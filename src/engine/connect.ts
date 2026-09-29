import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
    paths: ['.config/opencode/opencode.json'],
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
  let parsed: any = {};
  if (existsSync(filePath)) {
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      parsed = {};
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
    const existing = parsed.mcp.ambit;
    if (existing && existing.enabled !== false) {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      parsed.mcp.ambit = {
        type: 'local',
        command: ['ambit', 'mcp'],
        enabled: true,
      };
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
