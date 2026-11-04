import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keepBackup } from '../shared/backup.ts';
import { setIn } from '../shared/jsonEdit.ts';
import { mcpEntries, parseJsonc } from '../shared/opencode.ts';
import { shellQuote } from '../shared/shell.ts';
import { clientPaths } from './mcp-clients.ts';
import { ambitCommand, cursorLedgerScript } from './paths.ts';
import { gateHookEntry, gateInstalled } from './wiring.ts';

/**
 * Where a runtime keeps its servers, in the shape it reads them:
 * `mcpServers` (most JSON clients), OpenCode's `mcp`, VS Code's `servers`,
 * Zed's `context_servers`, and Codex's `[mcp_servers.<name>]` TOML tables.
 */
export type ConfigKind = 'mcpServers' | 'opencode' | 'servers' | 'context_servers' | 'codex';

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
    /**
     * For Cursor's ledger hooks and Claude Code's status line, the command the
     * entry runs, so a dry run shows the change.
     */
    hook?: string;
    /** And the events it is added under. */
    events?: string[];
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
    // Where the seed reads it (`claudeConfigPath`), so a write lands in the
    // file the next read finds.
    paths: home => [process.env.CLAUDE_CONFIG || join(home, '.claude.json')],
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
    paths: home => clientPaths('claude-desktop', home),
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

/**
 * A local tool server as every runtime can say it: the name it is listed
 * under, the program that starts it, and that program's arguments.
 */
export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** The runtime a word names, as `connect` and `apply --to` take it. */
export function runtimeTarget(runtime: string): ConnectTarget | undefined {
  return RUNTIME_TARGETS.find(t => t.runtime === runtime.toLowerCase());
}

/** Every runtime a config can be written for, by the word `--to` takes. */
export function runtimeWords(): string[] {
  return RUNTIME_TARGETS.map(t => t.runtime);
}

/** The file a runtime reads: the first of its paths that exists, else the first. */
export function targetFile(target: ConnectTarget, home: string): { path: string; exists: boolean } {
  const paths =
    typeof target.paths === 'function' ? target.paths(home) : target.paths.map(p => join(home, p));
  const found = paths.find(p => existsSync(p));
  return { path: found ?? paths[0], exists: Boolean(found) };
}

/** The runtimes whose config file is on this machine, each with that file. */
export function runtimesFound(home: string): { target: ConnectTarget; path: string }[] {
  return RUNTIME_TARGETS.flatMap(target => {
    const file = targetFile(target, home);
    return file.exists ? [{ target, path: file.path }] : [];
  });
}

/**
 * A server's entry in the words of a file of this kind. VS Code names the
 * transport, Zed marks a server it did not install, and the rest take the
 * command and its arguments alone. OpenCode and Codex keep theirs in shapes
 * of their own, and have none here.
 */
export function entryOf(kind: ConfigKind, server: Omit<ServerSpec, 'name'>) {
  if (kind === 'opencode' || kind === 'codex') return undefined;
  return {
    ...(kind === 'servers' ? { type: 'stdio' } : {}),
    ...(kind === 'context_servers' ? { source: 'custom' } : {}),
    command: server.command,
    args: server.args,
    ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
  };
}

/**
 * The one command that adds a server, for the runtimes that ship one, each
 * checked against that CLI's own help: Claude Code at user scope, which is the
 * `mcpServers` of `~/.claude.json` this module writes, Codex, and VS Code. A
 * runtime without one is answered with its file and the entry that goes in it.
 * Every word is quoted, since a name or an argument can be anything the tree
 * gave it.
 */
export function addCommand(runtime: string, server: ServerSpec): string | undefined {
  const q = (words: string[]) => words.map(shellQuote).join(' ');
  const env = Object.entries(server.env ?? {}).map(([k, v]) => `${k}=${v}`);
  const launch = q([server.command, ...server.args]);
  switch (runtime) {
    case 'claude-code':
      return `claude mcp add --scope user ${q([server.name])}${env.length ? ` ${q(env.flatMap(e => ['-e', e]))}` : ''} -- ${launch}`;
    case 'codex':
      return `codex mcp add ${q([server.name])}${env.length ? ` ${q(env.flatMap(e => ['--env', e]))}` : ''} -- ${launch}`;
    case 'vscode':
      return `code --add-mcp ${shellQuote(JSON.stringify({ name: server.name, ...entryOf('servers', server) }))}`;
    default:
      return undefined;
  }
}

