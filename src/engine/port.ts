/**
 * Cross-runtime MCP server porter.
 *
 * Developers juggle multiple agent runtimes (Claude Code, Cursor, Codex CLI,
 * OpenCode, VS Code, Zed, Windsurf). When a tool server is configured in one
 * runtime, having to manually copy its command, arguments, environment variables
 * and convert schemas across JSON/TOML formats is tedious friction.
 *
 * `ambit port` lists MCP servers across all detected runtimes and shows where
 * each can be ported. `ambit port <server> --to=<runtime>` ports the exact
 * server configuration into the destination runtime safely, creating a `.bak`
 * backup first and converting schemas automatically.
 */
import { toolServers, type ToolServer } from './weight.ts';
import {
  configureServerEntry,
  runtimesFound,
  runtimeTarget,
  runtimeWords,
  targetFile,
  type ServerSpec,
} from './connect.ts';
import { nearest } from '../shared/nearest.ts';

export interface PortStatusItem {
  name: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  configured_in: string[];
  available_to_port: string[];
  remote: boolean;
}

export interface PortStatusReport {
  servers: PortStatusItem[];
  runtimes: string[];
  summary: string;
}

export interface PortResult {
  ok: boolean;
  server: string;
  from?: string;
  to?: string;
  results: {
    runtime: string;
    label: string;
    path: string;
    action: 'added' | 'updated' | 'already_configured';
    backup?: string;
  }[];
  dry_run?: boolean;
  error?: string;
}

/** Lists all discovered tool servers across all runtimes, with porting targets. */
export function listPortStatus(home = process.env.HOME || '/'): PortStatusReport {
  const all = toolServers(home);
  const installed = runtimesFound(home).map(r => r.target.runtime);

  const servers: PortStatusItem[] = all
    .filter(s => s.command && !s.remote)
    .map(s => {
      const configured = [...new Set(s.declared_runtimes ?? s.runtimes)];
      const available = installed.filter(rt => !configured.includes(rt));
      return {
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
        configured_in: configured,
        available_to_port: available,
        remote: s.remote,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = servers.length;
  const portable = servers.filter(s => s.available_to_port.length > 0).length;

  return {
    servers,
    runtimes: installed,
    summary: `${total} local MCP servers found across ${installed.length} runtimes · ${portable} can be ported to other agents`,
  };
}

/**
 * Port an MCP server from one runtime to another (or all detected runtimes).
 */
export function portServer(
  serverName: string,
  options: {
    to?: string;
    from?: string;
    home?: string;
    dryRun?: boolean;
  } = {}
): PortResult {
  const home = options.home || process.env.HOME || '/';
  const dryRun = options.dryRun ?? false;
  const all = toolServers(home);

  if (!serverName) {
    return {
      ok: false,
      server: '',
      results: [],
      error: 'Usage: ambit port <server-name> --to=<runtime|all> [--from=<runtime>] [--dry-run]',
    };
  }

  const matches = all.filter(s => s.name === serverName);
  if (!matches.length) {
    const suggestions = nearest(
      serverName,
      all.map(s => s.name)
    );
    return {
      ok: false,
      server: serverName,
      results: [],
      error: `No MCP server named "${serverName}" in your configs.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
    };
  }

  let source: ToolServer | undefined;
  if (options.from) {
    source = matches.find(s => (s.declared_runtimes ?? s.runtimes).includes(options.from!));
    if (!source) {
      return {
        ok: false,
        server: serverName,
        results: [],
        error: `Server "${serverName}" is not configured in runtime "${options.from}". Configured in: ${matches.flatMap(m => m.declared_runtimes ?? m.runtimes).join(', ')}`,
      };
    }
  } else {
    source = matches.find(s => s.command && !s.remote) || matches[0];
  }

  if (!source.command) {
    return {
      ok: false,
      server: serverName,
      results: [],
      error: `Server "${serverName}" has no launch command (or is remote), so it cannot be ported automatically.`,
    };
  }

  const spec: ServerSpec = {
    name: source.name,
    command: source.command,
    args: source.args,
    env: source.env,
  };

  const to = options.to?.toLowerCase();
  if (!to) {
    return {
      ok: false,
      server: serverName,
      results: [],
      error: `Specify destination runtime with --to=<runtime|all>. Available: ${runtimeWords().join(', ')}, all`,
    };
  }

  const targetRuntimes: string[] = [];
  const sourceRuntimes = source.declared_runtimes ?? source.runtimes;
  if (to === 'all') {
    const installed = runtimesFound(home).map(r => r.target.runtime);
    targetRuntimes.push(...installed.filter(rt => !sourceRuntimes.includes(rt)));
    if (!targetRuntimes.length) {
      return {
        ok: true,
        server: serverName,
        from: sourceRuntimes[0],
        results: [],
        dry_run: dryRun,
        error: `Server "${serverName}" is already configured in all detected runtimes.`,
      };
    }
  } else {
    const target = runtimeTarget(to);
    if (!target) {
      return {
        ok: false,
        server: serverName,
        results: [],
        error: `Unknown runtime "${to}". Available: ${runtimeWords().join(', ')}, all`,
      };
    }
    targetRuntimes.push(to);
  }

  const results: PortResult['results'] = [];
  for (const rt of targetRuntimes) {
    const target = runtimeTarget(rt)!;
    const file = targetFile(target, home);
    try {
      const res = configureServerEntry(file.path, target.kind, spec, dryRun);
      results.push({
        runtime: rt,
        label: target.label,
        path: file.path,
        action: res.action,
        backup: res.backup,
      });
    } catch (err: any) {
      return {
        ok: false,
        server: serverName,
        results,
        error: err?.message || `Failed to configure ${rt}`,
      };
    }
  }

  return {
    ok: true,
    server: serverName,
    from: source.runtimes[0],
    to,
    results,
    dry_run: dryRun,
  };
}
