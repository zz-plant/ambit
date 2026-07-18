import { create } from 'zustand';
import type { Item, Connection } from '../utils/configImporter';
import type { TrendItem } from '../utils/knowledgeBase';
import { computeLayout } from '../utils/layoutEngine';

interface ConsultantFinding {
  severity: 'warn' | 'info' | 'error';
  message: string;
  action?: { type: string; target: string };
}

interface ConsultantResult {
  id: string;
  timestamp: string;
  score: number;
  findings: ConsultantFinding[];
  itemCount: number;
}

interface Snapshot {
  id: string;
  label: string;
  timestamp: string;
  items: Item[];
  connections: Connection[];
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
  consultantResults: Record<string, ConsultantResult>;
  snapshots: Snapshot[];
  showStarPanel: boolean;
  showUplinkModal: boolean;
  layoutMode: 'constellation' | 'civ';
  loading: boolean;
  error: string | null;
  trends: TrendItem[];
  infrastructureScan: InfrastructureScan | null;

  seedDemo: () => void;
  loadFromJSON: (json: string) => boolean;
  setShowUplinkModal: (show: boolean) => void;
  loadInfrastructureScan: () => Promise<InfrastructureScan | null>;
  fetchTrends: () => Promise<void>;
  updateItemOnServer: (id: string, type: string, updates: any) => Promise<boolean>;
  setItems: (items: Item[], connections: Connection[]) => void;
  layoutItems: () => void;
  selectItem: (id: string | null) => void;
  hoverItem: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleStarPanel: () => void;
  setLayoutMode: (mode: 'constellation' | 'orbital' | 'flat' | 'civ') => void;

  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  addConnection: (from: string, to: string, type: string) => void;
  removeConnection: (from: string, to: string) => void;

  loadConfig: () => Promise<void>;
  toggleMcpEnabled: (name: string, enabled: boolean) => Promise<boolean>;
  addMcpServer: (name: string, mcpConfig: any) => Promise<boolean>;
  applyFindingAction: (action: { type: string; target: string }) => Promise<boolean>;

  runConsultant: (id: string) => void;
  runAllConsultants: () => void;
  getConsultantDefs: () => ConsultantDef[];

  takeSnapshot: (label?: string) => void;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;

  reset: () => void;
}

export interface ConsultantDef {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
}

const consultantDefs: ConsultantDef[] = [
  { id: 'architecture', label: 'Architecture', icon: '◈', color: '#00d4ff', description: 'Topology, coupling, domain cohesion', prompt: 'Analyze coupling and redundancy.' },
  { id: 'efficiency', label: 'Efficiency', icon: '⚡', color: '#f59e0b', description: 'Bottlenecks, cold starts, waste', prompt: 'Find bottlenecks and waste.' },
  { id: 'security', label: 'Security', icon: '🔒', color: '#ef4444', description: 'Auth gaps, exposure, vulns', prompt: 'Audit for credential and access risk.' },
  { id: 'cost', label: 'Cost', icon: '💰', color: '#10b981', description: 'Redundancy, consolidation', prompt: 'Find savings.' },
  { id: 'reliability', label: 'Reliability', icon: '🛡️', color: '#3b82f6', description: 'SPOF, backup, DR', prompt: 'Review failure propagation.' },
  { id: 'dx', label: 'Dev Experience', icon: '✨', color: '#8b5cf6', description: 'Context switching, docs', prompt: 'Evaluate workflow friction.' },
];

import { importConfig } from '../utils/configImporter';
import { detectLevelUpOpportunities, detectTrendAlignedOpportunities } from '../utils/knowledgeBase';

