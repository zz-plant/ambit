/**
 * The runs behind a node's check, as the tree serves them.
 *
 * `meta.reliability` says how many runs passed, of how many. A row that wants to
 * show how it went, and whether it has been going wrong lately, needs the runs
 * themselves, in the order they happened. That order is the whole difficulty:
 * the evidence table stamps each row to the second, and a batch of checks lands
 * inside one.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CHECK_HISTORY_RUNS } from '../shared/api.ts';
import { deriveLifecycles } from './assurance.ts';
import { exportSync, importSync } from './sync.ts';
import { daysAgo, learn, makeGraph } from './testing/graph.ts';
import { techTreeView } from './views.ts';

const node = (id: string) => ({
  id,
  name: id,
  category: 'combo',
  kind: 'capability' as const,
  state: 'unlocked' as const,
});

const item = (db: ReturnType<typeof makeGraph>, id: string) =>
  techTreeView(db).items.find(i => i.id === id)!;

test('a node carries its last fourteen check runs, oldest first, in the order they ran', () => {
  const db = makeGraph({ capabilities: [node('combo:a')] });
  // Twenty runs, each stamped a day older than the one before it, the way rows
  // can arrive from an import. The strip reads them by when they ran, as the
  // lifecycle does, so the fourteen newest are the first fourteen rows. The
  // row id only breaks a tie inside one second (rule 11), which the test
  // below of a busy node and a quiet one holds.
  const outcomes = Array.from({ length: 20 }, (_, i) => (i % 5 === 4 ? 'failed' : 'verified'));
  for (const [i, action] of outcomes.entries()) {
    learn(db, 'combo:a', action, { at: daysAgo(i) });
  }
  const history = item(db, 'combo:a').meta.history;
  db.close();

  expect(CHECK_HISTORY_RUNS).toBe(14);
  expect(history).toHaveLength(CHECK_HISTORY_RUNS);
  // Rows 14 down to 1: the six oldest runs, rows 15 to 20, have left the window.
  expect(history?.map(r => r.id)).toEqual(Array.from({ length: 14 }, (_, i) => 14 - i));
  expect(history?.map(r => r.passed)).toEqual(
    outcomes
      .slice(0, 14)
      .reverse()
      .map(a => a === 'verified')
  );
});

test('only runs of a check are history, and a node with none has no history', () => {
  const db = makeGraph({ capabilities: [node('combo:a'), node('combo:b')] });
  // Approvals, applies, blocks and demotions are in the same table and are not
  // runs of a check.
  for (const action of ['approved', 'applied', 'blocked:tool', 'demoted']) {
    learn(db, 'combo:a', action);
  }
  learn(db, 'combo:b', 'verified');
  const a = item(db, 'combo:a');
  const b = item(db, 'combo:b');
  db.close();

  // Absence is an answer (rule 16): no key, not an empty strip.
  expect(a.meta.history).toBeUndefined();
  expect('history' in JSON.parse(JSON.stringify(a.meta))).toBe(false);
  expect(b.meta.history).toEqual([{ id: 5, passed: true }]);
});

test('a node that is checked often does not crowd out one that is checked rarely', () => {
  const db = makeGraph({ capabilities: [node('combo:busy'), node('combo:quiet')] });
  // The quiet node's two runs are the oldest rows in the ledger. A window over
  // the ledger's last rows, and not over each node's own, would lose both.
  learn(db, 'combo:quiet', 'failed');
  learn(db, 'combo:quiet', 'verified');
  for (let i = 0; i < 30; i++) learn(db, 'combo:busy', 'verified');
  const busy = item(db, 'combo:busy').meta.history;
  const quiet = item(db, 'combo:quiet').meta.history;
  db.close();

  expect(busy).toHaveLength(CHECK_HISTORY_RUNS);
  expect(quiet).toEqual([
    { id: 1, passed: false },
    { id: 2, passed: true },
  ]);
});

test('a run another machine recorded takes its place by when it ran, as the lifecycle reads it', () => {
  // An import keeps each run's timestamp and gives it a new, higher row id.
  // The lifecycle and `lastChecked` read runs by time and the strip read them
  // by row, so one older failure from elsewhere made the strip end red under a
  // node whose lifecycle said reliable.
  const dir = mkdtempSync(join(tmpdir(), 'ambit-history-'));
  const file = join(dir, 'sync.json');
  const elsewhere = makeGraph({ capabilities: [node('combo:a')] });
  learn(elsewhere, 'combo:a', 'failed', { at: daysAgo(9) });
  exportSync(elsewhere, file);
  elsewhere.close();

  const db = makeGraph({ capabilities: [node('combo:a')] });
  const passes = [6, 5, 4, 3, 2, 1].map(days => daysAgo(days));
  for (const at of passes) learn(db, 'combo:a', 'verified', { at });
  importSync(db, file);
  rmSync(dir, { recursive: true, force: true });
  deriveLifecycles(db);
  const { meta } = item(db, 'combo:a');
  db.close();

  expect(meta.lifecycle).toBe('reliable');
  expect(meta.lastChecked).toBe(passes.at(-1));
  // Oldest first: the failure from nine days ago, then the six passes since.
  expect(meta.history?.map(r => r.passed)).toEqual([false, true, true, true, true, true, true]);
  // The id stays on the wire: the failure is the newest row though not the newest run.
  expect(meta.history?.[0].id).toBe(7);
});

test('the history and the reliability count read the same runs', () => {
  const db = makeGraph({ capabilities: [node('combo:a')] });
  learn(db, 'combo:a', 'verified');
  learn(db, 'combo:a', 'failed');
  // A run scoped to an object is still a run of the check, and `reliability`
  // has always counted it.
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, object) VALUES ('t', 'combo:a', 'verified', 1, 'repo:x')"
  ).run();
  const { history, reliability } = item(db, 'combo:a').meta;
  db.close();

  expect(reliability).toEqual({ passed: 2, total: 3 });
  expect(history).toHaveLength(reliability!.total);
  expect(history?.filter(r => r.passed)).toHaveLength(reliability!.passed);
});
