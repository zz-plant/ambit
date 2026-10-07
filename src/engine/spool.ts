/**
 * What a Claude Code session did, read into the work ledger.
 *
 * The ledger was fed by the OpenCode plugin, the control plane and MCP calls,
 * so for someone on Claude Code the Time & cost view stayed empty, a grant
 * could never earn its promotion, and `ambit next` never learned what blocked
 * work. The Claude Code plugin's hooks now append one line per event to a spool
 * file (`spoolPath` in src/shared/db-path.ts), with the tool's name and, on a
 * failure, the error text: never a tool's input or output, which can hold
 * anything. A hook runs on every tool call and Claude Code waits for it, so it
 * only appends; the engine reads the file here, the next time anything runs.
 *
 * A Claude Code session is one run, named after the session, so a session
 * spread over several reads is still one run. A tool call is a work event and
 * a use of every capability the tool exercises, found the way the gate finds
 * them (`recordToolUse` in telemetry.ts), so the ledger and the gate agree
 * about what a tool is. A call is timed from its PreToolUse line to the line
 * that ends it where that can be said honestly (`timeCalls` below). A failed
 * call is a work event and a failure signal, which
 * src/engine/failures.ts classifies: this only reports what Claude Code said
 * (AGENTS.md rule 8). A permission request is a person asked, recorded as
 * asked, since no hook says how they answered. When a session ends, its
 * token counts are read from its transcript, per model. A price is applied
 * only where a person declared one for the model, and then the session's cost
 * is a spend against the budget on what the model is a use of, if one is set.
 */
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { spoolPath } from '../shared/db-path.ts';
import type { Db } from './db.ts';
import { recordTokens, type TokenCounts } from './economics.ts';
import { captureFailure } from './failures.ts';
import { addEvent, beginRun, endRun, recordIntervention, recordToolUse } from './telemetry.ts';

/** One line of the spool, as the hook script writes it. */
interface SpoolLine {
  /** When the hook ran, ISO 8601. */
  t?: string;
  /** Claude Code's hook_event_name. */
  e?: string;
  /** session_id. */
  s?: string;
  /** tool_use_id, which pairs a call's PreToolUse line with the line that ends it. */
  id?: string;
  /** tool_name. */
  tool?: string;
  /** tool_error, cut to 500 characters. */
  err?: string;
  /** is_interrupt: the call was stopped, not failed. */
  int?: boolean;
  /** SessionEnd's reason. */
  why?: string;
  /** SessionEnd's transcript_path, read here for the session's token counts. */
  tp?: string;
  /**
   * Written by the engine, never by the hook: on a PreToolUse line put back for
   * a later read, that a person was asked while the call was open.
   */
  asked?: boolean;
}

/** SQLite's `datetime('now')` shape, so a spooled time sorts with the rest. */
function sqlTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * How long a call may stay open before its PreToolUse line stops being put
 * back. A call with no end reported in a day is one whose end will not come:
 * the session was killed, or the hook that would have ended it timed out.
 */
const OPEN_CALL_MS = 24 * 60 * 60 * 1000;

const epochOf = (line: SpoolLine) => (line.t ? Date.parse(line.t) : Number.NaN);

/**
 * How long each tool call ran, where that can be said honestly, and which
 * calls are still running.
 *
 * A call is timed from its PreToolUse line to its PostToolUse line, paired by
 * session and tool_use_id, and its use is dated from the first, so the run view
 * draws the bar where the call was. A failed call records no use, so its pair
 * is only closed. Claude Code runs PreToolUse before it asks a person for
 * permission, so a call someone was asked about would count their wait as the
 * tool's run time. Such a call gets no length at all: the part that was the
 * tool's own cannot be told from the part that was the person's, and half a
 * figure would be read as the whole. A PermissionRequest that names its call
 * marks that call; one that does not marks every call of its session open at
 * that moment, since a parallel call that loses a figure it could have had is
 * the cheaper mistake. The span also holds the time any PreToolUse hook took,
 * the gate's among them, since the tool runs only after they answer.
 *
 * A PreToolUse line whose call has not ended is handed back to go in the spool
 * again. The spool is read whenever an `ambit` command runs, and an agent that
 * runs one through its shell is in the middle of a call, so without this the
 * calls that run Ambit would never be timed. A call whose session ended, or
 * that has been open more than a day, is let go.
 */
