export interface Item {
  id: string;
  name: string;
  type: 'framework' | 'mcp-server' | 'agent' | 'provider' | 'model' | 'command' | 'skill' | 'config' | 'possibility' | 'device' | 'service' | 'api' | 'network' | 'workflow';
  status: 'built' | 'specified' | 'deprecated';
  description: string;
  position: { x: number; y: number; z: number };
  meta: Record<string, unknown>;
  group?: string;
}

export interface Connection {
  from: string;
  to: string;
  type: string;
}

interface OpenCodeConfig {
  mcp?: Record<string, { type?: string; url?: string; command?: string[]; env?: Record<string, string>; enabled?: boolean }>;
  agent?: Record<string, { description?: string; mode?: string; color?: string; model?: string }>;
  provider?: Record<string, { name?: string; models?: Record<string, { name?: string; limit?: { context?: number; output?: number } }>; embeddings?: Record<string, { name?: string }> }>;
  command?: Record<string, { description?: string }>;
  skills?: { paths?: string[] };
  default_agent?: string;
  shell?: string;
  username?: string;
  autoupdate?: boolean;
  snapshot?: boolean;
  disabled_providers?: string[];
  watcher?: { ignore?: string[] };
  permission?: Record<string, string>;
  instructions?: string[];
}

interface PossibilitySeed {
  id: string;
  name: string;
  description: string;
  status?: Item['status'];
  meta: Record<string, unknown>;
  connectsTo?: string[];
}

const companionPossibilities: PossibilitySeed[] = [
  {
    id: 'possibility:pi-esp32-companion-loop',
    name: 'Pi/ESP32 Companion Loop',
    status: 'specified',
    description: 'RPi 4B acts as memory, policy, inference, and action gateway while ESP32-S3 stays the low-power display, nanopixel, button, cache, and fallback surface.',
    meta: {
      role: 'architecture',
      mode: 'local-first',
      constraint: 'no extra ESP32 hardware',
      primitives: 'FastAPI status, manifest, events, actions, cached state',
    },
    connectsTo: ['opencode-core', 'mcp:dev-control'],
  },
  {
    id: 'possibility:esp32-household-surface',
    name: 'Household Surface',
    status: 'specified',
    description: 'Visitor-safe ambient status object: nanopixel handles peripheral severity/freshness/activity while the display gives concise explanations and one safe next action.',
    meta: {
      role: 'embodied-ui',
      pixel: 'hue=severity, brightness=freshness, animation=activity',
      display: 'facts, deltas, suggested action, stale age',
      contexts: 'household, desk, TV, away, night, guest-safe',
    },
    connectsTo: ['possibility:pi-esp32-companion-loop'],
  },
  {
    id: 'possibility:self-healing-manifest',
    name: 'Self-Healing Manifest',
    status: 'specified',
    description: 'Pi serves versioned display/action/rule manifests; ESP32 keeps last-known-good config, reports apply health, rolls back locally, and degrades to cached mode.',
    meta: {
      role: 'reliability',
      artifacts: 'manifest version, schema version, config version, rollback marker',
      failureMode: 'cached display, stale pixel, exponential backoff',
    },
    connectsTo: ['possibility:pi-esp32-companion-loop', 'agent:offline-resilience-engineer'],
  },
  {
    id: 'possibility:adaptive-attention-loop',
    name: 'Adaptive Attention Loop',
    status: 'specified',
    description: 'ESP32 teaches the Pi what earns attention through dismiss, snooze, acknowledge, page-view, TV-mode, quiet-mode, and what-changed interactions.',
    meta: {
      role: 'learning-loop',
      deterministicRuntime: true,
      learns: 'alert priority, quiet hours, display order, action menu priority, polling cadence',
      approval: 'durable behavior changes require explicit approval',
    },
    connectsTo: ['possibility:esp32-household-surface', 'mcp:mempalace'],
  },
  {
    id: 'possibility:non-deterministic-enrichment',
    name: 'Non-Deterministic Enrichment',
    status: 'specified',
    description: 'Models propose summaries, classifications, UI copy, root-cause guesses, rule patches, and micro-cards; deterministic validators bound actions, privacy, severity, TTL, and schema.',
    meta: {
      role: 'ai-in-the-loop',
      rule: 'models propose, deterministic code disposes',
      allowed: 'summaries, what-changed briefs, display copy, rule suggestions, mode inference',
      forbidden: 'shutdown decisions, secret handling, unsafe actuation, lowering urgent severity',
    },
    connectsTo: ['possibility:adaptive-attention-loop', 'provider:cloudflare', 'provider:local-code', 'provider:local-quality'],
  },
  {
    id: 'possibility:free-cloud-inference-gateway',
    name: 'Free Cloud Inference Gateway',
    status: 'specified',
    description: 'Pi can opportunistically call free/free-starting inference such as Groq, Gemini, Cloudflare Workers AI, or Hugging Face, with strict budgets, cache keys, timeouts, and local fallback.',
    meta: {
      role: 'inference-routing',
      providers: 'Groq, Gemini Developer API, Cloudflare Workers AI, Hugging Face Inference Providers',
      budgets: 'daily call cap, prompt digest cache, fast timeout, circuit breaker',
      privacy: 'send sanitized facts, not raw private logs',
    },
    connectsTo: ['possibility:non-deterministic-enrichment', 'provider:cloudflare'],
  },
  {
    id: 'possibility:tv-mode-resource-governor',
    name: 'TV Mode Resource Governor',
    status: 'specified',
    description: 'ESP32 becomes the couch-side courtesy interface for the Pi: pause downloads/indexing, defer generation, suppress non-urgent alerts, and explain performance issues without TV overlays.',
    meta: {
      role: 'household-workflow',
      actions: 'pause downloads, quiet mode, restart safe service, explain load, resume later',
      value: 'keeps Pi useful while looking at the TV without opening a phone',
    },
    connectsTo: ['possibility:esp32-household-surface', 'mcp:qbittorrent', 'mcp:sabnzbd', 'mcp:romm-mcp'],
  },
  {
    id: 'possibility:generated-micro-cards',
    name: 'Generated Micro-Cards',
    status: 'specified',
    description: 'Pi compiles generated but schema-bound cards for ESP32: morning brief, away check, TV mode, outage, storage, maintenance, quiet, and what-changed views.',
    meta: {
      role: 'dynamic-ui',
      cardSchema: 'title, lines, severity, pixel animation, safe actions, expiry',
      safety: 'schema validation, max text length, allowlisted actions, rollback',
    },
    connectsTo: ['possibility:non-deterministic-enrichment', 'possibility:esp32-household-surface'],
  },
];

