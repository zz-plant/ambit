/**
 * A Claude Code session's tool calls, from the plugin's hook to the ledger.
 *
 * Each event goes through the hook script the plugin ships, as Claude Code
 * would run it, and the spool it writes is read by `ingestSpool`. What is held
 * is what the ledger's readers depend on: one run per session, a work event
 * and a use per tool call, a failure the engine classifies, a person asked,
 * the session's end, each at the time the hook ran, and nothing read twice.
 * A call is timed from its start to its end only where nobody was asked in
 * between, and a call still running waits in the spool for its end.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ingestSpool, type SpoolLine } from './spool.ts';
import { runTimeline, tokenUsage } from './telemetry.ts';
import { loopView } from './views.ts';
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

const ISSUE = 'mcp__github__create_issue';

/** Spool lines, written as the hook writes them. */
const spooled = (lines: SpoolLine[]) => lines.map(l => `${JSON.stringify(l)}\n`).join('');

/** An ISO time `ms` before now. */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Each length the uses of a session's run were recorded with. */
const lengths = (db: ReturnType<typeof getDb>, session: string) =>
  (
    db
      .prepare('SELECT duration_seconds d FROM capability_use WHERE run_id = ?')
      .all(`run-cc-${session}`) as Array<{ d: number | null }>
  ).map(u => u.d);

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
    hook_event_name: 'PreToolUse',
    tool_name: ISSUE,
    tool_use_id: 'toolu_01',
    tool_input: { title: 'secret-in-input' },
  });
  hook(spool, {
    ...session,
    hook_event_name: 'PostToolUse',
    tool_name: ISSUE,
    tool_use_id: 'toolu_01',
    tool_input: { title: 'secret-in-input' },
    tool_output: 'secret-in-output',
    tool_response: 'secret-in-response',
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

  // The spool holds the call's id and when each hook ran, and nothing the call
  // was given or gave back.
  const written = readFileSync(spool, 'utf8');
  expect(written).toContain('"id":"toolu_01"');
  expect(written).not.toMatch(/secret-in-/);

  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(ingestSpool(db, spool)).toEqual({ recorded: 5, skipped: 0, waiting: 0 });
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
    const uses = lengths(db, 'abc-123');
    expect(uses.length).toBeGreaterThan(0);
    // Timed from one hook to the other: the ask came after the call ended.
    for (const d of uses) expect(d).toBeGreaterThan(0);

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
      ['work_events', 'failure_signals', 'human_intervention', 'work_runs', 'capability_use'].map(
        t => db.prepare(`SELECT * FROM ${t}`).all()
      )
    );
    expect(everything).not.toMatch(/secret-in-(input|output)/);

    // Read once: a second pass finds nothing.
    expect(ingestSpool(db, spool)).toEqual({ recorded: 0, skipped: 0, waiting: 0 });
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
    expect(ingestSpool(db, spool)).toEqual({ recorded: 1, skipped: 2, waiting: 0 });
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

test('a call is timed from its start to its end, and its use begins at the start', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  writeFileSync(
    spool,
    spooled([
      { t: '2026-09-01T10:00:00.000Z', e: 'PreToolUse', s: 'timed', id: 'toolu_1', tool: ISSUE },
      { t: '2026-09-01T10:00:02.500Z', e: 'PostToolUse', s: 'timed', id: 'toolu_1', tool: ISSUE },
    ])
  );
  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(ingestSpool(db, spool)).toEqual({ recorded: 2, skipped: 0, waiting: 0 });
    const uses = db
      .prepare("SELECT used_at, duration_seconds FROM capability_use WHERE run_id = 'run-cc-timed'")
      .all() as any[];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u).toEqual({ used_at: '2026-09-01 10:00:00', duration_seconds: 2.5 });
    }
    // The event is the call's end, as it was before calls were timed.
    const event = db.prepare("SELECT at FROM work_events WHERE run_id = 'run-cc-timed'").get();
    expect(event).toEqual({ at: '2026-09-01 10:00:02' });
    // The run view draws each use as a bar of that length.
    const view = runTimeline(db, 'run-cc-timed').run;
    expect(view?.uses.map(u => u.seconds)).toEqual(uses.map(() => 2.5));
  } finally {
    db.close();
  }
});

