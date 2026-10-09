/**
 * `ambit gate` as Claude Code's PreToolUse hook calls it: one call on stdin,
 * the decision or nothing on stdout, exit 0 whatever happens.
 *
 * The hook runs before every tool call, and starting the engine for it loaded
 * the whole command surface to answer one question: about 200 ms a call. This
 * is the gate and what it needs (the graph handle, its migration, the gate
 * itself), so cli.js answers in its own process, as it does the status line.
 * The answer is the one cli.ts's `gate` gives: no spool read, no seed, a graph
 * that will not open says nothing, and so does a call it cannot read
 * (AGENTS.md rule 20). The snippet a terminal asks for stays in cli.ts.
 */
import { readFileSync } from 'node:fs';
import { getDb, migrate } from './db.ts';
import { claudeHookOutput, gateToolCall } from './gate.ts';

/** The hook's stdout for the call on stdin: a decision, or the empty string. */
function gateHook(): string {
  let db: ReturnType<typeof getDb> | undefined;
  try {
    const call = JSON.parse(readFileSync(0, 'utf8') || '{}');
    db = getDb();
    migrate(db);
    return claudeHookOutput(gateToolCall(db, call));
  } catch {
    return '';
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export { gateHook };
