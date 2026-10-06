/**
 * A Claude Code session's tool calls, from the plugin's hook to the ledger.
 *
 * Each event goes through the hook script the plugin ships, as Claude Code
 * would run it, and the spool it writes is read by `ingestSpool`. What is held
 * is what the ledger's readers depend on: one run per session, a work event
 * and a use per tool call, a failure the engine classifies, a person asked,
 * the session's end, each at the time the hook ran, and nothing read twice.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ingestSpool } from './spool.ts';
import { dir, getDb, join, seed } from './testing/cli.ts';

const HOOK = join(
  import.meta.dirname,
  '..',
  '..',
  'plugins',
  'claude-code',
  'ambit',
  'scripts',
  'spool.mjs'
);

const WITH_GITHUB = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { github: { type: 'local', command: ['github-mcp-server'] } },
};

/** Run the plugin's hook on one event, the way Claude Code pipes it. */
function hook(spool: string, event: Record<string, unknown>) {
  execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    env: { ...process.env, AMBIT_SPOOL: spool },
  });
}

test('a session becomes one run, with its tool calls, a failure, an ask and its end', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  const session = { session_id: 'abc-123', transcript_path: '/tmp/t.jsonl', cwd: '/tmp' };
  hook(spool, {
    ...session,
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__github__create_issue',
    tool_input: { title: 'secret-in-input' },
    tool_output: 'secret-in-output',
  });
  hook(spool, {
    ...session,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'mcp__github__create_issue',
    tool_error: '401 Unauthorized: bad credentials',
  });
  hook(spool, { ...session, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  hook(spool, { ...session, hook_event_name: 'Stop' });
  hook(spool, { ...session, hook_event_name: 'SessionEnd', reason: 'logout' });

  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(ingestSpool(db, spool)).toEqual({ recorded: 4, skipped: 0 });
    expect(existsSync(spool)).toBe(false);

    const run = db.prepare("SELECT * FROM work_runs WHERE id = 'run-cc-abc-123'").get() as any;
    expect(run.source).toBe('claude-code-hook');
    expect(run.ended_at).toBeTruthy();
    expect(run.outcome).toBe('logout');

    const events = db
      .prepare("SELECT action, detail FROM work_events WHERE run_id = 'run-cc-abc-123'")
      .all() as any[];
    expect(events.map(e => [e.action, e.detail])).toEqual([
      ['mcp__github__create_issue', null],
      ['mcp__github__create_issue', 'failed'],
    ]);
    // A use for each capability the server supplies, found as the gate finds them.
    const uses = db
      .prepare("SELECT capability_id FROM capability_use WHERE run_id = 'run-cc-abc-123'")
      .all() as any[];
    expect(uses.length).toBeGreaterThan(0);

    const failure = db
      .prepare("SELECT source, class FROM failure_signals WHERE session_id = 'abc-123'")
      .get() as any;
    expect(failure.source).toBe('claude-code');
    expect(failure.class).toBeTruthy();

    const asked = db
      .prepare(
        "SELECT kind, action, outcome FROM human_intervention WHERE run_id = 'run-cc-abc-123'"
      )
      .get() as any;
    expect(asked).toEqual({ kind: 'authority', action: 'Bash', outcome: 'asked' });

    // Nothing a tool was given or returned reached the database.
    const everything = JSON.stringify(
      ['work_events', 'failure_signals', 'human_intervention', 'work_runs'].map(t =>
        db.prepare(`SELECT * FROM ${t}`).all()
      )
    );
    expect(everything).not.toMatch(/secret-in-(input|output)/);

    // Read once: a second pass finds nothing.
    expect(ingestSpool(db, spool)).toEqual({ recorded: 0, skipped: 0 });
  } finally {
    db.close();
  }
});

test('events keep the time the hook ran, and a line that does not parse is skipped', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  writeFileSync(
    spool,
    [
      JSON.stringify({ t: '2026-09-01T10:00:00.000Z', e: 'PostToolUse', s: 'early', tool: 'Read' }),
      'not json',
      JSON.stringify({ e: 'PostToolUse', tool: 'Read' }),
    ].join('\n') + '\n'
  );
  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(ingestSpool(db, spool)).toEqual({ recorded: 1, skipped: 2 });
    const run = db
      .prepare("SELECT started_at FROM work_runs WHERE id = 'run-cc-early'")
      .get() as any;
    expect(run.started_at).toBe('2026-09-01 10:00:00');
    const event = db
      .prepare("SELECT at FROM work_events WHERE run_id = 'run-cc-early'")
      .get() as any;
    expect(event.at).toBe('2026-09-01 10:00:00');
  } finally {
    db.close();
  }
});

test('the hook writes nothing when the ledger is turned off', () => {
  const spool = join(dir, 'off.jsonl');
  execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Read' }),
    env: { ...process.env, AMBIT_SPOOL: spool, AMBIT_NO_LEDGER: '1' },
  });
  expect(existsSync(spool)).toBe(false);
});

test("a session's tokens come from its transcript, each message once, and a resume replaces them", () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  const transcript = join(dir, 'transcript.jsonl');
  const msg = (id: string, input: number, output: number) =>
    JSON.stringify({
      type: 'assistant',
      requestId: `req_${id}`,
      message: {
        id,
        model: 'claude-opus-5-5',
        usage: { input_tokens: input, cache_read_input_tokens: 100, output_tokens: output },
      },
    });
  // One message's usage on two lines, as Claude Code writes a multi-block reply.
  writeFileSync(transcript, [msg('m1', 10, 5), msg('m1', 10, 5), msg('m2', 20, 7)].join('\n'));
  const end = { session_id: 'tok', transcript_path: transcript, hook_event_name: 'SessionEnd' };
  hook(spool, end);

  const db = getDb(join(dir, 'graph.db'));
  try {
    ingestSpool(db, spool);
    const rows = () =>
      db
        .prepare(
          "SELECT unit, quantity, cost_cents FROM resource_consumption WHERE run_id = 'run-cc-tok' ORDER BY unit"
        )
        .all() as any[];
    expect(rows()).toEqual([
      { unit: 'cache read tokens', quantity: 200, cost_cents: null },
      { unit: 'input tokens', quantity: 30, cost_cents: null },
      { unit: 'output tokens', quantity: 12, cost_cents: null },
    ]);

    // Resumed and ended again with a longer transcript: the totals are replaced.
    writeFileSync(transcript, [msg('m1', 10, 5), msg('m2', 20, 7), msg('m3', 1, 1)].join('\n'));
    hook(spool, end);
    ingestSpool(db, spool);
    expect(rows()).toEqual([
      { unit: 'cache read tokens', quantity: 300, cost_cents: null },
      { unit: 'input tokens', quantity: 31, cost_cents: null },
      { unit: 'output tokens', quantity: 13, cost_cents: null },
    ]);
  } finally {
    db.close();
  }
});