/** One entry of a Cursor hooks.json list: the command, and seconds before Cursor gives up on it. */
export interface CursorHook {
  command: string;
  timeout: number;
}

/**
 * The Cursor events the ledger hook records, as hooks.json names them. The
 * script keeps the same four (plugins/cursor/ambit-ledger.mjs), and a test runs
 * it on each. None is a permission hook, so the entries cannot block or allow
 * anything; the script says why the permission hooks are left alone.
 */
export const CURSOR_LEDGER_EVENTS = [
  'afterShellExecution',
  'afterMCPExecution',
  'postToolUseFailure',
  'sessionEnd',
] as const;

/** The entry `--ledger` adds under each event: this copy's hook, by its absolute path. */
export function cursorLedgerHook(script = cursorLedgerScript()): CursorHook {
  return { command: `node ${shellQuote(script)}`, timeout: 5 };
}

/** Whether a hooks.json entry is Ambit's ledger hook, from this copy or an earlier one. */
const isLedgerHook = (entry: any) =>
  typeof entry?.command === 'string' && entry.command.includes('ambit-ledger.mjs');

/**
 * Add the ledger hook to Cursor's hooks.json under each event it records,
 * keeping every hook already there. An entry for the hook from another path,
 * such as a copy installed elsewhere before, is replaced and not doubled, since
 * Cursor runs every entry and two would write each line twice. The file is
 * kept in `<file>.bak` first, as every config `connect` writes is, and one that
 * does not parse, or whose shape is not the one Cursor documents, is left alone.
 */
function configureCursorHooks(
  filePath: string,
  dryRun: boolean
): {
  action: 'added' | 'updated' | 'already_configured';
  backup?: string;
} {
  const hook = cursorLedgerHook();
  let parsed: any = { version: 1, hooks: {} };
  const existed = existsSync(filePath);
  if (existed) {
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
          ? `${filePath} has comments, and writing it would delete them; add the hooks by hand`
          : `${filePath} is not valid JSON; left unchanged`
      );
    }
  }
  const isObject = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(parsed) || (parsed.hooks !== undefined && !isObject(parsed.hooks))) {
    throw new Error(
      `${filePath} is not a hooks file in the shape Cursor documents; left unchanged`
    );
  }
  // Cursor requires the version; a file without one gets the only one there is.
  if (parsed.version === undefined) parsed = { version: 1, ...parsed };
  if (!parsed.hooks) parsed.hooks = {};
  const hooks = parsed.hooks as Record<string, unknown>;

  let changed = false;
  let replaced = false;
  for (const event of CURSOR_LEDGER_EVENTS) {
    const list = Object.hasOwn(hooks, event) ? hooks[event] : [];
    if (!Array.isArray(list)) {
      throw new Error(`${filePath} has hooks.${event} that is not a list; left unchanged`);
    }
    const ours = list.filter(isLedgerHook);
    if (ours.length === 1 && ours[0].command === hook.command) continue;
    if (ours.length) replaced = true;
    hooks[event] = [...list.filter(e => !isLedgerHook(e)), hook];
    changed = true;
  }
  if (!changed) return { action: 'already_configured' };

  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
  }
  return { action: existed && replaced ? 'updated' : 'added', backup };
}

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
 * Append or configure an arbitrary MCP server table in Codex config.toml.
 * Codex keeps servers in TOML, which the engine reads with a reader of its
 * own and has no writer for. A table is appended when none is named; one that
 * exists is left alone, since rewriting TOML by hand risks the rest.
 */
