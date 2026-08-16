import { create } from 'zustand';
import type { Item, Connection } from '../utils/configImporter';
import { importConfig } from '../utils/configImporter';

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

let backendProbe: Promise<boolean> | null = null;
function backendAvailable(): Promise<boolean> {
  backendProbe ??= fetch('/api/health')
    .then(r => r.ok)
    .catch(() => false);
  return backendProbe;
}

interface InfrastructureNode {
  id: string;
  name: string;
  kind: 'device' | 'service' | 'api' | 'network' | 'workflow';
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  description: string;
  meta?: Record<string, unknown>;
}

interface InfrastructureLink {
  from: string;
  to: string;
  type: string;
}

interface InfrastructureFinding {
  severity: 'warn' | 'info' | 'error';
  message: string;
  relatedIds?: string[];
}

export interface InfrastructureScan {
  generatedAt: string;
  source: string;
  nodes: InfrastructureNode[];
  links: InfrastructureLink[];
  findings: InfrastructureFinding[];
  summary: { online: number; degraded: number; offline: number; unknown: number };
}

interface StoreState {
  items: Item[];
  connections: Connection[];
  selectedItem: string | null;
  hoveredItem: string | null;
  searchQuery: string;
  showStarPanel: boolean;
  showUplinkModal: boolean;
  treeFilter: 'all' | 'server' | 'agent' | 'skill' | 'combo';
  loading: boolean;
  error: string | null;
  infrastructureScan: InfrastructureScan | null;

  seedDemo: () => void;
  loadFromJSON: (json: string) => boolean;
  setShowUplinkModal: (show: boolean) => void;
  loadInfrastructureScan: () => Promise<InfrastructureScan | null>;
  updateItemOnServer: (id: string, type: string, updates: any) => Promise<boolean>;
  setItems: (items: Item[], connections: Connection[]) => void;
  selectItem: (id: string | null) => void;
  hoverItem: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleStarPanel: () => void;
  setTreeFilter: (f: 'all' | 'server' | 'agent' | 'skill' | 'combo') => void;

  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  addConnection: (from: string, to: string, type: string) => void;
  removeConnection: (from: string, to: string) => void;

  loadConfig: () => Promise<void>;
  toggleMcpEnabled: (name: string, enabled: boolean) => Promise<boolean>;
  buildMcpSnippet: (name: string, mcpConfig: any) => Promise<{ snippet: string; configPath: string } | null>;
  loadTechTree: () => Promise<boolean>;

  reset: () => void;
}

function statusToItemStatus(status: InfrastructureNode['status']): Item['status'] {
  if (status === 'online') return 'built';
  if (status === 'offline') return 'deprecated';
  return 'specified';
}

function infrastructureToGraph(scan: InfrastructureScan): { items: Item[]; connections: Connection[] } {
  const items: Item[] = scan.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.kind,
    status: statusToItemStatus(node.status),
    description: node.description,
    position: { x: 0, y: 0, z: 0 },
    group: 'Infrastructure',
    meta: {
      ...(node.meta || {}),
      // Without a domain these all collapsed into the 'meta' column. The
      // vocabulary was entirely software, which left no honest home for a
      // resource that acts on the world: an arm, a sensor, a vehicle, a
      // decoder. Those are `physical`; the rest keep their software domain.
      domain:
        (node.meta as any)?.domain ||
        (node.kind === 'device' ? 'physical' : node.kind === 'network' ? 'infra' : 'backend'),
      health: node.status,
      source: 'infrastructure-scan',
      generatedAt: scan.generatedAt,
    },
  }));

  return {
    items,
    connections: scan.links.map((link) => ({
      from: link.from,
      to: link.to,
      type: link.type,
    })),
  };
}

