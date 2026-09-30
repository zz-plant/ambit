import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mcpEntries, parseJsonc } from '../shared/opencode.ts';

export interface ConnectTarget {
  runtime: string;
  label: string;
  paths: string[];
  kind: 'mcpServers' | 'opencode';
}

export interface ConnectResult {
  ok: boolean;
  configured: {
    runtime: string;
    label: string;
    path: string;
    action: 'added' | 'updated' | 'already_configured';
  }[];
  skipped: {
    runtime: string;
    label: string;
    reason: string;
  }[];
  dry_run?: boolean;
}

const RUNTIME_TARGETS: ConnectTarget[] = [
  {
    runtime: 'claude-code',
    label: 'Claude Code',
    paths: ['.claude.json'],
    kind: 'mcpServers',
  },
  {
    runtime: 'cursor',
    label: 'Cursor',
    paths: ['.cursor/mcp.json'],
    kind: 'mcpServers',
  },
  {
    runtime: 'claude-desktop',
    label: 'Claude Desktop',
    paths: [
      'Library/Application Support/Claude/claude_desktop_config.json',
      '.config/Claude/claude_desktop_config.json',
    ],
    kind: 'mcpServers',
  },
  {
    runtime: 'windsurf',
    label: 'Windsurf',
    paths: ['.codeium/windsurf/mcp_config.json'],
    kind: 'mcpServers',
  },
  {
    runtime: 'opencode',
    label: 'OpenCode',
    paths: ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'],
    kind: 'opencode',
  },
  {
    runtime: 'continue',
    label: 'Continue',
    paths: ['.continue/config.json'],
    kind: 'mcpServers',
  },
];

/** Add or update the ambit entry in a client configuration. */
function configureFile(
  filePath: string,
  kind: 'mcpServers' | 'opencode',
  dryRun = false
): 'added' | 'updated' | 'already_configured' {
  // A file that does not parse is left as it is. Replacing it with `{}` plus
  // one entry deleted every other server, agent and key a person had in it,
  // and a commented `.jsonc` file, which OpenCode reads and JSON.parse does
  // not, was exactly such a file.
  let parsed: any = {};
  if (existsSync(filePath)) {
    const text = readFileSync(filePath, 'utf8');
    try {
      parsed = JSON.parse(text);
    } catch {
      let commented = false;
      try {
        parseJsonc(text);
        commented = true;
      } catch {}
      throw new Error(
        commented
          ? `${filePath} has comments, and writing it would delete them; add the ambit server by hand`
          : `${filePath} is not valid JSON; left unchanged`
      );
    }
  }

  let action: 'added' | 'updated' | 'already_configured' = 'added';

  if (kind === 'mcpServers') {
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      parsed.mcpServers = {};
    }
    const existing = parsed.mcpServers.ambit;
    if (existing && existing.command === 'ambit') {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      parsed.mcpServers.ambit = {
        command: 'ambit',
        args: ['mcp'],
      };
    }
  } else if (kind === 'opencode') {
    if (!parsed.mcp || typeof parsed.mcp !== 'object') {
      parsed.mcp = {};
    }
    // OpenCode 2 keeps servers under `mcp.servers` and switches one off with
    // `disabled`; the entry goes into whichever shape the file is already in.
    const { bag, v2 } = mcpEntries(parsed);
    const servers = bag as Record<string, any>;
    const existing = Object.hasOwn(servers, 'ambit') ? servers.ambit : undefined;
    const off = existing && (existing.enabled === false || existing.disabled === true);
    if (existing && !off) {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      servers.ambit = v2
        ? { type: 'local', command: ['ambit', 'mcp'], disabled: false }
        : { type: 'local', command: ['ambit', 'mcp'], enabled: true };
    }
  }

  if (action !== 'already_configured' && !dryRun) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
  }

  return action;
}

/** Connect Ambit as meta-MCP server to detected or specified agent runtimes. */
export function runConnect(
  runtimeName?: string,
  options: { home?: string; dryRun?: boolean; force?: boolean } = {}
): ConnectResult {
  const home = options.home || process.env.HOME || '/';
  const dryRun = options.dryRun ?? false;

  const configured: ConnectResult['configured'] = [];
  const skipped: ConnectResult['skipped'] = [];

  const targets = runtimeName
    ? RUNTIME_TARGETS.filter(t => t.runtime.toLowerCase() === runtimeName.toLowerCase())
    : RUNTIME_TARGETS;

  if (runtimeName && targets.length === 0) {
    return {
      ok: false,
      configured: [],
      skipped: [
        {
          runtime: runtimeName,
          label: runtimeName,
          reason: `Unknown runtime. Supported: ${RUNTIME_TARGETS.map(t => t.runtime).join(', ')}`,
        },
      ],
      dry_run: dryRun,
    };
  }

  for (const target of targets) {
    const fullPaths = target.paths.map(p => join(home, p));
    let targetPath = fullPaths.find(p => existsSync(p));

    if (!targetPath) {
      if (runtimeName || options.force) {
        // If explicitly requested, use the first path option even if not yet created
        targetPath = fullPaths[0];
      } else {
        skipped.push({
          runtime: target.runtime,
          label: target.label,
          reason: 'Config path not found on host',
        });
        continue;
      }
    }

    try {
      const action = configureFile(targetPath, target.kind, dryRun);
      configured.push({
        runtime: target.runtime,
        label: target.label,
        path: targetPath,
        action,
      });
    } catch (err: any) {
      skipped.push({
        runtime: target.runtime,
        label: target.label,
        reason: err?.message || 'Failed to update config',
      });
    }
  }

  return {
    ok: configured.length > 0 || skipped.length === 0,
    configured,
    skipped,
    dry_run: dryRun,
  };
}