const heuristicChecks: Record<string, (items: Item[], conns: Connection[]) => ConsultantFinding[]> = {
  architecture: (items, conns) => {
    const f: ConsultantFinding[] = [];
    const hubs = items.filter(i => conns.filter(c => c.from === i.id || c.to === i.id).length > 5);
    if (hubs.length) f.push({ severity: 'warn', message: `${hubs.length} hub(s) with >5 connections` });
    const orphans = items.filter(i => i.id !== 'opencode-core' && !conns.some(c => c.from === i.id || c.to === i.id));
    if (orphans.length) f.push({ severity: 'warn', message: `${orphans.length} orphaned items` });

    // Add unused MCP server rule with autofix action!
    const unusedMcp = items.filter(i => i.type === 'mcp-server' && i.status === 'built' && !conns.some(c => c.from === i.id || c.to === i.id));
    unusedMcp.forEach(i => {
      const name = i.id.replace('mcp:', '');
      f.push({
        severity: 'info',
        message: `Unused MCP server '${name}' is active`,
        action: { type: 'disable_mcp', target: name }
      });
    });

    const byType: Record<string, number> = {};
    items.forEach(i => { byType[i.type] = (byType[i.type] || 0) + 1; });
    if (Object.keys(byType).length > 6) f.push({ severity: 'info', message: `${Object.keys(byType).length} distinct types — possible sprawl` });
    return f;
  },
  efficiency: (items) => {
    const f: ConsultantFinding[] = [];
    const disabled = items.filter(i => i.status === 'specified' && i.type === 'mcp-server');
    if (disabled.length > items.filter(i => i.type === 'mcp-server').length / 2) {
      f.push({ severity: 'warn', message: `>50% MCP servers disabled — review config` });
    }
    // Action to enable disabled MCP servers
    disabled.forEach(i => {
      const name = i.id.replace('mcp:', '');
      f.push({
        severity: 'info',
        message: `MCP server '${name}' is disabled`,
        action: { type: 'enable_mcp', target: name }
      });
    });
    // Remote latency risks
    const remoteMcps = items.filter(i => i.type === 'mcp-server' && i.meta?.type === 'remote' && i.status === 'built');
    remoteMcps.forEach(i => {
      const name = i.id.replace('mcp:', '');
      f.push({
        severity: 'info',
        message: `Remote MCP '${name}' may introduce network latency`
      });
    });
    return f;
  },
  security: (items) => {
    const f: ConsultantFinding[] = [];
    const externalMcp = items.filter(i => i.type === 'mcp-server' && i.meta?.type === 'remote');
    if (externalMcp.length > 3) f.push({ severity: 'warn', message: `${externalMcp.length} remote MCP — audit each auth` });
    externalMcp.forEach(i => {
      const name = i.id.replace('mcp:', '');
      if (i.status === 'built') {
        f.push({
          severity: 'warn',
          message: `Remote MCP '${name}' is enabled. Disable if unused.`,
          action: { type: 'disable_mcp', target: name }
        });
      }
    });
    return f;
  },
  cost: (items) => {
    const f: ConsultantFinding[] = [];
    const counts: Record<string, number> = {};
    items.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
    Object.entries(counts).forEach(([t, c]) => { if (c > 5) f.push({ severity: 'info', message: `${c}x ${t} — consolidation opportunity` }); });
    return f;
  },
  reliability: (items, conns) => {
    const f: ConsultantFinding[] = [];
    const core = items.find(i => i.id === 'opencode-core');
    if (core && conns.filter(c => c.from === core.id).length === 0) {
      f.push({ severity: 'error', message: 'Core has no outgoing connections' });
    }
    // Check for agents referencing inactive models
    const agents = items.filter(i => i.type === 'agent');
    const models = new Set(items.filter(i => i.type === 'model').map(i => i.id.replace('model:', '')));
    agents.forEach(a => {
      const agentModel = a.meta?.model as string;
      if (agentModel && !models.has(agentModel)) {
        const firstModel = items.find(i => i.type === 'model')?.id.replace('model:', '') || 'local-code/gemma4:e4b-32k';
        const agentName = a.id.replace('agent:', '');
        f.push({
          severity: 'error',
          message: `Agent '${agentName}' references inactive model '${agentModel}'`,
          action: { type: 'set_agent_model', target: `${agentName}|${firstModel}` }
        });
      }
    });
    items
      .filter(i => ['device', 'service', 'api', 'network', 'workflow'].includes(i.type))
      .forEach(i => {
        const health = String(i.meta?.health || '');
        if (health === 'offline') {
          f.push({ severity: 'error', message: `${i.name} is offline in live infrastructure scan` });
        } else if (health === 'degraded') {
          f.push({ severity: 'warn', message: `${i.name} is degraded in live infrastructure scan` });
        }
      });
    return f;
  },
  dx: (items) => {
    const f: ConsultantFinding[] = [];
    const noDesc = items.filter(i => !i.description || i.description.length < 5);
    if (noDesc.length > items.length * 0.3) f.push({ severity: 'info', message: `${noDesc.length} items lack descriptions` });
    return f;
  },
};

