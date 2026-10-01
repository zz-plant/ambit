import { create } from 'zustand';
import { tickAt } from '../components/civ/history';
import { gapOf, outageSplit, unlockCascade } from '../components/civ/layout';
import { currentSearch, readLinkState, type ActiveLens } from '../linkState';
import type { FocusDepth, FocusDirection } from '../linkState';
import type { Item, Connection, OpenCodeConfig } from '../utils/configImporter';
import { importConfig, importMcpServers } from '../utils/configImporter';
import { normalizeOpencode, parseJsonc } from '../../shared/opencode';
import { demoRun } from '../utils/demoRun';
import { demoSnapshot } from '../utils/demoSnapshot';
import {
  DEMO_ATTENTION,
  demoApproval,
  demoAudit,
  demoConfigGraph,
  demoHistory,
  demoProposals,
  demoTreeGraph,
} from './demo';
import {
  isApiError,
  type ApiResult,
  type ApiRoutes,
  type ApproveResponse,
  type AuditResponse,
  type BriefingResponse,
  type FrontierHistoryResponse,
  type UnmappedResponse,
  type InfrastructureScanResponse,
  type LoopSince,
  type LoopSnapshot,
  type ProposalRow,
  type QueueDecisionRequest,
  type QueueDecisionResponse,
  type QueueDecisionResult,
  type RejectResponse,
  type RepoScanResponse,
  type RunResponse,
} from '../../shared/api';

/**
 * The visualiser's state: the graph, what is selected, which lens and
 * simulation are active, and the actions that load each of those from the
 * API. Every loading action has two paths — the live one, and what to show on
 * the published demo where there is no API — and the demo half lives in
 * ./demo.ts so this file reads as the product's state rather than its fixture.
 */

// The URL is the one parser for view state; see ./linkState.ts. These are
// re-exported because the store is where components already reach for them.
export { LENSES } from '../linkState';
export type { ActiveLens } from '../linkState';

export interface Graph {
  items: Item[];
  connections: Connection[];
}

/**
 * One list for both views.
 *
 * The engine's tree carries the curated nodes, the machine's own entries, and
 * the edges between them: which entry proves which node. The config read-out
 * carries the facts only a config file has: a url, a command, whether an entry
 * is switched on. They used to be two graphs the store swapped between when
 * the tab changed, so the header counted one and the list showed the other.
 * Merged by id, an entry keeps the config's facts and gains the engine's
 * evidence, and the map and My Setup read one list.
 */
export function mergeGraphs(tree: Graph | null, config: Graph | null): Graph {
  if (!tree) return config ?? { items: [], connections: [] };
  if (!config) return tree;
  const fromConfig = new Map(config.items.map(i => [i.id, i]));
  const items: Item[] = tree.items.map(node => {
    const entry = fromConfig.get(node.id);
    if (!entry) return node;
    return {
      ...entry,
      description: entry.description || node.description,
      meta: { ...entry.meta, ...node.meta },
    };
  });
  const known = new Set(tree.items.map(i => i.id));
  for (const entry of config.items) if (!known.has(entry.id)) items.push(entry);
  // The tree's edges carry the meaning; the config's are the runtime's star,
  // kept only for an entry the engine has not seen.
  const extra = config.connections.filter(c => !known.has(c.from) || !known.has(c.to));
  return { items, connections: [...tree.connections, ...extra] };
}

/** What the address bar asks for, read once at startup. */
const initialLink = readLinkState(currentSearch());

/** The playhead, if a tick of this series has its second; otherwise now. */
const knownAt = (history: FrontierHistoryResponse, at: string | null) =>
  tickAt(history, at) ? at : null;

/**
 * A typed GET against the API. The store used to call `await res.json()` and
 * read fields off `any`, which meant a route changing shape produced an empty
 * panel rather than a compile error. The response types live in
 * src/shared/api.ts and the server is annotated with the same ones.
 */
async function getJson<K extends keyof ApiRoutes>(path: K): Promise<ApiRoutes[K] | null> {
  const res = await fetch(path);
  if (!res.ok) return null;
  const body = (await res.json()) as ApiResult<ApiRoutes[K]>;
  return isApiError(body) ? null : body;
}

let backendProbe: Promise<boolean> | null = null;
/** What a failed request says to the person: the error's own words, or that the network did not answer. */
const errorMessage = (e: unknown) => (e instanceof Error && e.message) || 'Network error';