export function configureCodexServer(
  filePath: string,
  server: ServerSpec,
  dryRun: boolean
): { action: 'added' | 'already_configured'; backup?: string } {
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const escaped = server.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^\\[mcp_servers\\.${escaped}\\]\\s*$`, 'm').test(text)) {
    return { action: 'already_configured' };
  }
  let table = `[mcp_servers.${server.name}]\ncommand = ${JSON.stringify(server.command)}\nargs = [${server.args.map(a => JSON.stringify(a)).join(', ')}]\n`;
  if (server.env && Object.keys(server.env).length) {
    const envEntries = Object.entries(server.env)
      .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
      .join(', ');
    table += `env = { ${envEntries} }\n`;
  }
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

/** Add or update any server entry in a client configuration. */
export function configureServerEntry(
  filePath: string,
  kind: ConfigKind,
  server: ServerSpec,
  dryRun = false
): { action: 'added' | 'updated' | 'already_configured'; backup?: string } {
  if (kind === 'codex') return configureCodexServer(filePath, server, dryRun);
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
          ? `${filePath} has comments, and writing it would delete them; add the ${server.name} server by hand`
          : `${filePath} is not valid JSON; left unchanged`
      );
    }
  }

  let action: 'added' | 'updated' | 'already_configured' = 'added';

  if (kind === 'mcpServers' || kind === 'servers' || kind === 'context_servers') {
    if (!parsed[kind] || typeof parsed[kind] !== 'object') parsed[kind] = {};
    const servers = parsed[kind];
    const existing = Object.hasOwn(servers, server.name) ? servers[server.name] : undefined;
    const same =
      server.name === 'ambit'
        ? existing && startsAmbit(existing)
        : existing &&
          existing.command === server.command &&
          JSON.stringify(existing.args ?? []) === JSON.stringify(server.args ?? []);
    if (same) {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      servers[server.name] = entryOf(kind, server);
    }
  } else if (kind === 'opencode') {
    if (!parsed.mcp || typeof parsed.mcp !== 'object') {
      parsed.mcp = {};
    }
    const { bag, v2 } = mcpEntries(parsed);
    const servers = bag as Record<string, any>;
    const existing = Object.hasOwn(servers, server.name) ? servers[server.name] : undefined;
    const off = existing && (existing.enabled === false || existing.disabled === true);
    const same =
      server.name === 'ambit'
        ? existing && !off
        : existing &&
          JSON.stringify(existing.command ?? []) ===
            JSON.stringify([server.command, ...server.args]);
    if (same) {
      action = 'already_configured';
    } else {
      action = existing ? 'updated' : 'added';
      const command = [server.command, ...server.args];
      servers[server.name] = v2
        ? {
            type: 'local',
            command,
            disabled: false,
            ...(server.env && Object.keys(server.env).length ? { environment: server.env } : {}),
          }
        : {
            type: 'local',
            command,
            enabled: true,
            ...(server.env && Object.keys(server.env).length ? { environment: server.env } : {}),
          };
    }
  }

  let backup: string | undefined;
  if (action !== 'already_configured' && !dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
  }

  return { action, backup };
}

/** Add or update the ambit entry in a client configuration. */
function configureFile(
  filePath: string,
  kind: ConfigKind,
  dryRun = false
): { action: 'added' | 'updated' | 'already_configured'; backup?: string } {
  return configureServerEntry(filePath, kind, { name: 'ambit', ...serverCommand() }, dryRun);
}

/** Connect Ambit as meta-MCP server to detected or specified agent runtimes. */
export function runConnect(
  runtimeName?: string,
  options: {
    home?: string;
    dryRun?: boolean;
    force?: boolean;
    ledger?: boolean;
    statusline?: boolean;
    gate?: boolean;
  } = {}
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

  if (options.ledger) connectCursorLedger(runtimeName, home, options, configured, skipped);
  if (options.statusline) connectStatusLine(runtimeName, home, options, configured, skipped);
  if (options.gate) connectGate(runtimeName, home, options, configured, skipped);

  return {
    ok: configured.length > 0 || skipped.length === 0,
    configured,
    skipped,
    dry_run: dryRun,
    note:
      [changeNote(configured, dryRun, home), npxNote(configured)].filter(Boolean).join(' ') ||
      undefined,
  };
}

/**
 * `--ledger`: Cursor's hooks, which record what each conversation ran into the
 * work ledger. Only Cursor takes them here. Claude Code's ledger is the `ambit`
 * plugin's hooks and OpenCode's is plugins/ambit-telemetry.js, so naming either
 * with `--ledger` says where theirs is and writes nothing. Run bare, it adds the
 * hooks where Cursor is installed, as the MCP entry is added where its file is.
 */
function connectCursorLedger(
  runtimeName: string | undefined,
  home: string,
  options: { dryRun?: boolean; force?: boolean },
  configured: ConnectResult['configured'],
  skipped: ConnectResult['skipped']
) {
  const label = 'Cursor ledger hooks';
  if (runtimeName && runtimeName.toLowerCase() !== 'cursor') {
    skipped.push({
      runtime: runtimeName,
      label,
      reason:
        '--ledger adds the Cursor hooks. Claude Code records through the ambit plugin, OpenCode through plugins/ambit-telemetry.js',
    });
    return;
  }
  const path = join(home, '.cursor', 'hooks.json');
  if (!runtimeName && !options.force && !existsSync(dirname(path))) {
    skipped.push({ runtime: 'cursor', label, reason: 'Cursor not found on host' });
    return;
  }
  try {
    const { action, backup } = configureCursorHooks(path, options.dryRun ?? false);
    configured.push({
      runtime: 'cursor',
      label,
      path,
      action,
      ...(backup ? { backup } : {}),
      hook: cursorLedgerHook().command,
      events: [...CURSOR_LEDGER_EVENTS],
    });
  } catch (err: any) {
    skipped.push({ runtime: 'cursor', label, reason: err?.message || 'Failed to update hooks' });
  }
}

/** The status line `--statusline` sets: this copy's command, as Claude Code runs it. */
export function statusLineEntry(): { type: 'command'; command: string } {
  return { type: 'command', command: [...ambitCommand(), 'statusline'].join(' ') };
}

/**
 * Set `statusLine` in Claude Code's settings.json, only where none is set.
 * Claude Code runs one status line command, and a person who has one chose
 * it: Ambit never replaces it, and says how to add its line to theirs. One
 * that already runs `ambit statusline`, on its own or inside a longer
 * command, is left as it is. The member is spliced into the file's own text,
 * so its layout and any comments stay, and the file is kept in `<file>.bak`
 * first.
 */
function configureStatusLine(
  filePath: string,
  dryRun: boolean
): { action: 'added' | 'already_configured'; backup?: string } {
  const entry = statusLineEntry();
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '{}\n';
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    throw new Error(`${filePath} is not valid JSON; left unchanged`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a settings object; left unchanged`);
  }
  if (Object.hasOwn(parsed, 'statusLine')) {
    const theirs = (parsed as { statusLine?: { command?: unknown } }).statusLine?.command;
    if (typeof theirs === 'string' && theirs.includes(entry.command)) {
      return { action: 'already_configured' };
    }
    throw new Error(
      `${filePath} already sets a statusLine, and Ambit never replaces one. To show both, run \`${entry.command}\` from that command and print its line beside yours`
    );
  }
  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, setIn(text, ['statusLine'], entry));
  }
  return { action: 'added', backup };
}

