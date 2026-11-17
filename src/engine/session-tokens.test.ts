/**
 * Tokens kept per hour, Claude Code's read from its transcripts as they grow.
 *
 * Every transcript here is a fixture in the documented shape, under a
 * temporary HOME, carrying what a real session holds beside its counts: a
 * prompt, a reply, a command, a working directory. What is held: a token row
 * is one model, part and hour of a session, written once and grown in place;
 * a transcript read twice, grown, or read again whole at the session's end
 * counts each token once; a subagent's replay of the session's replies adds
 * nothing; rows from before hours were kept cover what they held; a price is
 * applied once, to what an hour grew by; only counts, names, ids and times
 * reach the graph; and AMBIT_NO_LEDGER reads nothing.
 */
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Db } from './db.ts';
import { readSessionLogs, transcriptTokens } from './session-logs.ts';
import { ingestSpool } from './spool.ts';
import { exportSync, importSync } from './sync.ts';
import { beginRun, tokenUsage } from './telemetry.ts';
import { cli, dir, getDb, join, migrate, seed } from './testing/cli.ts';

const WITH_GITHUB = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { github: { type: 'local', command: ['github-mcp-server'] } },
};

const SESSION = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const RUN = `run-cc-${SESSION}`;
const OPUS = 'claude-opus-5-5';
const PROJECT = '-Users-someone-SECRET-project';

const home = () => join(dir, 'home');
const env = () => ({ HOME: home() });

function graph(): Db {
  const db = getDb(join(dir, 'graph.db'));
  migrate(db);
  return db;
}

