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
import { setBudget } from './budgets.ts';
import { makeGraph } from './testing/graph.ts';
import { loopView } from './views.ts';

const HOUR = 3600;

/** A graph with one paid capability, a person to delegate from, and a $20 monthly budget. */
function budgeted(spentCents: number, daysAgo: number | null) {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:inference', name: 'Hosted Inference', category: 'combo' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
  });
  setBudget(db, { capability: 'combo:inference', amount: '$20', person: 'kanav' });
  if (daysAgo == null) {
    db.prepare('UPDATE budgets SET spent_cents = ?, period_start = NULL').run(spentCents);
  } else {
    db.prepare("UPDATE budgets SET spent_cents = ?, period_start = datetime('now', ?)").run(
      spentCents,
      `-${daysAgo} days`
    );
  }
  return db;
}

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

test('a budget is served with its period, the pace it is on, and the day the ceiling is reached', () => {
  // Sixty percent of the ceiling spent after half the period: at that pace the
  // period lands at 120%, so the ceiling is reached before it ends.
  const db = budgeted(1200, 15);
  const [budget] = loopView(db).authority.budgets;
  db.close();

  expect(budget).toMatchObject({
    capability: 'Hosted Inference',
    action: 'execute',
    ceiling_dollars: 20,
    spent_dollars: 12,
    period: 'month',
  });
  // Cents inside, dollars at the wire.
  expect(budget.forecast?.lands_dollars).toBe(24);
  expect(budget.period_start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(budget.period_ends_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Twenty-five days into a month that began fifteen days ago is ten days out.
  const hit = Date.parse(`${budget.forecast?.hits_ceiling_on}T12:00:00Z`);
  expect(Math.abs(hit - (Date.now() + 10 * 86_400_000))).toBeLessThan(1.5 * 86_400_000);
  // The period ends after the day the ceiling is reached.
  expect((budget.forecast?.hits_ceiling_on ?? '') < (budget.period_ends_on ?? '')).toBe(true);
});

test('a budget with nothing recorded as spent is served with no pace and no day', () => {
  // The state of every stock install: the ceiling is declared and nothing has
  // recorded a cent against it, so a tick would be drawn from zero.
  const db = budgeted(0, 15);
  const [budget] = loopView(db).authority.budgets;
  db.close();

  expect(budget.spent_dollars).toBe(0);
  expect(budget.period_start).not.toBeNull();
  expect(budget.forecast).toBeUndefined();
  expect(JSON.parse(JSON.stringify(budget))).not.toHaveProperty('forecast');
});

test('a budget whose clock was never started has a spend and no pace', () => {
  const db = budgeted(1200, null);
  const [budget] = loopView(db).authority.budgets;
  db.close();

  expect(budget.spent_dollars).toBe(12);
  expect(budget.period_start).toBeNull();
  expect(budget.period_ends_on).toBeNull();
  expect(budget.forecast).toBeUndefined();
});

test('a budget still inside its ceiling at the pace so far names no day', () => {
  const db = budgeted(500, 15);
  const [budget] = loopView(db).authority.budgets;
  db.close();

  expect(budget.forecast?.lands_dollars).toBe(10);
  expect(budget.forecast?.hits_ceiling_on).toBeUndefined();
});

test('a period that has run out reads as spent-nothing, the way the gate reads it', () => {
  // Nothing has rolled it, because reading a page must not: the stored figure
  // is twenty dollars and the gate has stopped counting it.
  const db = budgeted(2000, 40);
  const [budget] = loopView(db).authority.budgets;
  db.close();

  expect(budget.spent_dollars).toBe(0);
  expect(budget.period_start).toBeNull();
  expect(budget.forecast).toBeUndefined();
});
