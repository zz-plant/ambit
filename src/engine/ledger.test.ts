/**
 * The ledger's step, between any two observations of the frontier.
 *
 * `ledgerSince` compared a snapshot with the live graph and nothing else, so
 * the question the map's timeline asks, what moved between last Tuesday and
 * the Friday after, had no answer in the engine, and a page that answered it
 * itself would have been a second definition of emergent. These hold the one
 * definition: a step between two snapshots is the step to a live graph that
 * matches the later one, it reads as one sentence, and a second holds one
 * observation however many were recorded in it.
 */
import { expect, test } from 'vitest';
import type { Db } from './db.ts';
import { frontierAt, frontierSeries, ledgerSince, recordFrontier } from './ledger.ts';
import { makeGraph } from './testing/graph.ts';

const MONDAY = '2026-09-21 09:00:00';
const FRIDAY = '2026-09-25 17:00:00';

/**
 * A machine on Monday: git supplies version control, which passes its check,
 * and an ops agent supplies CI, which waits on a prerequisite.
 */
function monday(): Db {
  return makeGraph({
    capabilities: [
      { id: 'mcp:git', kind: 'provider', lifecycle: 'configured' },
      { id: 'agent:ops', kind: 'provider', lifecycle: 'configured' },
      { id: 'combo:vc', name: 'Version Control', lifecycle: 'verified' },
      { id: 'combo:ci', name: 'Continuous Integration', state: 'locked', lifecycle: 'unknown' },
    ],
    dependencies: [
      { from: 'mcp:git', to: 'combo:vc', kind: 'provides' },
      { from: 'agent:ops', to: 'combo:ci', kind: 'provides' },
    ],
  });
}

/**
 * The same machine on Friday: an embedding model was added and supplies
 * Embeddings, CI became reachable with nothing new supplying it, and version
 * control's check started failing.
 */
