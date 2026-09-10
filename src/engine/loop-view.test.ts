/**
 * What the Time & cost page is served on a real machine.
 *
 * That page existed only for the hosted demo: the tab was rendered when the
 * store held demo data and hidden otherwise, so a person who ran Ambit on
 * their own setup — the case the product is for — could not see the half of it
 * that prices their time. `loopView` is what the page reads now, and the thing
 * it has to get right is the empty case: a fresh graph with no ledger must say
 * so, because zeroes drawn as figures claim that nothing costs anything.
 */
import { expect, test } from 'vitest';
import { makeGraph } from './testing/graph.ts';
import { loopView } from './views.ts';

const HOUR = 3600;

test('a graph with no ledger reports itself empty rather than drawing zeroes', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'mcp:git', name: 'Git', category: 'mcp' },
      { id: 'combo:deploy', name: 'Deploy', category: 'combo', state: 'locked' },
    ],
  });
  const loop = loopView(db);
  db.close();

  expect(loop.empty).toBe(true);
  expect(loop.source).toBe('ledger');
  expect(loop.attention.interventions).toBe(0);
  expect(loop.roi.monthly_hours).toEqual([]);
  expect(loop.roi.forecast).toBeNull();
  // The graph half is answerable without a ledger, and is still answered.
  expect(loop.status.total).toBe(2);
  expect(loop.status.reached).toBe(1);
});

test('recorded interventions become hours, a month series, and a burden the page can rank', () => {
  const db = makeGraph({
    capabilities: [{ id: 'combo:transfer', name: 'Data transfer', category: 'combo' }],
  });
  db.prepare(
    `INSERT INTO human_intervention (actor_id, kind, capability_id, started_at, active_seconds, waiting_seconds)
     VALUES (?, ?, ?, datetime('now', '-2 days'), ?, ?)`
  ).run('human:kanav', 'clerical', 'combo:transfer', HOUR, 0);
  db.prepare(
    `INSERT INTO human_intervention (actor_id, kind, capability_id, started_at, active_seconds, waiting_seconds)
     VALUES (?, ?, ?, datetime('now', '-1 days'), ?, ?)`
  ).run('human:kanav', 'clerical', 'combo:transfer', HOUR / 2, HOUR / 2);

  const loop = loopView(db);
  db.close();

  expect(loop.empty).toBe(false);
  expect(loop.attention.interventions).toBe(2);
  const row = loop.attention.reducible.find(r => r.capability === 'Data transfer');
  expect(row?.hours).toBe(2);
  expect(row?.capability_id).toBe('combo:transfer');
  // One month of records is one point on the line, not twelve invented ones.
  expect(loop.roi.monthly_hours.length).toBeGreaterThanOrEqual(1);
  expect(loop.roi.monthly_hours.at(-1)?.hours).toBe(2);
});

test('judgment is reported as a keeper and never priced as an opportunity', () => {
  const db = makeGraph({
    capabilities: [{ id: 'combo:review', name: 'Architecture review', category: 'combo' }],
  });
  for (let i = 0; i < 3; i++) {
    db.prepare(
      `INSERT INTO human_intervention (actor_id, kind, capability_id, started_at, active_seconds, waiting_seconds)
       VALUES (?, 'judgment', ?, datetime('now', '-3 days'), ?, 0)`
    ).run('human:kanav', 'combo:review', HOUR);
  }

  const loop = loopView(db);
  db.close();

  expect(loop.attention.keepers.map(k => k.capability)).toContain('Architecture review');
  expect(loop.attention.reducible).toEqual([]);
  expect(loop.opportunities.map(o => o.capability)).not.toContain('Architecture review');
});
