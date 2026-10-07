import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keepBackup } from '../shared/backup.ts';
import { mcpEntries, parseJsonc } from '../shared/opencode.ts';
import { clientPaths } from './mcp-clients.ts';
import { ambitCommand } from './paths.ts';

/**
 * Where a runtime keeps its servers, in the shape it reads them:
 * `mcpServers` (most JSON clients), OpenCode's `mcp`, VS Code's `servers`,
 * Zed's `context_servers`, and Codex's `[mcp_servers.<name>]` TOML tables.
 */
type ConfigKind = 'mcpServers' | 'opencode' | 'servers' | 'context_servers' | 'codex';

export interface ConnectTarget {
  runtime: string;
  label: string;
  /** Relative to the home directory, or absolute when the reader supplies them. */
  paths: string[] | ((home: string) => string[]);
  kind: ConfigKind;
}

export interface ConnectResult {
  ok: boolean;
  configured: {
    runtime: string;
    label: string;
    path: string;
    action: 'added' | 'updated' | 'already_configured';
    /** Where the file stood before this run, when it existed and was rewritten. */
    backup?: string;
  }[];
  skipped: {
    runtime: string;
    label: string;
    reason: string;
  }[];
  dry_run?: boolean;
  /** Which files were rewritten and where each was kept, or would be on a dry run. */
  note?: string;
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
  // The ones below take their paths from the readers in mcp-clients.ts, so
  // connect writes where discovery reads and the two lists cannot drift.
  // Copilot CLI, Amp and Goose are read and not written: every entry Copilot
  // documents names its transport, which the shared writer leaves out; Amp's
  // sit under a dotted key; and Goose keeps YAML, which nothing here writes.
  {
    runtime: 'gemini-cli',
    label: 'Gemini CLI',
    paths: home => clientPaths('gemini-cli', home),
    kind: 'mcpServers',
  },
  {
    runtime: 'cline',
    label: 'Cline',
    paths: home => clientPaths('cline', home),
    kind: 'mcpServers',
  },
  {
    runtime: 'roo-code',
    label: 'Roo Code',
    paths: home => clientPaths('roo-code', home),
    kind: 'mcpServers',
  },
  {
    runtime: 'vscode',
    label: 'VS Code',
    paths: home => clientPaths('vscode', home),
    kind: 'servers',
  },
  {
    runtime: 'zed',
    label: 'Zed',
    paths: home => clientPaths('zed', home),
    kind: 'context_servers',
  },
  {
    runtime: 'codex',
    label: 'Codex CLI',
    paths: home => clientPaths('codex', home),
    kind: 'codex',
  },
  {
    runtime: 'kiro',
    label: 'Kiro',
    paths: home => clientPaths('kiro', home),
    kind: 'mcpServers',
  },
];

/** The same command for every runtime: `ambit mcp`, or through npx from npx's cache. */
function serverCommand(): { command: string; args: string[] } {
  const [command, ...rest] = ambitCommand();
  return { command, args: [...rest, 'mcp'] };
}

/** Whether an existing entry already starts this server, in either form. */
function startsAmbit(entry: any): boolean {
  const { command, args } = serverCommand();
  const said = [entry?.command, ...(entry?.args ?? [])].flat().filter(Boolean).join(' ');
  return said === [command, ...args].join(' ') || said === 'ambit mcp';
}

/**
 * Codex keeps servers in TOML, which the engine reads with a reader of its
 * own and has no writer for. A table is appended when none is named ambit;
 * one that exists is left alone, since rewriting TOML by hand risks the rest.
 */
function configureCodex(
  filePath: string,
  dryRun: boolean
): { action: 'added' | 'already_configured'; backup?: string } {
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  if (/^\[mcp_servers\.ambit\]\s*$/m.test(text)) return { action: 'already_configured' };
  const { command, args } = serverCommand();
  const table = `[mcp_servers.ambit]\ncommand = ${JSON.stringify(command)}\nargs = [${args.map(a => JSON.stringify(a)).join(', ')}]\n`;
  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${table}`
    );
  }
  return { action: 'added', backup };
}

/** Add or update the ambit entry in a client configuration. */
function configureFile(
  filePath: string,
  kind: ConfigKind,
  dryRun = false
): { action: 'added' | 'updated' | 'already_configured'; backup?: string } {
  if (kind === 'codex') return configureCodex(filePath, dryRun);
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

  if (kind === 'mcpServers' || kind === 'servers' || kind === 'context_servers') {
    if (!parsed[kind] || typeof parsed[kind] !== 'object') parsed[kind] = {};
    const servers = parsed[kind];
    const existing = Object.hasOwn(servers, 'ambit') ? servers.ambit : undefined;
    if (existing && startsAmbit(existing)) {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      // VS Code names the transport, and Zed marks a server it did not install.
      servers.ambit = {
        ...(kind === 'servers' ? { type: 'stdio' } : {}),
        ...(kind === 'context_servers' ? { source: 'custom' } : {}),
        ...serverCommand(),
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
      const command = [...ambitCommand(), 'mcp'];
      servers.ambit = v2
        ? { type: 'local', command, disabled: false }
        : { type: 'local', command, enabled: true };
    }
  }

  // The file is someone's own config, rewritten whole, so what it held is
  // kept in `<file>.bak` first. A backup that cannot be made throws, and the
  // file is left as it was.
  let backup: string | undefined;
  if (action !== 'already_configured' && !dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
  }

  return { action, backup };
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
    const fullPaths =
      typeof target.paths === 'function'
        ? target.paths(home)
        : target.paths.map(p => join(home, p));
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
      const { action, backup } = configureFile(targetPath, target.kind, dryRun);
      configured.push({
        runtime: target.runtime,
        label: target.label,
        path: targetPath,
        action,
        ...(backup ? { backup } : {}),
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
    note: changeNote(configured, dryRun, home),
  };
}

/**
 * The files this run rewrote, and where each one's previous contents are.
 * Run bare, `connect` edits every runtime config it finds without asking, so
 * the answer says plainly what it touched and how to put each back.
 */
function changeNote(
  configured: ConnectResult['configured'],
  dryRun: boolean,
  home: string
): string | undefined {
  const changed = configured.filter(c => c.action !== 'already_configured');
  if (!changed.length) return undefined;
  const short = (path = '') =>
    home !== '/' && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  const list = (paths: (string | undefined)[]) => paths.map(short).join(', ');
  if (dryRun) {
    return `Would change ${list(changed.map(c => c.path))}, keeping each file that exists in <file>.bak first. Nothing was written.`;
  }
  const kept = changed.filter(c => c.backup);
  const created = changed.filter(c => !c.backup);
  return [
    kept.length
      ? `Changed ${list(kept.map(c => c.path))}. What each held is in ${list(kept.map(c => c.backup))}.`
      : '',
    created.length ? `Created ${list(created.map(c => c.path))}, which did not exist.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
