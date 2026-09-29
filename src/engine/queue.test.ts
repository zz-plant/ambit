/**
 * The queue: several drafts decided in one request, each on its own.
 *
 * The web approved one id per call, and a script could already call that route
 * with no token and any actor it liked. One request that signs several raises
 * the stakes from one signature to many, so the queue binds each id to the
 * hash the page showed, decides drafts only, and answers per id: a proposal
 * that changed since is refused while the rest still sign, and nothing is
 * applied or granted.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Db } from './db.ts';
import { proposalHash } from './approval.ts';
import { decideShown } from './governance.ts';
import { makeGraph } from './testing/graph.ts';

const key = process.env.AMBIT_APPROVAL_KEY;
beforeAll(() => {
  // A fixed key, so no test reads or creates the real one on this machine.
  process.env.AMBIT_APPROVAL_KEY = 'queue-test-key';
});
afterAll(() => {
  if (key === undefined) delete process.env.AMBIT_APPROVAL_KEY;
  else process.env.AMBIT_APPROVAL_KEY = key;
});

/** Four drafts and the person at the browser. */
function graph(): Db {
  const db = makeGraph({
    capabilities: [{ id: 'human:web', name: 'you', category: 'human', kind: 'actor' }],
  });
  const insert = db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, ?, 'draft', '[]', '{}')"
  );
  for (const n of [1, 2, 3, 4]) insert.run(`prop-${n}`, `reach thing ${n}`);
  return db;
}

/** A proposal row the test wrote, so it is there to read. */
const row = (db: Db, id: string) => db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)!;

/** What the page sends: each id with the hash its card was drawn from. */
const shown = (db: Db, ...ids: string[]) =>
  ids.map(id => ({ id, proposalHash: proposalHash(db, row(db, id)) }));

test('approving three of four signs each on its own, applies none, and leaves the fourth', () => {
  const db = graph();
  const grants = db.prepare('SELECT COUNT(*) AS n FROM authority').get()?.n;
  const answer = decideShown(db, 'approve', shown(db, 'prop-1', 'prop-2', 'prop-3'), 'human:web');

  expect(answer).toEqual({
    results: [
      { id: 'prop-1', decided: true },
      { id: 'prop-2', decided: true },
      { id: 'prop-3', decided: true },
    ],
  });
  const artifacts = new Set<string>();
  for (const id of ['prop-1', 'prop-2', 'prop-3']) {
    const r = row(db, id);
    expect(r).toMatchObject({ status: 'approved', approved_by: 'human:web', applied_at: null });
    artifacts.add(JSON.parse(r.approval_artifact).proposal_hash);
  }
  // Three artifacts, one per proposal, each bound to its own row.
  expect(artifacts.size).toBe(3);
  expect(row(db, 'prop-4').status).toBe('draft');
  // Approving grants nothing: the authority table is as it was.
  expect(db.prepare('SELECT COUNT(*) AS n FROM authority').get()?.n).toBe(grants);
  db.close();
});

test('a proposal that changed after it was shown is refused, and the rest still sign', () => {
  const db = graph();
  const items = shown(db, 'prop-1', 'prop-2', 'prop-3');
  db.prepare("UPDATE proposals SET goal = 'reach something else' WHERE id = 'prop-2'").run();

  const answer = decideShown(db, 'approve', items, 'human:web') as { results: any[] };
  expect(answer.results.map(r => [r.id, r.decided])).toEqual([
    ['prop-1', true],
    ['prop-2', false],
    ['prop-3', true],
  ]);
  expect(answer.results[1].refused).toContain('changed after it was shown');
  expect(row(db, 'prop-2')).toMatchObject({ status: 'draft', approval_artifact: null });
  db.close();
});

test('a row that fails partway is refused and rolled back, and the batch goes on', () => {
  const db = graph();
  db.prepare("UPDATE proposals SET steps = 'not a list' WHERE id = 'prop-2'").run();

  const answer = decideShown(db, 'approve', shown(db, 'prop-1', 'prop-2', 'prop-3'), 'human:web');
  const results = (answer as { results: any[] }).results;
  expect(results.map(r => r.decided)).toEqual([true, false, true]);
  expect(results[1].refused).toMatch(/^Not recorded/);
  expect(row(db, 'prop-2')).toMatchObject({ status: 'draft', approved_by: null });
  // The transaction was closed either way, so the next write is not refused.
  db.prepare("UPDATE proposals SET goal = 'still writable' WHERE id = 'prop-4'").run();
  db.close();
});

test('the queue decides drafts only, so an approved proposal keeps its approval', () => {
  const db = graph();
  decideShown(db, 'approve', shown(db, 'prop-1'), 'human:web');
  const artifact = row(db, 'prop-1').approval_artifact;
  db.prepare("UPDATE proposals SET status = 'applied' WHERE id = 'prop-4'").run();

  // Turning down an approved row would leave its artifact spendable.
  const rejected = decideShown(db, 'reject', shown(db, 'prop-1', 'prop-2'), 'human:web') as {
    results: any[];
  };
  expect(rejected.results[0]).toMatchObject({ id: 'prop-1', decided: false });
  expect(rejected.results[0].refused).toContain('drafts only');
  expect(rejected.results[1]).toEqual({ id: 'prop-2', decided: true });
  expect(row(db, 'prop-1')).toMatchObject({ status: 'approved', approval_artifact: artifact });
  expect(row(db, 'prop-2').status).toBe('rejected');

  // Nor is an applied one approved again.
  const again = decideShown(db, 'approve', shown(db, 'prop-4'), 'human:web') as {
    results: any[];
  };
  expect(again.results[0]).toMatchObject({ id: 'prop-4', decided: false });
  expect(row(db, 'prop-4').status).toBe('applied');
  db.close();
});

test('a list the queue cannot read is refused whole, before anything is decided', () => {
  const db = graph();
  const one = shown(db, 'prop-1');
  const bad: unknown[] = [
    undefined,
    'prop-1',
    [],
    [{ id: 'prop-1' }],
    [{ id: 'prop-1', proposalHash: '' }],
    [...one, ...one],
    Array.from({ length: 51 }, (_, i) => ({ id: `prop-x${i}`, proposalHash: 'h' })),
  ];
  for (const items of bad) {
    expect(decideShown(db, 'approve', items, 'human:web')).toHaveProperty('error');
  }
  expect(row(db, 'prop-1').status).toBe('draft');

  // And someone the graph does not know is refused per id, as the CLI refuses them.
  const stranger = decideShown(db, 'approve', one, 'human:nobody') as { results: any[] };
  expect(stranger.results[0]).toMatchObject({ id: 'prop-1', decided: false });
  expect(row(db, 'prop-1').status).toBe('draft');
  db.close();
});