/** Every value in every table of the graph, as one string to search. */
function everything(db: Db): string {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>()
    .map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t.name}`).all()))
    .join('\n');
}

/** Where Claude Code keeps a session's transcript, under the temporary HOME. */
function transcriptPath(session = SESSION) {
  const folder = join(home(), '.claude', 'projects', PROJECT);
  mkdirSync(folder, { recursive: true });
  return join(folder, `${session}.jsonl`);
}

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

/** A prompt, as Claude Code writes one: nothing in it is a count. */
const prompt = (at: string) =>
  line({
    type: 'user',
    timestamp: at,
    sessionId: SESSION,
    cwd: '/Users/someone/SECRET-project',
    message: { role: 'user', content: 'SECRET-prompt: why does the build fail' },
  });

/** One line of a reply, with its usage, its content and the session around it. */
function reply(
  id: string,
  at: string,
  u: { input: number; cached: number; output: number; write?: number },
  extra: Record<string, unknown> = {},
  model = OPUS
) {
  return line({
    type: 'assistant',
    timestamp: at,
    sessionId: SESSION,
    requestId: `req_${id}`,
    cwd: '/Users/someone/SECRET-project',
    gitBranch: 'SECRET-branch',
    ...extra,
    message: {
      id,
      model,
      role: 'assistant',
      content: [
        { type: 'text', text: 'SECRET-reply' },
        { type: 'tool_use', name: 'Bash', input: { command: 'cat SECRET-file.txt' } },
      ],
      usage: {
        input_tokens: u.input,
        cache_creation_input_tokens: u.write ?? 0,
        cache_read_input_tokens: u.cached,
        output_tokens: u.output,
      },
    },
  });
}

/** A run's token rows: hour, model and part to quantity. */
function rowsOf(db: Db, run = RUN) {
  return db
    .prepare(
      `SELECT recorded_at AS hour, resource_id AS model, unit, quantity, cost_cents AS cost
       FROM resource_consumption WHERE run_id = ? AND kind = 'tokens'
       ORDER BY recorded_at, resource_id, unit, id`
    )
    .all<{ hour: string; model: string; unit: string; quantity: number; cost: number | null }>(run);
}

/** A run's tokens per part, every hour together. */
function totals(db: Db, run = RUN): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rowsOf(db, run)) out[r.unit] = (out[r.unit] ?? 0) + r.quantity;
  return out;
}

// ── Kept per hour ────────────────────────────────────────────────────────────

test('a transcript is kept per hour, one row per model and part, and a reread or a grown one adds only what is new', () => {
  const path = transcriptPath();
  writeFileSync(
    path,
    prompt('2026-10-05T09:05:00.000Z') +
      // One reply on two lines, the first written while it streamed.
      reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, write: 20, cached: 1000, output: 30 }) +
      reply('r1', '2026-10-05T09:10:02.000Z', { input: 100, write: 20, cached: 1000, output: 50 }) +
      reply('r2', '2026-10-05T10:05:00.000Z', { input: 10, cached: 2000, output: 40 })
  );
  const db = graph();
  try {
    const first = readSessionLogs(db, { env: env() });
    expect(first.logs).toEqual([
      expect.objectContaining({ runtime: 'Claude Code', files: 1, read: 1, tokens: 3220 }),
    ]);
    expect(rowsOf(db).map(r => [r.hour, r.unit, r.quantity])).toEqual([
      ['2026-10-05 09:00:00', 'cache read tokens', 1000],
      ['2026-10-05 09:00:00', 'input tokens', 120],
      ['2026-10-05 09:00:00', 'output tokens', 50],
      ['2026-10-05 10:00:00', 'cache read tokens', 2000],
      ['2026-10-05 10:00:00', 'input tokens', 10],
      ['2026-10-05 10:00:00', 'output tokens', 40],
    ]);
    const run = db
      .prepare('SELECT source, goal, started_at FROM work_runs WHERE id = ?')
      .get<Record<string, string>>(RUN);
    expect(run).toEqual({
      source: 'claude-code-log',
      goal: 'claude code session',
      started_at: '2026-10-05 09:10:00',
    });

    // Unchanged: not even opened, and nothing written.
    const again = readSessionLogs(db, { env: env() });
    expect(again.logs[0]).toMatchObject({ read: 0, tokens: 0 });

    // Grown inside the 10:00 hour, and into 11:00: the 10:00 rows grow in
    // place, an 11:00 row is new, and nothing before is counted again.
    appendFileSync(
      path,
      reply('r3', '2026-10-05T10:40:00.000Z', { input: 5, cached: 500, output: 7 }) +
        reply('r4', '2026-10-05T11:15:00.000Z', { input: 1, cached: 0, output: 2 })
    );
    readSessionLogs(db, { env: env() });
    expect(rowsOf(db).map(r => [r.hour, r.unit, r.quantity])).toEqual([
      ['2026-10-05 09:00:00', 'cache read tokens', 1000],
      ['2026-10-05 09:00:00', 'input tokens', 120],
      ['2026-10-05 09:00:00', 'output tokens', 50],
      ['2026-10-05 10:00:00', 'cache read tokens', 2500],
      ['2026-10-05 10:00:00', 'input tokens', 15],
      ['2026-10-05 10:00:00', 'output tokens', 47],
      ['2026-10-05 11:00:00', 'input tokens', 1],
      ['2026-10-05 11:00:00', 'output tokens', 2],
    ]);

    // Read again from the top: every hour is already held.
    readSessionLogs(db, { env: env(), refresh: true });
    expect(totals(db)).toEqual({
      'cache read tokens': 3500,
      'input tokens': 136,
      'output tokens': 99,
    });
  } finally {
    db.close();
  }
});

test('the transcript read as it grows and read whole at the session end count each token once', () => {
  const path = transcriptPath();
  const spool = join(dir, 'claude-code.jsonl');
  const end = (t: string) =>
    appendFileSync(spool, line({ t, e: 'SessionEnd', s: SESSION, why: 'exit', tp: path }));
  writeFileSync(
    path,
    reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 })
  );
  const db = graph();
  try {
    // Live: the first reply, while the session runs.
    readSessionLogs(db, { env: env() });
    expect(totals(db)).toEqual({
      'cache read tokens': 1000,
      'input tokens': 100,
      'output tokens': 50,
    });

    // The session grows inside the hour already read and into the next, and
    // ends; its last line has no newline after it, which only a read that
    // knows the session is over counts.
    appendFileSync(
      path,
      reply('r2', '2026-10-05T09:40:00.000Z', { input: 20, cached: 2000, output: 5 }) +
        reply('r3', '2026-10-05T10:20:00.000Z', { input: 3, cached: 300, output: 30 }).trimEnd()
    );
    end('2026-10-05T10:21:00.000Z');
    ingestSpool(db, spool);
    const whole = { 'cache read tokens': 3300, 'input tokens': 123, 'output tokens': 85 };
    expect(totals(db)).toEqual(whole);
    expect(
      db.prepare('SELECT outcome FROM work_runs WHERE id = ?').get<{ outcome: string }>(RUN)
    ).toEqual({ outcome: 'exit' });

    // The live read catches up to what the end already recorded, and the same
    // end spooled twice records nothing more.
    readSessionLogs(db, { env: env() });
    end('2026-10-05T10:21:00.000Z');
    end('2026-10-05T10:21:00.000Z');
    ingestSpool(db, spool);
    expect(totals(db)).toEqual(whole);
    expect(rowsOf(db)).toHaveLength(6);

    // Resumed: the same session's transcript grows again, and both paths
    // still agree on every hour.
    appendFileSync(
      path,
      `\n${reply('r4', '2026-10-05T10:50:00.000Z', { input: 1, cached: 0, output: 1 })}`
    );
    readSessionLogs(db, { env: env() });
    end('2026-10-05T10:51:00.000Z');
    ingestSpool(db, spool);
    expect(totals(db)).toEqual({
      'cache read tokens': 3300,
      'input tokens': 124,
      'output tokens': 86,
    });
  } finally {
    db.close();
  }
});

test("a subagent's transcript counts its own replies, and not the session's it replays", () => {
  const path = transcriptPath();
  writeFileSync(
    path,
    reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 })
  );
  const agents = join(path.replace(/\.jsonl$/, ''), 'subagents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(
    join(agents, 'agent-a1.jsonl'),
    // A side question replays the parent's reply under a new request id.
    reply(
      'r1',
      '2026-10-05T09:10:00.000Z',
      { input: 100, cached: 1000, output: 50 },
      { isSidechain: true, requestId: 'req_replayed' }
    ) +
      reply(
        's1',
        '2026-10-05T09:12:00.000Z',
        { input: 7, cached: 70, output: 9 },
        { isSidechain: true },
        'claude-haiku-4-5'
      )
  );
  const db = graph();
  try {
    readSessionLogs(db, { env: env() });
    expect(totals(db)).toEqual({
      'cache read tokens': 1070,
      'input tokens': 107,
      'output tokens': 59,
    });
    // The read at the session's end reads both the same way.
    const atEnd = transcriptTokens(path);
    expect([...atEnd.keys()].sort()).toEqual(['claude-haiku-4-5', OPUS]);
    expect(atEnd.get('claude-haiku-4-5')?.get('2026-10-05 09:00:00')).toEqual({
      input: 7,
      cached: 70,
      output: 9,
    });
    expect(atEnd.get(OPUS)?.get('2026-10-05 09:00:00')).toEqual({
      input: 100,
      cached: 1000,
      output: 50,
    });
  } finally {
    db.close();
  }
});

test('rows written before hours were kept cover what they held, and only what lies beyond is written', () => {
  const db = graph();
  const path = transcriptPath();
  try {
    // A session recorded at its end before tokens were kept per hour: one row
    // per part, no hour, timed when written.
    beginRun(db, { id: RUN, at: '2026-10-05 09:10:00', source: 'claude-code-hook' });
    const legacy = db.prepare(
      `INSERT INTO resource_consumption (run_id, resource_id, kind, quantity, unit, recorded_at)
       VALUES (?, ?, 'tokens', ?, ?, '2026-10-05 12:00:07')`
    );
    legacy.run(RUN, `model:${OPUS}`, 120, 'input tokens');
    legacy.run(RUN, `model:${OPUS}`, 3000, 'cache read tokens');
    legacy.run(RUN, `model:${OPUS}`, 55, 'output tokens');

    writeFileSync(
      path,
      reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 }) +
        reply('r2', '2026-10-05T10:40:00.000Z', { input: 20, cached: 2000, output: 5 }) +
        // Resumed after the old read: this is all that is new.
        reply('r3', '2026-10-05T13:30:00.000Z', { input: 4, cached: 400, output: 6 })
    );
    readSessionLogs(db, { env: env() });
    expect(totals(db)).toEqual({
      'cache read tokens': 3400,
      'input tokens': 124,
      'output tokens': 61,
    });
    // The old rows stay as they were; the new tokens are in their hour.
    expect(
      rowsOf(db)
        .filter(r => r.hour !== '2026-10-05 12:00:07')
        .map(r => [r.hour, r.unit, r.quantity])
    ).toEqual([
      ['2026-10-05 13:00:00', 'cache read tokens', 400],
      ['2026-10-05 13:00:00', 'input tokens', 4],
      ['2026-10-05 13:00:00', 'output tokens', 6],
    ]);
  } finally {
    db.close();
  }
});

test("a Codex cursor from before hours were kept is read from the top, so the run's rows cover the old turns", () => {
  const folder = join(home(), '.codex', 'sessions', '2026', '10', '05');
  mkdirSync(folder, { recursive: true });
  const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6c';
  const path = join(folder, `rollout-2026-10-05T13-00-00-${id}.jsonl`);
  const turn = (at: string, total: number) => {
    const use = (n: number) => ({
      input_tokens: n,
      cached_input_tokens: 0,
      output_tokens: 0,
      total_tokens: n,
    });
    return line({
      timestamp: at,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: use(total), last_token_usage: use(16) },
      },
    });
  };
  writeFileSync(
    path,
    line({ timestamp: '2026-10-05T13:00:00.000Z', type: 'session_meta', payload: { id } }) +
      line({
        timestamp: '2026-10-05T13:00:00.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5-codex' },
      }) +
      turn('2026-10-05T13:30:00.000Z', 16)
  );
  const db = graph();
  try {
    // What an earlier Ambit left: the first turn as a session total, and a
    // cursor at the end of the file whose state holds totals and no hours.
    const run = `run-codex-${id}`;
    beginRun(db, { id: run, at: '2026-10-05 13:00:00', source: 'codex-log' });
    db.prepare(
      `INSERT INTO resource_consumption (run_id, resource_id, kind, quantity, unit, recorded_at)
       VALUES (?, 'model:gpt-5-codex', 'tokens', 16, 'input tokens', '2026-10-05 15:00:07')`
    ).run(run);
    const { size, mtimeMs } = statSync(path);
    db.prepare(
      `INSERT INTO session_log_cursors (path, runtime, size, mtime_ms, byte_offset, state)
       VALUES (?, 'codex', ?, ?, ?, ?)`
    ).run(
      path,
      size,
      mtimeMs,
      size,
      JSON.stringify({
        meta: true,
        session: id,
        model: 'gpt-5-codex',
        prev: { input: 16, cached: 0, output: 0, total: 16 },
        use: { session: id, models: { 'gpt-5-codex': { input: 16 } } },
      })
    );

    appendFileSync(path, turn('2026-10-05T14:10:00.000Z', 32));
    readSessionLogs(db, { env: env() });
    expect(totals(db, run)).toEqual({ 'input tokens': 32 });
    expect(
      rowsOf(db, run)
        .filter(r => r.hour !== '2026-10-05 15:00:07')
        .map(r => [r.hour, r.quantity])
    ).toEqual([['2026-10-05 14:00:00', 16]]);
  } finally {
    db.close();
  }
});

// ── Pricing, content, the switch, sync ───────────────────────────────────────

const PRICE = [OPUS, '--input=5', '--cache-read=0.5', '--output=25'];

const spent = (db: Db) =>
  db
    .prepare("SELECT spent_cents FROM budgets WHERE capability_id = 'combo:hosted-inference'")
    .get<{ spent_cents: number }>()?.spent_cents;

test('an hour is priced once, and an hour that grows is priced for what it grew by', () => {
  seed(WITH_GITHUB).close();
  cli('people', 'add', 'kanav');
  cli('budget', 'set', 'hosted-inference', '--amount=20', '--by=kanav');
  // Every reply in the hour the budget's period began, which is the
  // period's: it had not ended when the period began.
  const db = graph();
  const start = db
    .prepare("SELECT period_start FROM budgets WHERE capability_id = 'combo:hosted-inference'")
    .get<{ period_start: string }>()?.period_start as string;
  db.close();
  const hour = Date.parse(`${start.slice(0, 13).replace(' ', 'T')}:00:00.000Z`);
  const at = (seconds: number) => new Date(hour + seconds * 1000).toISOString();
  const path = transcriptPath();
  // Before any price: counted, and not priced.
  writeFileSync(path, reply('r0', at(1), { input: 1_000_000, cached: 0, output: 0 }));
  const first = graph();
  try {
    expect(readSessionLogs(first, { env: env() }).undeclared).toEqual([OPUS]);
    expect(spent(first)).toBe(0);
  } finally {
    first.close();
  }
  cli('economics', 'price', ...PRICE);
  // A million fresh input at $5 and a hundred thousand output at $25.
  appendFileSync(path, reply('r1', at(2), { input: 1_000_000, cached: 0, output: 100_000 }));
  const db2 = graph();
  try {
    readSessionLogs(db2, { env: env() });
    expect(spent(db2)).toBeCloseTo(750, 6);
    readSessionLogs(db2, { env: env(), refresh: true });
    expect(spent(db2)).toBeCloseTo(750, 6);

    // The same hour grows: two hundred thousand more input, $1.
    appendFileSync(path, reply('r2', at(3), { input: 200_000, cached: 0, output: 0 }));
    readSessionLogs(db2, { env: env() });
    expect(spent(db2)).toBeCloseTo(850, 6);

    // The unpriced tokens keep a row of their own; the priced ones grew one.
    expect(
      rowsOf(db2)
        .filter(r => r.unit === 'input tokens')
        .map(r => [r.quantity, r.cost])
    ).toEqual([
      [1_000_000, null],
      [1_200_000, 600],
    ]);
    const [model] = tokenUsage(db2)?.models ?? [];
    expect(model).toMatchObject({ input: 2_200_000, spend_dollars: 8.5, unpriced: true });
  } finally {
    db2.close();
  }
});

test('only counts, model names, ids and times reach the graph', () => {
  const path = transcriptPath();
  writeFileSync(
    path,
    prompt('2026-10-05T09:05:00.000Z') +
      reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 }) +
      line({
        type: 'user',
        timestamp: '2026-10-05T09:10:05.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'SECRET-output', usage: 'SECRET-usage' }],
        },
      })
  );
  const db = graph();
  try {
    readSessionLogs(db, { env: env() });
    ingestSpool(db, join(dir, 'none.jsonl'));
    const held = everything(db);
    expect(totals(db)).toEqual({
      'cache read tokens': 1000,
      'input tokens': 100,
      'output tokens': 50,
    });
    // The cursor is filed under a digest, since the transcript's folder is
    // named after the project.
    expect(held).not.toContain('SECRET');
  } finally {
    db.close();
  }
});

test('AMBIT_NO_LEDGER reads no transcript', () => {
  writeFileSync(
    transcriptPath(),
    reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 })
  );
  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { ...env(), AMBIT_NO_LEDGER: '1' } });
    expect(read.skipped).toMatch(/AMBIT_NO_LEDGER/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_runs').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_log_cursors').get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

test('CLAUDE_CONFIG_DIR is the only place looked when it is set', () => {
  writeFileSync(
    transcriptPath(),
    reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 })
  );
  const elsewhere = join(dir, 'claude-elsewhere');
  mkdirSync(join(elsewhere, 'projects'), { recursive: true });
  const db = graph();
  try {
    readSessionLogs(db, { env: { ...env(), CLAUDE_CONFIG_DIR: elsewhere } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_runs').get()).toEqual({ n: 0 });
    // Named by its projects folder, it is the same place.
    readSessionLogs(db, {
      env: { ...env(), CLAUDE_CONFIG_DIR: join(home(), '.claude', 'projects') },
    });
    expect(totals(db)).toEqual({
      'cache read tokens': 1000,
      'input tokens': 100,
      'output tokens': 50,
    });
  } finally {
    db.close();
  }
});

test('an hour travels with ambit sync, grows on a second import, and is never added twice', () => {
  const path = transcriptPath();
  writeFileSync(
    path,
    reply('r1', '2026-10-05T09:10:00.000Z', { input: 100, cached: 1000, output: 50 })
  );
  const file = join(dir, 'sync.json');
  const db = graph();
  const elsewhere = getDb(join(dir, 'elsewhere.db'));
  migrate(elsewhere);
  try {
    readSessionLogs(db, { env: env() });
    exportSync(db, file);
    importSync(elsewhere, file);
    expect(totals(elsewhere)).toEqual(totals(db));

    appendFileSync(
      path,
      reply('r2', '2026-10-05T09:40:00.000Z', { input: 1, cached: 2, output: 3 })
    );
    readSessionLogs(db, { env: env() });
    exportSync(db, file);
    importSync(elsewhere, file);
    importSync(elsewhere, file);
    expect(totals(elsewhere)).toEqual({
      'cache read tokens': 1002,
      'input tokens': 101,
      'output tokens': 53,
    });
    expect(rowsOf(elsewhere)).toHaveLength(3);
  } finally {
    db.close();
    elsewhere.close();
  }
});
