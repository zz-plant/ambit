import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../shared/opencode.ts';
import { defaultMapping } from './seed/writers.ts';

export interface McpClientSeed {
  runtime:
    | 'cursor'
    | 'windsurf'
    | 'gemini-cli'
    | 'claude-desktop'
    | 'codex'
    | 'cline'
    | 'roo-code'
    | 'continue'
    | 'zed'
    | 'vscode'
    | 'copilot-cli'
    | 'amp'
    | 'goose'
    | 'kiro';
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

/** Continue's configuration, reading either mcpServers or experimental MCP servers. */
function readContinueJson(raw: string): Record<string, unknown> | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const servers = parsed?.mcpServers || parsed?.experimental?.modelContextProtocolServers;
  if (!servers || typeof servers !== 'object') return null;
  return servers;
}

/**
 * The servers under one top-level key of a JSON file that may carry comments:
 * Zed's `context_servers`, VS Code's `servers`, and Amp's `amp.mcpServers`,
 * which is one key with a dot in it, not a nested object.
 */
function serversUnder(key: string): (raw: string) => Record<string, unknown> | null {
  return raw => {
    let parsed: any;
    try {
      parsed = parseJsonc(raw);
    } catch {
      return null;
    }
    const servers = parsed?.[key];
    if (!servers || typeof servers !== 'object') return null;
    return servers;
  };
}

/** One YAML scalar: quoted either way, or plain with any trailing comment cut. */
function yamlScalar(text: string): unknown {
  const t = text.trim();
  const double = t.match(/^"((?:[^"\\]|\\.)*)"/);
  if (double) {
    try {
      return JSON.parse(`"${double[1]}"`);
    } catch {
      return double[1];
    }
  }
  const single = t.match(/^'((?:[^']|'')*)'/);
  if (single) return single[1].replace(/''/g, "'");
  const plain = t.replace(/(^|\s+)#.*$/, '');
  if (plain === 'true' || plain === 'false') return plain === 'true';
  if (plain === '' || plain === 'null' || plain === '~') return null;
  return plain;
}

/** The items of an inline `[a, "b"]` or `{k: v}`, split on commas outside quotes. */
function yamlFlow(inner: string): string[] {
  const items: string[] = [];
  let quote = '';
  let item = '';
  for (const ch of inner) {
    if (quote) quote = ch === quote ? '' : quote;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      items.push(item);
      item = '';
      continue;
    }
    item += ch;
  }
  items.push(item);
  return items.map(i => i.trim()).filter(Boolean);
}

/** `key: value` on one line, the key plain or quoted; null for anything else. */
function yamlKey(text: string): { name: string; value?: string } | null {
  const m = text.match(/^(?:"([^"]*)"|'([^']*)'|([^\s:#'"-][^:]*?))\s*:(?:\s+(.*))?$/);
  if (!m) return null;
  const value = m[4]?.trim();
  return { name: m[1] ?? m[2] ?? m[3], value: value && !value.startsWith('#') ? value : undefined };
}

/** A value after `key:`: an inline list or map, or one scalar. */
function yamlValue(text: string): unknown {
  const t = text.trim();
  if (t.startsWith('[') && t.includes(']'))
    return yamlFlow(t.slice(1, t.lastIndexOf(']'))).map(yamlScalar);
  if (t.startsWith('{') && t.includes('}')) {
    const map: Record<string, unknown> = {};
    for (const pair of yamlFlow(t.slice(1, t.lastIndexOf('}')))) {
      const kv = yamlKey(pair);
      if (kv?.value !== undefined) map[kv.name] = yamlScalar(kv.value);
    }
    return map;
  }
  return yamlScalar(t);
}

/**
 * Reads the `extensions:` mapping out of a Goose config.yaml.
 *
 * Not a YAML parser: a reader for the shape Goose documents and writes, one
 * mapping per extension holding scalars (`type`, `cmd`, `uri`, `enabled`), a
 * list (`args`, inline or one `- item` a line) and a map (`envs`), and nothing
 * nested deeper. Like the Codex reader, it trades generality for no
 * dependency, and a line it cannot read is skipped, never guessed at.
 *
 * Only `stdio`, `sse` and `streamable_http` extensions are servers a person
 * added; `builtin` and `platform` ones ship inside Goose and start nothing of
 * their own. `enabled: false` is kept on the entry, as the other readers keep
 * a runtime's own off switch. `envs` stays behind: Goose writes secret values
 * there, and nothing downstream reads them.
 */
