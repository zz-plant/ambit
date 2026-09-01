import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface McpClientSeed {
  runtime: 'cursor' | 'windsurf' | 'gemini-cli' | 'claude-desktop' | 'codex';
  label: string;
  path: string;
  config: { mcp: Record<string, unknown> };
  mapping: Record<string, unknown>;
}

/**
 * Reads the `[mcp_servers.<name>]` tables out of a Codex CLI config.toml.
 *
 * Not a TOML parser — a reader for the one shape Codex documents: a table per
 * server holding scalar keys (`command`, `url`) and a string array (`args`).
 * The engine carries no dependencies, and pulling one in to read four keys
 * would be the wrong trade; anything this cannot read is skipped, never
 * guessed at.
 */
function readCodexToml(raw: string): Record<string, unknown> | null {
  const servers: Record<string, any> = {};
  let current: any = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const table = trimmed.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
    if (table) {
      current = servers[table[1]] = {};
      continue;
    }
    if (trimmed.startsWith('[')) {
      current = null;
      continue;
    }
    if (!current) continue;
    const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.startsWith('"')) current[key] = value.replace(/^"|"\s*$/g, '');
    else if (value.startsWith('[')) {
      const items = value.match(/"([^"]*)"/g);
      current[key] = items ? items.map(s => s.slice(1, -1)) : [];
    }
  }
  return Object.keys(servers).length ? servers : null;
}

/** The `mcpServers` block every JSON-config client shares. */
function readMcpServersJson(raw: string): Record<string, unknown> | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed?.mcpServers || typeof parsed.mcpServers !== 'object') return null;
  return parsed.mcpServers;
}

const CLIENTS = [
  {
    runtime: 'cursor' as const,
    label: 'Cursor',
    env: 'CURSOR_MCP_CONFIG',
    paths: (home: string) => [join(home, '.cursor', 'mcp.json')],
    read: readMcpServersJson,
  },
  {
    runtime: 'windsurf' as const,
    label: 'Windsurf',
    env: 'WINDSURF_MCP_CONFIG',
    paths: (home: string) => [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    read: readMcpServersJson,
  },
  {
    runtime: 'gemini-cli' as const,
    label: 'Gemini CLI',
    env: 'GEMINI_MCP_CONFIG',
    paths: (home: string) => [join(home, '.gemini', 'settings.json')],
    read: readMcpServersJson,
  },
  {
    runtime: 'claude-desktop' as const,
    label: 'Claude Desktop',
    env: 'CLAUDE_DESKTOP_CONFIG',
    paths: (home: string) => [
      join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    ],
    read: readMcpServersJson,
  },
  {
    runtime: 'codex' as const,
    label: 'Codex CLI',
    env: 'CODEX_MCP_CONFIG',
    paths: (home: string) => [join(home, '.codex', 'config.toml')],
    read: readCodexToml,
  },
];

/** Read MCP-only clients into the same config shape used by the engine seeder. */
export function discoverMcpClients(home = process.env.HOME || '/'): McpClientSeed[] {
  const found: McpClientSeed[] = [];
  for (const client of CLIENTS) {
    const override = process.env[client.env];
    const path = override || client.paths(home).find(p => existsSync(p));
    if (!path || !existsSync(path)) continue;
    let servers: Record<string, unknown> | null = null;
    try {
      servers = client.read(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (!servers) continue;

    const mcp: Record<string, unknown> = {};
    for (const [name, server] of Object.entries<any>(servers)) {
      const remote = Boolean(
        server?.url ||
          server?.serverUrl ||
          server?.httpUrl ||
          server?.type === 'http' ||
          server?.type === 'sse'
      );
      mcp[name] = { ...server, type: remote ? 'remote' : 'local' };
    }
    if (Object.keys(mcp).length === 0) continue;

    found.push({
      runtime: client.runtime,
      label: client.label,
      path,
      config: { mcp },
      mapping: {
        config_keys: {
          mcp: {
            type: 'mcp',
            domain_field: 'type',
            domain_map: { remote: 'backend', local: 'infra' },
            desc_template: `${client.runtime} {type} server`,
          },
        },
        skill_dirs: [],
      },
    });
  }
  return found;
}
