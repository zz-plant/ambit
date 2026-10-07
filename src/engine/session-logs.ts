/**
 * The tokens other agents' sessions used, read from the logs those agents
 * already keep, into the work ledger.
 *
 * Claude Code's tokens reach the ledger through the plugin's hooks (spool.ts).
 * Codex, OpenCode and Amp have no hook Ambit ships, and each keeps a local
 * record of every session with its token counts, which is how ccusage
 * (https://github.com/ryoppippi/ccusage) reports their usage. This reads the
 * same records:
 *
 *   Codex     `sessions/` and `archived_sessions/` under each directory in
 *             CODEX_HOME (comma-separated), or ~/.codex: one JSONL rollout per
 *             session, `.jsonl`, or `.jsonl.zst` once Codex compresses a cold one.
 *   OpenCode  `opencode.db` and `opencode-<channel>.db` in each directory in
 *             OPENCODE_DATA_DIR, or ${XDG_DATA_HOME:-~/.local/share}/opencode:
 *             a SQLite database, opened read-only.
 *   Amp       `threads/` under each directory in AMP_DATA_DIR, or
 *             ~/.local/share/amp: one JSON file per thread.
 *
 * From each session it keeps the runtime, the session's id, each model's name,
 * the times of the first and last records it counted, and the token counts by
 * part: fresh input (cache writes included, as the Claude Code read counts
 * them), cache reads, output, and reasoning where a runtime counts it apart.
 * Nothing else leaves this file: never a prompt, a reply, a file path, a
 * working directory, a title, a command, or a tool's arguments or output. A
 * JSONL line or a thread file is parsed whole to reach its counts, so content
 * passes through memory and is dropped; OpenCode's database is asked for the
 * numbers in SQL (`json_extract`), so its content is never handed over.
 *
 * Each session is one work run, `run-codex-…`, `run-oc-…` or `run-amp-…`, and
 * its tokens are recorded, priced and spent by the rule the Claude Code read
 * uses (`recordTokens` in economics.ts): the session's totals less what its run
 * already holds. Reading a log twice, or a grown log again, records only what
 * is new, and a log that moves (Codex archives and compresses rollouts) adds
 * nothing.
 *
 * A cursor per file (`session_log_cursors`) keeps the reading cheap: a file
 * whose size and modification time have not changed is not opened, so a
 * command that finds nothing new costs a `stat` per log file and one query. A
 * grown rollout resumes at the byte it stopped at. The cursor describes this
 * machine's files and stays out of `ambit sync`. AMBIT_NO_LEDGER=1 stops the
 * reading. Nothing here writes to any of these files or opens a socket.
 */