function timeCalls(lines: SpoolLine[], now = Date.now()) {
  const key = (l: SpoolLine) => `${l.s}\n${l.id}`;
  const asks = lines.filter(l => l.e === 'PermissionRequest' && Number.isFinite(epochOf(l)));
  const askedDuring = (pre: SpoolLine, until: number) =>
    pre.asked === true ||
    asks.some(
      a =>
        a.s === pre.s &&
        (a.id ? a.id === pre.id : epochOf(a) >= epochOf(pre) && epochOf(a) <= until)
    );

  const open = new Map<string, SpoolLine>();
  for (const l of lines) {
    if (l.e === 'PreToolUse' && l.id && Number.isFinite(epochOf(l))) open.set(key(l), l);
  }
  const timed = new Map<SpoolLine, { from: string; seconds: number }>();
  for (const l of lines) {
    if ((l.e !== 'PostToolUse' && l.e !== 'PostToolUseFailure') || !l.id) continue;
    const pre = open.get(key(l));
    if (!pre) continue;
    open.delete(key(l));
    const from = epochOf(pre);
    const to = epochOf(l);
    // An end before the start is a clock that disagrees, not a length.
    if (l.e !== 'PostToolUse' || !(to >= from) || askedDuring(pre, to)) continue;
    timed.set(l, { from: pre.t as string, seconds: (to - from) / 1000 });
  }

  const ended = new Map<string, number>();
  for (const l of lines) {
    const at = epochOf(l);
    if (l.e === 'SessionEnd' && l.s && at > (ended.get(l.s) ?? -1)) ended.set(l.s, at);
  }
  /** Each line still waiting, and the line that goes back for it. */
  const waiting = new Map<SpoolLine, SpoolLine>();
  for (const pre of open.values()) {
    if ((ended.get(pre.s as string) ?? -1) >= epochOf(pre)) continue;
    if (now - epochOf(pre) > OPEN_CALL_MS) continue;
    waiting.set(pre, askedDuring(pre, Number.POSITIVE_INFINITY) ? { ...pre, asked: true } : pre);
  }
  return { timed, waiting };
}

/** The run a session's events belong to, begun at its first event if it is new. */
function runOf(db: Db, session: string, at?: string): string {
  const id = `run-cc-${session.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)}`;
  if (!db.prepare('SELECT 1 AS ok FROM work_runs WHERE id = ?').get(id)) {
    beginRun(db, {
      id,
      at,
      goal: 'claude code session',
      source: 'claude-code-hook',
      runType: 'task',
    });
  }
  return id;
}

/**
 * A session's tokens, per model, from its transcript. Claude Code's hooks carry
 * no usage or cost, and the transcript does: each assistant message records its
 * `usage`, once on every line its content spans, so a message is counted once
 * by its id. Only the counts and the model name are read. The transcript states
 * no price, and none is guessed here: a guessed one would be a number the
 * ledger could not stand behind (AGENTS.md rule 16).
 */
function tokensOf(transcript?: string): Map<string, TokenCounts> {
  const totals = new Map<string, Required<Pick<TokenCounts, 'input' | 'cached' | 'output'>>>();
  if (!transcript || !existsSync(transcript)) return totals;
  const seen = new Set<string>();
  for (const raw of readFileSync(transcript, 'utf8').split('\n')) {
    if (!raw.includes('"usage"')) continue;
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const message = line?.message;
    const usage = message?.usage;
    if (!usage || typeof message?.model !== 'string') continue;
    const id = message.id ?? line.requestId ?? line.uuid;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    // Cache reads apart from fresh input: in a long session they are most of
    // the tokens and a fraction of the price, and one sum would hide that.
    const t = totals.get(message.model) ?? { input: 0, cached: 0, output: 0 };
    t.input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    t.cached += usage.cache_read_input_tokens || 0;
    t.output += usage.output_tokens || 0;
    totals.set(message.model, t);
  }
  return totals;
}

