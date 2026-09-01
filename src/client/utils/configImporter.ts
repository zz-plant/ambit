import type { NodeType } from '../../shared/api';

export interface Item {
  id: string;
  name: string;
  /** The renderable node types, declared once in the API contract. */
  type: NodeType;
  status: 'built' | 'specified' | 'deprecated';
  description: string;
  position: { x: number; y: number; z: number };
  meta: Record<string, unknown>;
  group?: string;
}

/** The single layout mode: era columns. Position is computed by CivTree. */
export type LayoutMode = 'civ';

export interface Connection {
  from: string;
  to: string;
  type: string;
}

interface OpenCodeConfig {
  mcp?: Record<
    string,
    {
      type?: string;
      url?: string;
      command?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }
  >;
  agent?: Record<string, { description?: string; mode?: string; color?: string; model?: string }>;
  provider?: Record<
    string,
    {
      name?: string;
      models?: Record<string, { name?: string; limit?: { context?: number; output?: number } }>;
      embeddings?: Record<string, { name?: string }>;
    }
  >;
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

/**
 * Domain drives which era column an item lands in. Matched against the item's
 * name, so an MCP named "cloudflare-workers" reads as backend rather than
 * falling through to the meta column.
 */
const DOMAIN_KEYWORDS: [RegExp, string][] = [
  [/tailscale|network|dns|vpn|ssh|docker|host|proxy|caddy|nginx|pi-?hole/i, 'infra'],
  [/github|gitlab|git\b|ci|deploy|build|wrangler|brew|npm|package|release|actions/i, 'devops'],
  [/cloudflare|worker|d1|kv|r2|durable|database|sql|postgres|redis|api|server|queue/i, 'backend'],
  [/react|vue|svelte|css|ui|design|figma|browser|playwright|puppeteer|frontend/i, 'frontend'],
  [/llm|model|ollama|openai|anthropic|claude|gpt|gemini|embed|ai|ml|rag|vector/i, 'ai-ml'],
  [/test|vitest|jest|lint|eslint|typecheck|coverage|qa|audit|review/i, 'quality'],
  [/1password|secret|vault|auth|token|credential|security|permission/i, 'security'],
];

/** Item types whose domain is fixed regardless of name. */
const TYPE_DOMAINS: Record<string, string> = {
  agent: 'meta',
  command: 'meta',
  config: 'meta',
  model: 'ai-ml',
  provider: 'ai-ml',
};

function inferDomain(name: string, type: string, hint = ''): string {
  const haystack = `${name} ${hint}`;
  for (const [pattern, domain] of DOMAIN_KEYWORDS) {
    if (pattern.test(haystack)) return domain;
  }
  return TYPE_DOMAINS[type] || 'meta';
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
      domain: 'meta',
      maturity: 1,
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
      meta: {
        url: m.url,
        command: m.command,
        envKeys: Object.keys(m.env || {}),
        type: m.type,
        domain: inferDomain(name, 'mcp-server', `${m.url || ''} ${(m.command || []).join(' ')}`),
        maturity: m.enabled !== false ? 0.8 : 0.3,
      },
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
      meta: {
        mode: a.mode,
        color: a.color,
        model: a.model,
        domain: inferDomain(name, 'agent', a.description || ''),
        maturity: 0.75,
      },
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
      meta: { key: name, domain: 'ai-ml', maturity: 0.85 },
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
        meta: { provider: name, context: model.limit?.context, domain: 'ai-ml', maturity: 0.8 },
        group: 'Models',
      });
      connections.push({
        from: `provider:${name}`,
        to: `model:${name}/${mname}`,
        type: 'provides',
      });
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
      meta: { domain: inferDomain(name, 'command', c.description || ''), maturity: 0.6 },
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
      meta: { path, domain: inferDomain(skillName, 'skill', path), maturity: 0.7 },
      group: 'Skills',
    });
    connections.push({ from: 'opencode-core', to: `skill:${skillName}`, type: 'skill' });
  }

  // ── Structural config items ──
  const structuralItems: {
    id: string;
    name: string;
    description: string;
    meta: Record<string, unknown>;
  }[] = [];

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
      meta: { ...si.meta, domain: 'meta', maturity: 0.5 },
      group: 'Config',
    });
    connections.push({ from: 'opencode-core', to: si.id, type: 'config' });
  }

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
