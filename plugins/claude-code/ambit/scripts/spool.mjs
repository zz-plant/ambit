#!/usr/bin/env node
/**
 * One line per Claude Code event, appended to the spool the engine reads into
 * its work ledger (src/engine/spool.ts).
 *
 * Claude Code waits for a tool hook before it goes on, so this does the least
 * it can: no engine, no database, one append. It keeps five events and from
 * each only what the ledger records: when, which event, which session, the
 * tool's name and the id Claude Code gave the call, a failure's error text cut
 * to 500 characters, and why a session ended and where its transcript is. A
 * tool's input and output are never written; they can hold anything a person
 * or an agent typed.
 *
 * The call's id is what lets the engine pair a call's PreToolUse line with its
 * PostToolUse line and say how long the call ran. The pairing, and the rule
 * that a call a person was asked about gets no length at all, are the
 * engine's; this only notes the time and the id. Claude Code runs every hook
 * for one event side by side, so the PreToolUse append runs beside the gate's
 * hook and not ahead of it.
 *
 * `spoolPath` transcribes src/shared/db-path.ts, which the engine reads, the
 * way plugins/ambit-tracker.js transcribes resolveDbPath (AGENTS.md rule 15).
 * AMBIT_NO_LEDGER=1 turns it off. Every failure is swallowed and the exit is
 * always 0: a hook that broke would otherwise put an error on every tool call.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const KEPT = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'SessionEnd',
]);

function spoolPath() {
  if (process.env.AMBIT_SPOOL) return process.env.AMBIT_SPOOL;
  const base = process.env.XDG_STATE_HOME || join(process.env.HOME || '.', '.local', 'state');
  return join(base, 'ambit', 'claude-code.jsonl');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    if (process.env.AMBIT_NO_LEDGER) return;
    const input = JSON.parse(raw);
    if (!KEPT.has(input?.hook_event_name) || typeof input.session_id !== 'string') return;
    const line = {
      t: new Date().toISOString(),
      e: input.hook_event_name,
      s: input.session_id,
      // Claude Code's own id for the call, an opaque token like toolu_01…,
      // never anything the call was given.
      id: typeof input.tool_use_id === 'string' ? input.tool_use_id.slice(0, 128) : undefined,
      tool: typeof input.tool_name === 'string' ? input.tool_name : undefined,
      err: typeof input.tool_error === 'string' ? input.tool_error.slice(0, 500) : undefined,
      why: typeof input.reason === 'string' ? input.reason : undefined,
      // At a session's end, where its transcript is, so the engine can count
      // its tokens later; the file is not read here, inside Claude Code's wait.
      tp:
        input.hook_event_name === 'SessionEnd' && typeof input.transcript_path === 'string'
          ? input.transcript_path
          : undefined,
    };
    const path = spoolPath();
    mkdirSync(dirname(path), { recursive: true });
    // One write of one short line, so lines from parallel tool calls do not interleave.
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    /* never in the way of the session */
  }
});
