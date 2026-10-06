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
import { proposalHash, verifyApproval } from './approval.ts';
import {
  approveProposal,
  decideDraft,
  decideShown,
  ensureActor,
  rejectProposal,
} from './governance.ts';
import { ledgerSince, recordFrontier } from './ledger.ts';
import { opportunitiesFor } from './opportunities.ts';
import { makeGraph } from './testing/graph.ts';
import { techTreeView } from './views.ts';
import { graphCounts } from './vocabulary.ts';

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
  expect(rejected.results[0].refused).toContain('only a draft can be decided');
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

// The same guard for one proposal, which is what the card's own buttons use, and
// what turning a proposal down does to an approval that came before it.

test('one draft is decided against the hash its card showed, and refused when it is not that', () => {
  const db = graph();
  const [item] = shown(db, 'prop-1');

  expect(decideDraft(db, 'approve', { id: 'prop-1' }, 'human:web')).toMatchObject({
    ok: false,
    kind: 'unnamed',
  });
  expect(row(db, 'prop-1').status).toBe('draft');

  db.prepare("UPDATE proposals SET goal = 'reach something else' WHERE id = 'prop-1'").run();
  expect(decideDraft(db, 'approve', item, 'human:web')).toMatchObject({
    ok: false,
    kind: 'changed',
  });
  expect(row(db, 'prop-1')).toMatchObject({ status: 'draft', approval_artifact: null });

  const [again] = shown(db, 'prop-1');
  const decided = decideDraft(db, 'approve', again, 'human:web') as { ok: true; result: any };
  expect(decided.ok).toBe(true);
  expect(decided.result.artifact.sig).toMatch(/^[0-9a-f]{64}$/);
  expect(row(db, 'prop-1').status).toBe('approved');
  db.close();
});

test('a proposal that is no longer a draft is not decided again from the page', () => {
  // `approveProposal` alone will sign a rolled-back or applied proposal a second
  // time, which is the CLI's business. The page decides what it showed as a draft.
  const db = graph();
  for (const status of ['approved', 'applied', 'rolled_back', 'rejected']) {
    db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, 'prop-2');
    const [item] = shown(db, 'prop-2');
    for (const decision of ['approve', 'reject'] as const) {
      expect(decideDraft(db, decision, item, 'human:web')).toMatchObject({
        ok: false,
        kind: 'not-draft',
      });
    }
    expect(row(db, 'prop-2').status).toBe(status);
  }
  db.close();
});

test('a reason given when turning a draft down is recorded with the refusal', () => {
  const db = graph();
  const [item] = shown(db, 'prop-3');
  expect(decideDraft(db, 'reject', item, 'human:web', 'not this quarter')).toMatchObject({
    ok: true,
  });
  expect(
    db
      .prepare('SELECT rejected_by, reason FROM proposal_rejections WHERE proposal_id = ?')
      .get('prop-3')
  ).toMatchObject({ rejected_by: 'human:web', reason: 'not this quarter' });
  db.close();
});

test('turning down an approved proposal withdraws the approval it had been given', () => {
  // The artifact is a signed document, and apply and the control plane spend it
  // by reading the row. A refusal that left it in place said "turned down" on
  // the page while the artifact stayed good for its day.
  const db = graph();
  expect((approveProposal(db, 'prop-1', 'human:web') as any).artifact).toBeDefined();
  expect(verifyApproval(db, 'prop-1', 'human:web')).toEqual({ ok: true });

  expect((rejectProposal(db, 'prop-1', 'human:web') as any).error).toBeUndefined();
  expect(row(db, 'prop-1')).toMatchObject({
    status: 'rejected',
    approval_artifact: null,
    expires_at: null,
  });
  expect(verifyApproval(db, 'prop-1', 'human:web').ok).toBe(false);
  db.close();
});

test('a proposal turned down by an earlier release, artifact and all, is still not spendable', () => {
  const db = graph();
  approveProposal(db, 'prop-1', 'human:web');
  // What the earlier release left behind: rejected, and the artifact still there.
  db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = 'prop-1'").run();
  expect(row(db, 'prop-1').approval_artifact).not.toBeNull();
  expect(verifyApproval(db, 'prop-1', 'human:web')).toMatchObject({
    ok: false,
    reason: expect.stringContaining('turned down'),
  });
  db.close();
});

test('the person at the browser is not a capability the graph gained', () => {
  // Deciding from the page declares `human:web`. Counted as a node of the
  // frontier, the first approval read as a capability gained that week, moved
  // every reach count by one, and listed the person in My Setup as an entry.
  const db = makeGraph({
    capabilities: [{ id: 'combo:thing', name: 'Thing', kind: 'capability' }],
  });
  db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES ('prop-1', 'Thing', 'draft', ?, '{}')"
  ).run(JSON.stringify([{ id: 'combo:thing', name: 'Thing' }]));
  recordFrontier(db);
  const before = graphCounts(db);

  expect(ensureActor(db, 'human:web', 'you, at the browser', 'the browser')).toBe(true);
  approveProposal(db, 'prop-1', 'human:web');

  expect(graphCounts(db)).toEqual(before);
  expect((ledgerSince(db) as any).gained ?? []).toEqual([]);
  expect(techTreeView(db).items.map(i => i.id)).not.toContain('human:web');
  db.close();
});

test('an approval is about the proposal it decided, not the person deciding', () => {
  // Approvals are filed under the person, which is how the trail finds them.
  // Read as the subject, they ranked "Automate you, at the browser" first.
  const db = makeGraph({
    capabilities: [
      { id: 'combo:thing', name: 'Thing', kind: 'capability' },
      { id: 'human:web', name: 'you, at the browser', category: 'human', kind: 'actor' },
    ],
  });
  const steps = JSON.stringify([{ id: 'combo:thing', name: 'Thing' }]);
  const insert = db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, 'Thing', 'draft', ?, '{}')"
  );
  for (const n of [1, 2]) {
    insert.run(`prop-${n}`, steps);
    approveProposal(db, `prop-${n}`, 'human:web');
  }

  const subjects = (opportunitiesFor(db) as any).opportunities.map((o: any) => o.capability_id);
  expect(subjects).toContain('combo:thing');
  expect(subjects).not.toContain('human:web');
  db.close();
});
