#!/usr/bin/env node
/**
 * One line per Cursor agent event, appended to the spool the engine reads into
 * its work ledger (src/engine/spool.ts). The Cursor counterpart of
 * plugins/claude-code/ambit/scripts/spool.mjs, and it writes to the same file,
 * each line marked `src: "cursor"`.
 *
 * `ambit connect cursor --ledger` adds it to ~/.cursor/hooks.json on four
 * events. From each it keeps only what the ledger records: when the hook ran,
 * the event, the conversation, the MCP server's and tool's names, how long
 * Cursor says the call ran, a failed call's id, error text cut to 500
 * characters, failure kind and whether it was an interrupt, and why a
 * conversation ended. What Cursor hands a hook also holds a shell command's
 * text and output, an MCP call's arguments and result, file contents and the
 * person's prompt; none of it is written.
 *
 * The fields used, from Cursor's hooks reference
 * (https://cursor.com/docs/agent/hooks, "Reference"), each described there as:
 *   - every agent hook: `hook_event_name`, which hook is running, and
 *     `conversation_id`, the conversation's id, stable across its turns.
 *   - afterShellExecution: `duration`, milliseconds spent executing the
 *     command, which "excludes approval wait time".
 *   - afterMCPExecution: `mcp_server_name`, the server's key in its mcp.json;
 *     `tool_name`, the MCP tool that ran; `duration`, as for a shell command.
 *   - postToolUseFailure, sent when a tool fails, times out or is denied:
 *     `tool_name`, `tool_use_id`, `error_message` (a description of the
 *     failure), `failure_type` (`error`, `timeout` or `permission_denied`) and
 *     `is_interrupt` (whether a user interrupt or cancellation caused it).
 *   - sessionEnd: `session_id`, which the reference gives as the same value as
 *     `conversation_id`, and `reason`, how the conversation ended.
 *
 * Staying out of the way. None of the four is a permission hook: the
 * reference lists no output for the two after-execution hooks, an optional
 * `additional_context` for postToolUseFailure, and calls sessionEnd fire and
 * forget. So it prints `{}`, which asks for nothing, and exits 0. It is never
 * registered on a permission hook (beforeShellExecution, beforeMCPExecution,
 * beforeReadFile, preToolUse and the like): there an empty or unexpected
 * answer blocks the action, and an `allow` could pass what a person's own
 * settings would have stopped to ask about. Wired to any event it does not
 * record, it prints nothing and exits 1, which the reference says Cursor
 * treats as a failed hook and lets the action proceed.
 *
 * Nothing is classified here (AGENTS.md rule 8): what a failure means, and
 * which capability a call exercises, are the engine's. `spoolPath` transcribes
 * src/shared/db-path.ts, as spool.mjs does (rule 15). AMBIT_NO_LEDGER=1 turns
 * it off. Every failure to write is swallowed: a broken ledger must never be
 * in the way of the conversation.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const KEPT = new Set([
  'afterShellExecution',
  'afterMCPExecution',
  'postToolUseFailure',
  'sessionEnd',
]);

function spoolPath() {
  if (process.env.AMBIT_SPOOL) return process.env.AMBIT_SPOOL;
  const base = process.env.XDG_STATE_HOME || join(process.env.HOME || '.', '.local', 'state');
  return join(base, 'ambit', 'claude-code.jsonl');
}

const text = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const millis = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** The line for one event: only the fields named above, and only as Cursor typed them. */
function lineOf(input) {
  const event = input.hook_event_name;
  const line = {
    t: new Date().toISOString(),
    src: 'cursor',
    e: event,
    s: text(input.conversation_id, 128) ?? text(input.session_id, 128),
  };
  if (event === 'afterShellExecution') {
    line.ms = millis(input.duration);
  } else if (event === 'afterMCPExecution') {
    line.srv = text(input.mcp_server_name, 128);
    line.tool = text(input.tool_name, 128);
    line.ms = millis(input.duration);
  } else if (event === 'postToolUseFailure') {
    // Cursor's own id for the call, an opaque token, never anything the call was given.
    line.id = text(input.tool_use_id, 128);
    line.tool = text(input.tool_name, 128);
    line.err = text(input.error_message, 500);
    line.kind = text(input.failure_type, 40);
    // Reported as Cursor said it; what an interrupt means is the engine's to decide.
    line.int = input.is_interrupt === true ? true : undefined;
  } else if (event === 'sessionEnd') {
    line.why = text(input.reason, 40);
  }
  return line;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = null;
  }
  if (!KEPT.has(input?.hook_event_name)) {
    process.exitCode = 1;
    return;
  }
  try {
    const line = lineOf(input);
    if (!process.env.AMBIT_NO_LEDGER && line.s) {
      const path = spoolPath();
      mkdirSync(dirname(path), { recursive: true });
      // One write of one short line, so lines from parallel calls do not interleave.
      appendFileSync(path, `${JSON.stringify(line)}\n`);
    }
  } catch {
    /* never in the way of the conversation */
  }
  process.stdout.write('{}\n');
});
