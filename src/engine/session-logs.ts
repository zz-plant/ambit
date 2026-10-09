/**
 * The tokens agents' sessions used, read from the records those agents already
 * keep, into the work ledger.
 *
 * Each of these keeps a local record of every session with its token counts,
 * which is how ccusage (https://github.com/ryoppippi/ccusage) reports their
 * usage. This reads the same records:
 *
 *   Claude Code  `projects/<project>/<session-id>.jsonl` under each directory in
 *                CLAUDE_CONFIG_DIR (comma-separated), or ~/.claude and
 *                ${XDG_CONFIG_HOME:-~/.config}/claude: one JSONL transcript per
 *                session, and the transcripts its subagents write in a folder
 *                named after the session beside it.
 *   Codex        `sessions/` and `archived_sessions/` under each directory in
 *                CODEX_HOME (comma-separated), or ~/.codex: one JSONL rollout per
 *                session, `.jsonl`, or `.jsonl.zst` once Codex compresses a cold one.
 *   OpenCode     `opencode.db` and `opencode-<channel>.db` in each directory in
 *                OPENCODE_DATA_DIR, or ${XDG_DATA_HOME:-~/.local/share}/opencode:
 *                a SQLite database, opened read-only.
 *   Amp          `threads/` under each directory in AMP_DATA_DIR, or
 *                ~/.local/share/amp: one JSON file per thread.
 *
 * From each session it keeps the runtime, the session's id, each model's name,
 * the times of the first and last records it counted, the hour each record was
 * written in, and the token counts by part: fresh input (cache writes
 * included), cache reads, output, and reasoning where a runtime counts it
 * apart. Nothing else leaves this file: never a prompt, a reply, a file path, a
 * working directory, a title, a command, or a tool's arguments or output. A
 * JSONL line or a thread file is parsed whole to reach its counts, so content
 * passes through memory and is dropped; OpenCode's database is asked for the
 * numbers in SQL (`json_extract`), so its content is never handed over.
 *
 * Each session is one work run, `run-cc-…`, `run-codex-…`, `run-oc-…` or
 * `run-amp-…`, and its tokens are recorded per hour of use, priced and spent by
 * the one rule (`recordTokens` in economics.ts): per model, part and hour, the
 * session's totals less what its run already holds. Reading a log twice, or a
 * grown log again, records only what is new, and a log that moves (Codex
 * archives and compresses rollouts) adds nothing. A Claude Code session's run
 * is the one its plugin's hooks write to, and the transcript read again at the
 * session's end (`transcriptTokens`, from spool.ts) computes the same hours, so
 * the two never count one token twice. With the plugin or without it, an
 * active session's tokens arrive as its transcript grows.
 *
 * A cursor per file (`session_log_cursors`) keeps the reading cheap: a file
 * whose size and modification time have not changed is not opened, so a
 * command that finds nothing new costs a `stat` per log file and one query. A
 * grown transcript or rollout resumes at the byte it stopped at. The cursor
 * describes this machine's files and stays out of `ambit sync`.
 * AMBIT_NO_LEDGER=1 stops the reading. Nothing here writes to any of these
 * files or opens a socket.
 */