test('a call someone was asked about has no length, nor does a call open beside it', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  const T0 = Date.parse('2026-09-01T10:00:00.000Z');
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const call = (s: string, id: string, from: number, to: number): SpoolLine[] => [
    { t: at(from), e: 'PreToolUse', s, id, tool: ISSUE },
    { t: at(to), e: 'PostToolUse', s, id, tool: ISSUE },
  ];
  writeFileSync(
    spool,
    spooled([
      // An ask that names no call costs every call open in its session its
      // length, and none in another session.
      ...call('asked', 'toolu_a', 0, 30),
      ...call('asked', 'toolu_b', 0, 31),
      { t: at(1), e: 'PermissionRequest', s: 'asked', tool: 'Bash' },
      ...call('other', 'toolu_c', 0, 2),
      // One that names its call costs that call alone.
      ...call('named', 'toolu_x', 0, 40),
      ...call('named', 'toolu_y', 0, 3),
      { t: at(1), e: 'PermissionRequest', s: 'named', id: 'toolu_x', tool: 'Bash' },
      // An ask after a call ended has nothing to do with it.
      ...call('later', 'toolu_z', 0, 4),
      { t: at(5), e: 'PermissionRequest', s: 'later', tool: 'Bash' },
    ])
  );
  const db = getDb(join(dir, 'graph.db'));
  const distinct = (session: string) =>
    [...new Set(lengths(db, session))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  try {
    ingestSpool(db, spool);
    expect(distinct('asked')).toEqual([null]);
    expect(distinct('other')).toEqual([2]);
    expect(distinct('named')).toEqual([3, null]);
    expect(distinct('later')).toEqual([4]);
    // The asks themselves are recorded as they always were.
    expect(db.prepare('SELECT COUNT(*) n FROM human_intervention').get()).toEqual({ n: 3 });
  } finally {
    db.close();
  }
});

test('an end with no start has no length, and a start with no end waits in the spool', () => {
  seed(WITH_GITHUB).close();
  const spool = join(dir, 'claude-code.jsonl');
  writeFileSync(
    spool,
    spooled([
      { t: ago(5000), e: 'PostToolUse', s: 'lone', id: 'toolu_l', tool: ISSUE },
      { t: ago(3000), e: 'PreToolUse', s: 'open', id: 'toolu_o', tool: ISSUE },
      // A call whose session ended will not finish, nor will one a day old.
      { t: ago(3000), e: 'PreToolUse', s: 'ended', id: 'toolu_e', tool: ISSUE },
      { t: ago(1000), e: 'SessionEnd', s: 'ended', why: 'logout' },
      { t: ago(2 * 86_400_000), e: 'PreToolUse', s: 'stale', id: 'toolu_s', tool: ISSUE },
      // A failed call closes its pair and is not a use.
      { t: ago(3000), e: 'PreToolUse', s: 'failed', id: 'toolu_f', tool: ISSUE },
      { t: ago(2000), e: 'PostToolUseFailure', s: 'failed', id: 'toolu_f', tool: ISSUE, err: 'x' },
      // Asked while it runs and before the read: the ask goes back with it.
      { t: ago(3000), e: 'PreToolUse', s: 'wait', id: 'toolu_w', tool: ISSUE },
      { t: ago(2000), e: 'PermissionRequest', s: 'wait', tool: 'Bash' },
    ])
  );
  const db = getDb(join(dir, 'graph.db'));
  try {
    expect(ingestSpool(db, spool)).toEqual({ recorded: 7, skipped: 0, waiting: 2 });
    expect(lengths(db, 'lone').length).toBeGreaterThan(0);
    expect(new Set(lengths(db, 'lone'))).toEqual(new Set([null]));
    expect(lengths(db, 'failed')).toEqual([]);

    // Only the two calls still running went back, the asked one marked so.
    const back = readFileSync(spool, 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    expect(back.map(l => [l.id, l.asked ?? false])).toEqual([
      ['toolu_o', false],
      ['toolu_w', true],
    ]);

    // Their ends arrive after the read, and pair with the starts that waited.
    appendFileSync(
      spool,
      spooled([
        { t: ago(0), e: 'PostToolUse', s: 'open', id: 'toolu_o', tool: ISSUE },
        { t: ago(0), e: 'PostToolUse', s: 'wait', id: 'toolu_w', tool: ISSUE },
      ])
    );
    expect(ingestSpool(db, spool)).toEqual({ recorded: 4, skipped: 0, waiting: 0 });
    expect(existsSync(spool)).toBe(false);
    expect(lengths(db, 'open').length).toBeGreaterThan(0);
    for (const d of lengths(db, 'open')) expect(d).toBeCloseTo(3, 0);
    expect(new Set(lengths(db, 'wait'))).toEqual(new Set([null]));
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
      models: [{ model: 'claude-opus-5-5', input: 40, cached: 900, output: 60 }],
    });
    expect(view.empty).toBe(false);
  } finally {
    db.close();
  }
});
