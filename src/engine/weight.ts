/**
 * What a loadout carries: the tool listings a runtime loads every session.
 *
 * A runtime that starts a tool server asks it for its tools and puts each
 * one's name, description and input schema into the model's context before
 * the first message, whether or not any of them is called. No config says how
 * much that is, and it grows with every server added. It is the loadout's
 * weight, and the person carrying it never sees the number.
 *
 * `ambit weigh` asks. It starts each local server the user-level configs
 * declare, as its runtime would, asks for its tools over MCP, measures the
 * listing and stops the server. A server is a command, so this runs only when
 * a person types it: never on seed, and never from the API server, which reads
 * what was recorded. A project's committed config is never read, because a
 * command in a file that came with a clone is a file that travelled and then
 * executed. A remote server is not contacted: most need their runtime's own
 * sign-in, and reaching one is a request to a host, which weighing a local
 * command does not need.
 *
 * The figure is an estimate at four characters a token, of each listing as the
 * server sends it. A runtime that defers tool definitions until they are
 * searched for carries less than this, and one that wraps them carries more.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import type { ToolListingRow } from './rows.ts';
import type { ToolCarry } from '../shared/api.ts';
import { configDefault } from './paths.ts';
import { claudeConfigPath, mcpServersIn } from './claude-code.ts';
import { MCP_CLIENTS, discoverMcpClients } from './mcp-clients.ts';
import { mcpEntries, parseJsonc } from '../shared/opencode.ts';
import { carryByRuntime } from '../shared/carry.ts';
import { nearest } from '../shared/nearest.ts';
import { isReached, tokensOf } from './vocabulary.ts';

/** How long one server gets to start and list its tools. `npx` fetching a package on first run is most of it. */
const DEFAULT_TIMEOUT_SECONDS = 30;
/** How many servers start at once. */
const AT_ONCE = 4;
/** Pages of `tools/list` followed before a listing is taken as complete. */
const MAX_PAGES = 20;
/** The window "not called" is judged over. */
const USE_WINDOW_DAYS = 30;
/** The protocol version asked for. A server answers with the one it speaks, and `tools/list` is the same in each. */
const PROTOCOL_VERSION = '2025-06-18';

const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

const LABELS: Record<string, string> = {
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  ...Object.fromEntries(MCP_CLIENTS.map(c => [c.runtime, c.label])),
};
const labelOf = (runtime: string) => LABELS[runtime] ?? runtime;

/** One tool server as the configs declare it, with what starting it takes. */
interface ToolServer {
  name: string;
  /** The node the seed writes for it. */
  id: string;
  /** Every runtime whose config declares it switched on. */
  runtimes: string[];
  command?: string;
  args: string[];
  env: Record<string, string>;
  /** The project a Claude Code local-scope server belongs to, where it is started. */
  cwd?: string;
  remote: boolean;
  enabled: boolean;
}

/**
 * How a server entry starts, from any of the shapes the twelve configs use:
 * `command` as a string with `args` (most), as an array (OpenCode), or as an
 * object holding `path`, `args` and `env` (Zed's older one); `env`, or
 * `environment` (OpenCode).
 */
function launchOf(raw: any): Pick<ToolServer, 'command' | 'args' | 'env' | 'remote' | 'enabled'> {
  const remote = Boolean(
    raw?.url ||
      raw?.serverUrl ||
      raw?.httpUrl ||
      ['http', 'sse', 'remote', 'streamable-http'].includes(raw?.type)
  );
  const enabled = raw?.enabled !== false && raw?.disabled !== true;
  let command: string | undefined;
  let args: string[] = [];
  let env: Record<string, string> = {};
  const c = raw?.command;
  if (Array.isArray(c)) [command, ...args] = c.map(String);
  else if (c && typeof c === 'object') {
    command = typeof c.path === 'string' ? c.path : undefined;
    args = Array.isArray(c.args) ? c.args.map(String) : [];
    env = { ...(c.env ?? {}) };
  } else if (typeof c === 'string') command = c;
  if (Array.isArray(raw?.args)) args = [...args, ...raw.args.map(String)];
  for (const block of [raw?.env, raw?.environment]) {
    if (block && typeof block === 'object') {
      for (const [k, v] of Object.entries(block)) env[k] = String(v);
    }
  }
  return { command, args, env, remote, enabled };
}

