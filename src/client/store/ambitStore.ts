import { create } from 'zustand';
import type { Item, Connection } from '../utils/configImporter';
import { importConfig } from '../utils/configImporter';
import { demoSnapshot, type DemoSnapshot } from '../utils/demoSnapshot';
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
  type ProposalRow,
} from '../../shared/api';

/**
 * The visualiser's state: the graph, what is selected, which lens and
 * simulation are active, and the actions that load each of those from the
 * API. Every loading action has two paths — the live one, and what to show on
 * the published demo where there is no API — and the demo half lives in
 * ./demo.ts so this file reads as the product's state rather than its fixture.
 */

/** Matches the mobile breakpoint in App.css, where the panels become sheets. */
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

export type TreeFilter = 'all' | 'server' | 'agent' | 'skill' | 'combo' | 'compact';
export const TREE_FILTERS: readonly TreeFilter[] = [
  'all',
  'server',
  'agent',
  'skill',
  'combo',
  'compact',
];

/** The one place the filter's initial value comes from: URL param wins over a
 *  saved preference, both are validated, everything else is 'all'. */
function readInitialTreeFilter(): TreeFilter {
  if (typeof window === 'undefined') return 'all';
  const candidate =
    new URLSearchParams(window.location.search).get('treeFilter') ??
    localStorage.getItem('ambit.treeFilter');
  return candidate && (TREE_FILTERS as readonly string[]).includes(candidate)
    ? (candidate as TreeFilter)
    : 'all';
}

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
  backendProbe ??= fetch('/api/health')
    .then(r =>
      r
        .json()
        .then((j: any) => j?.status === 'ok')
        .catch(() => false)
    )
    .catch(() => false);
  return backendProbe;
}

import type {
  InfrastructureNode,
  InfrastructureLink,
  InfrastructureFinding,
  InfrastructureScan,
} from '../../shared/types.ts';

export type { InfrastructureNode, InfrastructureLink, InfrastructureFinding, InfrastructureScan };

export type ActiveLens = 'default' | 'attention' | 'credentials';
export type SimulationMode = 'none' | 'outage' | 'acquisition';

/** The approval UI's view of a proposal row, from the shared API contract. */
export type ProposalItem = ProposalRow;

interface StoreState {
  items: Item[];
  connections: Connection[];
  selectedItem: string | null;
  hoveredItem: string | null;
  searchQuery: string;
  showDetailPanel: boolean;
  /** Backwards compatibility alias for showDetailPanel. */
  showStarPanel: boolean;
  showApprovalModal: boolean;
  treeFilter: TreeFilter;
  activeLens: ActiveLens;
  simulationMode: SimulationMode;
  simulatedNodeId: string | null;
  simulatedCascadeIds: Set<string>;
  proposals: ProposalItem[];
  attentionInterventions: Record<string, number>;
  loading: boolean;
  error: string | null;
  /** The loop snapshot the static demo renders (null off-demo). */
  demo: DemoSnapshot | null;

  seedDemo: () => void;
  seedDemoTree: () => void;
  loadFromJSON: (json: string) => boolean;
  setShowApprovalModal: (show: boolean) => void;
  setActiveLens: (lens: ActiveLens) => void;
  startOutageSimulation: (nodeId: string) => void;
  startAcquisitionSimulation: (nodeId: string) => void;
  clearSimulation: () => void;
  loadProposals: () => Promise<void>;
  approveProposal: (
    proposalId: string,
    actor?: string
  ) => Promise<{ ok: boolean; artifact?: any; error?: string }>;
  loadAttentionData: () => Promise<void>;
  setItems: (items: Item[], connections: Connection[]) => void;
  selectItem: (id: string | null) => void;
  hoverItem: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleDetailPanel: () => void;
  /** Backwards compatibility alias for toggleDetailPanel. */
  toggleStarPanel: () => void;
  setTreeFilter: (f: TreeFilter) => void;

  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  addConnection: (from: string, to: string, type: string) => void;
  removeConnection: (from: string, to: string) => void;

  loadConfig: () => Promise<void>;
  toggleMcpEnabled: (name: string, enabled: boolean) => Promise<boolean>;
  loadTechTree: () => Promise<boolean>;

  reset: () => void;
}