import {
  closeSync,
  type Dirent,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import type { Db } from './db.ts';
import { recordTokens, type TokenCounts } from './economics.ts';
import type { SessionLogCursorRow } from './rows.ts';
import { beginRun } from './telemetry.ts';
import { TOKEN_SOURCES } from './vocabulary.ts';

type Runtime = 'codex' | 'opencode' | 'amp';

/** The ledger's words for each runtime: the run's source, its id prefix, its goal. */
const RUNTIMES: Record<Runtime, { source: string; run: string; goal: string }> = {
  codex: { source: 'codex-log', run: 'run-codex-', goal: 'codex session' },
  opencode: { source: 'opencode-log', run: 'run-oc-', goal: 'opencode session' },
  amp: { source: 'amp-log', run: 'run-amp-', goal: 'amp session' },
};

/** What one session used, so far as its log says: counts per model, and when. */
interface SessionUse {
  session: string;
  /** Epoch milliseconds of the session's start, or its first counted record. */
  first?: number;
  /** Epoch milliseconds of the last record counted. */
  last?: number;
  models: Record<string, TokenCounts>;
}

/** A log file found on disk, before it is read. */
interface LogFile {
  runtime: Runtime;
  path: string;
  /** Where it was found, as the summary names it. */
  root: string;
  size: number;
  mtimeMs: number;
}

/** What a read of one file hands back: the sessions it covers, and where to resume. */
interface FileRead {
  sessions: SessionUse[];
  offset: number;
  state: unknown;
}

// ─── Small readers ────────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** A record's time as epoch milliseconds: an ISO string, or a number in ms or s. */
function epoch(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v > 1e12 ? v : v * 1000;
  return undefined;
}

/** SQLite's `datetime('now')` shape, so a log's time sorts with the ledger's own. */
const sqlTime = (ms?: number) =>
  ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** Add one record's counts to a session, and widen the session's times to cover it. */
function add(use: SessionUse, model: string, at: number | undefined, counts: TokenCounts) {
  const m = (use.models[model] ??= {});
  for (const [unit, n] of Object.entries(counts) as [keyof TokenCounts, number][]) {
    if (n > 0) m[unit] = (m[unit] ?? 0) + n;
  }
  if (at !== undefined) {
    if (use.first === undefined || at < use.first) use.first = at;
    if (use.last === undefined || at > use.last) use.last = at;
  }
}

/** The directories an env var lists, comma-separated, or the one default. */
function dirsFrom(value: string | undefined, fallback: string | undefined): string[] {
  if (value?.trim()) {
    return [
      ...new Set(
        value
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      ),
    ];
  }
  return fallback ? [fallback] : [];
}

/**
 * Every file under `dir` whose name passes `keep`, never following a link: a
 * symlinked directory is neither walked nor counted, so a cycle cannot recurse
 * and a link cannot pull a file from elsewhere into the read.
 */
function walk(dir: string, keep: (name: string) => boolean, depth = 6, out: string[] = []) {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory() && depth > 0) walk(path, keep, depth - 1, out);
    else if (e.isFile() && keep(e.name)) out.push(path);
  }
  return out;
}

// ─── Codex ────────────────────────────────────────────────────────────────────
//
// The format, as ccusage reads it (rust/adapters/codex/src/parser.rs and
// src/README.md in https://github.com/ryoppippi/ccusage) and as Codex writes it
// (codex-rs/rollout/src/recorder.rs and TokenUsage in
// codex-rs/protocol/src/protocol.rs, https://github.com/openai/codex):
//
//   {"type":"session_meta","payload":{"id":…,"forked_from_id":…}}  first line
//   {"type":"turn_context","payload":{"model":"gpt-5-codex",…}}     model from here on
//   {"type":"event_msg","payload":{"type":"token_count","info":{
//     "total_token_usage":{…},"last_token_usage":{…}}}}
//
// `total_token_usage` is cumulative and `last_token_usage` is the turn's own.
// A turn counts `last` when the cumulative total moved, and the difference of
// the totals when only they are written; an event whose total did not move is
// a repeat and counts nothing. `input_tokens` includes the cached ones, so
// fresh input is the difference, and `output_tokens` includes the reasoning
// tokens, which are a breakdown of it and are not recorded again.
//
// A forked or subagent session replays its parent's history before its own
// turns, timestamped at the fork, in one burst. Its leading usage is skipped
// while each event follows the last within a second, ccusage's fallback when
// the parent's own log cannot anchor the replay (`detect_rewritten_burst`).
// Compaction requests (`token_usage_record`) are not counted: ccusage counts
// one only when a later `compacted` marker matches it and no cumulative total
// already holds it, and leaving them out can only undercount.

interface CodexUsage {
  input: number;
  cached: number;
  output: number;
  total: number;
}

interface CodexState {
  /** Whether the first `session_meta` has been read; a fork carries its parent's too. */
  meta?: boolean;
  session?: string;
  started?: number;
  model?: string;
  prev?: CodexUsage;
  /** Absent for a session that forked from nothing. */
  replay?: 'undecided' | 'skipping' | 'done';
  pending?: { at?: number; usage: CodexUsage; model?: string };
  skippedAt?: number;
  use: SessionUse;
  /** Tokens on a turn no model was named for, kept out of the ledger. */
  unattributed?: number;
}

/** How close one replayed usage event follows the last, in ccusage's measure. */
const CODEX_BURST_MS = 1000;

function codexUsage(v: any): CodexUsage | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const input = num(v.input_tokens ?? v.prompt_tokens);
  return {
    input,
    cached: Math.min(num(v.cached_input_tokens ?? v.cache_read_input_tokens), input),
    output: num(v.output_tokens ?? v.completion_tokens),
    total: num(v.total_tokens),
  };
}