/**
 * `--statusline`: `ambit statusline` as Claude Code's status line. Only Claude
 * Code runs one. A copy run through npx is not written in: the command runs
 * after every message, and npx would resolve the package again on each run,
 * where an installed `ambit` answers in about a twentieth of a second.
 */
function connectStatusLine(
  runtimeName: string | undefined,
  home: string,
  options: { dryRun?: boolean; force?: boolean },
  configured: ConnectResult['configured'],
  skipped: ConnectResult['skipped']
) {
  const label = 'Claude Code status line';
  if (runtimeName && runtimeName.toLowerCase() !== 'claude-code') {
    skipped.push({
      runtime: runtimeName,
      label,
      reason: '--statusline sets the status line of Claude Code, the one runtime that runs one',
    });
    return;
  }
  const path = join(home, '.claude', 'settings.json');
  if (!runtimeName && !options.force && !existsSync(dirname(path))) {
    skipped.push({ runtime: 'claude-code', label, reason: 'Claude Code not found on host' });
    return;
  }
  if (ambitCommand()[0] === 'npx') {
    skipped.push({
      runtime: 'claude-code',
      label,
      reason:
        'A status line runs after every message, and npx would resolve the package again on each run: install with `npm install -g ambit-cli` and run this again',
    });
    return;
  }
  try {
    const { action, backup } = configureStatusLine(path, options.dryRun ?? false);
    configured.push({
      runtime: 'claude-code',
      label,
      path,
      action,
      ...(backup ? { backup } : {}),
      hook: statusLineEntry().command,
    });
  } catch (err: any) {
    skipped.push({
      runtime: 'claude-code',
      label,
      reason: err?.message || 'Failed to update settings',
    });
  }
}

