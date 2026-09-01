/**
 * The append-only ledger: what was learned, when, and whether it survives a migration.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import { LOCAL_ONLY, PLUS_EMBEDDINGS, cli, rows, seed } from './testing/cli.ts';

test('seeding records the frontier, and an unchanged re-seed does not', () => {
  seed(LOCAL_ONLY).close();
  expect(cli('history').length).toBe(1);
  seed(LOCAL_ONLY).close(); // identical config
  expect(cli('history').length).toBe(1);
});

test('re-seeding updates derived state', () => {
  // The tech-tree insert is OR IGNORE, so without an explicit update every node
  // stayed frozen at whatever the first seed computed and the tree never moved.
  const first = seed(LOCAL_ONLY);
  const before = (
    first.prepare("SELECT state FROM capabilities WHERE id = 'combo:embeddings'").get() as any
  ).state;
  first.close();

  const second = seed(PLUS_EMBEDDINGS);
  const after = (
    second.prepare("SELECT state FROM capabilities WHERE id = 'combo:embeddings'").get() as any
  ).state;
  expect(before).toBe('locked');
  expect(after).toBe('unlocked');
});

test('the ledger separates what was acquired from what emerged', () => {
  seed(LOCAL_ONLY).close();
  seed(PLUS_EMBEDDINGS).close();

  const since = cli('history', 'since');
  expect(since.frontier_now).toBeGreaterThan(since.frontier_then);

  const gained = since.gained.map((g: any) => g.id);
  const emergent = since.emergent.map((e: any) => e.id);

  // Embeddings arrived because a model providing it was added.
  expect(gained).toContain('combo:embeddings');

  // Offline Capable was already provided by an agent that did not change; it
  // became reachable only because its prerequisites were satisfied elsewhere.
  // This is the entry a per-component changelog cannot produce.
  expect(emergent).toContain('combo:offline-capable');
  expect(gained).not.toContain('combo:offline-capable');
});

test('an expanding vocabulary is not an expanding frontier', () => {
  const db = seed(LOCAL_ONLY);

  // Stand in for the observation an older Ambit wrote: one taken before action
  // nodes were modelled at all. Everything that confers them was already there,
  // so nothing about this machine changed between the two observations.
  const snapshot = rows(
    db,
    'SELECT id, states FROM frontier_snapshots ORDER BY id DESC LIMIT 1'
  )[0];
  const states = JSON.parse(snapshot.states);
  const withoutActions = Object.fromEntries(
    Object.entries(states).filter(([id]) => !id.startsWith('act:'))
  );
  db.prepare('UPDATE frontier_snapshots SET states = ?, kinds = NULL WHERE id = ?').run(
    JSON.stringify(withoutActions),
    snapshot.id
  );
  db.close();

  const since = cli('history', 'since');
  const vocabulary = since.vocabulary.map((v: any) => v.id);
  expect(vocabulary).toContain('act:shell-execution/run_command');

  // The point of the class: they are described, not counted. Reporting them as
  // gains would say the machine could suddenly do a dozen more things.
  expect(since.gained.map((g: any) => g.id)).not.toContain('act:shell-execution/run_command');
  expect(since.frontier_now).toBe(since.frontier_then);
  expect(since.nodes_now).toBeGreaterThan(since.frontier_now);
});

test('a real acquisition is still a gain, not vocabulary', () => {
  seed(LOCAL_ONLY).close();
  seed(PLUS_EMBEDDINGS).close();
  const since = cli('history', 'since');
  // Its provider is new, so this is the system changing rather than the model.
  expect(since.gained.map((g: any) => g.id)).toContain('combo:embeddings');
  expect(since.vocabulary.map((v: any) => v.id)).not.toContain('combo:embeddings');
});

test('a frontier query before any history explains itself', () => {
  const db = seed(LOCAL_ONLY);
  db.close();
  // One observation exists, so `since` compares against it rather than erroring.
  const since = cli('history', 'since');
  expect(since.since).toBeDefined();
  expect(since.emergent).toEqual([]);
});