import {
  closeSync,
  type Dirent,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import type { Db } from './db.ts';
import { type HourlyTokens, hourOf, recordTokens, type TokenCounts, UNTIMED } from './economics.ts';
import type { SessionLogCursorRow } from './rows.ts';
import { beginRun } from './telemetry.ts';
import { TOKEN_SOURCES } from './vocabulary.ts';

type Runtime = 'claude' | 'codex' | 'opencode' | 'amp';

/**
 * The ledger's words for each runtime: the run's source, its id prefix, its
 * goal. A Claude Code session's run is named as the plugin's hooks name it
 * (`runOf` in spool.ts), so the hooks and the transcript feed one run.
 */
const RUNTIMES: Record<Runtime, { source: string; run: string; goal: string }> = {
  claude: { source: 'claude-code-log', run: 'run-cc-', goal: 'claude code session' },
  codex: { source: 'codex-log', run: 'run-codex-', goal: 'codex session' },
  opencode: { source: 'opencode-log', run: 'run-oc-', goal: 'opencode session' },
  amp: { source: 'amp-log', run: 'run-amp-', goal: 'amp session' },
};

/** What one session used, so far as its log says: counts per model and hour, and when. */
interface SessionUse {
  session: string;
  /** Epoch milliseconds of the session's start, or its first counted record. */
  first?: number;
  /** Epoch milliseconds of the last record counted. */
  last?: number;
  /** Model, then the hour its records were written in (`hourOf`), then the counts. */
  hours: Record<string, Record<string, TokenCounts>>;
}

/** A log file found on disk, before it is read. */
interface LogFile {
  runtime: Runtime;
  path: string;
  /** Where it was found, as the summary names it. */
  root: string;
  size: number;
  mtimeMs: number;
  /** A Claude Code transcript's session, which its subagents' transcripts share. */
  session?: string;
  /** A subagent's transcript, in the folder named after its session. */
  nested?: boolean;
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

/** Add counts to one model's hour of a session. */
function addTo(use: SessionUse, model: string, hour: string, counts: TokenCounts) {
  const m = ((use.hours[model] ??= {})[hour] ??= {});
  for (const [unit, n] of Object.entries(counts) as [keyof TokenCounts, number][]) {
    if (n > 0) m[unit] = (m[unit] ?? 0) + n;
  }
}

/** Widen a session's times to cover an instant. */
function widen(use: SessionUse, at: number | undefined) {
  if (at === undefined) return;
  if (use.first === undefined || at < use.first) use.first = at;
  if (use.last === undefined || at > use.last) use.last = at;
}

/**
 * Add one record's counts to a session, in the hour it was written, and widen
 * the session's times to cover it. A record with no time is held apart
 * (`UNTIMED`), and `recordTokens` counts it in the hour its run began.
 */
function add(use: SessionUse, model: string, at: number | undefined, counts: TokenCounts) {
  addTo(use, model, at === undefined ? UNTIMED : hourOf(at), counts);
  widen(use, at);
}

/** A session's hours as `recordTokens` takes them, with every empty count left out. */
function hourly(hours: SessionUse['hours']): HourlyTokens {
  const out: HourlyTokens = new Map();
  for (const [model, byHour] of Object.entries(hours)) {
    const kept = new Map(
      Object.entries(byHour).filter(([, c]) => Object.values(c).some(n => (n ?? 0) > 0))
    );
    if (kept.size) out.set(model, kept);
  }
  return out;
}

/** Several files' hours of one session, added together. */
function sumUses(session: string, uses: SessionUse[]): SessionUse {
  const out: SessionUse = { session, hours: {} };
  for (const use of uses) {
    for (const [model, byHour] of Object.entries(use.hours)) {
      for (const [hour, counts] of Object.entries(byHour)) addTo(out, model, hour, counts);
    }
    widen(out, use.first);
    widen(out, use.last);
  }
  return out;
}

/** The directories an env var lists, comma-separated, or the defaults. */
function dirsFrom(value: string | undefined, ...fallback: (string | undefined)[]): string[] {
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
  return fallback.filter((d): d is string => !!d);
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

/**
 * The whole lines appended to a file since `offset`, and the offset after the
 * last of them: a line still being written is left for the next read, and
 * handed back apart (`rest`) for a reader that knows the file is finished.
 */
function appendedLines(path: string, size: number, offset: number) {
  const length = Math.max(size - offset, 0);
  let bytes = Buffer.alloc(length);
  const fd = openSync(path, 'r');
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
  const complete = bytes.lastIndexOf(10) + 1;
  return {
    lines: bytes.subarray(0, complete).toString('utf8').split('\n'),
    end: offset + complete,
    rest: bytes.subarray(complete).toString('utf8'),
  };
}

// ─── Claude Code ──────────────────────────────────────────────────────────────
//
// Where the transcripts are, as Claude Code's documentation states it
// (https://code.claude.com/docs/en/sessions, "Where transcripts are stored"):
// `~/.claude/projects/<project>/<session-id>.jsonl`, under CLAUDE_CONFIG_DIR
// when that moves storage off ~/.claude, kept 30 days unless
// `cleanupPeriodDays` says otherwise. ccusage also reads
// ${XDG_CONFIG_HOME:-~/.config}/claude/projects, takes several directories in
// CLAUDE_CONFIG_DIR, comma-separated, and reads only those when it is set
// (claude_paths in rust/adapters/claude/src/paths.rs); this does the same. A
// session's subagents and side questions write their own transcripts in a
// folder named after the session (`<session-id>/subagents/…`,
// rust/adapters/claude/src/README.md), and their tokens are the session's.
//
// An assistant line, of which only these fields are kept:
//
//   {"type":"assistant","timestamp":…,"requestId":…,
//    "message":{"id":…,"model":…,"usage":{"input_tokens","output_tokens",
//      "cache_creation_input_tokens","cache_read_input_tokens"},"content":[…]}}
//
// One response is written as a line per content block, each carrying the
// response's usage, and a line written while the reply streamed can carry
// fewer output tokens than the last; ccusage keeps the largest
// (should_replace_deduped_entry in rust/adapters/claude/src/lib.rs). A response
// is counted once by its message id, at its largest, in the hour its first
// line was written. A side question's transcript replays the parent's
// responses under their own ids (ccusage issue #913), and a response copied
// into more than one transcript keeps its id, so a subagent's transcript
// counts no response the session's own transcript already counted.

/** How many of the latest responses keep what was counted, for a later, larger line of one. */
const CLAUDE_OPEN = 32;

interface ClaudeState {
  /** The shape this state was written in; anything else is read again from the top. */
  v: 2;
  /** Every response counted, by message id, oldest first. */
  ids: string[];
  /** The latest responses: model, hour, and the input, cache reads and output counted. */
  open: Record<string, [string, string, number, number, number]>;
  use: SessionUse;
}

const freshClaude = (session: string): ClaudeState => ({
  v: 2,
  ids: [],
  open: {},
  use: { session, hours: {} },
});

/**
 * One transcript line into a session's counts. `parent` is the ids the
 * session's own transcript counted, when this is a subagent's; `seen` is the
 * state's ids as a set.
 */
function claudeLine(state: ClaudeState, seen: Set<string>, raw: string, parent?: Set<string>) {
  // A cheap test before a parse: most lines are prompts, tool calls and their
  // output, and only a response carries a usage.
  if (!raw.includes('"usage"')) return;
  let line: any;
  try {
    line = JSON.parse(raw);
  } catch {
    return;
  }
  const message = line?.message;
  const usage = message?.usage;
  const model = text(message?.model);
  if (!usage || typeof usage !== 'object' || !model) return;
  const at = epoch(line.timestamp);
  const input = num(usage.input_tokens) + num(usage.cache_creation_input_tokens);
  const cached = num(usage.cache_read_input_tokens);
  const output = num(usage.output_tokens);
  const id = text(message.id) ?? text(line.requestId) ?? text(line.uuid);
  if (!id) {
    add(state.use, model, at, { input, cached, output });
    return;
  }
  const prior = state.open[id];
  if (prior) {
    // The same response on another line: only what it holds beyond what was
    // counted, in the hour the response was first counted in.
    const [m, hour, i, c, o] = prior;
    if (input + cached + output <= i + c + o) return;
    addTo(state.use, m, hour, {
      input: Math.max(input - i, 0),
      cached: Math.max(cached - c, 0),
      output: Math.max(output - o, 0),
    });
    state.open[id] = [m, hour, Math.max(input, i), Math.max(cached, c), Math.max(output, o)];
    widen(state.use, at);
    return;
  }
  if (seen.has(id) || parent?.has(id)) return;
  seen.add(id);
  state.ids.push(id);
  const hour = at === undefined ? UNTIMED : hourOf(at);
  state.open[id] = [model, hour, input, cached, output];
  const open = Object.keys(state.open);
  if (open.length > CLAUDE_OPEN) delete state.open[open[0]];
  add(state.use, model, at, { input, cached, output });
}

/**
 * Read a transcript into a state: from where its cursor stopped when the file
 * has only grown, or from the top. Only whole lines are read, unless `ended`
 * says the session is over and a last line with no newline after it is whole.
 */
function readClaude(
  file: Pick<LogFile, 'path' | 'size'> & { session: string },
  cursor?: Pick<SessionLogCursorRow, 'state' | 'byte_offset' | 'size'>,
  parent?: Set<string>,
  ended = false
): { state: ClaudeState; offset: number } {
  let state = freshClaude(file.session);
  let offset = 0;
  if (cursor?.state && cursor.byte_offset <= file.size && cursor.size <= file.size) {
    try {
      const held = JSON.parse(cursor.state);
      if (held?.v === 2 && held.use?.hours) {
        state = held;
        offset = cursor.byte_offset;
      }
    } catch {
      /* read from the top; what the run holds is not recorded twice */
    }
  }
  const seen = new Set(state.ids);
  const { lines, end, rest } = appendedLines(file.path, file.size, offset);
  if (ended) lines.push(rest);
  for (const raw of lines) if (raw) claudeLine(state, seen, raw, parent);
  return { state, offset: end };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The config directories Claude Code keeps `projects/` in. A directory named
 * twice, or reached by two names, is read once.
 */
function claudeRoots(env: NodeJS.ProcessEnv): string[] {
  const xdg = env.XDG_CONFIG_HOME?.startsWith('/')
    ? env.XDG_CONFIG_HOME
    : env.HOME
      ? join(env.HOME, '.config')
      : undefined;
  const named = dirsFrom(
    env.CLAUDE_CONFIG_DIR,
    xdg ? join(xdg, 'claude') : undefined,
    env.HOME ? join(env.HOME, '.claude') : undefined
  ).map(d => (basename(d) === 'projects' ? dirname(d) : d));
  const roots = new Map<string, string>();
  for (const dir of named) {
    try {
      const real = realpathSync(join(dir, 'projects'));
      if (!roots.has(real)) roots.set(real, dir);
    } catch {
      /* no projects folder here */
    }
  }
  return [...roots.values()];
}

/**
 * Every session transcript, and every transcript in a session's own folder.
 * A session found in two places is read from the one written to last, since a
 * copy is the same responses and adding both would count them twice.
 */
function claudeFiles(env: NodeJS.ProcessEnv): LogFile[] {
  const sessions = new Map<string, LogFile[]>();
  for (const root of claudeRoots(env)) {
    const projects = join(root, 'projects');
    let dirs: Dirent[];
    try {
      dirs = readdirSync(projects, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const project of dirs) {
      if (!project.isDirectory()) continue;
      const folder = join(projects, project.name);
      let entries: Dirent[];
      try {
        entries = readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const session = e.name.slice(0, -'.jsonl'.length);
        if (!UUID.test(session)) continue;
        const [main] = statted('claude', join(folder, e.name), projects);
        if (!main) continue;
        const nested = walk(join(folder, session), n => n.endsWith('.jsonl'), 4)
          .sort()
          .flatMap(p => statted('claude', p, projects))
          .map(f => ({ ...f, session, nested: true }));
        const files = [{ ...main, session }, ...nested];
        const held = sessions.get(session);
        if (!held || held[0].mtimeMs < main.mtimeMs) sessions.set(session, files);
      }
    }
  }
  return [...sessions.values()].flat();
}

/**
 * A Claude Code session's tokens per model and hour, read whole from its
 * transcript and its subagents' beside it: what `ingestSpool` records when the
 * session ends. It reads the same lines by the same rule as the reading that
 * follows the transcript as it grows, so the two arrive at the same hours and
 * `recordTokens` records each token once whichever comes first. Only counts,
 * model names, message ids and times are kept.
 */
function transcriptTokens(path?: string): HourlyTokens {
  if (!path || !existsSync(path)) return new Map();
  const session = basename(path).replace(/\.jsonl$/, '');
  const size = (p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  };
  const main = readClaude({ path, size: size(path), session }, undefined, undefined, true).state;
  const parent = new Set(main.ids);
  const nested = walk(path.replace(/\.jsonl$/, ''), n => n.endsWith('.jsonl'), 4)
    .sort()
    .map(p => readClaude({ path: p, size: size(p), session }, undefined, parent, true).state.use);
  return hourly(sumUses(session, [main.use, ...nested]).hours);
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
  // A turn with no time of its own was the session's; its start is that time.
  add(state.use, e.model, e.at ?? state.started, {
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
  let state: CodexState = { use: { session: '', hours: {} } };
  let offset = 0;
  // An appended rollout resumes where the last read stopped; a compressed one,
  // or one that shrank, is read again from the top. So is one whose cursor
  // kept a session's totals and not its hours, as cursors did before token
  // rows were kept per hour: resuming it would hand on only the new turns,
  // and the run's earlier rows would be taken to cover those.
  if (!compressed && cursor?.state && cursor.byte_offset <= file.size && cursor.size <= file.size) {
    try {
      const held = JSON.parse(cursor.state);
      if (held?.use?.hours) {
        state = held;
        offset = cursor.byte_offset;
      }
    } catch {
      state = { use: { session: '', hours: {} } };
      offset = 0;
    }
  }
  let lines: string[];
  let end = 0;
  if (compressed) {
    lines = zstdDecompressSync(readFileSync(file.path)).toString('utf8').split('\n');
  } else {
    ({ lines, end } = appendedLines(file.path, file.size, offset));
  }
  for (const raw of lines) if (raw) codexLine(state, raw);
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
    offset: compressed ? 0 : end,
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

/** The hour an epoch column falls in, in SQL: OpenCode writes milliseconds, and seconds are read too. */
const sqlHour = (column: string) =>
  `CASE WHEN ${column} IS NULL THEN NULL
        WHEN ${column} > 1e12 THEN strftime('%Y-%m-%d %H:00:00', ${column} / 1000, 'unixepoch')
        ELSE strftime('%Y-%m-%d %H:00:00', ${column}, 'unixepoch') END`;

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
    // A model call's hour is its part's, else its message's; with neither,
    // the session's start.
    const when = part.has('time_created')
      ? 'p.time_created'
      : message.has('time_created')
        ? 'm.time_created'
        : 'NULL';
    const perModel = handle.prepare(
      `SELECT json_extract(m.data, '$.providerID') AS provider,
              json_extract(m.data, '$.modelID') AS model,
              ${sqlHour(when)} AS hour,
              SUM(json_extract(p.data, '$.tokens.input')) AS input,
              SUM(json_extract(p.data, '$.tokens.output')) AS output,
              SUM(json_extract(p.data, '$.tokens.reasoning')) AS reasoning,
              SUM(json_extract(p.data, '$.tokens.cache.read')) AS cache_read,
              SUM(json_extract(p.data, '$.tokens.cache.write')) AS cache_write,
              MIN(${when}) AS first,
              MAX(${when}) AS last
       FROM part p JOIN message m ON m.id = p.message_id
       WHERE p.session_id = ? ${copied} AND json_extract(p.data, '$.type') = 'step-finish'
       GROUP BY provider, model, hour`
    );
    const next: OpenCodeState = { marks: {} };
    const sessions: SessionUse[] = [];
    for (const s of marks) {
      const mark = String(s.mark);
      next.marks[s.id] = mark;
      if (prior.marks[s.id] === mark) continue;
      const use: SessionUse = { session: s.id, hours: {} };
      const start = epoch(s.created);
      const args = copied ? [s.id, s.created ?? 0] : [s.id];
      for (const r of perModel.all(...args) as Record<string, unknown>[]) {
        const model = text(r.model);
        if (!model) continue;
        const provider = text(r.provider);
        const name = provider ? `${provider}/${model}` : model;
        const hour = text(r.hour) ?? (start === undefined ? UNTIMED : hourOf(start));
        addTo(use, name, hour, {
          input: num(r.input) + num(r.cache_write),
          cached: num(r.cache_read),
          output: num(r.output),
          reasoning: num(r.reasoning),
        });
        widen(use, epoch(r.first));
        widen(use, epoch(r.last));
      }
      if (start !== undefined && Object.keys(use.hours).length) use.first = start;
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
  const use: SessionUse = { session: id, hours: {} };
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

/**
 * What a file's cursor is filed under: its path, except a Claude Code
 * transcript's, whose folder is named after the project's working directory
 * and so is kept as a digest of the path, which the graph never needs to read
 * back: the cursor is only ever looked up by a file found on disk.
 */
function cursorKey(f: Pick<LogFile, 'runtime' | 'path'>): string {
  return f.runtime === 'claude'
    ? `claude:${createHash('sha256').update(f.path).digest('hex').slice(0, 32)}`
    : f.path;
}

/** Where each runtime's files are. A Claude Code transcript is read apart (`readClaude`). */
const FILES: Record<Runtime, (env: NodeJS.ProcessEnv) => LogFile[]> = {
  claude: claudeFiles,
  codex: codexFiles,
  opencode: openCodeFiles,
  amp: ampFiles,
};

const READERS: Record<Exclude<Runtime, 'claude'>, typeof readCodex> = {
  codex: readCodex,
  opencode: readOpenCode,
  amp: readAmp,
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
 * The changed files in the order they are read: newest first, so a first read
 * of a long history records the recent part before the time runs out, and a
 * Claude Code session's transcripts together, its own before its subagents',
 * so a subagent's replay of a response is known for one when it is read.
 */
function readingOrder(changed: LogFile[]): LogFile[] {
  const newest = [...changed].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sessions = new Map<string, LogFile[]>();
  const order: (LogFile | string)[] = [];
  for (const f of newest) {
    if (f.runtime !== 'claude' || !f.session) {
      order.push(f);
      continue;
    }
    const held = sessions.get(f.session);
    if (held) held.push(f);
    else {
      sessions.set(f.session, [f]);
      order.push(f.session);
    }
  }
  return order.flatMap(o =>
    typeof o === 'string'
      ? (sessions.get(o) ?? []).sort(
          (a, b) =>
            Number(a.nested ?? false) - Number(b.nested ?? false) || (a.path < b.path ? -1 : 1)
        )
      : [o]
  );
}

/**
 * Read every agent session log that changed since the last read into the
 * ledger, newest first, until `budgetMs` has passed; what is left waits for the
 * next read. `refresh` ignores the cursors and reads every log from the top,
 * which records nothing a run already holds. `env` is where the log directories
 * are found (HOME, CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME, CODEX_HOME,
 * OPENCODE_DATA_DIR, XDG_DATA_HOME, AMP_DATA_DIR), so a test points it at a
 * temporary home and never at a person's own logs.
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
  for (const runtime of Object.keys(FILES) as Runtime[]) found.push(...FILES[runtime](env));

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
    const c = cursors.get(cursorKey(f));
    if (opts.refresh || !c || c.size !== f.size || c.mtime_ms !== f.mtimeMs) changed.push(f);
  }

  // A Claude Code session's files, and each one's state as last read: a
  // session's tokens are its transcript's and its subagents' together.
  const bySession = new Map<string, LogFile[]>();
  for (const f of found) {
    if (f.runtime !== 'claude' || !f.session) continue;
    bySession.set(f.session, [...(bySession.get(f.session) ?? []), f]);
  }
  const claudeStates = new Map<string, ClaudeState>();
  const claudeState = (f: LogFile): ClaudeState | undefined => {
    const held = claudeStates.get(f.path);
    if (held) return held;
    try {
      const state = JSON.parse(cursors.get(cursorKey(f))?.state ?? 'null');
      return state?.v === 2 ? state : undefined;
    } catch {
      return undefined;
    }
  };

  const undeclared = new Set<string>();
  const upsert = db.prepare(
    `INSERT INTO session_log_cursors (path, runtime, size, mtime_ms, byte_offset, state, read_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(path) DO UPDATE SET runtime = excluded.runtime, size = excluded.size,
       mtime_ms = excluded.mtime_ms, byte_offset = excluded.byte_offset, state = excluded.state,
       read_at = excluded.read_at`
  );
  for (const f of readingOrder(changed)) {
    if (Date.now() - began > budget) {
      summary.waiting++;
      continue;
    }
    const cursor = opts.refresh ? undefined : cursors.get(cursorKey(f));
    let result: FileRead;
    let state: ClaudeState | undefined;
    try {
      if (f.runtime === 'claude' && f.session) {
        const siblings = bySession.get(f.session) ?? [f];
        const main = f.nested ? siblings.find(s => !s.nested) : undefined;
        const parent = main ? new Set(claudeState(main)?.ids ?? []) : undefined;
        const read = readClaude({ path: f.path, size: f.size, session: f.session }, cursor, parent);
        state = read.state;
        const uses = siblings.map(s => (s.path === f.path ? read.state : claudeState(s))?.use);
        result = {
          sessions: [
            sumUses(
              f.session,
              uses.filter((u): u is SessionUse => !!u)
            ),
          ],
          offset: read.offset,
          state: read.state,
        };
      } else {
        result = READERS[f.runtime as Exclude<Runtime, 'claude'>](f, cursor, opts.now);
      }
    } catch {
      // A file that cannot be read now (locked, half-written, an unknown
      // shape) is tried again when it changes, and costs nothing until then.
      result = { sessions: [], offset: 0, state: null };
      state = undefined;
    }
    const row = rowOf(f);
    db.exec('BEGIN');
    try {
      for (const use of result.sessions) {
        const counts = hourly(use.hours);
        if (!counts.size) continue;
        const run = runFor(db, f.runtime, use);
        const added = recordTokens(db, run, counts);
        if (added.tokens > 0) {
          row.sessions++;
          row.tokens += added.tokens;
        }
        for (const m of added.undeclared) undeclared.add(m);
      }
      upsert.run(
        cursorKey(f),
        f.runtime,
        f.size,
        f.mtimeMs,
        result.offset,
        result.state == null ? null : JSON.stringify(result.state)
      );
      db.exec('COMMIT');
      if (state) claudeStates.set(f.path, state);
      row.read++;
    } catch {
      db.exec('ROLLBACK');
    }
  }

  // A cursor for a file no longer where it was (archived, compressed, deleted)
  // describes nothing; the run it fed keeps what it holds.
  const present = new Set(found.map(cursorKey));
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
      note: 'No Claude Code, Codex, OpenCode or Amp session log was found. Looked in CLAUDE_CONFIG_DIR or ~/.claude and ~/.config/claude, CODEX_HOME or ~/.codex, OPENCODE_DATA_DIR or ~/.local/share/opencode, and AMP_DATA_DIR or ~/.local/share/amp.',
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
    note: `Every log was read again from the top, and only tokens a session's run did not already hold, per hour, were recorded. Only token counts, model names, session and message ids and times are read.${
      read.undeclared.length
        ? ' The undeclared models carry no price: ambit economics price <model> --input=<dollars> --cache-read=<dollars> --output=<dollars> declares one for tokens recorded after it.'
        : ''
    }`,
  };
}

export { readSessionLogs, sessionLogReport, transcriptTokens, SESSION_LOG_BUDGET_MS };