/**
 * Add the gate to Claude Code's PreToolUse hooks, beside any already there, and
 * do nothing where the plugin or an earlier run already put it on. The array is
 * rewritten whole, so a comment inside it does not survive; the file is kept in
 * `<file>.bak` first.
 */
function configureGate(
  filePath: string,
  home: string,
  dryRun: boolean
): { action: 'added' | 'already_configured'; backup?: string } {
  if (gateInstalled(home)) return { action: 'already_configured' };
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '{}\n';
  let parsed: { hooks?: unknown } | undefined;
  try {
    parsed = parseJsonc(text);
  } catch {
    throw new Error(`${filePath} is not valid JSON; left unchanged`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a settings object; left unchanged`);
  }
  const hooks = parsed.hooks;
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))) {
    throw new Error(`${filePath} has a hooks value that is not an object; left unchanged`);
  }
  const theirs = (hooks as { PreToolUse?: unknown } | undefined)?.PreToolUse;
  if (theirs !== undefined && !Array.isArray(theirs)) {
    throw new Error(`${filePath} has a PreToolUse value that is not a list; left unchanged`);
  }
  const entry = gateHookEntry([...ambitCommand(), 'gate'].join(' '));
  let backup: string | undefined;
  if (!dryRun) {
    backup = keepBackup(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, setIn(text, ['hooks', 'PreToolUse'], [...(theirs ?? []), entry]));
  }
  return { action: 'added', backup };
}

/**
 * `--gate`: `ambit gate` on every Claude Code tool call. Only Claude Code has
 * the hook. A copy run through npx is not written in: the hook runs before every
 * call with a ten-second limit, and npx would resolve the package again each
 * time, so a slow resolve would pass the call through with no answer.
 */
function connectGate(
  runtimeName: string | undefined,
  home: string,
  options: { dryRun?: boolean; force?: boolean },
  configured: ConnectResult['configured'],
  skipped: ConnectResult['skipped']
) {
  const label = 'Claude Code gate';
  if (runtimeName && runtimeName.toLowerCase() !== 'claude-code') {
    skipped.push({
      runtime: runtimeName,
      label,
      reason: '--gate puts the gate on Claude Code, the one runtime with the hook it needs',
    });
    return;
  }
  const path = join(home, '.claude', 'settings.json');
  if (!runtimeName && !options.force && !existsSync(dirname(path))) {
    skipped.push({ runtime: 'claude-code', label, reason: 'Claude Code not found on host' });
    return;
  }
  if (ambitCommand()[0] === 'npx') {
    skipped.push({
      runtime: 'claude-code',
      label,
      reason:
        'The gate runs before every tool call, and npx would resolve the package again each time: install with `npm install -g ambit-cli` and run this again',
    });
    return;
  }
  try {
    const { action, backup } = configureGate(path, home, options.dryRun ?? false);
    configured.push({
      runtime: 'claude-code',
      label,
      path,
      action,
      ...(backup ? { backup } : {}),
      hook: [...ambitCommand(), 'gate'].join(' '),
    });
  } catch (err: any) {
    skipped.push({
      runtime: 'claude-code',
      label,
      reason: err?.message || 'Failed to update settings',
    });
  }
}

/**
 * A copy npx unpacked lives in npx's cache, which npm may clear, and the hooks
 * name their script by its path there; said so the person can install a copy
 * whose path lasts.
 */
function npxNote(configured: ConnectResult['configured']): string | undefined {
  const hooked = configured.some(c => c.hook && c.action !== 'already_configured');
  if (!hooked || ambitCommand()[0] !== 'npx') return undefined;
  return "The Cursor hooks run a script in npx's cache, which npm may clear: install with `npm install -g ambit-cli` and run this again for a path that lasts.";
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
