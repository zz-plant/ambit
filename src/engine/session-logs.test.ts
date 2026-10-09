/**
 * The tokens Codex, OpenCode and Amp sessions used, read from the logs those
 * agents keep, into the work ledger.
 *
 * Every log here is a fixture written in the documented shape, under a
 * temporary HOME, with the content a real session holds beside its counts: a
 * prompt, a reply, a command, a tool's output, a working directory. What is
 * held is what the module promises: only counts, model names, session ids and
 * times reach the graph; a cumulative count is turned into turns once; a log
 * read twice, or grown, records only what is new; a price applies by the rule
 * the Claude Code read uses; AMBIT_NO_LEDGER reads nothing; and the cursor,
 * which names this machine's files, does not travel with `ambit sync`.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import { expect, test } from 'vitest';
import type { Db } from './db.ts';
import { readSessionLogs } from './session-logs.ts';
import { exportSync, importSync } from './sync.ts';
import { tokenUsage } from './telemetry.ts';
import { cli, dir, getDb, join, migrate, seed, withEnv } from './testing/cli.ts';

const WITH_GITHUB = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { github: { type: 'local', command: ['github-mcp-server'] } },
};

/** Every value in every table of the graph, as one string to search. */
function everything(db: Db): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>()
    .map(t => t.name);
  return tables.map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n');
}

/** A run's token rows, as `model|unit` to quantity. */
function tokensOf(db: Db, run: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db
    .prepare(
      `SELECT resource_id, unit, SUM(quantity) AS n FROM resource_consumption
       WHERE run_id = ? AND kind = 'tokens' GROUP BY resource_id, unit`
    )
    .all<{ resource_id: string; unit: string; n: number }>(run)) {
    out[`${r.resource_id.replace(/^model:/, '')}|${r.unit}`] = r.n;
  }
  return out;
}

function graph(): Db {
  const db = getDb(join(dir, 'graph.db'));
  migrate(db);
  return db;
}

/** The temporary HOME every log in a test is written under. */
const home = () => join(dir, 'home');

// ── Codex ────────────────────────────────────────────────────────────────────

const SESSION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const DAY = join('2026', '10', '01');

const usage = (input: number, cached: number, output: number, reasoning = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

/** A token_count event, cumulative total and the turn's own, either of which may be left out. */
const tokenCount = (at: string, total?: object, last?: object) =>
  line({
    timestamp: at,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 },
      rate_limits: { primary: { used_percent: 12 } },
    },
  });

/** The opening of a rollout as Codex writes one, with the content a session holds. */
function codexOpening(id = SESSION, at = '2026-10-01T09:00:00.000Z', extra: object = {}) {
  return [
    line({
      timestamp: at,
      type: 'session_meta',
      payload: {
        id,
        timestamp: at,
        cwd: '/Users/someone/SECRET-project',
        originator: 'codex_cli_rs',
        cli_version: '0.144.0',
        base_instructions: { text: 'SECRET-instructions' },
        git: { branch: 'SECRET-branch', repository_url: 'git@example.com:SECRET-repo.git' },
        ...extra,
      },
    }),
    line({
      timestamp: at,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'SECRET-prompt: why is token_count wrong' }],
      },
    }),
    line({
      timestamp: at,
      type: 'turn_context',
      payload: { cwd: '/Users/someone/SECRET-project', model: 'gpt-5-codex', effort: 'medium' },
    }),
    line({
      timestamp: at,
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        arguments: '{"command":["cat","SECRET-file.txt"]}',
        call_id: 'call_1',
      },
    }),
    line({
      timestamp: at,
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call_1', output: 'SECRET-output' },
    }),
  ].join('');
}

function codexRollout(name = `rollout-2026-10-01T09-00-00-${SESSION}.jsonl`, sub = 'sessions') {
  const folder = join(home(), '.codex', sub, DAY);
  mkdirSync(folder, { recursive: true });
  return join(folder, name);
}

