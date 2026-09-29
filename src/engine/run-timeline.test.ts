/**
 * One run, laid out in time from what the ledger recorded.
 *
 * A run has a start and an end, capabilities used for a measured time, events
 * that are points, and asks of a person. What the producers record is uneven:
 * the OpenCode plugin logs that a permission prompt happened and cannot see the
 * reply, so the ask never ends; the control plane writes zero seconds because it
 * cannot measure either; only the telemetry route takes a start and an end.
 * The projection draws what exists and marks what does not, and above all never
 * turns an unmeasured wait into a wait of nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { exportSync, importSync } from './sync.ts';
import { beginRun, recordIntervention, recordUse, runTimeline } from './telemetry.ts';
import { makeGraph } from './testing/graph.ts';
import { GATE_KINDS } from './vocabulary.ts';
import { runView } from './views.ts';

const graph = () =>
  makeGraph({
    capabilities: [
      { id: 'combo:shell', name: 'Shell Execution', category: 'combo' },
      { id: 'combo:vcs', name: 'Version Control', category: 'combo' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
  });

type Db = ReturnType<typeof graph>;

function run(db: Db, id: string, startedAt = '2026-09-29 10:00:00', endedAt: string | null = null) {
  db.prepare('INSERT INTO work_runs (id, goal, started_at, ended_at) VALUES (?, ?, ?, ?)').run(
    id,
    `goal of ${id}`,
    startedAt,
    endedAt
  );
}

interface AskRow {
  kind?: string;
  startedAt?: string;
  endedAt?: string | null;
  active?: number | null;
  waiting?: number | null;
  capability?: string | null;
}

function ask(db: Db, runId: string, a: AskRow = {}) {
  db.prepare(
    `INSERT INTO human_intervention
       (run_id, actor_id, kind, started_at, ended_at, active_seconds, waiting_seconds, capability_id)
     VALUES (?, 'human:kanav', ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    a.kind ?? 'authority',
    a.startedAt ?? '2026-09-29 10:05:00',
    a.endedAt ?? null,
    a.active ?? null,
    a.waiting ?? null,
    a.capability ?? null
  );
}

const asksOf = (db: Db, id = 'r1') => runTimeline(db, id).run?.asks ?? [];

test('a run with one timed and one untimed ask has one span and one point, and counts only the timed one', () => {
  const db = graph();
  run(db, 'r1');
  // The reply to this one was recorded.
  ask(db, 'r1', {
    startedAt: '2026-09-29 10:05:00',
    endedAt: '2026-09-29 10:07:10',
    active: 130,
  });
  // The reply to this one was not, as the plugin leaves it.
  ask(db, 'r1', { startedAt: '2026-09-29 10:09:00' });
  const view = runTimeline(db, 'r1').run;
  db.close();

  const [timed, untimed] = view?.asks ?? [];
  expect(timed).toMatchObject({
    at: '2026-09-29T10:05:00.000Z',
    ended_at: '2026-09-29T10:07:10.000Z',
    seconds: 130,
    gate: true,
  });
  expect(untimed).toMatchObject({ at: '2026-09-29T10:09:00.000Z', ended_at: null, seconds: null });
  // One counted, one said not to be, and the total is the timed one alone.
  expect(view?.human).toEqual({ seconds: 130, timed: 1, untimed: 1 });
});

test('the zero a recorder writes because it cannot see the reply is not a measurement', () => {
  const db = graph();
  run(db, 'r1');
  // The control plane records both as zero, with no end.
  ask(db, 'r1', { active: 0, waiting: 0 });
  const view = runTimeline(db, 'r1').run;
  db.close();

  expect(view?.asks[0].seconds).toBeNull();
  expect(view?.human).toEqual({ seconds: 0, timed: 0, untimed: 1 });
});

test('recorded seconds with no end are timed, and the ask stays a point', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1', { active: 45 });
  const [only] = asksOf(db);
  db.close();

  expect(only).toMatchObject({ seconds: 45, ended_at: null });
});

test('recorded active and waiting time is what the ask took, not the span it was drawn over', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1', {
    startedAt: '2026-09-29 10:05:00',
    endedAt: '2026-09-29 10:06:00',
    active: 30,
    waiting: 90,
  });
  const [only] = asksOf(db);
  db.close();

  expect(only.seconds).toBe(120);
});

test('an end before the start is a clock that disagrees, and is not an answer', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1', { startedAt: '2026-09-29 10:05:00', endedAt: '2026-09-29 10:01:00' });
  const view = runTimeline(db, 'r1').run;
  db.close();

  expect(view?.asks[0]).toMatchObject({ ended_at: null, seconds: null });
  expect(view?.human.untimed).toBe(1);
});

test('either spelling of a time comes out as one, in UTC', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1', { startedAt: '2026-09-29 10:00:00', endedAt: '2026-09-29T10:01:00Z' });
  const [only] = asksOf(db);
  db.close();

  expect(only.at).toBe('2026-09-29T10:00:00.000Z');
  expect(only.ended_at).toBe('2026-09-29T10:01:00.000Z');
  expect(only.seconds).toBe(60);
});

test('the permission kinds are the vocabulary gate, and nothing else is', () => {
  const db = graph();
  run(db, 'r1');
  const others = ['clerical', 'judgment', 'exception'];
  for (const kind of [...GATE_KINDS, ...others]) ask(db, 'r1', { kind });
  const asks = asksOf(db);
  db.close();

  for (const kind of GATE_KINDS) expect(asks.find(a => a.kind === kind)?.gate).toBe(true);
  for (const kind of others) expect(asks.find(a => a.kind === kind)?.gate).toBe(false);
});

test('an ask names the capability it was about, or keeps its id', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1', { capability: 'combo:shell' });
  ask(db, 'r1', { capability: 'combo:unknown' });
  const asks = asksOf(db);
  db.close();

  expect(asks.map(a => a.capability)).toEqual(['Shell Execution', 'combo:unknown']);
});

test('uses are bars where a duration was measured and points where it was not', () => {
  const db = graph();
  run(db, 'r1');
  const use = db.prepare(
    'INSERT INTO capability_use (run_id, capability_id, used_at, duration_seconds) VALUES (?, ?, ?, ?)'
  );
  use.run('r1', 'combo:shell', '2026-09-29 10:01:00', 90);
  use.run('r1', 'combo:vcs', '2026-09-29 10:03:00', null);
  // A duration of nothing is a point too, not a bar of no width.
  use.run('r1', 'combo:vcs', '2026-09-29 10:04:00', 0);
  const view = runTimeline(db, 'r1').run;
  db.close();

  expect(view?.uses.map(u => [u.capability, u.seconds])).toEqual([
    ['Shell Execution', 90],
    ['Version Control', null],
    ['Version Control', null],
  ]);
  expect(view?.uses_total).toBe(3);
});

test('events are points in time order, and a long run sends the latest and says how many there were', () => {
  const db = graph();
  run(db, 'r1');
  const put = db.prepare(
    "INSERT INTO work_events (run_id, at, kind, action) VALUES ('r1', datetime('2026-09-29 10:00:00', ?), 'tool', ?)"
  );
  for (let i = 0; i < 1003; i++) put.run(`+${i} seconds`, `tool-${i}`);
  const view = runTimeline(db, 'r1').run;
  db.close();

  expect(view?.events_total).toBe(1003);
  expect(view?.events).toHaveLength(1000);
  // The latest thousand, oldest first.
  expect(view?.events[0].action).toBe('tool-3');
  expect(view?.events.at(-1)?.action).toBe('tool-1002');
  const times = (view?.events ?? []).map(e => e.at);
  expect(times).toEqual([...times].sort());
});

test('with no id it is the newest run that recorded an ask, else the newest', () => {
  const db = graph();
  run(db, 'r-old', '2026-09-28 09:00:00');
  run(db, 'r-new', '2026-09-29 09:00:00');
  ask(db, 'r-old');

  // The newest was never asked anything, so it is not the one to draw.
  expect(runTimeline(db).run?.id).toBe('r-old');
  expect(runTimeline(db).recent.map(r => r.id)).toEqual(['r-new', 'r-old']);
  expect(runTimeline(db).recent.map(r => r.asks)).toEqual([0, 1]);

  db.prepare('DELETE FROM human_intervention').run();
  expect(runTimeline(db).run?.id).toBe('r-new');

  // An id is taken as asked, and one that names nothing is nothing.
  expect(runTimeline(db, 'r-old').run?.id).toBe('r-old');
  expect(runTimeline(db, 'nonesuch').run).toBeNull();
  db.close();
});

test('two runs begun in the same second are told apart by the order they were written', () => {
  const db = graph();
  run(db, 'first', '2026-09-29 09:00:00');
  run(db, 'second', '2026-09-29 09:00:00');
  const ids = runTimeline(db).recent.map(r => r.id);
  db.close();

  expect(ids).toEqual(['second', 'first']);
});

test('a ledger with no runs has nothing to draw', () => {
  const db = graph();
  expect(runTimeline(db)).toEqual({ recent: [], run: null });
  db.close();
});

test('the run and its end are as recorded, and an open run has no end', () => {
  const db = graph();
  run(db, 'open');
  run(db, 'closed', '2026-09-29 11:00:00', '2026-09-29 11:14:00');
  const open = runTimeline(db, 'open').run;
  const closed = runTimeline(db, 'closed').run;
  db.close();

  expect(open?.ended_at).toBeNull();
  expect(closed).toMatchObject({
    started_at: '2026-09-29T11:00:00.000Z',
    ended_at: '2026-09-29T11:14:00.000Z',
    goal: 'goal of closed',
  });
});

test('the recorders write what the projection reads', () => {
  const db = graph();
  const { run: id } = beginRun(db, { goal: 'ship it' });
  recordUse(db, id, 'combo:shell', { durationSeconds: 12 });
  recordIntervention(db, id, 'human:kanav', {
    kind: 'authority',
    startedAt: '2026-09-29 10:00:00',
    endedAt: '2026-09-29 10:00:30',
  });
  recordIntervention(db, id, 'human:kanav', { kind: 'authority', outcome: 'asked' });
  const view = runView(db, id).run;
  db.close();

  expect(view?.uses[0]).toMatchObject({ capability: 'Shell Execution', seconds: 12 });
  expect(view?.asks.map(a => a.seconds)).toContain(30);
  expect(view?.human.timed).toBe(1);
  expect(view?.human.untimed).toBe(1);
});

test('reading a run writes nothing', () => {
  const db = graph();
  run(db, 'r1');
  ask(db, 'r1');
  const tables = ['work_runs', 'work_events', 'capability_use', 'human_intervention', 'outcomes'];
  const counts = () =>
    tables.map(t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get<{ n: number }>()!.n);
  const changes = () => db.prepare('SELECT total_changes() AS n').get<{ n: number }>()!.n;
  const before = [counts(), changes()];

  runTimeline(db);
  runTimeline(db, 'r1');
  runView(db, 'nonesuch');
  expect([counts(), changes()]).toEqual(before);
  db.close();
});

test('a run that arrived in a sync file has its uses and asks and no events', () => {
  // Events are the one ledger table a sync file does not carry (a sync file
  // carries every row its rows point at, and events point at nothing else), so
  // the projection has to draw a run whose events are simply absent.
  const dir = mkdtempSync(join(tmpdir(), 'ambit-run-'));
  const file = join(dir, 'sync.json');
  const source = graph();
  run(source, 'r1');
  source
    .prepare(
      "INSERT INTO work_events (run_id, at, kind) VALUES ('r1', '2026-09-29 10:01:00', 'tool')"
    )
    .run();
  source
    .prepare(
      "INSERT INTO capability_use (run_id, capability_id, used_at, duration_seconds) VALUES ('r1', 'combo:shell', '2026-09-29 10:02:00', 30)"
    )
    .run();
  ask(source, 'r1', { startedAt: '2026-09-29 10:03:00', endedAt: '2026-09-29 10:04:00' });
  exportSync(source, file);
  source.close();

  const target = graph();
  importSync(target, file);
  const view = runTimeline(target, 'r1').run;
  target.close();
  rmSync(dir, { recursive: true, force: true });

  expect(view?.uses_total).toBe(1);
  expect(view?.asks_total).toBe(1);
  expect(view?.events).toEqual([]);
  expect(view?.events_total).toBe(0);
});