let layoutAnimFrameId: number | null = null;

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
    group: 'Household Edge',
    meta: {
      ...(node.meta || {}),
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
  consultantResults: {},
  snapshots: [],
  showStarPanel: false,
  showUplinkModal: false,
  layoutMode: 'civ',
  loading: false,
  error: null,
  trends: [],
  infrastructureScan: null,

  setItems: (items, connections) => set({ items, connections }),

  layoutItems: () => set(state => ({
    items: computeLayout(state.items, state.connections, 60, state.layoutMode),
  })),

  selectItem: (id) => {
    const s = get();
    const next = s.selectedItem === id ? null : id;
    set({ selectedItem: next, showStarPanel: next !== null });
    if (next) get().runConsultant('architecture');
  },
  hoverItem: (id) => set({ hoveredItem: id }),
  setSearch: (q) => set({ searchQuery: q }),
  toggleStarPanel: () => set(s => ({ showStarPanel: !s.showStarPanel })),
  loadFromJSON: (jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      const items = (data.items || []).map(i => ({
        ...i,
        status: i.status || 'built',
        position: i.position || { x: 0, y: 0, z: 0 },
        meta: i.meta || {}
      }));
      const connections = (data.connections || []).map(c => ({
        ...c,
        type: c.type || 'connects'
      }));
      set({ items, connections, loading: false, error: null });
      get().layoutItems();
      return true;
    } catch {
      return false;
    }
  },

  seedDemo: () => {
    const items = [
      {id:'opencode-core',name:'OpenCode',type:'framework',status:'built',description:'Main framework',meta:{maturity:1,domain:'meta'}},
      {id:'mcp:playwright',name:'Playwright',type:'mcp-server',status:'built',description:'Browser automation',meta:{maturity:.82,domain:'quality'}},
      {id:'mcp:cloudflare',name:'Cloudflare',type:'mcp-server',status:'built',description:'Edge compute',meta:{maturity:.9,domain:'backend'}},
      {id:'mcp:tailscale',name:'Tailscale',type:'mcp-server',status:'built',description:'Mesh VPN',meta:{maturity:.75,domain:'infra'}},
      {id:'mcp:github',name:'GitHub',type:'mcp-server',status:'built',description:'CI + repos',meta:{maturity:.88,domain:'devops'}},
      {id:'mcp:1password',name:'1Password',type:'mcp-server',status:'built',description:'Secrets',meta:{maturity:.7,domain:'security'}},
      {id:'mcp:brew',name:'Homebrew',type:'mcp-server',status:'built',description:'Packages',meta:{maturity:.92,domain:'devops'}},
      {id:'agent:oracle',name:'Oracle',type:'agent',status:'built',description:'Debugging',meta:{maturity:.95,domain:'meta'}},
      {id:'agent:deep',name:'Deep Agent',type:'agent',status:'built',description:'Autonomous',meta:{maturity:.8,domain:'meta'}},
      {id:'agent:steward',name:'Steward',type:'agent',status:'built',description:'Repos',meta:{maturity:.78,domain:'devops'}},
      {id:'skill:frontend',name:'Frontend',type:'skill',status:'built',description:'UI patterns',meta:{maturity:.75,domain:'frontend'}},
      {id:'skill:cloudflare',name:'Cloudflare',type:'skill',status:'built',description:'Workers',meta:{maturity:.8,domain:'backend'}},
      {id:'skill:wrangler',name:'Wrangler',type:'skill',status:'built',description:'CLI',meta:{maturity:.72,domain:'backend'}},
      {id:'skill:playwright',name:'Browser',type:'skill',status:'built',description:'E2E',meta:{maturity:.68,domain:'quality'}},
      {id:'skill:vitest',name:'Vitest',type:'skill',status:'built',description:'Unit tests',meta:{maturity:.65,domain:'quality'}},
      {id:'skill:durable-objects',name:'Durable Objects',type:'skill',status:'specified',description:'Stateful',meta:{maturity:.35,domain:'backend'}},
      {id:'skill:agents-sdk',name:'Agents SDK',type:'skill',status:'specified',description:'Framework',meta:{maturity:.3,domain:'ai-ml'}},
      {id:'skill:llm',name:'LLM',type:'skill',status:'built',description:'Local models',meta:{maturity:.9,domain:'ai-ml'}},
      {id:'skill:gguf',name:'GGUF',type:'skill',status:'built',description:'Quant',meta:{maturity:.6,domain:'ai-ml'}},
      {id:'combo:e2e',name:'E2E on Edge',type:'possibility',status:'specified',description:'Deploy+verify',meta:{maturity:.4,domain:'quality'}},
      {id:'combo:deploy',name:'Deploy Pipeline',type:'possibility',status:'specified',description:'Push→build',meta:{maturity:.55,domain:'devops'}},
      {id:'combo:local-ai',name:'Local Inference',type:'possibility',status:'built',description:'Quant→run',meta:{maturity:.9,domain:'ai-ml'}},
      {id:'tool:bash',name:'Shell',type:'framework',status:'built',description:'Commands',meta:{maturity:1,domain:'infra'}},
      {id:'tool:edit',name:'Editor',type:'framework',status:'built',description:'Files',meta:{maturity:1,domain:'meta'}},
      {id:'tool:lsp',name:'LSP',type:'framework',status:'built',description:'Diagnostics',meta:{maturity:.95,domain:'quality'}},
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
    get().layoutItems();
    get().selectItem('mcp:cloudflare');
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

  setLayoutMode: (layoutMode) => {
    set({ layoutMode });
    const targetItems = computeLayout(get().items, get().connections, 60, layoutMode);

    if (layoutAnimFrameId !== null) {
      cancelAnimationFrame(layoutAnimFrameId);
    }

    let frame = 0;
    const animate = () => {
      const currentItems = get().items;
      let done = true;
      const nextItems = currentItems.map(item => {
        const target = targetItems.find(t => t.id === item.id);
        if (!target) return item;
        const dx = target.position.x - item.position.x;
        const dy = target.position.y - item.position.y;
        const dz = target.position.z - item.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 0.02 && frame < 90) {
          done = false;
          return {
            ...item,
            position: {
              x: item.position.x + dx * 0.12,
              y: item.position.y + dy * 0.12,
              z: item.position.z + dz * 0.12,
            }
          };
        } else {
          return { ...item, position: target.position };
        }
      });

      set({ items: nextItems });
      frame++;

      if (!done && frame < 90) {
        layoutAnimFrameId = requestAnimationFrame(animate);
      } else {
        layoutAnimFrameId = null;
      }
    };

    layoutAnimFrameId = requestAnimationFrame(animate);
  },

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
        set({ error: 'Sensor offline. Run `bun run server` to establish uplink.', loading: false });
        return;
      }
      const { config } = await res.json();
      const base = importConfig(config);
      const infraScan = await get().loadInfrastructureScan();
      const infra = infraScan ? infrastructureToGraph(infraScan) : { items: [], connections: [] };
      const itemIds = new Set([...base.items, ...infra.items].map(i => i.id));
      const connections = [...base.connections, ...infra.connections].filter(c => itemIds.has(c.from) && itemIds.has(c.to));
      set({ items: [...base.items, ...infra.items], connections, loading: false });
      get().layoutItems(); get().selectItem("mcp:cloudflare");
      get().fetchTrends();
    } catch (e) {
      set({ error: 'Uplink failed: ' + (e as Error).message, loading: false });
    }
  },

  loadInfrastructureScan: async () => {
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

  fetchTrends: async () => {
    try {
      const res = await fetch('/api/trending');
      if (res.ok) {
        const data = await res.json();
        set({ trends: data.trends || [] });
      }
    } catch {}
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

  addMcpServer: async (name: string, mcpConfig: any) => {
    try {
      const res = await fetch('/api/config/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addMcp: { [name]: { ...mcpConfig, enabled: true } }
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

  applyFindingAction: async (action: { type: string; target: string }) => {
    if (action.type === 'enable_mcp') {
      return get().toggleMcpEnabled(action.target, true);
    } else if (action.type === 'disable_mcp') {
      return get().toggleMcpEnabled(action.target, false);
    } else if (action.type === 'set_agent_model') {
      const [agentName, modelName] = action.target.split('|');
      return get().updateItemOnServer(`agent:${agentName}`, 'agent', { model: modelName });
    }
    return false;
  },

  runConsultant: (consultantId) => set(state => {
    const def = consultantDefs.find(d => d.id === consultantId);
    if (!def) return state;
    const check = heuristicChecks[consultantId];
    const findings = check ? check(state.items, state.connections) : [];

    // Enrich with knowledge-base findings relevant to this consultant's domain
    const kbMap: Record<string, string[]> = {
      architecture: ['Gap', 'Scale'],
      efficiency: ['Level-up', 'Modernization'],
      security: ['Security'],
      cost: ['Scale', 'Housekeeping'],
      reliability: ['Gap'],
      dx: ['Level-up'],
    };
    const relevantCategories = kbMap[consultantId] || [];
    const kbFindings = detectLevelUpOpportunities(state.items, state.connections)
      .filter(f => relevantCategories.includes(f.category))
      .map(f => ({ severity: f.severity as 'info' | 'warn' | 'error', message: `[${f.category}] ${f.message}`, action: f.action }));
    // Ecosystem signals from trending data
    const trendFindings = state.trends.length > 0
      ? detectTrendAlignedOpportunities(state.items, state.trends)
        .filter(f => consultantId === 'dx' || consultantId === 'architecture')
        .map(f => ({ severity: f.severity as 'info' | 'warn' | 'error', message: `[${f.category}] ${f.message}`, action: f.action }))
      : [];
    const allFindings = [...findings, ...kbFindings, ...trendFindings];

    const score = allFindings.length === 0 ? 100 : Math.max(0, 100 - allFindings.reduce((s, f) => s + (f.severity === 'error' ? 35 : f.severity === 'warn' ? 20 : 5), 0));
    const result = { id: consultantId, timestamp: new Date().toISOString(), findings: allFindings, score, itemCount: state.items.length };
    
    fetch('/api/consultant/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultantId, score, findings: allFindings, itemCount: state.items.length })
    }).catch(console.error);

    return {
      consultantResults: {
        ...state.consultantResults,
        [consultantId]: result,
      },
    };
  }),

  runAllConsultants: () => set(state => {
    const results: Record<string, ConsultantResult> = {};
    const allKb = detectLevelUpOpportunities(state.items, state.connections);
    const kbMap: Record<string, string[]> = {
      architecture: ['Gap', 'Scale'],
      efficiency: ['Level-up', 'Modernization'],
      security: ['Security'],
      cost: ['Scale', 'Housekeeping'],
      reliability: ['Gap'],
      dx: ['Level-up'],
    };

    consultantDefs.forEach(def => {
      const check = heuristicChecks[def.id];
      const findings = check ? check(state.items, state.connections) : [];
      const relevantCategories = kbMap[def.id] || [];
      const kbFindings = allKb
        .filter(f => relevantCategories.includes(f.category))
        .map(f => ({ severity: f.severity as 'info' | 'warn' | 'error', message: `[${f.category}] ${f.message}`, action: f.action }));
      const trendFindings = state.trends.length > 0 && (def.id === 'dx' || def.id === 'architecture')
        ? detectTrendAlignedOpportunities(state.items, state.trends)
          .map(f => ({ severity: f.severity as 'info' | 'warn' | 'error', message: `[${f.category}] ${f.message}`, action: f.action }))
        : [];
      const allFindings = [...findings, ...kbFindings, ...trendFindings];

      const score = allFindings.length === 0 ? 100 : Math.max(0, 100 - allFindings.reduce((s, f) => s + (f.severity === 'error' ? 35 : f.severity === 'warn' ? 20 : 5), 0));
      results[def.id] = { id: def.id, timestamp: new Date().toISOString(), findings: allFindings, score, itemCount: state.items.length };

      fetch('/api/consultant/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultantId: def.id, score, findings: allFindings, itemCount: state.items.length })
      }).catch(console.error);
    });
    return { consultantResults: results };
  }),

  getConsultantDefs: () => consultantDefs,

  takeSnapshot: (label) => set(state => {
    const snap = {
      id: `snap-${Date.now()}`,
      label: label || `Snapshot ${state.snapshots.length + 1}`,
      timestamp: new Date().toISOString(),
      items: JSON.parse(JSON.stringify(state.items)),
      connections: JSON.parse(JSON.stringify(state.connections)),
    };
    
    // Log snapshot back to API
    fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: snap.label, items: snap.items, connections: snap.connections })
    }).catch(console.error);

    return {
      snapshots: [...state.snapshots, snap],
    };
  }),

  restoreSnapshot: (id) => set(state => {
    const snap = state.snapshots.find(s => s.id === id);
    if (!snap) return state;
    return { items: snap.items, connections: snap.connections, selectedItem: null };
  }),

  deleteSnapshot: (id) => set(state => {
    fetch(`/api/snapshots/${id}`, { method: 'DELETE' }).catch(console.error);
    return {
      snapshots: state.snapshots.filter(s => s.id !== id),
    };
  }),

  reset: () => set({
    items: [], connections: [], selectedItem: null, hoveredItem: null,
    searchQuery: '', consultantResults: {}, snapshots: [], showStarPanel: false,
    layoutMode: 'civ', loading: false, error: null, infrastructureScan: null,
  }),
}));
