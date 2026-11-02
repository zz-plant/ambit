/**
 * Toggle MCP servers on or off across agent runtimes.
 *
 * Heavy agent users often suffer from prompt context bloat (15K-60K+ tokens
 * loaded on every turn). Disabling heavy or currently unused MCP servers
 * instantly reclaims context window tokens, lowers prompt costs, and speeds up
 * model response times.
 *
 * `ambit toggle <server> --off` disables a server in detected configs.
 * `ambit toggle <server> --on` re-enables it.
 * Every edit keeps a `<file>.bak` backup first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { keepBackup } from '../shared/backup.ts';
import { mcpEntries, parseJsonc } from '../shared/opencode.ts';
import { toolServers } from './weight.ts';
import {
  runtimeTarget,
  runtimeWords,
  runtimesFound,
  targetFile,
  type ConnectTarget,
} from './connect.ts';
import { nearest } from '../shared/nearest.ts';

export interface ToggleItemResult {
  runtime: string;
  label: string;
  path: string;
  state: 'disabled' | 'enabled' | 'unchanged';
  backup?: string;
}

export interface ToggleResult {
  ok: boolean;
  server: string;
  state: 'disabled' | 'enabled';
  results: ToggleItemResult[];
  dry_run?: boolean;
  error?: string;
  reclaimed_tokens?: number;
}

/** Toggles an MCP server in a JSON-based client configuration. */
function toggleJson(
  filePath: string,
  kind: string,
  serverName: string,
  disabled: boolean,
  dryRun: boolean
): { state: 'disabled' | 'enabled' | 'unchanged'; backup?: string } {
  if (!existsSync(filePath)) return { state: 'unchanged' };
  const text = readFileSync(filePath, 'utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = parseJsonc(text);
    } catch {
      throw new Error(`${filePath} is not valid JSON; left unchanged`);
    }
  }

  let changed = false;

  if (kind === 'mcpServers' || kind === 'servers' || kind === 'context_servers') {
    const bag = parsed[kind];
    if (bag && typeof bag === 'object' && Object.hasOwn(bag, serverName)) {
      const entry = bag[serverName];
      if (entry && typeof entry === 'object') {
        const currentDisabled = entry.disabled === true;
        if (currentDisabled !== disabled) {
          if (disabled) {
            entry.disabled = true;
          } else {
            delete entry.disabled;
          }
          changed = true;
        }
      }
    }
  } else if (kind === 'opencode') {
    const { bag, v2 } = mcpEntries(parsed);
    const servers = bag as Record<string, any>;
    if (servers && Object.hasOwn(servers, serverName)) {
      const entry = servers[serverName];
      if (entry && typeof entry === 'object') {
        if (v2) {
          const currentDisabled = entry.disabled === true;
          if (currentDisabled !== disabled) {
            entry.disabled = disabled;
            changed = true;
          }
        } else {
          const currentEnabled = entry.enabled !== false;
          if (currentEnabled === disabled) {
            entry.enabled = !disabled;
            changed = true;
          }
        }
      }
    }
  }

  if (!changed) return { state: 'unchanged' };

  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
  }

  return { state: disabled ? 'disabled' : 'enabled', backup };
}

/** Toggles an MCP server in Codex config.toml by toggling the table header. */
function toggleCodex(
  filePath: string,
  serverName: string,
  disabled: boolean,
  dryRun: boolean
): { state: 'disabled' | 'enabled' | 'unchanged'; backup?: string } {
  if (!existsSync(filePath)) return { state: 'unchanged' };
  const text = readFileSync(filePath, 'utf8');
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let newText = text;
  let changed = false;

  if (disabled) {
    const activePattern = new RegExp(`^\\[mcp_servers\\.${escaped}\\]`, 'm');
    if (activePattern.test(text)) {
      newText = text.replace(activePattern, `[disabled_mcp_servers.${serverName}]`);
      changed = true;
    }
  } else {
    const disabledPattern = new RegExp(`^\\[disabled_mcp_servers\\.${escaped}\\]`, 'm');
    if (disabledPattern.test(text)) {
      newText = text.replace(disabledPattern, `[mcp_servers.${serverName}]`);
      changed = true;
    }
  }

  if (!changed) return { state: 'unchanged' };

  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, newText);
  }

  return { state: disabled ? 'disabled' : 'enabled', backup };
}

/** Toggle an MCP server on or off. */
export function toggleServer(
  serverName: string,
  options: {
    off?: boolean;
    on?: boolean;
    to?: string;
    home?: string;
    dryRun?: boolean;
  } = {}
): ToggleResult {
  const home = options.home || process.env.HOME || '/';
  const dryRun = options.dryRun ?? false;
  const disabled = options.off === true || options.on === false;
  const targetState = disabled ? 'disabled' : 'enabled';

  if (!serverName) {
    return {
      ok: false,
      server: '',
      state: targetState,
      results: [],
      error: 'Usage: ambit toggle <server-name> [--off|--on] [--to=<runtime>] [--dry-run]',
    };
  }

  const targetsToTouch: ConnectTarget[] = [];
  if (options.to) {
    const t = runtimeTarget(options.to);
    if (!t) {
      return {
        ok: false,
        server: serverName,
        state: targetState,
        results: [],
        error: `Unknown runtime "${options.to}". Choose one of: ${runtimeWords().join(', ')}`,
      };
    }
    targetsToTouch.push(t);
  } else {
    for (const inst of runtimesFound(home)) {
      targetsToTouch.push(inst.target);
    }
  }

  const results: ToggleItemResult[] = [];
  for (const target of targetsToTouch) {
    const file = targetFile(target, home);
    try {
      const res =
        target.kind === 'codex'
          ? toggleCodex(file.path, serverName, disabled, dryRun)
          : toggleJson(file.path, target.kind, serverName, disabled, dryRun);

      results.push({
        runtime: target.runtime,
        label: target.label,
        path: file.path,
        state: res.state,
        backup: res.backup,
      });
    } catch (err: any) {
      return {
        ok: false,
        server: serverName,
        state: targetState,
        results,
        error: err?.message || `Failed to toggle in ${target.label}`,
      };
    }
  }

  const changed = results.some(r => r.state !== 'unchanged');
  const touched = results.filter(r => r.state !== 'unchanged');

  if (!changed && !options.dryRun) {
    // Check if server is known at all
    const all = toolServers(home);
    const known = all.some(s => s.name === serverName);
    if (!known) {
      const suggestions = nearest(
        serverName,
        all.map(s => s.name)
      );
      return {
        ok: false,
        server: serverName,
        state: targetState,
        results,
        error: `No MCP server named "${serverName}" found in your configs.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
      };
    }
  }

  return {
    ok: changed || dryRun,
    server: serverName,
    state: targetState,
    results: touched.length ? touched : results,
    dry_run: dryRun,
  };
}