export const useAmbitStore = create<StoreState>((set, get) => ({
  items: [],
  connections: [],
  selectedItem: null,
  hoveredItem: null,
  searchQuery: '',
  showDetailPanel: false,
  showStarPanel: false,
  showApprovalModal: false,
  treeFilter: readInitialTreeFilter(),
  activeLens: 'default',
  simulationMode: 'none',
  simulatedNodeId: null,
  simulatedCascadeIds: new Set<string>(),
  proposals: [],
  attentionInterventions: DEMO_ATTENTION,
  loading: false,
  error: null,
  demo: null,

  setItems: (items, connections) => set({ items, connections }),

  selectItem: id => {
    const s = get();
    const next = s.selectedItem === id ? null : id;
    set({ selectedItem: next, showDetailPanel: next !== null, showStarPanel: next !== null });
  },
  hoverItem: id => set({ hoveredItem: id }),
  setSearch: q => set({ searchQuery: q }),
  toggleDetailPanel: () =>
    set(s => ({ showDetailPanel: !s.showDetailPanel, showStarPanel: !s.showDetailPanel })),
  toggleStarPanel: () =>
    set(s => ({ showDetailPanel: !s.showStarPanel, showStarPanel: !s.showStarPanel })),
  setShowApprovalModal: show => set({ showApprovalModal: show }),
  setActiveLens: lens => set({ activeLens: lens }),

  startOutageSimulation: (nodeId: string) => {
    const { connections } = get();
    const downstream = new Map<string, string[]>();
    for (const c of connections) {
      if (!downstream.has(c.from)) downstream.set(c.from, []);
      downstream.get(c.from)!.push(c.to);
    }
    const cascade = new Set<string>();
    const q = [nodeId];
    while (q.length) {
      const curr = q.shift()!;
      for (const next of downstream.get(curr) || []) {
        if (!cascade.has(next)) {
          cascade.add(next);
          q.push(next);
        }
      }
    }
    set({
      simulationMode: 'outage',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: cascade,
    });
  },

  startAcquisitionSimulation: (nodeId: string) => {
    const { items, connections } = get();
    const hardReqs = new Map<string, string[]>();
    for (const c of connections) {
      if (c.type === 'hard-dep') {
        if (!hardReqs.has(c.to)) hardReqs.set(c.to, []);
        hardReqs.get(c.to)!.push(c.from);
      }
    }
    const itemState = new Map(items.map(i => [i.id, i.status]));
    itemState.set(nodeId, 'built'); // simulate acquired

    const unlocked = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [targetId, prereqs] of hardReqs.entries()) {
        if (itemState.get(targetId) !== 'built' && !unlocked.has(targetId)) {
          const allMet = prereqs.every(p => itemState.get(p) === 'built' || unlocked.has(p));
          if (allMet) {
            unlocked.add(targetId);
            changed = true;
          }
        }
      }
    }
    set({
      simulationMode: 'acquisition',
      simulatedNodeId: nodeId,
      simulatedCascadeIds: unlocked,
    });
  },

  clearSimulation: () =>
    set({
      simulationMode: 'none',
      simulatedNodeId: null,
      simulatedCascadeIds: new Set<string>(),
    }),

  loadProposals: async () => {
    if (!(await backendAvailable())) {
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

  approveProposal: async (proposalId: string, actor = 'human:kanav') => {
    if (!(await backendAvailable())) {
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
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error' };
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
  loadFromJSON: jsonStr => {
    try {
      const data = JSON.parse(jsonStr);
      const items: Item[] = (data.items || []).map((i: Partial<Item>) => ({
        ...i,
        status: i.status || 'built',
        position: i.position || { x: 0, y: 0, z: 0 },
        meta: i.meta || {},
      }));
      const connections: Connection[] = (data.connections || []).map((c: Partial<Connection>) => ({
        ...c,
        type: c.type || 'connects',
      }));
      set({ items, connections, loading: false, error: null });
      return true;
    } catch {
      return false;
    }
  },

  // Two demo seeds because the two views are different datasets: the tree is
  // the curated eras the README's hero image shows, the config view is a flat
  // list of discovered entries. Both mark the store as demo so a later health
  // probe cannot clobber them.
  seedDemoTree: () =>
    set({ ...demoTreeGraph(), loading: false, error: null, demo: demoSnapshot() }),

  seedDemo: () => set({ ...demoConfigGraph(), loading: false, error: null, demo: demoSnapshot() }),

  setTreeFilter: treeFilter => {
    set({ treeFilter });
    if (typeof window === 'undefined') return;
    localStorage.setItem('ambit.treeFilter', treeFilter);
    const url = new URL(window.location.href);
    url.searchParams.set('treeFilter', treeFilter);
    window.history.replaceState({}, document.title, url);
  },

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

  loadConfig: async () => {
    // No live backend means the published demo: an empty graph and the
    // welcome screen, not an error. LOAD DEMO is the entry there.
    if (!(await backendAvailable())) {
      // The health probe is async: if LOAD DEMO was clicked (or ?demo=1 ran)
      // while this was in flight, don't clobber the seeded graph on resolve.
      if (get().demo) return;
      set({ items: [], connections: [], loading: false, error: null, demo: null });
      return;
    }
    set({ loading: true, error: null, demo: null });
    try {
      const data = await getJson('/api/config');
      if (!data) {
        set({ error: 'Cannot reach the API. Start it with `npm run server`.', loading: false });
        return;
      }
      const base = importConfig(data.config);
      set({ items: base.items, connections: base.connections, loading: false });
      if (!isNarrowViewport()) get().selectItem('mcp:cloudflare');
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
        await get().loadConfig();
        return true;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  },

  // Loads the engine's graph — the curated tech tree plus the user's own
  // capabilities — instead of the config-derived view. Locked nodes arrive as
  // 'specified', which the renderers already draw as not-yet-built.
  loadTechTree: async () => {
    // No engine to serve a tree: render the snapshot that ships with the
    // bundle. This is the published demo's path, and it used to `return false`
    // and change nothing at all — so on the page the README sends every
    // visitor to first, clicking the tab named after the product did nothing,
    // with no message and no failed request to notice. A view that cannot load
    // has to say so or show something; silence is the one option that reads as
    // a broken build.
    if (!(await backendAvailable())) {
      get().seedDemoTree();
      return true;
    }
    set({ loading: true, error: null, demo: null });
    try {
      const data = await getJson('/api/tech-tree');
      if (!data) {
        set({ error: 'No graph yet. Run ./bootstrap.sh to seed one.', loading: false });
        return false;
      }
      set({ items: data.items, connections: data.connections, loading: false, error: null });
      return true;
    } catch (e) {
      set({ error: 'Tech tree unavailable: ' + (e as Error).message, loading: false });
      return false;
    }
  },

  reset: () =>
    set({
      items: [],
      connections: [],
      selectedItem: null,
      hoveredItem: null,
      searchQuery: '',
      showDetailPanel: false,
      showStarPanel: false,
      loading: false,
      error: null,
      demo: null,
    }),
}));