/**
 * `${VAR}`, `${VAR:-default}`, `${env:VAR}` and `${userHome}`, as the runtimes
 * expand them before starting a server. Anything else is left as written, and
 * a server that needed it fails to start and says so.
 */
function expand(value: string): string {
  return value
    .replace(/\$\{userHome\}/g, process.env.HOME || '~')
    .replace(
      /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
      (whole, name: string, fallback?: string) => process.env[name] ?? fallback ?? whole
    );
}

function readConfig(path: string): any {
  try {
    return existsSync(path) ? parseJsonc(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

/**
 * Every tool server the user-level configs declare, one per name, since the
 * seed writes one node per name. The first declaration switched on is the one
 * started; every runtime declaring it on carries it. The sources are the
 * seed's, in its order and by its rule: OPENCODE_CONFIG names the one config
 * to read, and the others are left alone.
 */
function toolServers(home = process.env.HOME || '/'): ToolServer[] {
  const byName = new Map<string, ToolServer>();
  const add = (runtime: string, name: string, raw: unknown, cwd?: string) => {
    const launch = launchOf(raw);
    const known = byName.get(name);
    if (!known) {
      byName.set(name, {
        name,
        id: `mcp:${name}`,
        runtimes: launch.enabled ? [runtime] : [],
        cwd,
        ...launch,
      });
      return;
    }
    if (!launch.enabled) return;
    if (!known.runtimes.includes(runtime)) known.runtimes.push(runtime);
    if (!known.enabled) Object.assign(known, launch, { cwd });
  };

  const opencode = mcpEntries(readConfig(configDefault()) ?? {}).bag;
  for (const [name, raw] of Object.entries(opencode ?? {})) {
    add(process.env.AMBIT_RUNTIME || 'opencode', name, raw);
  }
  if (!process.env.OPENCODE_CONFIG) {
    for (const { name, server, project } of mcpServersIn(readConfig(claudeConfigPath()))) {
      add('claude-code', name, server, project);
    }
    for (const client of discoverMcpClients(home)) {
      for (const [name, raw] of Object.entries(client.config.mcp)) add(client.runtime, name, raw);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface Listing {
  /** Each tool's name and the length of what the model is sent for it, heaviest first. */
  tools: { name: string; chars: number }[];
  chars: number;
}

type Answer = { ok: true; listing: Listing } | { ok: false; reason: string };

/** What a model is sent for each tool: its name, description and input schema. */
function measure(tools: any[]): Listing {
  const each = tools
    .map(t => ({
      name: String(t?.name ?? ''),
      chars: JSON.stringify({
        name: t?.name,
        description: t?.description,
        inputSchema: t?.inputSchema,
      }).length,
    }))
    .sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name));
  return { tools: each, chars: each.reduce((n, t) => n + t.chars, 0) };
}

/**
 * Stops a server and anything it started. It runs in a process group of its
 * own, because `npx` starts the server as a child of its own and a signal to
 * `npx` alone can leave the server running.
 */
function stop(child: ChildProcess) {
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signal = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), 2000).unref();
}

/** The last line a server wrote to stderr, which is usually the reason it stopped. */
const lastLine = (text: string) =>
  text.trim().split('\n').filter(Boolean).pop()?.trim().slice(0, 160) ?? '';

/**
 * Starts one server, asks for its tools and stops it.
 *
 * Messages are newline-delimited JSON-RPC on stdio. A line that is not JSON is
 * skipped, since some servers log to stdout. A request from the server, such as
 * `roots/list`, is answered as not supported, because a client that never
 * answers leaves a server waiting.
 */
function listTools(server: ToolServer, timeoutMs: number): Promise<Answer> {
  return new Promise(resolve => {
    let child: ChildProcess;
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) env[k] = expand(v);
      child = spawn(expand(server.command!), server.args.map(expand), {
        cwd: server.cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (e: any) {
      resolve({ ok: false, reason: `could not start: ${String(e?.message || e).slice(0, 120)}` });
      return;
    }

    let settled = false;
    let stderr = '';
    let buffer = '';
    let nextId = 1;
    let pages = 0;
    const tools: any[] = [];
    const pending = new Map<number, { method: string; then: (result: any) => void }>();

    const finish = (answer: Answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop(child);
      resolve(answer);
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: `no answer within ${Math.round(timeoutMs / 1000)}s` }),
      timeoutMs
    );
    const send = (message: object) => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        /* the close handler reports it */
      }
    };
    const request = (method: string, params: object, then: (result: any) => void) => {
      const id = nextId++;
      pending.set(id, { method, then });
      send({ jsonrpc: '2.0', id, method, params });
    };
    const page = (cursor?: string) => {
      pages++;
      request('tools/list', cursor ? { cursor } : {}, result => {
        if (Array.isArray(result?.tools)) tools.push(...result.tools);
        const more = typeof result?.nextCursor === 'string' && result.nextCursor;
        if (more && pages < MAX_PAGES) page(result.nextCursor);
        else finish({ ok: true, listing: measure(tools) });
      });
    };

    child.on('error', (e: any) =>
      finish({
        ok: false,
        reason:
          e?.code === 'ENOENT'
            ? `${server.command} is not on this machine's PATH${server.cwd && !existsSync(server.cwd) ? `, or ${server.cwd} is gone` : ''}`
            : `could not start: ${String(e?.message || e).slice(0, 120)}`,
      })
    );
    child.on('close', code => {
      const said = lastLine(stderr);
      finish({
        ok: false,
        reason: `stopped (exit ${code ?? 'by signal'}) before listing its tools${said ? `: ${said}` : ''}`,
      });
    });
    child.stdin?.on('error', () => {
      /* a server that exits early closes the pipe; the close handler reports it */
    });
    child.stderr?.on('data', d => {
      stderr = (stderr + d).slice(-2000);
    });
    child.stdout?.on('data', d => {
      buffer += d;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message?.method && message.id !== undefined) {
          send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Not supported' },
          });
          continue;
        }
        const waiting = pending.get(message?.id);
        if (!waiting) continue;
        pending.delete(message.id);
        if (message.error) {
          const said = String(message.error?.message ?? 'an error').slice(0, 120);
          finish({ ok: false, reason: `answered ${waiting.method} with ${said}` });
          return;
        }
        waiting.then(message.result);
      }
    });

    request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ambit-weigh', version: VERSION },
      },
      result => {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        // A server that offers no tools has nothing to list, and asking anyway
        // gets an error from a server that is otherwise working.
        if (result?.capabilities && !result.capabilities.tools) {
          finish({ ok: true, listing: measure([]) });
        } else page();
      }
    );
  });
}

