/**
 * The append-only ledger: what was learned, when, and whether it survives a migration.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import { frontierSeries } from './ledger.ts';
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

test('the terminal names a step between two observations in the words the timeline uses', () => {
  seed(LOCAL_ONLY).close();
  const db = seed(PLUS_EMBEDDINGS);
  // Two seeds a moment apart can share a second, and a second holds one
  // observation. Dated apart, they are two.
  const [first, second] = rows(db, 'SELECT id FROM frontier_snapshots ORDER BY id');
  db.prepare('UPDATE frontier_snapshots SET taken_at = ? WHERE id = ?').run(
    '2026-09-21 09:00:00',
    first.id
  );
  db.prepare('UPDATE frontier_snapshots SET taken_at = ? WHERE id = ?').run(
    '2026-09-25 17:00:00',
    second.id
  );
  const { ticks } = frontierSeries(db);
  db.close();

  const step = cli('history', 'since', '2026-09-21 09:00:00', '2026-09-25 17:00:00');
  expect(step.until).toBe('2026-09-25 17:00:00');
  expect(step.moved).toMatch(/^reached \d+ to \d+/);
  expect(step.moved).toBe(ticks[1].moved);
  // Up to now, the live graph is where the second seed left it.
  expect(cli('history', 'since', '2026-09-21 09:00:00').moved).toBe(step.moved);
});

/** Two seeds, dated Monday and Friday, with the live graph where Friday left it. */
function mondayAndFriday() {
  seed(LOCAL_ONLY).close();
  const db = seed(PLUS_EMBEDDINGS);
  const [first, second] = rows(db, 'SELECT id FROM frontier_snapshots ORDER BY id');
  const date = db.prepare('UPDATE frontier_snapshots SET taken_at = ? WHERE id = ?');
  date.run('2026-09-21 09:00:00', first.id);
  date.run('2026-09-25 17:00:00', second.id);
  db.close();
}

test('a date and a time typed without quotes are read as the one timestamp they are', () => {
  mondayAndFriday();
  const quoted = cli('history', 'since', '2026-09-21 09:00:00', '2026-09-25 17:00:00');

  // What a shell hands over for `ambit history since 2026-09-21 09:00:00`: two
  // words. The second used to become `until`, a time on no date, which SQLite
  // places in the year 2000, and the answer compared Monday with itself.
  const split = cli('history', 'since', '2026-09-21', '09:00:00');
  expect(split.error).toBeUndefined();
  expect(split.since).toBe('2026-09-21 09:00:00');
  expect(split.until).toBeUndefined();
  expect(split.moved).toBe(quoted.moved);

  const both = cli('history', 'since', '2026-09-21', '09:00:00', '2026-09-25', '17:00:00');
  expect(both.until).toBe('2026-09-25 17:00:00');
  expect(both.moved).toBe(quoted.moved);
});

test('a time with no date, or a bare number, is not a timestamp, and the error shows one', () => {
  mondayAndFriday();
  for (const typed of ['10:00:00', '2026', 'now']) {
    const answer = cli('history', 'since', typed);
    expect(answer.error, typed).toMatch(/^Not a timestamp/);
    // The example in the message is one that works pasted into a shell.
    expect(answer.error).toContain('2026-09-26T10:00:00Z');
  }
  expect(cli('history', 'since', '2026-09-21 09:00:00', '10:00:00').error).toMatch(
    /^Not a timestamp: 10:00:00/
  );
});

test('an until before every observation is refused, naming the earliest', () => {
  mondayAndFriday();
  // `when` may still start from the first observation after it, as documented.
  expect(cli('history', 'since', '2026-09-01').since).toBe('2026-09-21 09:00:00');
  // `until` did the same, so a question about a time before the ledger began
  // was quietly answered about a later one.
  const early = cli('history', 'since', '2026-09-01', '2026-09-02');
  expect(early.error).toContain('2026-09-02');
  expect(early.error).toContain('2026-09-21 09:00:00');
});

test('a frontier query before any history explains itself', () => {
  const db = seed(LOCAL_ONLY);
  db.close();
  // One observation exists, so `since` compares against it rather than erroring.
  const since = cli('history', 'since');
  expect(since.since).toBeDefined();
  expect(since.emergent).toEqual([]);
});