function addCompanionPossibilities(items: Item[], connections: Connection[]): void {
  const itemIds = new Set(items.map(i => i.id));

  for (const seed of companionPossibilities) {
    if (itemIds.has(seed.id)) continue;
    items.push({
      id: seed.id,
      name: seed.name,
      type: 'possibility',
      status: seed.status || 'specified',
      description: seed.description,
      position: { x: 0, y: 0, z: 0 },
      meta: seed.meta,
      group: 'Possibilities',
    });
    itemIds.add(seed.id);
  }

  const knownIds = new Set(items.map(i => i.id));
  for (const seed of companionPossibilities) {
    for (const target of seed.connectsTo || []) {
      if (!knownIds.has(target)) continue;
      if (connections.some(c => c.from === target && c.to === seed.id)) continue;
      connections.push({ from: target, to: seed.id, type: 'possibility' });
    }
  }
}

export function importConfig(config: OpenCodeConfig): { items: Item[]; connections: Connection[] } {
  const items: Item[] = [];
  const connections: Connection[] = [];

  // Core framework — enriched with structural config as metadata
  items.push({
    id: 'opencode-core',
    name: 'OpenCode Core',
    type: 'framework',
    status: 'built',
    description: 'Main agent framework',
    position: { x: 0, y: 0, z: 0 },
    meta: {
      version: 'latest',
      defaultAgent: config.default_agent,
      shell: config.shell,
      autoupdate: config.autoupdate,
      snapshot: config.snapshot,
      permissions: config.permission ? Object.keys(config.permission).join(', ') : undefined,
      disabledProviders: config.disabled_providers?.join(', '),
    },
  });

  // ── MCP Servers ──
  const mcp = config.mcp || {};
  for (const [name, m] of Object.entries(mcp)) {
    items.push({
      id: `mcp:${name}`,
      name,
      type: 'mcp-server',
      status: m.enabled !== false ? 'built' : 'specified',
      description: `${m.type || 'local'} MCP server` + (m.url ? ` — ${m.url}` : ''),
      position: { x: 0, y: 0, z: 0 },
      meta: { url: m.url, command: m.command, envKeys: Object.keys(m.env || {}), type: m.type },
      group: m.type === 'remote' ? 'Cloudflare' : 'Local',
    });
    if (m.enabled !== false) {
      connections.push({ from: 'opencode-core', to: `mcp:${name}`, type: 'connects' });
    }
  }

  // ── Agents ──
  const agents = config.agent || {};
  for (const [name, a] of Object.entries(agents)) {
    items.push({
      id: `agent:${name}`,
      name,
      type: 'agent',
      status: 'built',
      description: a.description || '',
      position: { x: 0, y: 0, z: 0 },
      meta: { mode: a.mode, color: a.color, model: a.model },
      group: 'Agents',
    });
    connections.push({ from: 'opencode-core', to: `agent:${name}`, type: 'subagent' });
  }

  // ── Providers + Models ──
  const providers = config.provider || {};
  for (const [name, p] of Object.entries(providers)) {
    items.push({
      id: `provider:${name}`,
      name: p.name || name,
      type: 'provider',
      status: 'built',
      description: `LLM provider`,
      position: { x: 0, y: 0, z: 0 },
      meta: { key: name },
      group: 'Providers',
    });
    connections.push({ from: 'opencode-core', to: `provider:${name}`, type: 'uses-provider' });

    const models = p.models || {};
    for (const [mname, model] of Object.entries(models)) {
      items.push({
        id: `model:${name}/${mname}`,
        name: model.name || mname,
        type: 'model',
        status: 'built',
        description: `${model.limit?.context || '?'}K context`,
        position: { x: 0, y: 0, z: 0 },
        meta: { provider: name, context: model.limit?.context },
        group: 'Models',
      });
      connections.push({ from: `provider:${name}`, to: `model:${name}/${mname}`, type: 'provides' });
    }
  }

  // ── Commands ──
  const commands = config.command || {};
  for (const [name, c] of Object.entries(commands)) {
    items.push({
      id: `cmd:${name}`,
      name,
      type: 'command',
      status: 'built',
      description: c.description || '',
      position: { x: 0, y: 0, z: 0 },
      meta: {},
      group: 'Commands',
    });
    connections.push({ from: 'opencode-core', to: `cmd:${name}`, type: 'command' });
  }

  // ── Skills (from config paths) ──
  const skillPaths = config.skills?.paths || [];
  for (const path of skillPaths) {
    const skillName = path.split('/').filter(Boolean).pop() || path;
    items.push({
      id: `skill:${skillName}`,
      name: skillName,
      type: 'skill',
      status: 'built',
      description: `Skill path: ${path}`,
      position: { x: 0, y: 0, z: 0 },
      meta: { path },
      group: 'Skills',
    });
    connections.push({ from: 'opencode-core', to: `skill:${skillName}`, type: 'skill' });
  }

  // ── Structural config items ──
  const structuralItems: { id: string; name: string; description: string; meta: Record<string, unknown> }[] = [];

  if (config.watcher?.ignore?.length) {
    structuralItems.push({
      id: 'cfg:watcher',
      name: 'File Watcher',
      description: `Watches for changes, ignoring ${config.watcher.ignore.length} patterns`,
      meta: { ignorePatterns: config.watcher.ignore.join(', ') },
    });
  }

  if (config.instructions?.length) {
    structuralItems.push({
      id: 'cfg:instructions',
      name: 'Global Instructions',
      description: `${config.instructions.length} instruction file(s) loaded`,
      meta: { files: config.instructions.join(', ') },
    });
  }

  if (config.disabled_providers?.length) {
    structuralItems.push({
      id: 'cfg:disabled-providers',
      name: 'Disabled Providers',
      description: `${config.disabled_providers.length} provider(s) explicitly disabled`,
      meta: { providers: config.disabled_providers.join(', ') },
    });
  }

  for (const si of structuralItems) {
    items.push({
      ...si,
      type: 'config',
      status: 'built',
      position: { x: 0, y: 0, z: 0 },
      group: 'Config',
    });
    connections.push({ from: 'opencode-core', to: si.id, type: 'config' });
  }

  addCompanionPossibilities(items, connections);

  return { items, connections };
}

export function countByType(items: Item[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.type] = (counts[i.type] || 0) + 1;
  return counts;
}

export function countByStatus(items: Item[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
  return counts;
}
