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
import { canExecute } from './assurance.ts';
import { budgetReport } from './budgets.ts';
import { ingestSpool } from './spool.ts';
import { tokenUsage } from './telemetry.ts';
import { loopView } from './views.ts';
import { cli, dir, getDb, join, seed } from './testing/cli.ts';

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

test("a session's tokens come from its transcript, each message once, and a resume adds what is new", () => {
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
          `SELECT unit, SUM(quantity) AS quantity, MAX(cost_cents) AS cost_cents
           FROM resource_consumption WHERE run_id = 'run-cc-tok' GROUP BY unit ORDER BY unit`
        )
        .all() as any[];
    expect(rows()).toEqual([
      { unit: 'cache read tokens', quantity: 200, cost_cents: null },
      { unit: 'input tokens', quantity: 30, cost_cents: null },
      { unit: 'output tokens', quantity: 12, cost_cents: null },
    ]);

    // Resumed and ended again with a longer transcript: the run holds the
    // totals of the whole of it, each token counted once.
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

test('Time & cost reads the tokens, and a ledger with only tokens is not empty', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  const transcript = join(dir, 'transcript.jsonl');
  writeFileSync(
    transcript,
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 40, cache_read_input_tokens: 900, output_tokens: 60 },
      },
    })
  );
  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(tokenUsage(db)).toBeUndefined();
    expect(loopView(db).tokens).toBeUndefined();
    hook(spool, { session_id: 'loop', transcript_path: transcript, hook_event_name: 'SessionEnd' });
    ingestSpool(db, spool);
    const view = loopView(db);
    expect(view.tokens).toEqual({
      days: 30,
      sessions: 1,
      models: [{ model: 'claude-opus-5-5', input: 40, cached: 900, output: 60, unpriced: true }],
    });
    expect(view.empty).toBe(false);
  } finally {
    db.close();
  }
});

// ── The spend meter ──────────────────────────────────────────────────────────

/** A transcript of assistant messages, each with its own usage. */
function transcriptOf(
  path: string,
  ...messages: { id: string; input: number; cached: number; output: number }[]
) {
  writeFileSync(
    path,
    messages
      .map(m =>
        JSON.stringify({
          type: 'assistant',
          message: {
            id: m.id,
            model: 'claude-opus-5-5',
            usage: {
              input_tokens: m.input,
              cache_read_input_tokens: m.cached,
              output_tokens: m.output,
            },
          },
        })
      )
      .join('\n')
  );
}

// A million fresh input at $5, two million cache reads at $0.50 and a hundred
// thousand output at $25: $5 + $1 + $2.50.
const SESSION = { id: 'm1', input: 1_000_000, cached: 2_000_000, output: 100_000 };
const SESSION_CENTS = 850;
const PRICE = ['claude-opus-5-5', '--input=5', '--cache-read=0.5', '--output=25'];

/** End a session through the hook, and read the spool into the ledger. */
function endSession(transcript: string, session = 'meter') {
  const spool = join(dir, 'claude-code.jsonl');
  hook(spool, { session_id: session, transcript_path: transcript, hook_event_name: 'SessionEnd' });
  const db = getDb(join(dir, 'graph.db'));
  try {
    ingestSpool(db, spool);
  } finally {
    db.close();
  }
}

