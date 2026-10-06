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
 * them (`capabilitiesFor` in gate.ts), so the ledger and the gate agree about
 * what a tool is. A failed call is a work event and a failure signal, which
 * src/engine/failures.ts classifies: this only reports what Claude Code said
 * (AGENTS.md rule 8). A permission request is a person asked, recorded as
 * asked, since no hook says how they answered. When a session ends, its
 * token counts are read from its transcript, per model and without a price.
 */
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { spoolPath } from '../shared/db-path.ts';
import type { Db } from './db.ts';
import { captureFailure } from './failures.ts';
import { capabilitiesFor } from './gate.ts';
import {
  addEvent,
  beginRun,
  endRun,
  recordIntervention,
  recordResource,
  recordUse,
} from './telemetry.ts';

/** One line of the spool, as the hook script writes it. */
interface SpoolLine {
  /** When the hook ran, ISO 8601. */
  t?: string;
  /** Claude Code's hook_event_name. */
  e?: string;
  /** session_id. */
  s?: string;
  /** tool_name. */
  tool?: string;
  /** tool_error, cut to 500 characters. */
  err?: string;
  /** SessionEnd's reason. */
  why?: string;
  /** SessionEnd's transcript_path, read here for the session's token counts. */
  tp?: string;
}

/** SQLite's `datetime('now')` shape, so a spooled time sorts with the rest. */
function sqlTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
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
 * by its id. Only the counts and the model name are read. No price is applied:
 * the transcript states none, and a guessed one would be a number the ledger
 * could not stand behind (AGENTS.md rule 16).
 */
function tokensOf(
  transcript: string
): Map<string, { input: number; cached: number; output: number }> {
  const totals = new Map<string, { input: number; cached: number; output: number }>();
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
 * Write a session's token totals to its run, replacing any written before: a
 * resumed session ends again with a longer transcript, and its totals are of
 * the whole of it.
 */
function recordTokens(db: Db, run: string, transcript?: string) {
  if (!transcript || !existsSync(transcript)) return;
  const totals = tokensOf(transcript);
  if (!totals.size) return;
  db.prepare("DELETE FROM resource_consumption WHERE run_id = ? AND kind = 'tokens'").run(run);
  for (const [model, t] of totals) {
    const resource = `model:${model}`;
    recordResource(db, run, resource, 'tokens', { quantity: t.input, unit: 'input tokens' });
    recordResource(db, run, resource, 'tokens', { quantity: t.cached, unit: 'cache read tokens' });
    recordResource(db, run, resource, 'tokens', { quantity: t.output, unit: 'output tokens' });
  }
}

/**
 * Read the spool into the ledger and remove it. Returns how many lines were
 * recorded and skipped. The file is renamed before it is read, so a hook that
 * appends meanwhile starts a new file and nothing is read twice or lost; a
 * line that does not parse, or names no session, is skipped and counted.
 */
function ingestSpool(db: Db, path = spoolPath()): { recorded: number; skipped: number } {
  if (!existsSync(path)) return { recorded: 0, skipped: 0 };
  const taken = `${path}.${process.pid}.reading`;
  try {
    renameSync(path, taken);
  } catch {
    return { recorded: 0, skipped: 0 };
  }
  let recorded = 0;
  let skipped = 0;
  try {
    const lines = readFileSync(taken, 'utf8').split('\n').filter(Boolean);
    db.exec('BEGIN');
    try {
      for (const raw of lines) {
        let line: SpoolLine;
        try {
          line = JSON.parse(raw);
        } catch {
          skipped++;
          continue;
        }
        if (!line.s || !line.e) {
          skipped++;
          continue;
        }
        const at = sqlTime(line.t);
        const run = runOf(db, line.s, at);
        const tool = typeof line.tool === 'string' ? line.tool : undefined;
        switch (line.e) {
          case 'PostToolUse':
            if (!tool) break;
            addEvent(db, run, { kind: 'tool', action: tool, actor: 'agent', at });
            for (const capability of capabilitiesFor(db, tool)) {
              recordUse(db, run, capability, { source: 'claude-code', at });
            }
            break;
          case 'PostToolUseFailure':
            if (!tool) break;
            addEvent(db, run, { kind: 'tool', action: tool, actor: 'agent', detail: 'failed', at });
            captureFailure(db, {
              source: 'claude-code',
              sessionId: line.s,
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
            recordTokens(db, run, typeof line.tp === 'string' ? line.tp : undefined);
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
    rmSync(taken, { force: true });
  } catch {
    return { recorded: 0, skipped };
  }
  return { recorded, skipped };
}

export { ingestSpool, type SpoolLine };