function readGooseYaml(raw: string): Record<string, unknown> | null {
  const extensions: Record<string, Record<string, any>> = {};
  let inside = false;
  let nameIndent = -1;
  let keyIndent = -1;
  let entry: Record<string, any> | null = null;
  // The key whose block list or map the next, deeper lines fill.
  let open: string | null = null;
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inside = /^extensions\s*:\s*(#.*)?$/.test(text);
      entry = null;
      nameIndent = -1;
      continue;
    }
    if (!inside) continue;
    if (nameIndent < 0) nameIndent = indent;
    if (indent <= nameIndent) {
      const key = yamlKey(text);
      entry = key && key.value === undefined ? (extensions[key.name] = {}) : null;
      keyIndent = -1;
      open = null;
      continue;
    }
    if (!entry) continue;
    if (keyIndent < 0) keyIndent = indent;
    // Goose writes a list's items at its key's own indent, so `- ` decides.
    const item = text === '-' || text.startsWith('- ');
    if (indent === keyIndent && !item) {
      const key = yamlKey(text);
      open = key && key.value === undefined ? key.name : null;
      // A `|` or `>` block's lines are skipped, since `open` stays unset.
      if (key?.value !== undefined && !/^[|>]/.test(key.value))
        entry[key.name] = yamlValue(key.value);
      continue;
    }
    if (!open || indent < keyIndent) continue;
    if (item) {
      if (!Array.isArray(entry[open])) entry[open] = [];
      entry[open].push(yamlScalar(text.slice(1)));
    } else if (indent > keyIndent) {
      const key = yamlKey(text);
      if (key?.value === undefined) continue;
      if (!entry[open] || typeof entry[open] !== 'object' || Array.isArray(entry[open]))
        entry[open] = {};
      entry[open][key.name] = yamlScalar(key.value);
    }
  }

  const servers: Record<string, unknown> = {};
  for (const [name, ext] of Object.entries(extensions)) {
    const on = typeof ext.enabled === 'boolean' ? { enabled: ext.enabled } : {};
    if (ext.type === 'stdio' && typeof ext.cmd === 'string') {
      const args = Array.isArray(ext.args) ? { args: ext.args.map(String) } : {};
      servers[name] = { command: ext.cmd, ...args, ...on };
    } else if (
      (ext.type === 'streamable_http' || ext.type === 'sse') &&
      typeof ext.uri === 'string'
    ) {
      servers[name] = { url: ext.uri, ...on };
    }
  }
  return Object.keys(servers).length ? servers : null;
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
  {
    runtime: 'cline' as const,
    label: 'Cline',
    env: 'CLINE_MCP_CONFIG',
    paths: (home: string) => [
      join(
        home,
        'Library',
        'Application Support',
        'Code',
        'User',
        'globalStorage',
        'saoudrizwan.claude-dev',
        'settings',
        'cline_mcp_settings.json'
      ),
      join(
        home,
        '.config',
        'Code',
        'User',
        'globalStorage',
        'saoudrizwan.claude-dev',
        'settings',
        'cline_mcp_settings.json'
      ),
    ],
    read: readMcpServersJson,
  },
  {
    runtime: 'roo-code' as const,
    label: 'Roo Code',
    env: 'ROO_CODE_MCP_CONFIG',
    paths: (home: string) => [
      join(
        home,
        'Library',
        'Application Support',
        'Code',
        'User',
        'globalStorage',
        'rooveterinaryinc.roo-cline',
        'settings',
        'cline_mcp_settings.json'
      ),
      join(
        home,
        '.config',
        'Code',
        'User',
        'globalStorage',
        'rooveterinaryinc.roo-cline',
        'settings',
        'cline_mcp_settings.json'
      ),
    ],
    read: readMcpServersJson,
  },
  {
    runtime: 'continue' as const,
    label: 'Continue',
    env: 'CONTINUE_MCP_CONFIG',
    paths: (home: string) => [join(home, '.continue', 'config.json')],
    read: readContinueJson,
  },
  {
    runtime: 'zed' as const,
    label: 'Zed',
    env: 'ZED_MCP_CONFIG',
    paths: (home: string) => [
      join(home, '.config', 'zed', 'settings.json'),
      join(home, 'Library', 'Application Support', 'Zed', 'settings.json'),
    ],
    read: serversUnder('context_servers'),
  },
  {
    runtime: 'vscode' as const,
    label: 'VS Code',
    env: 'VSCODE_MCP_CONFIG',
    paths: (home: string) => [
      join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
      join(home, '.config', 'Code', 'User', 'mcp.json'),
    ],
    read: serversUnder('servers'),
  },
  // https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
  // `mcpServers`, each `type: "local"` (or `stdio`) with a command, or `http`
  // (or `sse`) with a url. `copilot mcp disable` switches one off, and the
  // page does not say where that is kept, so it is not read.
  {
    runtime: 'copilot-cli' as const,
    label: 'Copilot CLI',
    env: 'COPILOT_MCP_CONFIG',
    paths: (home: string) => [join(home, '.copilot', 'mcp-config.json')],
    read: readMcpServersJson,
  },
  // https://ampcode.com/docs/customize/mcp and https://ampcode.com/docs/cli/settings
  // The user settings file, `.json` or `.jsonc`, with the servers under the
  // one key `amp.mcpServers`: a command and args, or a url and headers.
  {
    runtime: 'amp' as const,
    label: 'Amp',
    env: 'AMP_MCP_CONFIG',
    paths: (home: string) => [
      join(home, '.config', 'amp', 'settings.json'),
      join(home, '.config', 'amp', 'settings.jsonc'),
    ],
    read: serversUnder('amp.mcpServers'),
  },
  // https://goose-docs.ai/docs/guides/config-files
  // YAML, each extension under `extensions:` with its `type` and `enabled`,
  // and `cmd` and `args` for stdio or `uri` for streamable_http.
  {
    runtime: 'goose' as const,
    label: 'Goose',
    env: 'GOOSE_MCP_CONFIG',
    paths: (home: string) => [join(home, '.config', 'goose', 'config.yaml')],
    read: readGooseYaml,
  },
  // https://kiro.dev/docs/mcp/configuration/
  // `mcpServers`, each a command, args and env or a url and headers, and
  // `disabled: true` on one kept configured and off.
  {
    runtime: 'kiro' as const,
    label: 'Kiro',
    env: 'KIRO_MCP_CONFIG',
    paths: (home: string) => [join(home, '.kiro', 'settings', 'mcp.json')],
    read: readMcpServersJson,
  },
];

