import { create } from 'zustand';
import { gapOf, outageSplit, unlockCascade } from '../components/civ/layout';
import { currentSearch, readLinkState, type ActiveLens } from '../linkState';
import type { Item, Connection, OpenCodeConfig } from '../utils/configImporter';
import { importConfig, importMcpServers } from '../utils/configImporter';
import { demoSnapshot } from '../utils/demoSnapshot';
import {
  DEMO_ATTENTION,
  demoApproval,
  demoConfigGraph,
  demoProposals,
  demoTreeGraph,
} from './demo';
import {
  isApiError,
  type ApiResult,
  type ApiRoutes,
  type ApproveResponse,
  type BriefingResponse,
  type InfrastructureScanResponse,
  type LoopSince,
  type LoopSnapshot,
  type ProposalRow,
  type RejectResponse,
  type RepoScanResponse,
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
  hoveredItem: string | null;
  searchQuery: string;
  showDetailPanel: boolean;
  showApprovalModal: boolean;
  activeLens: ActiveLens;
  /** A legend key or a header segment, lit on its own: the one way to see a subset of the map. */
  spotlight: string | null;
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
  /** Whether an engine is answering, as far as the health probe got. */
  backend: 'unknown' | 'live' | 'static';
  /** How each repository's agent config has drifted from the global one. */
  repos: RepoScanResponse | null;
  /** The device and service topology, probed from the manifest. */
  infrastructure: InfrastructureScanResponse | null;
  /** What an agent is told at connect, for the person to read. */
  briefing: BriefingResponse | null;
  /** The global config's MCP entries by name, so a repo missing one can be handed the entry. */
  configMcp: Record<string, Record<string, unknown>>;

  seedDemo: () => void;
  loadFromJSON: (json: string) => boolean;
  setShowApprovalModal: (show: boolean) => void;
  setActiveLens: (lens: ActiveLens) => void;
  setSpotlight: (group: string | null) => void;
  startOutageSimulation: (nodeId: string) => void;
  startAcquisitionSimulation: (nodeId: string) => void;
  startGapSimulation: (nodeId: string) => void;
  clearSimulation: () => void;
  loadProposals: () => Promise<void>;
  loadLoop: () => Promise<void>;
  loadRepos: () => Promise<void>;
  loadInfrastructure: () => Promise<void>;
  probeBackend: () => Promise<void>;
  approveProposal: (
    proposalId: string,
    actor?: string
  ) => Promise<{ ok: boolean; artifact?: any; error?: string }>;
  rejectProposal: (proposalId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  loadBriefing: () => Promise<void>;
  /** The paste-ready entry for one MCP server, from the endpoint that composes it. */
  snippetFor: (name: string) => Promise<string | null>;
  loadAttentionData: () => Promise<void>;
  setItems: (items: Item[], connections: Connection[]) => void;
  selectItem: (id: string | null) => void;
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
  hoveredItem: null,
  searchQuery: '',
  showDetailPanel: false,
  showApprovalModal: false,
  activeLens: initialLink.lens,
  spotlight: null,
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
  backend: 'unknown',
  repos: null,
  infrastructure: null,
  briefing: null,
  configMcp: {},

  setItems: (items, connections) => set({ items, connections }),

  selectItem: id => {
    const s = get();
    const next = s.selectedItem === id ? null : id;
    set({ selectedItem: next, showDetailPanel: next !== null });
  },
  hoverItem: id => set({ hoveredItem: id }),
  setSearch: q => set({ searchQuery: q }),
  toggleDetailPanel: () => set(s => ({ showDetailPanel: !s.showDetailPanel })),
  setShowApprovalModal: show => set({ showApprovalModal: show }),
  setActiveLens: lens => set({ activeLens: lens }),
  setSpotlight: group => set({ spotlight: group }),

  // The walks live in civ/layout.ts, where the detail panel reads the same
  // ones to state their size before any simulation is run.
  startOutageSimulation: (nodeId: string) => {
    const { stops, weakened } = outageSplit(get().items, get().connections, nodeId);
    set({
      simulationMode: 'outage',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: stops,
      simulatedWeakenedIds: weakened,
    });
  },

  startAcquisitionSimulation: (nodeId: string) =>
    set({
      simulationMode: 'acquisition',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: unlockCascade(get().items, get().connections, nodeId),
      simulatedWeakenedIds: new Set<string>(),
    }),

  startGapSimulation: (nodeId: string) =>
    set({
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
      const res = await fetch(`/api/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor }),
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
      const res = await fetch(`/api/proposals/${proposalId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: WEB_ACTOR, reason }),
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

  loadBriefing: async () => {
    if (!(await backendAvailable())) return;
    try {
      const data = await getJson('/api/briefing');
      if (data) set({ briefing: data });
    } catch {
      /* the tab keeps its empty state */
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
      parsed = JSON.parse(jsonStr);
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
    const looksLikeConfig = ['mcp', 'agent', 'provider', 'command', 'skills'].some(
      k => data[k] && typeof data[k] === 'object'
    );
    const graph = looksLikeConfig ? importConfig(data as OpenCodeConfig) : importMcpServers(data);
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
      hoveredItem: null,
      searchQuery: '',
      showDetailPanel: false,
      loading: false,
      error: null,
      demo: false,
    }),
}));
