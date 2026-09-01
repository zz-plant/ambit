import { create } from 'zustand';
import type { Item, Connection } from '../utils/configImporter';
import { importConfig } from '../utils/configImporter';
import { demoSnapshot, type DemoSnapshot } from '../utils/demoSnapshot';

/**
 * The published demo is static files on GitHub Pages with no API behind it, so
 * every optional call — infrastructure scan, the config graph — failed in the
 * console of exactly the audience most likely to open one. Probe once, remember
 * the answer, and let those calls opt out.
 *
 * Only optional calls use this. Loading the config still reports its own
 * failure, because there the API not being up is the answer to the question.
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

let backendProbe: Promise<boolean> | null = null;
/**
 * A live backend answers /api/health with JSON. A static site (the published
 * demo on GitHub Pages) answers every path with index.html — which is a 200,
 * so `r.ok` alone says "up". Requiring the JSON payload is what tells the two
 * apart, and it is why the demo shows its welcome screen instead of an error.
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

export interface ProposalItem {
  id: string;
  created_at: string;
  goal: string;
  status: 'draft' | 'approved' | 'applied' | 'rejected';
  steps: string;
  approved_by?: string;
  approved_at?: string;
}

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

export const useToolchainStore = create<StoreState>((set, get) => ({
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
  attentionInterventions: {
    'tool:bash': 42,
    'mcp:github': 28,
    'skill:vitest': 14,
    'mcp:cloudflare': 8,
  },
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
      // Load demo proposals
      set({
        proposals: [
          {
            id: 'prop-deploy-staging-42',
            created_at: new Date(Date.now() - 3600000).toISOString(),
            goal: 'Deploy Billing Service Hotfix to Staging Cluster',
            status: 'draft',
            steps: JSON.stringify([
              { action: 'verify_kubeconfig', provider: 'tool:kubectl', status: 'pending' },
              { action: 'apply_k8s_manifest', provider: 'tool:kubectl', status: 'pending' },
              { action: 'run_smoke_tests', provider: 'skill:vitest', status: 'pending' },
            ]),
          },
          {
            id: 'prop-offline-semantic-search',
            created_at: new Date(Date.now() - 86400000).toISOString(),
            goal: 'Acquire pgvector extension on local Postgres for offline RAG',
            status: 'approved',
            steps: JSON.stringify([
              { action: 'enable_extension', provider: 'tool:postgres', status: 'done' },
            ]),
            approved_by: 'human:kanav',
            approved_at: new Date(Date.now() - 72000000).toISOString(),
          },
        ],
      });
      return;
    }
    try {
      const res = await fetch('/api/proposals');
      if (res.ok) {
        const data = await res.json();
        set({ proposals: data.proposals || [] });
      }
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
      return {
        ok: true,
        artifact: {
          proposal_id: proposalId,
          actor,
          timestamp: new Date().toISOString(),
          signature: 'hmac-sha256-demo-sig-7f8a9b2c3d4e5f',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      };
    }
    try {
      const res = await fetch(`/api/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor }),
      });
      if (res.ok) {
        const data = await res.json();
        await get().loadProposals();
        return { ok: true, artifact: data.artifact };
      }
      const err = await res.json();
      return { ok: false, error: err?.error || 'Approval failed' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error' };
    }
  },

  loadAttentionData: async () => {
    if (!(await backendAvailable())) return;
    try {
      const res = await fetch('/api/attention');
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, number> = {};
        for (const row of data.interventions || []) {
          map[row.capability_id] = row.count;
        }
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

  seedDemo: () => {
    const items: Omit<Item, 'position'>[] = [
      {
        id: 'opencode-core',
        name: 'OpenCode',
        type: 'framework',
        status: 'built',
        description: 'Main framework',
        meta: { domain: 'meta' },
      },
      {
        id: 'mcp:playwright',
        name: 'Playwright',
        type: 'mcp-server',
        status: 'built',
        description: 'Browser automation',
        meta: { domain: 'quality' },
      },
      {
        id: 'mcp:cloudflare',
        name: 'Cloudflare',
        type: 'mcp-server',
        status: 'built',
        description: 'Edge compute',
        meta: { domain: 'backend' },
      },
      {
        id: 'mcp:tailscale',
        name: 'Tailscale',
        type: 'mcp-server',
        status: 'built',
        description: 'Mesh VPN',
        meta: { domain: 'infra' },
      },
      {
        id: 'mcp:github',
        name: 'GitHub',
        type: 'mcp-server',
        status: 'built',
        description: 'CI + repos',
        meta: { domain: 'devops' },
      },
      {
        id: 'mcp:1password',
        name: '1Password',
        type: 'mcp-server',
        status: 'built',
        description: 'Secrets',
        meta: { domain: 'security' },
      },
      {
        id: 'mcp:brew',
        name: 'Homebrew',
        type: 'mcp-server',
        status: 'built',
        description: 'Packages',
        meta: { domain: 'devops' },
      },
      {
        id: 'agent:oracle',
        name: 'Oracle',
        type: 'agent',
        status: 'built',
        description: 'Debugging',
        meta: { domain: 'meta' },
      },
      {
        id: 'agent:deep',
        name: 'Deep Agent',
        type: 'agent',
        status: 'built',
        description: 'Autonomous',
        meta: { domain: 'meta' },
      },
      {
        id: 'agent:steward',
        name: 'Steward',
        type: 'agent',
        status: 'built',
        description: 'Repos',
        meta: { domain: 'devops' },
      },
      {
        id: 'skill:frontend',
        name: 'Frontend',
        type: 'skill',
        status: 'built',
        description: 'UI patterns',
        meta: { domain: 'frontend' },
      },
      {
        id: 'skill:cloudflare',
        name: 'Cloudflare',
        type: 'skill',
        status: 'built',
        description: 'Workers',
        meta: { domain: 'backend' },
      },
      {
        id: 'skill:wrangler',
        name: 'Wrangler',
        type: 'skill',
        status: 'built',
        description: 'CLI',
        meta: { domain: 'backend' },
      },
      {
        id: 'skill:playwright',
        name: 'Browser',
        type: 'skill',
        status: 'built',
        description: 'E2E',
        meta: { domain: 'quality' },
      },
      {
        id: 'skill:vitest',
        name: 'Vitest',
        type: 'skill',
        status: 'built',
        description: 'Unit tests',
        meta: { domain: 'quality' },
      },
      {
        id: 'skill:durable-objects',
        name: 'Durable Objects',
        type: 'skill',
        status: 'specified',
        description: 'Stateful',
        meta: { domain: 'backend' },
      },
      {
        id: 'skill:agents-sdk',
        name: 'Agents SDK',
        type: 'skill',
        status: 'specified',
        description: 'Framework',
        meta: { domain: 'ai-ml' },
      },
      {
        id: 'skill:llm',
        name: 'LLM',
        type: 'skill',
        status: 'built',
        description: 'Local models',
        meta: { domain: 'ai-ml' },
      },
      {
        id: 'skill:gguf',
        name: 'GGUF',
        type: 'skill',
        status: 'built',
        description: 'Quant',
        meta: { domain: 'ai-ml' },
      },
      {
        id: 'combo:e2e',
        name: 'E2E on Edge',
        type: 'possibility',
        status: 'specified',
        description: 'Deploy+verify',
        meta: { domain: 'quality' },
      },
      {
        id: 'combo:deploy',
        name: 'Deploy Pipeline',
        type: 'possibility',
        status: 'specified',
        description: 'Push→build',
        meta: { domain: 'devops' },
      },
      {
        id: 'combo:local-ai',
        name: 'Local Inference',
        type: 'possibility',
        status: 'built',
        description: 'Quant→run',
        meta: { domain: 'ai-ml' },
      },
      {
        id: 'tool:bash',
        name: 'Shell',
        type: 'framework',
        status: 'built',
        description: 'Commands',
        meta: { domain: 'infra' },
      },
      {
        id: 'tool:edit',
        name: 'Editor',
        type: 'framework',
        status: 'built',
        description: 'Files',
        meta: { domain: 'meta' },
      },
      {
        id: 'tool:lsp',
        name: 'LSP',
        type: 'framework',
        status: 'built',
        description: 'Diagnostics',
        meta: { domain: 'quality' },
      },
    ];
    const connections = [
      { from: 'opencode-core', to: 'mcp:playwright', type: 'connects' },
      { from: 'opencode-core', to: 'mcp:cloudflare', type: 'connects' },
      { from: 'opencode-core', to: 'mcp:github', type: 'connects' },
      { from: 'opencode-core', to: 'agent:oracle', type: 'subagent' },
      { from: 'skill:cloudflare', to: 'combo:e2e', type: 'hard-dep' },
      { from: 'skill:playwright', to: 'combo:e2e', type: 'hard-dep' },
      { from: 'skill:cloudflare', to: 'combo:deploy', type: 'hard-dep' },
      { from: 'skill:wrangler', to: 'combo:deploy', type: 'hard-dep' },
      { from: 'skill:llm', to: 'combo:local-ai', type: 'hard-dep' },
      { from: 'skill:gguf', to: 'combo:local-ai', type: 'hard-dep' },
      { from: 'mcp:playwright', to: 'combo:e2e', type: 'soft-dep' },
      { from: 'skill:vitest', to: 'combo:e2e', type: 'soft-dep' },
      { from: 'skill:durable-objects', to: 'combo:deploy', type: 'soft-dep' },
      { from: 'skill:agents-sdk', to: 'combo:deploy', type: 'soft-dep' },
    ];
    set({
      items: items.map((i, idx) => ({
        ...i,
        position: { x: 100 + (idx % 6) * 80, y: 50 + Math.floor(idx / 6) * 70, z: 0 },
      })),
      connections,
      loading: false,
      error: null,
      demo: demoSnapshot(),
    });
    // Not on a phone: the inspector is a sheet there, so opening one unasked
    // covers the graph the visitor came to look at.
    if (!isNarrowViewport()) get().selectItem('mcp:cloudflare');
  },

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
      const res = await fetch('/api/config');
      if (!res.ok) {
        set({ error: 'Cannot reach the API. Start it with `bun run server`.', loading: false });
        return;
      }
      const { config } = await res.json();
      const base = importConfig(config);
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
    // A static site has no engine to serve a tree — show the welcome screen.
    if (!(await backendAvailable())) {
      set({ items: [], connections: [], loading: false, error: null, demo: null });
      return false;
    }
    set({ loading: true, error: null, demo: null });
    try {
      const res = await fetch('/api/tech-tree');
      if (!res.ok) {
        set({ error: 'No graph yet. Run ./bootstrap.sh to seed one.', loading: false });
        return false;
      }
      const { items, connections } = await res.json();
      set({ items, connections, loading: false, error: null });
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

export const useAmbitStore = useToolchainStore;