/** Runs `run` over every item, `size` at a time, keeping the order. */
async function inTurn<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function parseJson<T>(text: string | null, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Calls per capability over the window, or null when the ledger recorded none at all. */
function recentCalls(db: Db): Map<string, number> | null {
  try {
    const rows = db
      .prepare(
        `SELECT capability_id AS id, COUNT(*) AS n FROM capability_use
         WHERE used_at >= datetime('now', ?) GROUP BY capability_id`
      )
      .all<{ id: string; n: number }>(`-${USE_WINDOW_DAYS} days`);
    return rows.length ? new Map(rows.map(r => [r.id, Number(r.n)])) : null;
  } catch {
    return null;
  }
}

/**
 * The recorded weight of every tool server still in a config, by node id.
 * The tree projection puts it on each node, and `carryReport` adds it up.
 */
function carryById(db: Db): Map<string, ToolCarry> {
  let rows: (ToolListingRow & { state: string })[] = [];
  try {
    rows = db
      .prepare(
        `SELECT t.*, c.state FROM tool_listings t JOIN capabilities c ON c.id = t.capability_id`
      )
      .all<ToolListingRow & { state: string }>();
  } catch {
    return new Map();
  }
  const calls = recentCalls(db);
  const out = new Map<string, ToolCarry>();
  for (const r of rows) {
    // A server taken out of every config is retired and locked, and no
    // session carries it any more, whatever it last weighed.
    if (!isReached(r.state)) continue;
    out.set(r.capability_id, {
      tokens: tokensOf(r.chars),
      tools: r.tools,
      measuredAt: r.measured_at,
      runtimes: parseJson<string[]>(r.runtimes, []).map(labelOf),
      heaviest: parseJson<[string, number][]>(r.per_tool, [])
        .slice(0, 3)
        .map(([name, chars]) => ({ name, tokens: tokensOf(chars) })),
      ...(calls ? { calls: calls.get(r.capability_id) ?? 0 } : {}),
    });
  }
  return out;
}

const ESTIMATE_NOTE =
  'An estimate at four characters a token, of each tool list as the server sends it. A runtime that defers tool definitions until they are searched for carries less.';

/**
 * What the configs carry, as last weighed: per runtime, per server, what was
 * not called in the work the ledger recorded, and what has never been weighed.
 * Reads only; `weigh` is what measures.
 */
function carryReport(db: Db) {
  const byId = carryById(db);
  const names = new Map(
    db
      .prepare("SELECT id, name, state FROM capabilities WHERE id LIKE 'mcp:%'")
      .all<{ id: string; name: string; state: string }>()
      .map(r => [r.id, r])
  );
  const servers = [...byId]
    .map(([id, carry]) => ({ id, name: names.get(id)?.name ?? id, ...carry }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const neverWeighed = [...names.values()]
    .filter(r => isReached(r.state) && !byId.has(r.id))
    .map(r => r.name)
    .sort();
  const ledgerHasCalls = servers.some(s => s.calls !== undefined);
  const notCalled = ledgerHasCalls ? servers.filter(s => s.calls === 0) : [];

  if (!servers.length) {
    return {
      empty: true,
      runtimes: [],
      servers: [],
      never_weighed: neverWeighed,
      next: 'ambit weigh',
      meaning:
        'Nothing has been weighed here. ambit weigh starts each local tool server your configs declare, asks for its tools, and records what the list costs in context.',
    };
  }
  return {
    runtimes: carryByRuntime(servers),
    servers,
    ...(ledgerHasCalls
      ? { not_called: { days: USE_WINDOW_DAYS, servers: notCalled.map(s => s.name) } }
      : {}),
    never_weighed: neverWeighed,
    oldest_measurement: servers.map(s => s.measuredAt).sort()[0],
    note: ESTIMATE_NOTE,
  };
}

/**
 * Weighs each local tool server the configs declare, or the one named, and
 * records every listing it gets. A server that cannot be weighed keeps what it
 * last weighed, and the report says why it was not weighed this time.
 */
async function weigh(
  db: Db,
  options: { only?: string; timeoutSeconds?: number; home?: string } = {}
) {
  const all = toolServers(options.home);
  const wanted = options.only
    ? all.filter(s => s.name === options.only || s.id === options.only)
    : all;
  if (options.only && !wanted.length) {
    const close = nearest(
      options.only,
      all.map(s => s.name)
    );
    return {
      error: `No tool server named ${options.only} in your agent configs.${close.length ? ` Did you mean ${close.join(', ')}?` : ''}`,
    };
  }

  const notWeighed: { id: string; name: string; reason: string }[] = [];
  const runnable: ToolServer[] = [];
  for (const s of wanted) {
    if (!s.enabled) {
      notWeighed.push({ id: s.id, name: s.name, reason: 'switched off in every config' });
    } else if (s.remote) {
      notWeighed.push({
        id: s.id,
        name: s.name,
        reason: 'remote, so not contacted: its runtime signs in to it',
      });
    } else if (!s.command) {
      notWeighed.push({ id: s.id, name: s.name, reason: 'its config names no command' });
    } else runnable.push(s);
  }

  const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const answers = await inTurn(runnable, AT_ONCE, s => listTools(s, timeoutMs));
  const onGraph = db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?');
  const write = db.prepare(
    `INSERT INTO tool_listings (capability_id, tools, chars, per_tool, runtimes, measured_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(capability_id) DO UPDATE SET
       tools = excluded.tools, chars = excluded.chars, per_tool = excluded.per_tool,
       runtimes = excluded.runtimes, measured_at = excluded.measured_at`
  );
  const weighed: string[] = [];
  runnable.forEach((s, i) => {
    const answer = answers[i];
    if (!answer.ok) {
      notWeighed.push({ id: s.id, name: s.name, reason: answer.reason });
    } else if (!onGraph.get(s.id)) {
      notWeighed.push({
        id: s.id,
        name: s.name,
        reason: 'not on the graph yet: ambit seed adds it',
      });
    } else {
      write.run(
        s.id,
        answer.listing.tools.length,
        answer.listing.chars,
        JSON.stringify(answer.listing.tools.map(t => [t.name, t.chars])),
        JSON.stringify(s.runtimes)
      );
      weighed.push(s.name);
    }
  });

  return {
    weighed_now: weighed,
    not_weighed: notWeighed.sort((a, b) => a.name.localeCompare(b.name)),
    ...carryReport(db),
  };
}

export {
  carryById,
  carryReport,
  launchOf,
  listTools,
  toolServers,
  weigh,
  DEFAULT_TIMEOUT_SECONDS,
  USE_WINDOW_DAYS,
  type ToolServer,
};