/**
 * Every client discovery reads, by runtime id and the name a person knows it
 * by. The end-to-end seed test is held to it, so a client added above fails
 * that test until it has a fixture there.
 */
export const MCP_CLIENTS = CLIENTS.map(({ runtime, label }) => ({ runtime, label }));

/**
 * Where discovery looks for each client, as a person would check by hand: the
 * override when one is set, else the first place the client keeps its config.
 * A first run that finds nothing lists these, so "no config" names where it
 * looked instead of naming one runtime.
 */
export function clientLocations(home = process.env.HOME || '/'): { label: string; path: string }[] {
  return CLIENTS.map(client => ({
    label: client.label,
    path: process.env[client.env] || client.paths(home)[0],
  }));
}

/** Every place discovery looks for one client's config, for `ambit connect` to write to. */
export function clientPaths(runtime: string, home = process.env.HOME || '/'): string[] {
  return CLIENTS.find(c => c.runtime === runtime)?.paths(home) ?? [];
}

/**
 * Each client whose config file exists, with the servers its own reader finds
 * there, or null when the file does not parse. `ambit doctor` reads this, so
 * it knows every runtime discovery knows, in the shape each one keeps.
 */
export function clientConfigs(
  home = process.env.HOME || '/'
): { runtime: string; label: string; path: string; servers: Record<string, unknown> | null }[] {
  const out = [];
  for (const client of CLIENTS) {
    const override = process.env[client.env];
    const path = override || client.paths(home).find(p => existsSync(p));
    if (!path || !existsSync(path)) continue;
    let servers: Record<string, unknown> | null = null;
    try {
      servers = client.read(readFileSync(path, 'utf8'));
    } catch {
      servers = null;
    }
    out.push({ runtime: client.runtime, label: client.label, path, servers });
  }
  return out;
}

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
      mapping: defaultMapping({ runtime: client.runtime, only: ['mcp'], skillDirs: [] }),
    });
  }
  return found;
}