/**
 * Read the spool into the ledger and remove it. Returns how many lines were
 * recorded, skipped, and put back to wait for the end of a call still running.
 * The file is renamed before it is read, so a hook that appends meanwhile
 * starts a new file and nothing is read twice or lost; a line that does not
 * parse, or names no session, is skipped and counted.
 */
function ingestSpool(
  db: Db,
  path = spoolPath()
): { recorded: number; skipped: number; waiting: number } {
  if (!existsSync(path)) return { recorded: 0, skipped: 0, waiting: 0 };
  const taken = `${path}.${process.pid}.reading`;
  try {
    renameSync(path, taken);
  } catch {
    return { recorded: 0, skipped: 0, waiting: 0 };
  }
  let recorded = 0;
  let skipped = 0;
  let waiting = 0;
  try {
    const lines: SpoolLine[] = [];
    for (const raw of readFileSync(taken, 'utf8').split('\n').filter(Boolean)) {
      let line: SpoolLine;
      try {
        line = JSON.parse(raw);
      } catch {
        skipped++;
        continue;
      }
      if (!line?.s || !line.e) {
        skipped++;
        continue;
      }
      lines.push(line);
    }
    const calls = timeCalls(lines);
    db.exec('BEGIN');
    try {
      for (const line of lines) {
        const session = line.s as string;
        const at = sqlTime(line.t);
        const run = runOf(db, session, at);
        const tool = typeof line.tool === 'string' ? line.tool : undefined;
        switch (line.e) {
          case 'PreToolUse':
            // Nothing of its own to write: it is the start its call is timed
            // from, and the line of a call still running goes back.
            if (calls.waiting.has(line)) continue;
            break;
          case 'PostToolUse': {
            if (!tool) break;
            addEvent(db, run, { kind: 'tool', action: tool, actor: 'agent', at });
            const span = calls.timed.get(line);
            recordToolUse(
              db,
              run,
              tool,
              span
                ? { source: 'claude-code', at: sqlTime(span.from), durationSeconds: span.seconds }
                : { source: 'claude-code', at }
            );
            break;
          }
          case 'PostToolUseFailure':
            if (!tool) break;
            // A call someone stopped (Esc, a new prompt) ended without failing:
            // recorded as stopped, and never as a failure signal, which would
            // rank the tool among what keeps blocking work.
            if (line.int) {
              addEvent(db, run, {
                kind: 'tool',
                action: tool,
                actor: 'agent',
                detail: 'interrupted',
                at,
              });
              break;
            }
            addEvent(db, run, { kind: 'tool', action: tool, actor: 'agent', detail: 'failed', at });
            captureFailure(db, {
              source: 'claude-code',
              sessionId: session,
              tool,
              message: line.err,
              at,
            });
            break;
          case 'PermissionRequest':
            recordIntervention(db, run, process.env.AMBIT_ACTOR || 'human:operator', {
              kind: 'authority',
              action: tool,
              startedAt: at,
              outcome: 'asked',
            });
            break;
          case 'SessionEnd':
            endRun(db, run, line.why || 'ended', undefined, at);
            // Priced and spent by the rule every token reader shares
            // (`recordTokens` in economics.ts), dated at the session's end.
            recordTokens(db, run, tokensOf(typeof line.tp === 'string' ? line.tp : undefined), at);
            break;
          default:
            skipped++;
            continue;
        }
        recorded++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // Nothing was written, and the lines are kept beside the spool so a
      // failed read loses nothing; a new spool collects what comes next.
      renameSync(taken, `${path}.${process.pid}.failed`);
      throw err;
    }
    // The calls still running go back in one append, as the hook writes, and
    // after whatever the hooks wrote meanwhile: pairing is by id, not by order.
    // A failed append costs those calls their lengths and nothing else.
    if (calls.waiting.size) {
      try {
        appendFileSync(
          path,
          [...calls.waiting.values()].map(l => `${JSON.stringify(l)}\n`).join('')
        );
        waiting = calls.waiting.size;
      } catch {
        /* untimed, not lost */
      }
    }
    rmSync(taken, { force: true });
  } catch {
    return { recorded: 0, skipped, waiting: 0 };
  }
  return { recorded, skipped, waiting };
}

export { ingestSpool, type SpoolLine };