test('a Codex rollout becomes one run, its cumulative counts turned into turns once', () => {
  const path = codexRollout();
  writeFileSync(
    path,
    codexOpening() +
      // The turn's own count, and the total it brings the session to.
      tokenCount('2026-10-01T09:01:00.000Z', usage(1000, 200, 100, 40), usage(1000, 200, 100, 40)) +
      // The same total again: a repeat, which counts nothing.
      tokenCount('2026-10-01T09:01:01.000Z', usage(1000, 200, 100, 40), usage(1000, 200, 100, 40)) +
      // Only the total: the turn is the difference.
      tokenCount('2026-10-01T09:05:00.000Z', usage(3000, 1200, 400, 100)) +
      line({
        timestamp: '2026-10-01T09:05:01.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'SECRET-reply' },
      })
  );
  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home() } });
    expect(read.logs).toEqual([
      {
        runtime: 'Codex',
        from: '~/.codex/sessions',
        files: 1,
        read: 1,
        sessions: 1,
        tokens: 3400,
      },
    ]);
    expect(read.undeclared).toEqual(['gpt-5-codex']);
    const run = `run-codex-${SESSION}`;
    // Fresh input is input less the cached part; reasoning is inside output.
    expect(tokensOf(db, run)).toEqual({
      'gpt-5-codex|input tokens': 1800,
      'gpt-5-codex|cache read tokens': 1200,
      'gpt-5-codex|output tokens': 400,
    });
    expect(db.prepare('SELECT * FROM work_runs WHERE id = ?').get(run)).toMatchObject({
      source: 'codex-log',
      goal: 'codex session',
      started_at: '2026-10-01 09:00:00',
      ended_at: '2026-10-01 09:05:00',
      outcome: null,
    });
    // A count with no price is undeclared, never $0.
    expect(
      db
        .prepare('SELECT COUNT(cost_cents) AS n FROM resource_consumption WHERE run_id = ?')
        .get(run)
    ).toEqual({ n: 0 });
    // Nothing the session said, ran or worked in reached the graph.
    expect(everything(db)).not.toMatch(/SECRET/);
  } finally {
    db.close();
  }
});

test('a second read finds nothing new, and a grown rollout adds only its new turns', () => {
  const path = codexRollout();
  writeFileSync(
    path,
    codexOpening() +
      tokenCount('2026-10-01T09:01:00.000Z', usage(1000, 200, 100), usage(1000, 200, 100))
  );
  const db = graph();
  try {
    readSessionLogs(db, { env: { HOME: home() } });
    const run = `run-codex-${SESSION}`;
    const once = tokensOf(db, run);

    // Unchanged: the file is not opened, and nothing is recorded.
    const again = readSessionLogs(db, { env: { HOME: home() } });
    expect(again.logs[0]).toMatchObject({ files: 1, read: 0, tokens: 0 });
    expect(tokensOf(db, run)).toEqual(once);

    // Grown, on another model: the read resumes at the byte it stopped at.
    const before = db
      .prepare('SELECT byte_offset FROM session_log_cursors WHERE path = ?')
      .get<{ byte_offset: number }>(path)?.byte_offset;
    expect(before).toBe(readFileSync(path).length);
    appendFileSync(
      path,
      line({
        timestamp: '2026-10-01T09:10:00.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.1-codex', cwd: '/Users/someone/SECRET-project' },
      }) + tokenCount('2026-10-01T09:10:30.000Z', usage(1500, 300, 150), usage(500, 100, 50))
    );
    const grown = readSessionLogs(db, { env: { HOME: home() } });
    expect(grown.logs[0]).toMatchObject({ read: 1, tokens: 550 });
    expect(tokensOf(db, run)).toEqual({
      'gpt-5-codex|input tokens': 800,
      'gpt-5-codex|cache read tokens': 200,
      'gpt-5-codex|output tokens': 100,
      'gpt-5.1-codex|input tokens': 400,
      'gpt-5.1-codex|cache read tokens': 100,
      'gpt-5.1-codex|output tokens': 50,
    });

    // Read from the top again, cursors set aside: nothing a run holds is added.
    const refreshed = readSessionLogs(db, { env: { HOME: home() }, refresh: true });
    expect(refreshed.logs[0]).toMatchObject({ read: 1, tokens: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM resource_consumption WHERE kind = 'tokens'").get()
    ).toEqual({ n: 6 });
  } finally {
    db.close();
  }
});