/** Served from GitHub Pages, where no engine can be listening. */
export const isHostedDemo = (
  host = (globalThis as { location?: { hostname?: string } }).location?.hostname ?? ''
) => host === 'github.io' || host.endsWith('.github.io');

/**
 * Whether there is an engine behind the page. Probed once and remembered: the
 * published demo is static files on GitHub Pages, and every optional call —
 * the infrastructure scan, the config graph — used to fail in the console of
 * exactly the audience most likely to open it.
 *
 * A live backend answers /api/health with JSON. A static site answers every
 * path with index.html — which is a 200, so `r.ok` alone says "up". Requiring
 * the JSON payload is what tells the two apart, and it is why the demo shows
 * its welcome screen instead of an error.
 */
export function backendAvailable(): Promise<boolean> {
  // The hosted demo is GitHub Pages, which never has an engine behind it, and
  // asking anyway logged a 404 for /api/health in every visitor's console.
  if (!backendProbe && isHostedDemo()) {
    backendProbe = Promise.resolve(false);
    useAmbitStore.setState({ backend: 'static' });
  }
  backendProbe ??= fetch('/api/health')
    .then(r =>
      r
        .json()
        .then((j: unknown) => (j as { status?: string } | null)?.status === 'ok')
        .catch(() => false)
    )
    .catch(() => false)
    // Remembered in the store as well as in the promise: a component that
    // renders a control only a live engine can honour — the config toggle, the
    // repo and infrastructure tabs — needs the answer synchronously, and
    // awaiting a promise in a render is not an option.
    .then(ok => {
      useAmbitStore.setState({ backend: ok ? 'live' : 'static' });
      return ok;
    });
  return backendProbe;
}

import type {
  InfrastructureNode,
  InfrastructureLink,
  InfrastructureFinding,
  InfrastructureScan,
} from '../../shared/types.ts';
import { WEB_ACTOR } from '../utils/copy';

export type { InfrastructureNode, InfrastructureLink, InfrastructureFinding, InfrastructureScan };

/** An outage, an unlock, or the gap: what must be reached before a node can be. */
export type SimulationMode = 'none' | 'outage' | 'acquisition' | 'gap';

/** The approval UI's view of a proposal row, from the shared API contract. */
export type ProposalItem = ProposalRow;

interface StoreState {
  items: Item[];
  connections: Connection[];
  selectedItem: string | null;
  /** An era whose ladder is open in the detail panel, in place of a node. */
  selectedEra: number | null;
  hoveredItem: string | null;
  searchQuery: string;
  showDetailPanel: boolean;
  showApprovalModal: boolean;
  activeLens: ActiveLens;
  /** A legend key or a header segment, lit on its own: the one way to see a subset of the map. */
  spotlight: string | null;
  /**
   * The map is collapsed to the selected node's neighbourhood. It follows the
   * selection: another node takes the collapse with it, and no selection ends it.
   */
  collapsed: boolean;
  collapseDepth: FocusDepth;
  collapseDirection: FocusDirection;
  simulationMode: SimulationMode;
  simulatedNodeId: string | null;
  simulatedCascadeIds: Set<string>;
  /** In an outage, what keeps another provider and only loses one. */
  simulatedWeakenedIds: Set<string>;
  proposals: ProposalItem[];
  attentionInterventions: Record<string, number>;
  loading: boolean;
  error: string | null;
  /** Whether the graph on screen is the bundled demo rather than this machine. */
  demo: boolean;
  /** Where the time went and what would buy it back — from the ledger, or the demo's sample. */
  loop: LoopSnapshot | null;
  loopSource: 'ledger' | 'sample' | null;
  /**
   * How the map's range moved this week, from the tree view on a real
   * machine and from the sample on the demo. Null before a second
   * observation, which is a state the map explains.
   */
  rangeSince: LoopSince | null;
  /** True when the ledger exists and has recorded nothing yet. */
  loopEmpty: boolean;
  /** One run in time, and the recent ones to pick from. Null until asked for. */
  run: RunResponse | null;
  /** Whether an engine is answering, as far as the health probe got. */
  backend: 'unknown' | 'live' | 'static';
  /** How each repository's agent config has drifted from the global one. */
  repos: RepoScanResponse | null;
  /** The device and service topology, probed from the manifest. */
  infrastructure: InfrastructureScanResponse | null;
  /** What an agent is told at connect, for the person to read. */
  briefing: BriefingResponse | null;
  /** What the agents used that no node on the map accounts for. */
  unmapped: UnmappedResponse | null;
  /** The trail, one line per event: from the ledger, or the demo's sample. */
  audit: AuditResponse | null;
  /** The global config's MCP entries by name, so a repo missing one can be handed the entry. */
  configMcp: Record<string, Record<string, unknown>>;
  /**
   * The frontier through time, one tick per recorded observation. Null where
   * nothing can answer: no engine, or one that predates the route.
   */
  history: FrontierHistoryResponse | null;
  /**
   * The playhead: the second of the tick the map is scrubbed to, as the URL's
   * `at` writes it, or null for now. Kept until the series arrives, and then
   * dropped if no tick has that second.
   */
  historyAt: string | null;
  setHistoryAt: (at: string | null) => void;
  /**
   * Whether the timeline is open under the map. Closed until asked for, or
   * until a link names a moment: a strip that says nothing has moved is a
   * band of the screen spent on nothing.
   */
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;