const sameUsage = (a: CodexUsage, b?: CodexUsage) =>
  !!b &&
  a.input === b.input &&
  a.cached === b.cached &&
  a.output === b.output &&
  a.total === b.total;

const minus = (a: CodexUsage, b?: CodexUsage): CodexUsage => {
  const input = Math.max(a.input - (b?.input ?? 0), 0);
  return {
    input,
    cached: Math.min(Math.max(a.cached - (b?.cached ?? 0), 0), input),
    output: Math.max(a.output - (b?.output ?? 0), 0),
    total: Math.max(a.total - (b?.total ?? 0), 0),
  };
};

const codexModel = (v: any): string | undefined =>
  v && typeof v === 'object'
    ? (text(v.model) ?? text(v.model_name) ?? text(v.metadata?.model))
    : undefined;

function countCodex(state: CodexState, e: { at?: number; usage: CodexUsage; model?: string }) {
  const { usage } = e;
  if (!e.model) {
    state.unattributed = (state.unattributed ?? 0) + usage.input + usage.output;
    return;
  }
  add(state.use, e.model, e.at, {
    input: usage.input - usage.cached,
    cached: usage.cached,
    output: usage.output,
  });
}

/** A fork's leading burst is its parent's history, replayed; anything after it is its own. */
function admitCodex(state: CodexState, e: { at?: number; usage: CodexUsage; model?: string }) {
  const within = (from?: number) =>
    e.at !== undefined && from !== undefined && e.at - from >= 0 && e.at - from <= CODEX_BURST_MS;
  if (state.replay === 'undecided') {
    if (!state.pending) {
      state.pending = e;
      return;
    }
    const first = state.pending;
    state.pending = undefined;
    if (within(first.at)) {
      state.replay = 'skipping';
      state.skippedAt = e.at;
      return;
    }
    state.replay = 'done';
    countCodex(state, first);
  } else if (state.replay === 'skipping') {
    if (within(state.skippedAt)) {
      state.skippedAt = e.at;
      return;
    }
    state.replay = 'done';
  }
  countCodex(state, e);
}

function codexLine(state: CodexState, raw: string) {
  // A cheap test before a parse: most lines are messages and tool output, and
  // only these three kinds carry anything this reads.
  if (
    !raw.includes('token_count') &&
    !raw.includes('turn_context') &&
    !raw.includes('session_meta')
  )
    return;
  let line: any;
  try {
    line = JSON.parse(raw);
  } catch {
    return;
  }
  const payload = line?.payload;
  if (!payload || typeof payload !== 'object') return;
  if (line.type === 'session_meta') {
    if (state.meta) return;
    state.meta = true;
    state.session = text(payload.id);
    state.started = epoch(line.timestamp);
    const parent =
      text(payload.forked_from_id) ??
      text(payload.source?.subagent?.thread_spawn?.parent_thread_id);
    if (parent) state.replay = 'undecided';
    return;
  }
  if (line.type === 'turn_context') {
    const model = codexModel(payload);
    if (model) state.model = model;
    return;
  }
  if (line.type !== 'event_msg' || payload.type !== 'token_count') return;
  const info = payload.info;
  if (!info || typeof info !== 'object') return;
  const total = codexUsage(info.total_token_usage);
  const last = codexUsage(info.last_token_usage);
  const advanced = !total || !sameUsage(total, state.prev);
  const usage = (advanced ? last : undefined) ?? (total ? minus(total, state.prev) : undefined);
  if (total) state.prev = total;
  if (!usage || usage.input + usage.output === 0) return;
  const named = codexModel(payload) ?? codexModel(info);
  if (named) state.model = named;
  admitCodex(state, { at: epoch(line.timestamp), usage, model: state.model });
}

/** The session a rollout is about: its `session_meta` id, else the id its name ends in. */
function codexSessionId(path: string, state: CodexState): string {
  if (state.session) return state.session;
  const name = basename(path).replace(/\.jsonl(\.zst)?$/, '');
  const uuid = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid ? uuid[0] : name;
}