export const useToolchainStore = create<StoreState>((set, get) => ({
  items: [],
  connections: [],
  selectedItem: null,
  hoveredItem: null,
  searchQuery: '',
  showStarPanel: false,
  showUplinkModal: false,
  treeFilter: 'all',
  loading: false,
  error: null,
  infrastructureScan: null,

  setItems: (items, connections) => set({ items, connections }),

  selectItem: (id) => {
    const s = get();
    const next = s.selectedItem === id ? null : id;
    set({ selectedItem: next, showStarPanel: next !== null });
  },
  hoverItem: (id) => set({ hoveredItem: id }),
  setSearch: (q) => set({ searchQuery: q }),
  toggleStarPanel: () => set(s => ({ showStarPanel: !s.showStarPanel })),
  loadFromJSON: (jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      const items: Item[] = (data.items || []).map((i: Partial<Item>) => ({
        ...i,
        status: i.status || 'built',
        position: i.position || { x: 0, y: 0, z: 0 },
        meta: i.meta || {}
      }));
      const connections: Connection[] = (data.connections || []).map((c: Partial<Connection>) => ({
        ...c,
        type: c.type || 'connects'
      }));
      set({ items, connections, loading: false, error: null });
      return true;
    } catch {
      return false;
    }
  },

  seedDemo: () => {
    const items: Omit<Item, 'position'>[] = [
      {id:'opencode-core',name:'OpenCode',type:'framework',status:'built',description:'Main framework',meta:{domain:'meta'}},
      {id:'mcp:playwright',name:'Playwright',type:'mcp-server',status:'built',description:'Browser automation',meta:{domain:'quality'}},
      {id:'mcp:cloudflare',name:'Cloudflare',type:'mcp-server',status:'built',description:'Edge compute',meta:{domain:'backend'}},
      {id:'mcp:tailscale',name:'Tailscale',type:'mcp-server',status:'built',description:'Mesh VPN',meta:{domain:'infra'}},
      {id:'mcp:github',name:'GitHub',type:'mcp-server',status:'built',description:'CI + repos',meta:{domain:'devops'}},
      {id:'mcp:1password',name:'1Password',type:'mcp-server',status:'built',description:'Secrets',meta:{domain:'security'}},
      {id:'mcp:brew',name:'Homebrew',type:'mcp-server',status:'built',description:'Packages',meta:{domain:'devops'}},
      {id:'agent:oracle',name:'Oracle',type:'agent',status:'built',description:'Debugging',meta:{domain:'meta'}},
      {id:'agent:deep',name:'Deep Agent',type:'agent',status:'built',description:'Autonomous',meta:{domain:'meta'}},
      {id:'agent:steward',name:'Steward',type:'agent',status:'built',description:'Repos',meta:{domain:'devops'}},
      {id:'skill:frontend',name:'Frontend',type:'skill',status:'built',description:'UI patterns',meta:{domain:'frontend'}},
      {id:'skill:cloudflare',name:'Cloudflare',type:'skill',status:'built',description:'Workers',meta:{domain:'backend'}},
      {id:'skill:wrangler',name:'Wrangler',type:'skill',status:'built',description:'CLI',meta:{domain:'backend'}},
      {id:'skill:playwright',name:'Browser',type:'skill',status:'built',description:'E2E',meta:{domain:'quality'}},
      {id:'skill:vitest',name:'Vitest',type:'skill',status:'built',description:'Unit tests',meta:{domain:'quality'}},
      {id:'skill:durable-objects',name:'Durable Objects',type:'skill',status:'specified',description:'Stateful',meta:{domain:'backend'}},
      {id:'skill:agents-sdk',name:'Agents SDK',type:'skill',status:'specified',description:'Framework',meta:{domain:'ai-ml'}},
      {id:'skill:llm',name:'LLM',type:'skill',status:'built',description:'Local models',meta:{domain:'ai-ml'}},
      {id:'skill:gguf',name:'GGUF',type:'skill',status:'built',description:'Quant',meta:{domain:'ai-ml'}},
      {id:'combo:e2e',name:'E2E on Edge',type:'possibility',status:'specified',description:'Deploy+verify',meta:{domain:'quality'}},
      {id:'combo:deploy',name:'Deploy Pipeline',type:'possibility',status:'specified',description:'Push→build',meta:{domain:'devops'}},
      {id:'combo:local-ai',name:'Local Inference',type:'possibility',status:'built',description:'Quant→run',meta:{domain:'ai-ml'}},
      {id:'tool:bash',name:'Shell',type:'framework',status:'built',description:'Commands',meta:{domain:'infra'}},
      {id:'tool:edit',name:'Editor',type:'framework',status:'built',description:'Files',meta:{domain:'meta'}},
      {id:'tool:lsp',name:'LSP',type:'framework',status:'built',description:'Diagnostics',meta:{domain:'quality'}},
    ];
    const connections = [
      {from:'opencode-core',to:'mcp:playwright',type:'connects'},{from:'opencode-core',to:'mcp:cloudflare',type:'connects'},
      {from:'opencode-core',to:'mcp:github',type:'connects'},{from:'opencode-core',to:'agent:oracle',type:'subagent'},
      {from:'skill:cloudflare',to:'combo:e2e',type:'hard-dep'},{from:'skill:playwright',to:'combo:e2e',type:'hard-dep'},
      {from:'skill:cloudflare',to:'combo:deploy',type:'hard-dep'},{from:'skill:wrangler',to:'combo:deploy',type:'hard-dep'},
      {from:'skill:llm',to:'combo:local-ai',type:'hard-dep'},{from:'skill:gguf',to:'combo:local-ai',type:'hard-dep'},
      {from:'mcp:playwright',to:'combo:e2e',type:'soft-dep'},{from:'skill:vitest',to:'combo:e2e',type:'soft-dep'},
      {from:'skill:durable-objects',to:'combo:deploy',type:'soft-dep'},{from:'skill:agents-sdk',to:'combo:deploy',type:'soft-dep'},
    ];
    set({ items: items.map((i,idx) => ({...i, position:{x:100+(idx%6)*80, y:50+Math.floor(idx/6)*70, z:0}})), connections, loading:false, error:null });
    // Not on a phone: the inspector is a sheet there, so opening one unasked
    // covers the graph the visitor came to look at.
    if (!isNarrowViewport()) get().selectItem('mcp:cloudflare');
  },
  setShowUplinkModal: (show) => set({ showUplinkModal: show }),

  updateItemOnServer: async (id, type, updates) => {
    try {
      const name = id.replace(/^(agent|command):/, '');
      let payload = {};
      if (type === 'agent') {
        payload = { updateAgent: { name, updates } };
      } else if (type === 'command') {
        payload = { updateCommand: { name, updates } };
      } else {
        return false;
      }
      const res = await fetch('/api/config/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

  setTreeFilter: (treeFilter) => set({ treeFilter }),

  updateItem: (id, updates) => set(state => ({
    items: state.items.map(i => i.id === id ? { ...i, ...updates } : i),
  })),

  deleteItem: (id) => set(state => ({
    items: state.items.filter(i => i.id !== id),
    connections: state.connections.filter(c => c.from !== id && c.to !== id),
    selectedItem: state.selectedItem === id ? null : state.selectedItem,
  })),

  addConnection: (from, to, type) => set(state => {
    if (state.connections.some(c => c.from === from && c.to === to)) return state;
    return { connections: [...state.connections, { from, to, type }] };
  }),

  removeConnection: (from, to) => set(state => ({
    connections: state.connections.filter(c => !(c.from === from && c.to === to)),
  })),

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/config');
      if (!res.ok) {
        set({ error: 'Cannot reach the API. Start it with `bun run server`.', loading: false });
        return;
      }
      const { config } = await res.json();
      const base = importConfig(config);
      const infraScan = await get().loadInfrastructureScan();
      const infra = infraScan ? infrastructureToGraph(infraScan) : { items: [], connections: [] };
      const itemIds = new Set([...base.items, ...infra.items].map(i => i.id));
      const connections = [...base.connections, ...infra.connections].filter(c => itemIds.has(c.from) && itemIds.has(c.to));
      set({ items: [...base.items, ...infra.items], connections, loading: false });
      if (!isNarrowViewport()) get().selectItem("mcp:cloudflare");
    } catch (e) {
      set({ error: 'Could not load: ' + (e as Error).message, loading: false });
    }
  },

  loadInfrastructureScan: async () => {
    if (!(await backendAvailable())) return null;
    try {
      const res = await fetch('/api/infrastructure/scan');
      if (!res.ok) return null;
      const scan = await res.json();
      set({ infrastructureScan: scan });
      return scan;
    } catch {
      return null;
    }
  },

  toggleMcpEnabled: async (name: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/config/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enableMcp: enabled ? [name] : [],
          disableMcp: !enabled ? [name] : []
        })
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

  // Returns a snippet to paste rather than writing the config. An MCP entry
  // carries a command OpenCode executes, so it must not be reachable through an
  // HTTP request — see the security note in AGENTS.md.
  // Loads the engine's graph — the curated tech tree plus the user's own
  // capabilities — instead of the config-derived view. Locked nodes arrive as
  // 'specified', which the renderers already draw as not-yet-built.
  loadTechTree: async () => {
    set({ loading: true, error: null });
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

  buildMcpSnippet: async (name: string, mcpConfig: any) => {
    try {
      const res = await fetch('/api/config/mcp-snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: mcpConfig })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.error(e);
    }
    return null;
  },

  reset: () => set({
    items: [], connections: [], selectedItem: null, hoveredItem: null,
    searchQuery: '', showStarPanel: false, loading: false, error: null, infrastructureScan: null,
  }),
}));