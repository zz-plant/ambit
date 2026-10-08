/**
 * The second tree, and the asks behind a next step, as the tree view serves
 * them.
 *
 * A grant climbs five rungs: no grant, asks, a threshold a person set,
 * unattended, unattended under a ceiling. The panel draws the rung and the one
 * command that moves it up, so the rule that promotion needs a person is
 * visible per node: every command names `--by=<person>`, and the threshold
 * rung has no command at all, because evidence is what moves it. A refusal is
 * on no rung. And a locked node that work was recorded blocked on carries the
 * count, which the map draws as a part fill; a node nothing asked for carries
 * nothing, never zero.
 */
import { expect, test } from 'vitest';
import { setBudget } from './budgets.ts';
import { makeGraph } from './testing/graph.ts';
import { techTreeView } from './views.ts';

const graph = (authority: NonNullable<Parameters<typeof makeGraph>[0]>['authority'] = []) =>
  makeGraph({
    capabilities: [
      { id: 'combo:shell', name: 'Shell', category: 'combo' },
      { id: 'combo:deploy', name: 'Deploy', category: 'combo', state: 'locked', setupSeconds: 600 },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
    dependencies: [{ from: 'combo:shell', to: 'combo:deploy' }],
    authority,
  });

const ladderOf = (db: ReturnType<typeof makeGraph>, id: string) =>
  (techTreeView(db).items.find(i => i.id === id)?.meta as any)?.authority?.ladder;

test('a reached capability with no grant is on the bottom rung, and the way up names a person', () => {
  const db = graph();
  const ladder = ladderOf(db, 'combo:shell');
  db.close();
  expect(ladder?.rung).toBe('ungranted');
  expect(ladder?.next?.command).toBe('ambit authority grant shell confirm --by=<person>');
});

test('asking first offers a threshold; a threshold set has no command, only distance', () => {
  const db = graph([{ capability: 'combo:shell', mode: 'confirm', source: 'techtree' }]);
  expect(ladderOf(db, 'combo:shell')).toMatchObject({
    rung: 'confirm',
    next: { command: 'ambit authority promote shell execute --after=10 --by=<person>' },
  });

  db.prepare(
    `UPDATE authority SET promote_after = 5, promote_window_days = 30, promote_set_by = 'kanav'
     WHERE capability_id = 'combo:shell'`
  ).run();
  const set = ladderOf(db, 'combo:shell');
  db.close();
  expect(set?.rung).toBe('threshold');
  expect(set?.next).toBeUndefined();
  expect(set?.note).toContain('0 of 5 in 30d, set by kanav');
  expect(set?.note).toContain('5 more passing checks');
});

test('unattended offers a ceiling, and under one it is at the top', () => {
  const db = graph([{ capability: 'combo:shell', mode: 'autonomous', source: 'techtree' }]);
  const open = ladderOf(db, 'combo:shell');
  expect(open).toMatchObject({
    rung: 'autonomous',
    next: { command: 'ambit budget set shell --amount=20 --by=<person>' },
  });
  expect(open?.note).toContain('default');

  setBudget(db, { capability: 'combo:shell', amount: '$20', person: 'kanav' });
  const capped = ladderOf(db, 'combo:shell');
  db.close();
  expect(capped?.rung).toBe('budgeted');
  expect(capped?.next).toBeUndefined();
});

test('a refusal is on no rung, and a locked node has no ladder', () => {
  const db = graph([{ capability: 'combo:shell', mode: 'forbidden', source: 'techtree' }]);
  expect(ladderOf(db, 'combo:shell')).toEqual({
    rung: 'forbidden',
    note: 'A refusal takes no threshold.',
  });
  expect(ladderOf(db, 'combo:deploy')).toBeUndefined();
  db.close();
});

test('a next step carries how often work was blocked on it, and nothing when never', () => {
  const db = graph();
  const before = techTreeView(db).items.find(i => i.id === 'combo:deploy')!;
  expect('blocks' in (before.meta as object) && before.meta.blocks !== undefined).toBe(false);

  const stamp = db.prepare(
    `INSERT INTO session_learning (session_id, capability_id, action, timestamp)
     VALUES ('s1', 'combo:deploy', 'blocked', datetime('now'))`
  );
  stamp.run();
  stamp.run();
  const after = techTreeView(db).items.find(i => i.id === 'combo:deploy')!;
  db.close();
  expect(after.meta.blocks).toBe(2);
});