function readCodex(file: LogFile, cursor?: SessionLogCursorRow, now = Date.now()): FileRead {
  const compressed = file.path.endsWith('.zst');
  let state: CodexState = { use: { session: '', models: {} } };
  let offset = 0;
  // An appended rollout resumes where the last read stopped; a compressed one,
  // or one that shrank, is read again from the top.
  if (!compressed && cursor?.state && cursor.byte_offset <= file.size && cursor.size <= file.size) {
    try {
      state = JSON.parse(cursor.state);
      offset = cursor.byte_offset;
    } catch {
      state = { use: { session: '', models: {} } };
      offset = 0;
    }
  }
  let bytes: Buffer;
  if (compressed) {
    bytes = zstdDecompressSync(readFileSync(file.path));
  } else {
    const length = Math.max(file.size - offset, 0);
    bytes = Buffer.alloc(length);
    const fd = openSync(file.path, 'r');
    try {
      let read = 0;
      while (read < length) {
        const n = readSync(fd, bytes, read, length - read, offset + read);
        if (n <= 0) break;
        read += n;
      }
      bytes = bytes.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  }
  // Only whole lines: a line still being written is read next time.
  const complete = compressed ? bytes.length : bytes.lastIndexOf(10) + 1;
  for (const raw of bytes.subarray(0, complete).toString('utf8').split('\n')) {
    if (raw) codexLine(state, raw);
  }
  // A fork with one usage event and nothing after it for longer than a burst
  // takes is not a replay: one event is the session's own.
  if (state.replay === 'undecided' && state.pending && file.mtimeMs < now - 2 * CODEX_BURST_MS) {
    const first = state.pending;
    state.pending = undefined;
    state.replay = 'done';
    countCodex(state, first);
  }
  state.use.session = codexSessionId(file.path, state);
  if (
    state.started !== undefined &&
    (state.use.first === undefined || state.started < state.use.first)
  )
    state.use.first = state.started;
  return {
    sessions: [state.use],
    offset: compressed ? 0 : offset + complete,
    state: compressed ? null : state,
  };
}

/**
 * Every rollout under each Codex home. A path in both `sessions/` and
 * `archived_sessions/` is read once, from `sessions/`, as ccusage does
 * (rust/adapters/codex/src/paths.rs), and a rollout in both its plain and
 * compressed spelling is read from the plain one.
 */
function codexFiles(env: NodeJS.ProcessEnv): LogFile[] {
  const homes = dirsFrom(env.CODEX_HOME, env.HOME ? join(env.HOME, '.codex') : undefined);
  const chosen = new Map<string, { path: string; rank: number; root: string }>();
  for (const home of homes) {
    for (const [sub, archived] of [
      ['sessions', 0],
      ['archived_sessions', 2],
    ] as const) {
      const root = join(home, sub);
      for (const path of walk(root, n => n.endsWith('.jsonl') || n.endsWith('.jsonl.zst'))) {
        const rel = path.slice(root.length).replace(/\.zst$/, '');
        const rank = archived + (path.endsWith('.zst') ? 1 : 0);
        const key = `${home}\0${rel}`;
        const held = chosen.get(key);
        if (!held || rank < held.rank) chosen.set(key, { path, rank, root });
      }
    }
  }
  return [...chosen.values()].flatMap(f => statted('codex', f.path, f.root));
}

// ─── OpenCode ─────────────────────────────────────────────────────────────────
//
// The database OpenCode keeps (packages/core/src/database/database.ts and the
// tables in packages/core/src/session/sql.ts, https://github.com/anomalyco/opencode):
// `session` (id, time_created, and running token counters), `message` (id,
// session_id, time_created, `data` JSON with modelID and providerID) and `part`
// (session_id, message_id, `data` JSON). A `step-finish` part carries one
// model call's `tokens` {input, output, reasoning, cache: {read, write}}, and the
// session's counters are their sum (applyUsage in packages/core/src/session/
// projector.ts). The message's own `tokens` hold only its last step's
// (processor.ts sets them, it does not add), so a sum over messages, which is
// what ccusage reads, undercounts a message of several steps; the parts are
// read here. Input excludes cache reads and writes, and output excludes
// reasoning, which OpenCode charges at the output rate (getUsage in
// packages/opencode/src/session/session.ts).
//
// A fork copies its parent's messages and parts under new ids, keeping each
// message's creation time (Session.fork), so a message created before its
// session was is copied history and is not counted again.

interface OpenCodeState {
  /** Each session's counters as last read, so an unchanged session is not queried. */
  marks: Record<string, string>;
}

function columns(handle: DatabaseSync, table: string): Set<string> {
  try {
    return new Set(
      (handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name)
    );
  } catch {
    return new Set();
  }
}

function readOpenCode(file: LogFile, cursor?: SessionLogCursorRow): FileRead {
  const prior: OpenCodeState = { marks: {} };
  try {
    if (cursor?.state) Object.assign(prior, JSON.parse(cursor.state));
  } catch {
    /* read every session again; what is held is not recorded twice */
  }
  const handle = new DatabaseSync(file.path, { readOnly: true });
  try {
    handle.exec('PRAGMA busy_timeout = 1000');
    const session = columns(handle, 'session');
    const message = columns(handle, 'message');
    const part = columns(handle, 'part');
    const needed =
      session.has('id') &&
      message.has('id') &&
      message.has('data') &&
      part.has('data') &&
      part.has('session_id') &&
      part.has('message_id');
    if (!needed) return { sessions: [], offset: 0, state: prior };
    const counters = [
      'tokens_input',
      'tokens_output',
      'tokens_reasoning',
      'tokens_cache_read',
      'tokens_cache_write',
    ].every(c => session.has(c));
    const created = session.has('time_created') ? 's.time_created' : 'NULL';
    const marks = handle
      .prepare(
        counters
          ? `SELECT s.id AS id, ${created} AS created, tokens_input || ':' || tokens_output || ':' ||
               tokens_reasoning || ':' || tokens_cache_read || ':' || tokens_cache_write AS mark
             FROM session s`
          : `SELECT s.id AS id, ${created} AS created,
               COUNT(p.id) || ':' || IFNULL(MAX(p.rowid), 0) AS mark
             FROM session s LEFT JOIN part p ON p.session_id = s.id GROUP BY s.id`
      )
      .all() as { id: string; created: number | null; mark: string }[];
    // Copied history is a message older than its session; with no times to
    // compare, every message counts.
    const copied =
      message.has('time_created') && session.has('time_created') ? 'AND m.time_created >= ?' : '';
    const perModel = handle.prepare(
      `SELECT json_extract(m.data, '$.providerID') AS provider,
              json_extract(m.data, '$.modelID') AS model,
              SUM(json_extract(p.data, '$.tokens.input')) AS input,
              SUM(json_extract(p.data, '$.tokens.output')) AS output,
              SUM(json_extract(p.data, '$.tokens.reasoning')) AS reasoning,
              SUM(json_extract(p.data, '$.tokens.cache.read')) AS cache_read,
              SUM(json_extract(p.data, '$.tokens.cache.write')) AS cache_write,
              MIN(${part.has('time_created') ? 'p.time_created' : 'NULL'}) AS first,
              MAX(${part.has('time_created') ? 'p.time_created' : 'NULL'}) AS last
       FROM part p JOIN message m ON m.id = p.message_id
       WHERE p.session_id = ? ${copied} AND json_extract(p.data, '$.type') = 'step-finish'
       GROUP BY provider, model`
    );
    const next: OpenCodeState = { marks: {} };
    const sessions: SessionUse[] = [];
    for (const s of marks) {
      const mark = String(s.mark);
      next.marks[s.id] = mark;
      if (prior.marks[s.id] === mark) continue;
      const use: SessionUse = { session: s.id, models: {} };
      const args = copied ? [s.id, s.created ?? 0] : [s.id];
      for (const r of perModel.all(...args) as Record<string, unknown>[]) {
        const model = text(r.model);
        if (!model) continue;
        const provider = text(r.provider);
        const name = provider ? `${provider}/${model}` : model;
        add(use, name, epoch(r.first), {
          input: num(r.input) + num(r.cache_write),
          cached: num(r.cache_read),
          output: num(r.output),
          reasoning: num(r.reasoning),
        });
        const last = epoch(r.last);
        if (last !== undefined && (use.last === undefined || last > use.last)) use.last = last;
      }
      const start = epoch(s.created);
      if (start !== undefined && Object.keys(use.models).length) use.first = start;
      sessions.push(use);
    }
    return { sessions, offset: 0, state: next };
  } finally {
    handle.close();
  }
}

const OPENCODE_DB = /^opencode(-[A-Za-z0-9._-]+)?\.db$/;

/**
 * OpenCode's databases. Its write-ahead log changes first, so the size and
 * time a cursor compares are the database's and its `-wal`'s together.
 */
function openCodeFiles(env: NodeJS.ProcessEnv): LogFile[] {
  const xdg = env.XDG_DATA_HOME?.startsWith('/') ? env.XDG_DATA_HOME : undefined;
  const base = xdg ?? (env.HOME ? join(env.HOME, '.local', 'share') : undefined);
  const dirs = dirsFrom(env.OPENCODE_DATA_DIR, base ? join(base, 'opencode') : undefined);
  const out: LogFile[] = [];
  for (const dir of dirs) {
    let names: Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of names) {
      if (!e.isFile() || !OPENCODE_DB.test(e.name)) continue;
      const [db] = statted('opencode', join(dir, e.name), dir);
      if (!db) continue;
      const [wal] = statted('opencode', `${db.path}-wal`, dir);
      out.push(
        wal ? { ...db, size: db.size + wal.size, mtimeMs: Math.max(db.mtimeMs, wal.mtimeMs) } : db
      );
    }
  }
  return out;
}