  seedDemo: () => void;
  loadFromJSON: (json: string) => boolean;
  setShowApprovalModal: (show: boolean) => void;
  setActiveLens: (lens: ActiveLens) => void;
  setSpotlight: (group: string | null) => void;
  /**
   * Whether the map's key was opened or closed by hand; null until it is. A
   * lens opens the key by itself, so a new lens resets this, and Escape reads
   * it to close the key before it clears a highlight.
   */
  keyToggled: boolean | null;
  setKeyToggled: (open: boolean | null) => void;
  setCollapsed: (on: boolean) => void;
  setCollapseDepth: (depth: FocusDepth) => void;
  setCollapseDirection: (direction: FocusDirection) => void;
  startOutageSimulation: (nodeId: string) => void;
  startAcquisitionSimulation: (nodeId: string) => void;
  startGapSimulation: (nodeId: string) => void;
  clearSimulation: () => void;
  loadProposals: () => Promise<void>;
  loadLoop: () => Promise<void>;
  /** A run drawn in time: the one named, or the newest that recorded an ask. */
  loadRun: (id?: string) => Promise<void>;
  loadRepos: () => Promise<void>;
  loadInfrastructure: () => Promise<void>;
  probeBackend: () => Promise<void>;
  approveProposal: (
    proposalId: string,
    actor?: string
  ) => Promise<{ ok: boolean; artifact?: any; error?: string }>;
  rejectProposal: (proposalId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  /** Several drafts, each approved or turned down on its own; the answer is per id. */
  decideQueue: (
    decision: 'approve' | 'reject',
    ids: string[]
  ) => Promise<{ ok: boolean; results: QueueDecisionResult[]; error?: string }>;
  loadBriefing: () => Promise<void>;
  loadUnmapped: () => Promise<void>;
  loadAudit: () => Promise<void>;
  loadHistory: () => Promise<void>;
  /** The paste-ready entry for one MCP server, from the endpoint that composes it. */
  snippetFor: (name: string) => Promise<string | null>;
  loadAttentionData: () => Promise<void>;
  setItems: (items: Item[], connections: Connection[]) => void;
  selectItem: (id: string | null) => void;
  /** Open an era's ladder, or close it when it is already open. A node and an era are never selected together. */
  selectEra: (era: number | null) => void;
  hoverItem: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleDetailPanel: () => void;

  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  addConnection: (from: string, to: string, type: string) => void;
  removeConnection: (from: string, to: string) => void;

  /** The tree and the config read-out, fetched together and merged. */
  loadGraph: () => Promise<void>;
  toggleMcpEnabled: (name: string, enabled: boolean) => Promise<boolean>;

  reset: () => void;
}

export const useAmbitStore = create<StoreState>((set, get) => ({
  items: [],
  connections: [],
  selectedItem: null,
  selectedEra: null,
  hoveredItem: null,
  searchQuery: '',
  showDetailPanel: false,
  showApprovalModal: false,
  activeLens: initialLink.lens,
  spotlight: null,
  // A link's `collapse` is applied with the node it focuses, once the graph
  // holds it (linkFocus): with nothing selected there is nothing to collapse to.
  collapsed: false,
  collapseDepth: initialLink.depth,
  collapseDirection: initialLink.dir,
  simulationMode: 'none',
  simulatedNodeId: null,
  simulatedCascadeIds: new Set<string>(),
  simulatedWeakenedIds: new Set<string>(),
  proposals: [],
  attentionInterventions: {},
  loading: false,
  error: null,
  demo: false,
  loop: null,
  loopSource: null,
  rangeSince: null,
  loopEmpty: false,
  run: null,
  backend: 'unknown',
  repos: null,
  infrastructure: null,
  briefing: null,
  unmapped: null,
  audit: null,
  configMcp: {},
  history: null,
  historyAt: initialLink.at ?? null,
  historyOpen: Boolean(initialLink.at),

  setItems: (items, connections) => set({ items, connections }),

  selectItem: id => {
    const s = get();
    const next = s.selectedItem === id ? null : id;
    // A collapse is to a selected node's neighbourhood: with none selected there
    // is nothing to keep, and it must not wait to catch the next node picked.
    set({
      selectedItem: next,
      selectedEra: null,
      showDetailPanel: next !== null,
      ...(next === null ? { collapsed: false } : {}),
    });
  },
  selectEra: era => {
    const next = get().selectedEra === era ? null : era;
    set({
      selectedEra: next,
      selectedItem: null,
      showDetailPanel: next !== null,
      collapsed: false,
    });
  },
  hoverItem: id => set({ hoveredItem: id }),
  setSearch: q => set({ searchQuery: q }),
  toggleDetailPanel: () => set(s => ({ showDetailPanel: !s.showDetailPanel })),
  setShowApprovalModal: show => set({ showApprovalModal: show }),
  // No observation records attention or grants, so a lens that paints them is
  // a lens on now: chosen while the map is scrubbed, it brings the map back.
  // The standard lens is what a past map is drawn in, and keeps the playhead.
  setActiveLens: lens =>
    set(
      lens === 'default'
        ? { activeLens: lens, keyToggled: null }
        : { activeLens: lens, historyAt: null, keyToggled: null }
    ),
  setSpotlight: group => set({ spotlight: group }),
  keyToggled: null,
  setKeyToggled: open => set({ keyToggled: open }),
  // A simulation walks the live graph, and an outage needs providers, which no
  // snapshot stores, so scrubbing into the past ends one. Each simulation below
  // returns the map to now for the same reason, whichever surface started it.
  setHistoryAt: at => {
    if (at) get().clearSimulation();
    set(at ? { historyAt: at, historyOpen: true } : { historyAt: at });
  },
  // Closing the strip returns the map to now: a past map with no playhead on
  // screen would be a date nothing says.
  setHistoryOpen: open =>
    set(open ? { historyOpen: true } : { historyOpen: false, historyAt: null }),
  setCollapsed: on => set({ collapsed: on }),
  setCollapseDepth: depth => set({ collapseDepth: depth }),
  setCollapseDirection: direction => set({ collapseDirection: direction }),

  // The walks live in civ/layout.ts, where the detail panel reads the same
  // ones to state their size before any simulation is run.
  startOutageSimulation: (nodeId: string) => {
    const { stops, weakened } = outageSplit(get().items, get().connections, nodeId);
    set({
      historyAt: null,
      simulationMode: 'outage',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: stops,
      simulatedWeakenedIds: weakened,
    });
  },

  startAcquisitionSimulation: (nodeId: string) =>
    set({
      historyAt: null,
      simulationMode: 'acquisition',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: unlockCascade(get().items, get().connections, nodeId),
      simulatedWeakenedIds: new Set<string>(),
    }),

  startGapSimulation: (nodeId: string) =>
    set({
      historyAt: null,
      simulationMode: 'gap',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: gapOf(get().items, get().connections, nodeId).missing,
      simulatedWeakenedIds: new Set<string>(),
    }),

  clearSimulation: () =>
    set({
      simulationMode: 'none',
      simulatedNodeId: null,
      simulatedCascadeIds: new Set<string>(),
      simulatedWeakenedIds: new Set<string>(),
    }),

  // The demo's proposals are the demo's, whether or not an engine is behind
  // the page: with one, the panel used to fetch this machine's proposals into
  // a page the reader had asked to be a demo, and decide on them for real.
  loadProposals: async () => {
    if (get().demo || !(await backendAvailable())) {
      set({ proposals: demoProposals() });
      return;
    }
    try {
      const data = await getJson('/api/proposals');
      if (data) set({ proposals: data.proposals });
    } catch {
      /* ignore error */
    }
  },

  approveProposal: async (proposalId: string, actor = WEB_ACTOR) => {
    if (get().demo || !(await backendAvailable())) {
      // Demo mode approval simulation
      set(state => ({
        proposals: state.proposals.map(p =>
          p.id === proposalId
            ? {
                ...p,
                status: 'approved',
                approved_by: actor,
                approved_at: new Date().toISOString(),
              }
            : p
        ),
      }));
      return { ok: true, artifact: demoApproval(proposalId, actor) };
    }
    try {
      // The card's own hash, so a proposal that changed after it was drawn is
      // refused. No actor goes with it: the server decides as the person at the page.
      const proposalHash = get().proposals.find(p => p.id === proposalId)?.proposal_hash;
      const res = await fetch(`/api/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalHash }),
      });
      if (res.ok) {
        const data = (await res.json()) as ApproveResponse;
        await get().loadProposals();
        return { ok: true, artifact: data.artifact };
      }
      const err = (await res.json()) as { error?: string };
      return { ok: false, error: err?.error || 'Approval failed' };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },

  /**
   * The other half of every decision. In the demo the card is marked locally;
   * live, the engine records who turned it down and why, which is what the
   * next draft learns from.
   */
  rejectProposal: async (proposalId: string, reason?: string) => {
    if (get().demo || !(await backendAvailable())) {
      set(state => ({
        proposals: state.proposals.map(p =>
          p.id === proposalId ? { ...p, status: 'rejected' as const } : p
        ),
      }));
      return { ok: true };
    }
    try {
      const proposalHash = get().proposals.find(p => p.id === proposalId)?.proposal_hash;
      const res = await fetch(`/api/proposals/${proposalId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalHash, reason }),
      });
      if (res.ok) {
        (await res.json()) as RejectResponse;
        await get().loadProposals();
        return { ok: true };
      }
      const err = (await res.json()) as { error?: string };
      return { ok: false, error: err?.error || 'Could not record the decision' };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  },

  /**
   * The queue. Live, every id travels with the hash its card was drawn from,
   * and the engine refuses one that changed since while the rest go ahead.
   * In the demo the drafts are marked here, as the per-id paths mark them.
   */
  decideQueue: async (decision: 'approve' | 'reject', ids: string[]) => {
    const shown = get().proposals.filter(p => ids.includes(p.id) && p.status === 'draft');
    if (get().demo || !(await backendAvailable())) {
      const decided = new Set(shown.map(p => p.id));
      set(state => ({
        proposals: state.proposals.map(p =>
          !decided.has(p.id)
            ? p
            : decision === 'approve'
              ? {
                  ...p,
                  status: 'approved' as const,
                  approved_by: WEB_ACTOR,
                  approved_at: new Date().toISOString(),
                }
              : { ...p, status: 'rejected' as const }
        ),
      }));
      return { ok: true, results: shown.map(p => ({ id: p.id, decided: true as const })) };
    }
    try {
      const request: QueueDecisionRequest = {
        items: shown.map(p => ({ id: p.id, proposalHash: p.proposal_hash ?? '' })),
      };
      const res = await fetch(`/api/proposals/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = (await res.json()) as ApiResult<QueueDecisionResponse>;
      if (isApiError(data) || !res.ok) {
        return {
          ok: false,
          results: [],
          error: isApiError(data) ? data.error : 'Could not record the decisions',
        };
      }
      await get().loadProposals();
      return { ok: true, results: data.results };
    } catch (e) {
      return { ok: false, results: [], error: errorMessage(e) };
    }
  },

  loadBriefing: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/briefing');
      if (data) set({ briefing: data });
    } catch {
      /* the tab keeps its empty state */
    }
  },

  loadUnmapped: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/unmapped');
      if (data) set({ unmapped: data });
    } catch {
      /* the tab keeps its empty state */
    }
  },

  /**
   * The trail. The demo's is the demo's whether or not an engine answers, as
   * its proposals are; live, a failed read keeps what the view had.
   */
  loadAudit: async () => {
    if (get().demo) {
      set({ audit: demoAudit() });
      return;
    }
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/audit');
      if (data) set({ audit: data });
    } catch {
      /* the view keeps whatever it had */
    }
  },

  /**
   * The frontier through time, for the map's timeline. The demo has a series
   * of its own, recorded on fixed dates; a live engine answers from its ledger.
   * Without an engine the map offers no timeline, since nothing recorded one.
   */
  loadHistory: async () => {
    if (get().demo) {
      set({ history: demoHistory(), historyAt: knownAt(demoHistory(), get().historyAt) });
      return;
    }
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/frontier');
      // "Open the demo" may have been pressed while this was in flight.
      if (data && !get().demo) set({ history: data, historyAt: knownAt(data, get().historyAt) });
    } catch {
      /* the map keeps whatever it had */
    }
  },

  snippetFor: async (name: string) => {
    const entry = get().configMcp[name];
    if (!entry || !(await backendAvailable())) return null;
    try {
      const res = await fetch('/api/config/mcp-snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: entry }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { snippet?: string };
      return data.snippet ?? null;
    } catch {
      return null;
    }
  },

  probeBackend: async () => {
    await backendAvailable();
  },

  /**
   * The loop page's figures.
   *
   * The demo seeds a sample; a live engine answers with its own ledger, which
   * on a new machine is empty. Empty is a state the page renders rather than a
   * failure, because "no interventions recorded" and "your time costs nothing"
   * are different claims.
   */
  loadLoop: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/loop');
      if (!data) return;
      const { source, empty, ...snapshot } = data;
      set({ loop: snapshot, loopSource: source, loopEmpty: empty });
    } catch {
      /* the page keeps whatever it had rather than blanking */
    }
  },

  /**
   * One run laid out in time. The demo has runs written by hand; a live engine
   * answers from the ledger, and a ledger with no run is a state the section
   * says. An id is asked for by name, and an answer that is an error leaves what
   * the page already shows.
   */
  loadRun: async (id?: string) => {
    if (get().demo || !(await backendAvailable())) {
      set({ run: demoRun(id) });
      return;
    }
    // With nothing drawn yet, an answer that is not a run is a ledger with no
    // run, and says so. An engine that predates the route answers a plain 404,
    // and the section read "Reading the ledger…" for good.
    const none = () => {
      if (!get().run) set({ run: { recent: [], run: null } });
    };
    try {
      const res = await fetch(id ? `/api/run?id=${encodeURIComponent(id)}` : '/api/run');
      if (!res.ok) return none();
      const body = (await res.json()) as ApiResult<ApiRoutes['/api/run']>;
      if (!isApiError(body)) set({ run: body });
      else none();
    } catch {
      // Whatever the section already shows, it keeps.
      none();
    }
  },

  loadRepos: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/repos/scan');
      if (data) set({ repos: data });
    } catch {
      /* a scan that cannot run leaves the tab on its empty state */
    }
  },

  loadInfrastructure: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/infrastructure/scan');
      if (data) set({ infrastructure: data });
    } catch {
      /* as above: no manifest is the common case, not an error */
    }
  },

  loadAttentionData: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/attention');
      if (data) {
        const map: Record<string, number> = {};
        for (const row of data.interventions) map[row.capability_id] = row.count;
        set({ attentionInterventions: map });
      }
    } catch {
      /* ignore */
    }
  },
  /**
   * Draw a graph from JSON the browser was handed, with nothing installed.
   *
   * Two shapes arrive here. An agent config — the `opencode.json` a person can
   * drop on the welcome screen — goes through the same importer the live
   * `/api/config` path uses, so a visitor sees their own setup mapped without
   * an engine. A `{ items, connections }` export (`ambit graph`) is drawn as
   * it stands. Everything happens in the tab: nothing is uploaded, and the
   * file is not kept.
   */
  loadFromJSON: jsonStr => {
    let parsed: unknown;
    try {
      // A config may be `opencode.jsonc`, comments and all.
      parsed = parseJsonc(jsonStr);
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const data = parsed as Record<string, unknown>;

    if (Array.isArray(data.items)) {
      // An `ambit graph` export is taken at its word, with the fields an
      // older export may lack filled in.
      const items: Item[] = (data.items as Item[]).map(i => ({
        ...i,
        status: i.status || 'built',
        position: i.position || { x: 0, y: 0, z: 0 },
        meta: i.meta || {},
      }));
      const connections: Connection[] = ((data.connections as Connection[] | undefined) || []).map(
        c => ({ ...c, type: c.type || 'connects' })
      );
      set({ items, connections, loading: false, error: null, demo: false });
      return true;
    }

    // An agent config: OpenCode's mcp, agent, provider, command, skills, or
    // the mcpServers block the other runtimes write. A file with none of
    // those is some other JSON, and drawing an empty graph from it would look
    // like a bug in the reader, not a mismatch in the file.
    // OpenCode 2's names (`agents`, `mcp.servers`, ...) are read into the
    // ones the importer knows, as the server does for /api/config.
    const config = normalizeOpencode(data);
    const looksLikeConfig = ['mcp', 'agent', 'provider', 'command', 'skills'].some(
      k => config[k] && typeof config[k] === 'object'
    );
    const graph = looksLikeConfig ? importConfig(config as OpenCodeConfig) : importMcpServers(data);
    if (!graph) return false;
    if (!graph.items.length) return false;
    set({ ...graph, loading: false, error: null, demo: false });
    return true;
  },

  // One seed: the curated eras the README's hero image shows, and the config
  // entries that prove them, merged the way a live machine's are. Marked as
  // demo so a later health probe cannot clobber it.
  seedDemo: () =>
    set({
      ...mergeGraphs(demoTreeGraph(), demoConfigGraph()),
      loading: false,
      error: null,
      demo: true,
      loop: demoSnapshot(),
      loopSource: 'sample',
      loopEmpty: false,
      rangeSince: demoSnapshot().since,
      attentionInterventions: DEMO_ATTENTION,
      history: demoHistory(),
      historyAt: knownAt(demoHistory(), get().historyAt),
    }),

  updateItem: (id, updates) =>
    set(state => ({
      items: state.items.map(i => (i.id === id ? { ...i, ...updates } : i)),
    })),

  deleteItem: id =>
    set(state => ({
      items: state.items.filter(i => i.id !== id),
      connections: state.connections.filter(c => c.from !== id && c.to !== id),
      selectedItem: state.selectedItem === id ? null : state.selectedItem,
    })),

  addConnection: (from, to, type) =>
    set(state => {
      if (state.connections.some(c => c.from === from && c.to === to)) return state;
      return { connections: [...state.connections, { from, to, type }] };
    }),

  removeConnection: (from, to) =>
    set(state => ({
      connections: state.connections.filter(c => !(c.from === from && c.to === to)),
    })),

  /**
   * The graph, from the engine and the config file together.
   *
   * The tree and the config read-out are asked for at once and merged, so
   * switching views never goes to the network and never swaps the list under
   * the header. Locked nodes arrive as 'specified', which the renderers draw
   * as not yet reached.
   */
  loadGraph: async () => {
    // No live backend means the published demo: an empty graph and the
    // welcome screen, not an error. "Open the demo" is the entry there.
    if (!(await backendAvailable())) {
      // The health probe is async: if "Open the demo" was clicked (or ?demo=1
      // ran) while this was in flight, don't clobber the seeded graph.
      if (get().demo) return;
      set({ items: [], connections: [], loading: false, error: null, demo: false });
      return;
    }
    set({ loading: true, error: null, demo: false });
    try {
      const [tree, config] = await Promise.all([getJson('/api/tech-tree'), getJson('/api/config')]);
      const treeGraph = tree ? { items: tree.items, connections: tree.connections } : null;
      const configGraph = config ? importConfig(config.config) : null;
      const mcp = (config?.config as { mcp?: Record<string, Record<string, unknown>> })?.mcp;
      set({ configMcp: mcp && typeof mcp === 'object' ? mcp : {} });
      if (!treeGraph && !configGraph) {
        set({ error: 'No graph yet. Run ./bootstrap.sh to seed one.', loading: false });
        return;
      }
      const merged = mergeGraphs(treeGraph, configGraph);
      set({
        items: merged.items,
        connections: merged.connections,
        rangeSince: tree?.since ?? null,
        loading: false,
        error: null,
      });
    } catch (e) {
      set({ error: 'Could not load: ' + (e as Error).message, loading: false });
    }
  },

  toggleMcpEnabled: async (name: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/config/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enableMcp: enabled ? [name] : [],
          disableMcp: !enabled ? [name] : [],
        }),
      });
      if (res.ok) {
        await get().loadGraph();
        return true;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  },

  reset: () =>
    set({
      items: [],
      connections: [],
      selectedItem: null,
      selectedEra: null,
      collapsed: false,
      hoveredItem: null,
      searchQuery: '',
      showDetailPanel: false,
      loading: false,
      error: null,
      demo: false,
    }),
}));