test("a fork's replayed history is skipped, an archived copy is read once, and a compressed one is read", () => {
  // The parent, in sessions/ and again under the same name in archived_sessions/.
  const parent =
    codexOpening() +
    tokenCount('2026-10-01T09:01:00.000Z', usage(1000, 0, 100), usage(1000, 0, 100)) +
    tokenCount('2026-10-01T09:02:00.000Z', usage(3000, 0, 300), usage(2000, 0, 200));
  writeFileSync(codexRollout(), parent);
  writeFileSync(codexRollout(undefined, 'archived_sessions'), parent);

  // The fork: its parent's two turns rewritten to the fork instant, back to
  // back, then a turn of its own eight seconds later.
  const child = '0199a1b2-c3d4-7e5f-8a9b-00000000c41d';
  const fork = '2026-10-01T10:00:00.000Z';
  writeFileSync(
    codexRollout(`rollout-2026-10-01T10-00-00-${child}.jsonl`),
    codexOpening(child, fork, { forked_from_id: SESSION }) +
      tokenCount('2026-10-01T10:00:00.010Z', usage(1000, 0, 100), usage(1000, 0, 100)) +
      tokenCount('2026-10-01T10:00:00.030Z', usage(3000, 0, 300), usage(2000, 0, 200)) +
      tokenCount('2026-10-01T10:00:08.000Z', usage(3700, 0, 370), usage(700, 0, 70))
  );

  // A cold rollout Codex compressed.
  const cold = '0199a1b2-c3d4-7e5f-8a9b-0000000000c0';
  const zst = codexRollout(`rollout-2026-09-01T08-00-00-${cold}.jsonl.zst`, 'archived_sessions');
  writeFileSync(
    zst,
    zstdCompressSync(
      Buffer.from(
        codexOpening(cold, '2026-09-01T08:00:00.000Z') +
          tokenCount('2026-09-01T08:01:00.000Z', usage(90, 0, 9), usage(90, 0, 9))
      )
    )
  );

  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home() } });
    const files = Object.fromEntries(read.logs.map(l => [l.from, l.files]));
    // Two in sessions/; the archived copy of the parent is not counted again.
    expect(files).toEqual({ '~/.codex/sessions': 2, '~/.codex/archived_sessions': 1 });
    expect(tokensOf(db, `run-codex-${SESSION}`)).toMatchObject({
      'gpt-5-codex|input tokens': 3000,
    });
    expect(tokensOf(db, `run-codex-${child}`)).toEqual({
      'gpt-5-codex|input tokens': 700,
      'gpt-5-codex|output tokens': 70,
    });
    expect(tokensOf(db, `run-codex-${cold}`)).toEqual({
      'gpt-5-codex|input tokens': 90,
      'gpt-5-codex|output tokens': 9,
    });
  } finally {
    db.close();
  }
});

// ── OpenCode ─────────────────────────────────────────────────────────────────

/** An OpenCode database in the shape packages/core/src/session/sql.ts declares. */
function openCodeDb(): string {
  const folder = join(home(), '.local', 'share', 'opencode');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, 'opencode.db');
  const oc = new DatabaseSync(path);
  oc.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
      directory TEXT, title TEXT, version TEXT, cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0, tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0, model TEXT,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  oc.close();
  return path;
}

const T0 = Date.parse('2026-10-02T12:00:00.000Z');

function openCodeWrite(path: string, fn: (oc: DatabaseSync) => void) {
  const oc = new DatabaseSync(path);
  try {
    fn(oc);
  } finally {
    oc.close();
  }
}

const stepFinish = (
  input: number,
  output: number,
  reasoning: number,
  read: number,
  write: number
) =>
  JSON.stringify({
    type: 'step-finish',
    reason: 'tool-calls',
    snapshot: 'SECRET-snapshot',
    cost: 0.01,
    tokens: { input, output, reasoning, cache: { read, write } },
  });