// ─── Amp ──────────────────────────────────────────────────────────────────────
//
// A thread file, as ccusage reads it (rust/adapters/amp/src/parser.rs and
// src/README.md in https://github.com/ryoppippi/ccusage): `id`, `messages[]`,
// and on some versions `usageLedger.events[]`. When the ledger is there its
// events are the counts (`tokens.input`, `tokens.output`, with each event's
// cache counts from the assistant message its `toMessageId` names); otherwise
// each assistant message's `usage` is (`inputTokens`, `outputTokens`,
// `cacheCreationInputTokens`, `cacheReadInputTokens`, with its own `model` and
// `timestamp`). Input excludes the cache counts: `totalInputTokens`, where
// written, is their sum. A `totalTokens` with no parts is not recorded, since
// nothing says which part it was. Credits are not read.

function readAmp(file: LogFile): FileRead {
  let thread: any;
  try {
    thread = JSON.parse(readFileSync(file.path, 'utf8'));
  } catch {
    return { sessions: [], offset: 0, state: null };
  }
  const id = text(thread?.id);
  if (!id) return { sessions: [], offset: 0, state: null };
  const use: SessionUse = { session: id, models: {} };
  const messages: any[] = Array.isArray(thread.messages)
    ? thread.messages.filter((m: unknown) => m && typeof m === 'object')
    : [];
  const events = thread.usageLedger?.events;
  if (Array.isArray(events)) {
    const cache = new Map<number, { write: number; read: number }>();
    for (const m of messages) {
      if (m.role !== 'assistant' || typeof m.messageId !== 'number') continue;
      cache.set(m.messageId, {
        write: num(m.usage?.cacheCreationInputTokens),
        read: num(m.usage?.cacheReadInputTokens),
      });
    }
    for (const e of events) {
      const at = epoch(e?.timestamp);
      const model = text(e?.model);
      const tokens = e?.tokens;
      if (at === undefined || !model || !tokens || typeof tokens !== 'object') continue;
      const c = cache.get(e.toMessageId) ?? { write: 0, read: 0 };
      add(use, model, at, {
        input: num(tokens.input) + c.write,
        cached: c.read,
        output: num(tokens.output),
      });
    }
  } else {
    for (const m of messages) {
      const usage = m.usage;
      if (m.role !== 'assistant' || !usage || typeof usage !== 'object') continue;
      const at = epoch(usage.timestamp) ?? epoch(m.timestamp);
      const model = text(usage.model) ?? text(m.model);
      if (at === undefined || !model) continue;
      add(use, model, at, {
        input: num(usage.inputTokens) + num(usage.cacheCreationInputTokens),
        cached: num(usage.cacheReadInputTokens),
        output: num(usage.outputTokens),
      });
    }
  }
  return { sessions: [use], offset: 0, state: null };
}