function toFriday(db: Db) {
  db.prepare(
    "UPDATE capabilities SET state = 'unlocked', lifecycle = 'configured' WHERE id = ?"
  ).run('combo:ci');
  db.prepare("UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'combo:vc'").run();
  const add = db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
     VALUES (?, ?, 'ai-ml', '', ?, 'unlocked', ?, 'configured')`
  );
  add.run('provider:embed', 'nomic-embed-text', 'model', 'provider');
  add.run('combo:embeddings', 'Embeddings', 'skill', 'capability');
  db.prepare(
    `INSERT INTO dependencies (from_capability, to_capability, kind)
     VALUES ('provider:embed', 'combo:embeddings', 'provides')`
  ).run();
}

/** Monday and Friday as snapshots, and a live graph that matches Friday. */
function week(): Db {
  const db = monday();
  recordFrontier(db, MONDAY);
  toFriday(db);
  recordFrontier(db, FRIDAY);
  return db;
}

test('a step between two snapshots is the step to a live graph that matches the later one', () => {
  const db = week();
  const between = ledgerSince(db, MONDAY, FRIDAY) as any;
  const toNow = ledgerSince(db, MONDAY) as any;
  db.close();

  expect(between.since).toBe(MONDAY);
  expect(between.until).toBe(FRIDAY);
  expect(toNow.until).toBeUndefined();
  const { until: _, ...step } = between;
  expect(step).toEqual(toNow);

  // What the step is made of, by name.
  expect(between.gained.map((g: any) => g.id).sort()).toEqual([
    'combo:embeddings',
    'provider:embed',
  ]);
  expect(between.emergent.map((e: any) => e.id)).toEqual(['combo:ci']);
  expect(between.diminished.map((d: any) => d.id)).toEqual(['combo:vc']);
});

test('a step reads as one sentence: reach, what emerged, what was proven, what went failing', () => {
  const db = week();
  const step = ledgerSince(db, MONDAY, FRIDAY) as any;
  db.close();

  expect(step.frontier_then).toBe(3);
  expect(step.frontier_now).toBe(6);
  expect(step.moved).toBe('reached 3 to 6, 1 emergent, verified 1 to 0, 1 went failing');
});

test('an observation with no lifecycles claims nothing about what was proven or went failing', () => {
  // Snapshots written before lifecycles existed carry a verified count of zero
  // by default. Printing "verified 0 to 1" off one would be a zero nobody
  // measured.
  const db = week();
  db.prepare('UPDATE frontier_snapshots SET lifecycles = NULL WHERE taken_at = ?').run(MONDAY);
  const step = ledgerSince(db, MONDAY, FRIDAY) as any;
  db.close();

  expect(step.diminished).toBeUndefined();
  expect(step.moved).toBe('reached 3 to 6, 1 emergent');
});

test('two snapshots in the same second resolve to the later, whichever plan SQLite picks', () => {
  // The index on taken_at happened to return the later of two tied rows and a
  // table scan returns the earlier, so without an id tie-break the answer was
  // the query plan's. Dropping the index is what makes the difference visible.
  const db = monday();
  recordFrontier(db, FRIDAY);
  toFriday(db);
  recordFrontier(db, FRIDAY);
  expect((db.prepare('SELECT COUNT(*) AS n FROM frontier_snapshots').get() as any).n).toBe(2);
  db.exec('DROP INDEX idx_frontier_taken');

  expect(frontierAt(db, FRIDAY)?.states['combo:embeddings']).toBe('unlocked');
  // The earliest observation is the first recorded.
  expect(frontierAt(db)?.states['combo:embeddings']).toBeUndefined();

  const { ticks } = frontierSeries(db);
  db.close();
  expect(ticks).toHaveLength(1);
  expect(ticks[0].taken_at).toBe(FRIDAY);
  expect(ticks[0].states['combo:embeddings']).toBe('unlocked');
});

test('a timestamp names the same second however it is written', () => {
  // `2026-09-25T17:00:00Z` compared as a string sorts after every snapshot of
  // that day, because the ledger writes a space where ISO writes a T.
  const db = week();
  const iso = frontierAt(db, '2026-09-25T16:59:59Z');
  const stored = frontierAt(db, '2026-09-25 16:59:59');
  expect(iso?.taken_at).toBe(MONDAY);
  expect(stored?.taken_at).toBe(MONDAY);
  expect(frontierAt(db, '2026-09-25T17:00:00Z')?.taken_at).toBe(FRIDAY);

  // A word is not a second, and the ledger says so.
  expect((ledgerSince(db, 'last tuesday') as any).error).toMatch(/Not a timestamp/);
  expect((ledgerSince(db, MONDAY, 'friday') as any).error).toMatch(/Not a timestamp/);
  expect((ledgerSince(db, FRIDAY, MONDAY) as any).error).toMatch(/earlier than/);
  db.close();
});

test('a dated observation is stored at its date, and compared with what was in effect then', () => {
  const db = monday();
  expect(recordFrontier(db, MONDAY)).toBe('recorded');
  // Nothing moved since the observation in effect on Friday, which is Monday's.
  expect(recordFrontier(db, FRIDAY)).toBe('unchanged');
  expect(() => recordFrontier(db, 'someday')).toThrow(/Not a timestamp/);
  const rows = db.prepare('SELECT taken_at FROM frontier_snapshots').all() as any[];
  db.close();
  expect(rows.map(r => r.taken_at)).toEqual([MONDAY]);
});

test('the series is one tick per second, oldest first, each saying what moved since the last', () => {
  const db = week();
  const { ticks, movedSinceLast } = frontierSeries(db);

  expect(ticks.map(t => t.taken_at)).toEqual([MONDAY, FRIDAY]);
  expect(ticks[0].moved).toBe('first observation, reached 3');
  // The same words `ambit history since <monday> <friday>` prints.
  expect(ticks[1].moved).toBe((ledgerSince(db, MONDAY, FRIDAY) as any).moved);
  // The live graph is where Friday left it.
  expect(movedSinceLast).toBeNull();

  // A check that starts passing after the last seed changes the live graph and
  // records nothing, so the newest snapshot trails it. The series says what.
  db.prepare("UPDATE capabilities SET lifecycle = 'verified' WHERE id = 'combo:vc'").run();
  const after = frontierSeries(db);
  db.close();
  expect(after.ticks).toHaveLength(2);
  expect(after.movedSinceLast).toBe('reached 6, verified 0 to 1');
});

test('a graph with no observation has no series', () => {
  const db = monday();
  const series = frontierSeries(db);
  db.close();
  expect(series).toEqual({ ticks: [], movedSinceLast: null });
});