/** What the graph holds once the spool is read: the budget, the rows, the reports. */
function read<T>(fn: (db: ReturnType<typeof getDb>) => T): T {
  const db = getDb(join(dir, 'graph.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const spent = () =>
  read(
    db =>
      (
        db
          .prepare("SELECT spent_cents FROM budgets WHERE capability_id = 'combo:hosted-inference'")
          .get() as any
      )?.spent_cents
  );

const costed = () =>
  read(
    db =>
      db
        .prepare(
          "SELECT SUM(cost_cents) AS cents, COUNT(cost_cents) AS priced, COUNT(*) AS rows FROM resource_consumption WHERE kind = 'tokens'"
        )
        .get() as any
  );

test("a session's tokens on a priced model are a spend against Hosted Inference's budget, once", () => {
  seed(WITH_GITHUB).close();
  cli('people', 'add', 'kanav');
  cli('budget', 'set', 'hosted-inference', '--amount=20', '--by=kanav');
  expect(cli('economics', 'price', ...PRICE).note).toContain(
    'recorded against the budget on Hosted Inference'
  );
  const transcript = join(dir, 'transcript.jsonl');
  transcriptOf(transcript, SESSION);

  endSession(transcript);
  expect(spent()).toBeCloseTo(SESSION_CENTS, 6);
  expect(costed().cents).toBeCloseTo(SESSION_CENTS, 6);

  // The budget report, the gate and the page all read the same spend.
  read(db => {
    const [budget] = budgetReport(db).budgets as any[];
    expect(budget.spent).toBe('$8.50');
    expect(budget.remaining).toBe('$11.50');
    const decision = canExecute(db, { capability: 'combo:hosted-inference' }) as any;
    expect(decision.remaining_budget_cents).toBeCloseTo(2000 - SESSION_CENTS, 6);
    expect(loopView(db).authority.budgets[0].spent_dollars).toBe(8.5);
    expect(tokenUsage(db)?.models).toEqual([
      { model: 'claude-opus-5-5', ...withoutId(SESSION), spend_dollars: 8.5 },
    ]);
  });

  // The same end read again, from a spool that carries it twice: nothing new.
  const spool = join(dir, 'claude-code.jsonl');
  const end = { session_id: 'meter', transcript_path: transcript, hook_event_name: 'SessionEnd' };
  hook(spool, end);
  hook(spool, end);
  read(db => ingestSpool(db, spool));
  expect(spent()).toBeCloseTo(SESSION_CENTS, 6);

  // Resumed: only the tokens the session added are priced. 200K input at $5.
  transcriptOf(transcript, SESSION, { id: 'm2', input: 200_000, cached: 0, output: 0 });
  endSession(transcript);
  expect(spent()).toBeCloseTo(SESSION_CENTS + 100, 6);
  expect(costed().cents).toBeCloseTo(SESSION_CENTS + 100, 6);
});

test('with no budget the cost stays on the session, and no budget row is made', () => {
  seed(WITH_GITHUB).close();
  const declared = cli('economics', 'price', ...PRICE);
  expect(declared.note).toContain('no budget is set on Hosted Inference');
  const transcript = join(dir, 'transcript.jsonl');
  transcriptOf(transcript, SESSION);
  endSession(transcript);

  expect(read(db => db.prepare('SELECT COUNT(*) AS n FROM budgets').get() as any).n).toBe(0);
  expect(costed().cents).toBeCloseTo(SESSION_CENTS, 6);
  expect(read(db => tokenUsage(db)?.models[0].spend_dollars)).toBe(8.5);
});

test('a model with no declared price records no spend, and is reported undeclared', () => {
  seed(WITH_GITHUB).close();
  cli('people', 'add', 'kanav');
  cli('budget', 'set', 'hosted-inference', '--amount=20', '--by=kanav');
  const transcript = join(dir, 'transcript.jsonl');
  transcriptOf(transcript, SESSION);
  endSession(transcript);

  expect(spent()).toBe(0);
  expect(costed()).toMatchObject({ cents: null, priced: 0 });
  const [model] = read(db => loopView(db).tokens?.models ?? []);
  expect(model.spend_dollars).toBeUndefined();
  expect(model.unpriced).toBe(true);

  // A price declared afterwards does not reach back to what was recorded: the
  // same end read again adds nothing, and a resume prices only what is new.
  cli('economics', 'price', ...PRICE);
  endSession(transcript);
  expect(spent()).toBe(0);
  transcriptOf(transcript, SESSION, { id: 'm2', input: 0, cached: 0, output: 40_000 });
  endSession(transcript);
  expect(spent()).toBeCloseTo(100, 6);
  const [after] = read(db => tokenUsage(db)?.models ?? []);
  expect(after).toMatchObject({ spend_dollars: 1, unpriced: true });
});

function withoutId({ id: _, ...counts }: typeof SESSION) {
  return counts;
}