function ampFiles(env: NodeJS.ProcessEnv): LogFile[] {
  const dirs = dirsFrom(
    env.AMP_DATA_DIR,
    env.HOME ? join(env.HOME, '.local', 'share', 'amp') : undefined
  );
  return dirs.flatMap(dir => {
    const root = join(dir, 'threads');
    return walk(root, n => n.endsWith('.json')).flatMap(path => statted('amp', path, root));
  });
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function statted(runtime: Runtime, path: string, root: string): LogFile[] {
  try {
    const s = statSync(path);
    return s.isFile() ? [{ runtime, path, root, size: s.size, mtimeMs: s.mtimeMs }] : [];
  } catch {
    return [];
  }
}

const READERS: Record<
  Runtime,
  { files: (env: NodeJS.ProcessEnv) => LogFile[]; read: typeof readCodex }
> = {
  codex: { files: codexFiles, read: readCodex },
  opencode: { files: openCodeFiles, read: readOpenCode },
  amp: { files: ampFiles, read: readAmp },
};

/** The run a session's tokens go to, begun at the session's start if it is new. */
function runFor(db: Db, runtime: Runtime, use: SessionUse): string {
  const spec = RUNTIMES[runtime];
  const id = `${spec.run}${use.session.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)}`;
  if (!db.prepare('SELECT 1 AS ok FROM work_runs WHERE id = ?').get(id)) {
    beginRun(db, {
      id,
      at: sqlTime(use.first),
      goal: spec.goal,
      source: spec.source,
      runType: 'task',
    });
  }
  // The last record the log holds, which is as far as it says the session ran.
  // A log never says a session ended, so no outcome is written.
  const last = sqlTime(use.last);
  if (last) {
    db.prepare(
      'UPDATE work_runs SET ended_at = ? WHERE id = ? AND (ended_at IS NULL OR julianday(ended_at) < julianday(?))'
    ).run(last, id, last);
  }
  return id;
}

export interface SessionLogRead {
  /** Why nothing was read, when nothing was. */
  skipped?: string;
  /** Per runtime and place: the files found, those read because they changed, and what they added. */
  logs: {
    runtime: string;
    from: string;
    files: number;
    read: number;
    sessions: number;
    tokens: number;
  }[];
  /** Models whose new tokens carry no price, because none is declared. */
  undeclared: string[];
  /** Changed files left for the next read, because the time allowed ran out. */
  waiting: number;
}

/**
 * Read every agent session log that changed since the last read into the
 * ledger, newest first, until `budgetMs` has passed; what is left waits for the
 * next read. `refresh` ignores the cursors and reads every log from the top,
 * which records nothing a run already holds. `env` is where the log directories
 * are found (HOME, CODEX_HOME, OPENCODE_DATA_DIR, XDG_DATA_HOME, AMP_DATA_DIR),
 * so a test points it at a temporary home and never at a person's own logs.
 */
function readSessionLogs(
  db: Db,
  opts: { env?: NodeJS.ProcessEnv; budgetMs?: number; refresh?: boolean; now?: number } = {}
): SessionLogRead {
  const env = opts.env ?? process.env;
  const summary: SessionLogRead = { logs: [], undeclared: [], waiting: 0 };
  if (env.AMBIT_NO_LEDGER) {
    summary.skipped = 'AMBIT_NO_LEDGER is set, so no session log is read.';
    return summary;
  }
  const began = Date.now();
  const budget = opts.budgetMs ?? Number.POSITIVE_INFINITY;
  const cursors = new Map(
    db
      .prepare('SELECT * FROM session_log_cursors')
      .all<SessionLogCursorRow>()
      .map(c => [c.path, c] as const)
  );
  const found: LogFile[] = [];
  for (const runtime of Object.keys(READERS) as Runtime[]) {
    found.push(...READERS[runtime].files(env));
  }

  const home = env.HOME;
  const shown = (path: string) =>
    home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  const rows = new Map<string, SessionLogRead['logs'][number]>();
  const rowOf = (f: LogFile) => {
    const key = `${f.runtime}\0${f.root}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        runtime: TOKEN_SOURCES[RUNTIMES[f.runtime].source],
        from: shown(f.root),
        files: 0,
        read: 0,
        sessions: 0,
        tokens: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  const changed: LogFile[] = [];
  for (const f of found) {
    rowOf(f).files++;
    const c = cursors.get(f.path);
    if (opts.refresh || !c || c.size !== f.size || c.mtime_ms !== f.mtimeMs) changed.push(f);
  }
  // Newest first, so a first read of a long history records the recent part
  // before the time runs out.
  changed.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const undeclared = new Set<string>();
  const upsert = db.prepare(
    `INSERT INTO session_log_cursors (path, runtime, size, mtime_ms, byte_offset, state, read_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(path) DO UPDATE SET runtime = excluded.runtime, size = excluded.size,
       mtime_ms = excluded.mtime_ms, byte_offset = excluded.byte_offset, state = excluded.state,
       read_at = excluded.read_at`
  );
  for (const f of changed) {
    if (Date.now() - began > budget) {
      summary.waiting++;
      continue;
    }
    let result: FileRead;
    try {
      result = READERS[f.runtime].read(f, opts.refresh ? undefined : cursors.get(f.path), opts.now);
    } catch {
      // A file that cannot be read now (locked, half-written, an unknown
      // shape) is tried again when it changes, and costs nothing until then.
      result = { sessions: [], offset: 0, state: null };
    }
    const row = rowOf(f);
    db.exec('BEGIN');
    try {
      for (const use of result.sessions) {
        const counts = new Map(
          Object.entries(use.models).filter(([, c]) => Object.values(c).some(n => (n ?? 0) > 0))
        );
        if (!counts.size) continue;
        const run = runFor(db, f.runtime, use);
        const added = recordTokens(db, run, counts, sqlTime(use.last));
        if (added.tokens > 0) {
          row.sessions++;
          row.tokens += added.tokens;
        }
        for (const m of added.undeclared) undeclared.add(m);
      }
      upsert.run(
        f.path,
        f.runtime,
        f.size,
        f.mtimeMs,
        result.offset,
        result.state == null ? null : JSON.stringify(result.state)
      );
      db.exec('COMMIT');
      row.read++;
    } catch {
      db.exec('ROLLBACK');
    }
  }

  // A cursor for a file no longer where it was (archived, compressed, deleted)
  // describes nothing; the run it fed keeps what it holds.
  const present = new Set(found.map(f => f.path));
  const forget = db.prepare('DELETE FROM session_log_cursors WHERE path = ?');
  for (const path of cursors.keys()) if (!present.has(path)) forget.run(path);

  summary.logs = [...rows.values()];
  summary.undeclared = [...undeclared].sort();
  return summary;
}

/** How long a command's own read of the logs may run before what is left waits for the next. */
const SESSION_LOG_BUDGET_MS = 1500;

/**
 * What `ambit usage --refresh` answers: each place it read, what that added,
 * and which models' new tokens carry no price.
 */
function sessionLogReport(read: SessionLogRead) {
  if (read.skipped) return { note: read.skipped };
  if (!read.logs.length) {
    return {
      note: 'No Codex, OpenCode or Amp session log was found. Looked in CODEX_HOME or ~/.codex, OPENCODE_DATA_DIR or ~/.local/share/opencode, and AMP_DATA_DIR or ~/.local/share/amp.',
    };
  }
  return {
    logs: read.logs.map(l => ({
      name: l.runtime,
      from: l.from,
      files: l.files,
      read: l.read,
      sessions_with_new_tokens: l.sessions,
      new_tokens: l.tokens,
    })),
    undeclared: read.undeclared.length ? read.undeclared : undefined,
    note: `Every log was read again from the top, and only tokens a session's run did not already hold were recorded. Only token counts, model names, session ids and times are read.${
      read.undeclared.length
        ? ' The undeclared models carry no price: ambit economics price <model> --input=<dollars> --cache-read=<dollars> --output=<dollars> declares one for tokens recorded after it.'
        : ''
    }`,
  };
}

export { readSessionLogs, sessionLogReport, SESSION_LOG_BUDGET_MS };