function addSession(oc: DatabaseSync, id: string, created: number, counters: number[]) {
  oc.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, tokens_input,
       tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model,
       time_created, time_updated)
     VALUES (?, 'p', 's', '/Users/someone/SECRET-dir', 'SECRET-title', '1.0', ?, ?, ?, ?, ?,
       '{"id":"claude-sonnet-4-5","providerID":"anthropic"}', ?, ?)`
  ).run(id, ...counters, created, created);
}

function addAssistant(
  oc: DatabaseSync,
  session: string,
  id: string,
  created: number,
  steps: string[]
) {
  oc.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)'
  ).run(
    `${id}-user`,
    session,
    created - 1,
    created - 1,
    JSON.stringify({ role: 'user', time: { created: created - 1 } })
  );
  oc.prepare(
    'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    `${id}-prompt`,
    `${id}-user`,
    session,
    created - 1,
    created - 1,
    JSON.stringify({ type: 'text', text: 'SECRET-prompt' })
  );
  // The message's own tokens are its last step's, as OpenCode writes them.
  oc.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    session,
    created,
    created,
    JSON.stringify({
      role: 'assistant',
      modelID: 'claude-sonnet-4-5',
      providerID: 'anthropic',
      path: { cwd: '/Users/someone/SECRET-dir', root: '/Users/someone/SECRET-dir' },
      tokens: JSON.parse(steps[steps.length - 1]).tokens,
      time: { created },
    })
  );
  const parts = [
    JSON.stringify({ type: 'text', text: 'SECRET-reply' }),
    JSON.stringify({
      type: 'tool',
      tool: 'bash',
      state: { input: { command: 'cat SECRET-file' }, output: 'SECRET-output' },
    }),
    ...steps,
  ];
  parts.forEach((data, i) => {
    oc.prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(`${id}-part-${i}`, id, session, created + i, created + i, data);
  });
}

test('an OpenCode session is summed over its steps, reasoning apart, and a fork counts only its own', () => {
  const path = openCodeDb();
  openCodeWrite(path, oc => {
    // Two steps in one message: the message's tokens hold only the second.
    addSession(oc, 'ses_A', T0, [110, 55, 20, 2100, 30]);
    addAssistant(oc, 'ses_A', 'msg_A1', T0 + 1000, [
      stepFinish(100, 50, 20, 1000, 30),
      stepFinish(10, 5, 0, 1100, 0),
    ]);
    // A fork made an hour later: the parent's message copied under a new id,
    // keeping its creation time, then a turn of its own.
    addSession(oc, 'ses_B', T0 + 3_600_000, [117, 58, 20, 2100, 30]);
    addAssistant(oc, 'ses_B', 'msg_B1', T0 + 1000, [
      stepFinish(100, 50, 20, 1000, 30),
      stepFinish(10, 5, 0, 1100, 0),
    ]);
    addAssistant(oc, 'ses_B', 'msg_B2', T0 + 3_700_000, [stepFinish(7, 3, 0, 0, 0)]);
  });
  const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
  const untouched = hash();

  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home() } });
    expect(read.logs).toEqual([
      {
        runtime: 'OpenCode',
        from: '~/.local/share/opencode',
        files: 1,
        read: 1,
        sessions: 2,
        tokens: 2325,
      },
    ]);
    // Input carries the cache writes, as the Claude Code read counts them;
    // reasoning is its own unit; the model is named with its provider.
    expect(tokensOf(db, 'run-oc-sesA')).toEqual({
      'anthropic/claude-sonnet-4-5|input tokens': 140,
      'anthropic/claude-sonnet-4-5|cache read tokens': 2100,
      'anthropic/claude-sonnet-4-5|output tokens': 55,
      'anthropic/claude-sonnet-4-5|reasoning tokens': 20,
    });
    expect(tokensOf(db, 'run-oc-sesB')).toEqual({
      'anthropic/claude-sonnet-4-5|input tokens': 7,
      'anthropic/claude-sonnet-4-5|output tokens': 3,
    });
    expect(db.prepare('SELECT source FROM work_runs WHERE id = ?').get('run-oc-sesA')).toEqual({
      source: 'opencode-log',
    });
    expect(everything(db)).not.toMatch(/SECRET/);
    // Opened read-only: the database is byte for byte what it was.
    expect(hash()).toBe(untouched);

    // A new step in one session: only that session is read, and only the step is added.
    openCodeWrite(path, oc => {
      oc.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p-new', 'msg_A1', 'ses_A', ?, ?, ?)"
      ).run(T0 + 9000, T0 + 9000, stepFinish(1, 2, 3, 4, 5));
      oc.prepare(
        "UPDATE session SET tokens_input = 111, tokens_output = 57, tokens_reasoning = 23, tokens_cache_read = 2104, tokens_cache_write = 35 WHERE id = 'ses_A'"
      ).run();
    });
    const grown = readSessionLogs(db, { env: { HOME: home() } });
    expect(grown.logs[0]).toMatchObject({ read: 1, sessions: 1, tokens: 15 });
    expect(tokensOf(db, 'run-oc-sesA')['anthropic/claude-sonnet-4-5|reasoning tokens']).toBe(23);
  } finally {
    db.close();
  }
});

test("OpenCode's reasoning is priced at the declared output price", () => {
  seed(WITH_GITHUB).close();
  cli(
    'economics',
    'price',
    'anthropic/claude-sonnet-4-5',
    '--input=3',
    '--cache-read=0.3',
    '--output=15'
  );
  const path = openCodeDb();
  const now = Date.now() - 60_000;
  openCodeWrite(path, oc => {
    addSession(oc, 'ses_P', now, [1_000_000, 0, 1_000_000, 0, 0]);
    addAssistant(oc, 'ses_P', 'msg_P1', now + 1000, [stepFinish(1_000_000, 0, 1_000_000, 0, 0)]);
  });
  const db = graph();
  try {
    readSessionLogs(db, { env: { HOME: home() } });
    const cost = db
      .prepare(
        "SELECT unit, cost_cents FROM resource_consumption WHERE run_id = 'run-oc-sesP' ORDER BY unit"
      )
      .all();
    expect(cost).toEqual([
      { unit: 'input tokens', cost_cents: 300 },
      { unit: 'reasoning tokens', cost_cents: 1500 },
    ]);
  } finally {
    db.close();
  }
});

// ── Amp ──────────────────────────────────────────────────────────────────────

function ampThread(name: string, thread: object) {
  const folder = join(home(), '.local', 'share', 'amp', 'threads');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), JSON.stringify(thread));
}

test('an Amp thread is read from its messages, or from its usage ledger when it has one', () => {
  ampThread('T-aaaa.json', {
    v: 12,
    id: 'T-aaaa',
    title: 'SECRET-title',
    env: { initial: { trees: [{ displayName: 'SECRET-repo' }] } },
    messages: [
      { role: 'user', messageId: 0, content: [{ type: 'text', text: 'SECRET-prompt' }] },
      {
        role: 'assistant',
        messageId: 1,
        content: [
          { type: 'text', text: 'SECRET-reply' },
          { type: 'tool_use', name: 'Bash', input: { cmd: 'SECRET-command' } },
        ],
        usage: {
          model: 'claude-sonnet-4-5-20250929',
          inputTokens: 10,
          outputTokens: 178,
          cacheCreationInputTokens: 986,
          cacheReadInputTokens: 11372,
          totalInputTokens: 12368,
          timestamp: '2026-10-03T08:00:00.000Z',
        },
      },
    ],
  });
  ampThread('T-bbbb.json', {
    id: 'T-bbbb',
    messages: [
      {
        role: 'assistant',
        messageId: 4,
        content: [{ type: 'text', text: 'SECRET-reply' }],
        usage: {
          model: 'ignored-when-a-ledger-is-there',
          inputTokens: 999,
          outputTokens: 999,
          cacheCreationInputTokens: 5,
          cacheReadInputTokens: 50,
          timestamp: '2026-10-03T09:00:00.000Z',
        },
      },
    ],
    usageLedger: {
      events: [
        {
          id: 'e1',
          timestamp: '2026-10-03T09:00:00.000Z',
          model: 'claude-opus-4-5',
          tokens: { input: 20, output: 30 },
          credits: 1.5,
          toMessageId: 4,
        },
      ],
    },
  });
  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home() } });
    expect(read.logs).toEqual([
      {
        runtime: 'Amp',
        from: '~/.local/share/amp/threads',
        files: 2,
        read: 2,
        sessions: 2,
        tokens: 12651,
      },
    ]);
    expect(tokensOf(db, 'run-amp-T-aaaa')).toEqual({
      'claude-sonnet-4-5-20250929|input tokens': 996,
      'claude-sonnet-4-5-20250929|cache read tokens': 11372,
      'claude-sonnet-4-5-20250929|output tokens': 178,
    });
    expect(tokensOf(db, 'run-amp-T-bbbb')).toEqual({
      'claude-opus-4-5|input tokens': 25,
      'claude-opus-4-5|cache read tokens': 50,
      'claude-opus-4-5|output tokens': 30,
    });
    expect(everything(db)).not.toMatch(/SECRET/);
  } finally {
    db.close();
  }
});

// ── Price, budget, opt-out, sync ─────────────────────────────────────────────

/** A one-turn rollout used now, so its tokens fall inside a budget's period. */
function recentRollout(id: string, at = new Date().toISOString()) {
  writeFileSync(
    codexRollout(`rollout-${id}.jsonl`),
    codexOpening(id, at) +
      tokenCount(at, usage(1_200_000, 200_000, 100_000), usage(1_200_000, 200_000, 100_000))
  );
}

const PRICE = ['gpt-5-codex', '--input=1.25', '--cache-read=0.125', '--output=10'];
// A million fresh input at $1.25, 200K cache reads at $0.125 and 100K output
// at $10: 125 + 2.5 + 100 cents.
const CENTS = 227.5;

const spent = (db: Db) =>
  db
    .prepare("SELECT spent_cents FROM budgets WHERE capability_id = 'combo:hosted-inference'")
    .get<{ spent_cents: number }>()?.spent_cents;

test('with a price declared, a session is a spend against the budget, once', () => {
  seed(WITH_GITHUB).close();
  cli('people', 'add', 'kanav');
  cli('budget', 'set', 'hosted-inference', '--amount=20', '--by=kanav');
  cli('economics', 'price', ...PRICE);
  recentRollout('0199a1b2-c3d4-7e5f-8a9b-0000000000a1');
  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home() } });
    expect(read.undeclared).toEqual([]);
    expect(spent(db)).toBeCloseTo(CENTS, 6);
    readSessionLogs(db, { env: { HOME: home() }, refresh: true });
    expect(spent(db)).toBeCloseTo(CENTS, 6);
    expect(tokenUsage(db)?.models).toEqual([
      {
        model: 'gpt-5-codex',
        input: 1_000_000,
        cached: 200_000,
        output: 100_000,
        runtimes: ['Codex'],
        spend_dollars: 2.28,
      },
    ]);
    expect(tokenUsage(db)?.runtimes).toEqual([{ runtime: 'Codex', sessions: 1 }]);
  } finally {
    db.close();
  }
});

test('with no budget the cost stays on the run, and no budget row is made', () => {
  seed(WITH_GITHUB).close();
  cli('economics', 'price', ...PRICE);
  recentRollout('0199a1b2-c3d4-7e5f-8a9b-0000000000a2');
  const db = graph();
  try {
    readSessionLogs(db, { env: { HOME: home() } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM budgets').get()).toEqual({ n: 0 });
    expect(
      db
        .prepare("SELECT SUM(cost_cents) AS c FROM resource_consumption WHERE kind = 'tokens'")
        .get<{
          c: number;
        }>()?.c
    ).toBeCloseTo(CENTS, 6);
  } finally {
    db.close();
  }
});

test("a session older than the budget's period is priced and not spent against it", () => {
  seed(WITH_GITHUB).close();
  cli('people', 'add', 'kanav');
  cli('budget', 'set', 'hosted-inference', '--amount=20', '--by=kanav');
  cli('economics', 'price', ...PRICE);
  recentRollout('0199a1b2-c3d4-7e5f-8a9b-0000000000a3', '2025-11-20T10:00:00.000Z');
  const db = graph();
  try {
    readSessionLogs(db, { env: { HOME: home() } });
    expect(spent(db)).toBe(0);
    expect(
      db
        .prepare("SELECT SUM(cost_cents) AS c FROM resource_consumption WHERE kind = 'tokens'")
        .get<{
          c: number;
        }>()?.c
    ).toBeCloseTo(CENTS, 6);
  } finally {
    db.close();
  }
});

test('AMBIT_NO_LEDGER reads no log, from the engine or from the command', () => {
  recentRollout('0199a1b2-c3d4-7e5f-8a9b-0000000000a4');
  const db = graph();
  try {
    const read = readSessionLogs(db, { env: { HOME: home(), AMBIT_NO_LEDGER: '1' } });
    expect(read.skipped).toMatch(/AMBIT_NO_LEDGER/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_runs').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_log_cursors').get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
  const logs = { CODEX_HOME: join(home(), '.codex') };
  expect(withEnv({ ...logs, AMBIT_NO_LEDGER: '1' }, () => cli('usage', '--refresh')).note).toMatch(
    /AMBIT_NO_LEDGER/
  );
  const refreshed = withEnv({ ...logs, AMBIT_NO_LEDGER: undefined }, () =>
    cli('usage', '--refresh')
  );
  expect(refreshed.logs).toEqual([
    expect.objectContaining({ name: 'Codex', files: 1, read: 1, new_tokens: 1_300_000 }),
  ]);
  expect(refreshed.undeclared).toEqual(['gpt-5-codex']);
});

test('the runs and tokens travel with ambit sync, and the cursor does not', () => {
  const path = codexRollout();
  writeFileSync(
    path,
    codexOpening() +
      tokenCount('2026-10-01T09:01:00.000Z', usage(1000, 200, 100), usage(1000, 200, 100))
  );
  const db = graph();
  const file = join(dir, 'sync.json');
  try {
    readSessionLogs(db, { env: { HOME: home() } });
    const exported = exportSync(db, file);
    expect(exported.excluded).toContain('session log cursors');
  } finally {
    db.close();
  }
  const written = JSON.parse(readFileSync(file, 'utf8'));
  expect(written.tables.session_log_cursors).toBeUndefined();
  expect(JSON.stringify(written)).not.toContain(path);
  expect(written.tables.work_runs.map((r: { id: string }) => r.id)).toContain(
    `run-codex-${SESSION}`
  );

  const elsewhere = getDb(join(dir, 'elsewhere.db'));
  migrate(elsewhere);
  try {
    importSync(elsewhere, file);
    expect(tokensOf(elsewhere, `run-codex-${SESSION}`)).toEqual({
      'gpt-5-codex|input tokens': 800,
      'gpt-5-codex|cache read tokens': 200,
      'gpt-5-codex|output tokens': 100,
    });
    expect(elsewhere.prepare('SELECT COUNT(*) AS n FROM session_log_cursors').get()).toEqual({
      n: 0,
    });
  } finally {
    elsewhere.close();
  }
});

test('a read that runs out of time leaves the rest for the next one', () => {
  const older = codexRollout('rollout-older-0199a1b2-c3d4-7e5f-8a9b-0000000000b1.jsonl');
  const newer = codexRollout('rollout-newer-0199a1b2-c3d4-7e5f-8a9b-0000000000b2.jsonl');
  for (const [path, id] of [
    [older, '0199a1b2-c3d4-7e5f-8a9b-0000000000b1'],
    [newer, '0199a1b2-c3d4-7e5f-8a9b-0000000000b2'],
  ]) {
    writeFileSync(
      path,
      codexOpening(id) + tokenCount('2026-10-01T09:01:00.000Z', usage(10, 0, 1), usage(10, 0, 1))
    );
  }
  utimesSync(older, new Date('2026-09-01'), new Date('2026-09-01'));
  const db = graph();
  try {
    // No time at all: every changed file waits, and nothing is marked read.
    const first = readSessionLogs(db, { env: { HOME: home() }, budgetMs: -1 });
    expect(first.waiting).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_log_cursors').get()).toEqual({ n: 0 });
    const next = readSessionLogs(db, { env: { HOME: home() } });
    expect(next.waiting).toBe(0);
    expect(next.logs[0]).toMatchObject({ files: 2, read: 2 });
  } finally {
    db.close();
  }
});
