/**
 * The pace of a budget, and the one rule for when its period has run out.
 *
 * Three readers used to decide this apart. The reset counted a month as thirty
 * days, the gate kept its own table of the same numbers, and the loop page had
 * no rule at all: it drew whatever was stored as spent, so a period that had
 * turned over showed a figure the gate had already stopped counting. These hold
 * the rule where all three read it, and the forecast the page draws from it.
 */
import { describe, expect, it } from 'vitest';
import { canExecute, recordSpend } from './assurance.ts';
import {
  budgetReport,
  budgetStanding,
  forecastSpend,
  PERIOD_DAYS,
  periodElapsed,
  periodLength,
  setBudget,
} from './budgets.ts';
import { makeGraph } from './testing/graph.ts';

const graph = () =>
  makeGraph({
    capabilities: [
      { id: 'combo:deploy', name: 'Deploy', category: 'combo' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
  });

/** A budget of `amount` on Deploy, spent so far and started `daysAgo` days back. */
function budgetOf(
  db: ReturnType<typeof graph>,
  opts: { amount?: string; period?: string; spentCents?: number; daysAgo?: number | null }
) {
  setBudget(db, {
    capability: 'combo:deploy',
    amount: opts.amount ?? '$20',
    period: opts.period,
    person: 'kanav',
  });
  const spent = opts.spentCents ?? 0;
  if (opts.daysAgo == null) {
    db.prepare('UPDATE budgets SET spent_cents = ?, period_start = NULL').run(spent);
  } else {
    db.prepare("UPDATE budgets SET spent_cents = ?, period_start = datetime('now', ?)").run(
      spent,
      `-${opts.daysAgo} days`
    );
  }
  return db.prepare('SELECT budget_cents, spent_cents, period, period_start FROM budgets').get<{
    budget_cents: number;
    spent_cents: number;
    period: string;
    period_start: string | null;
  }>()!;
}

describe('the pace of a period', () => {
  const month = { period: 'month', periodStart: '2026-09-01 00:00:00' };

  it('lands 60% of a ceiling after half a period at 120%, and names the day it is reached', () => {
    // Twelve dollars of twenty, fifteen days into a thirty-day month: the pace
    // is 80 cents a day, so twenty dollars is twenty-five days in.
    expect(
      forecastSpend({ ...month, spentCents: 1200, budgetCents: 2000, elapsedDays: 15 })
    ).toEqual({ landsCents: 2400, hitsCeilingOn: '2026-09-26' });
  });

  it('says nothing while nothing is spent', () => {
    expect(
      forecastSpend({ ...month, spentCents: 0, budgetCents: 2000, elapsedDays: 15 })
    ).toBeNull();
  });

  it('says nothing before enough of the period has run for there to be a pace', () => {
    // Fifty cents an hour into a month is a rate of thirty-six dollars, and a
    // claim about nothing: the pace needs a twentieth of the period behind it.
    expect(
      forecastSpend({ ...month, spentCents: 50, budgetCents: 2000, elapsedDays: 0.04 })
    ).toBeNull();
    expect(
      forecastSpend({ ...month, spentCents: 100, budgetCents: 2000, elapsedDays: 1.49 })
    ).toBeNull();
    expect(
      forecastSpend({ ...month, spentCents: 100, budgetCents: 2000, elapsedDays: 1.5 })
    ).toMatchObject({ landsCents: 2000 });
  });

  it('names no day when the pace stays inside the ceiling', () => {
    const inside = forecastSpend({ ...month, spentCents: 500, budgetCents: 2000, elapsedDays: 15 });
    expect(inside).toEqual({ landsCents: 1000 });
    expect(inside).not.toHaveProperty('hitsCeilingOn');
  });

  it('names no day once the ceiling is reached, because a day already gone would answer wrongly', () => {
    const reached = forecastSpend({
      ...month,
      spentCents: 2000,
      budgetCents: 2000,
      elapsedDays: 15,
    });
    expect(reached).toEqual({ landsCents: 4000 });
    expect(reached).not.toHaveProperty('hitsCeilingOn');
  });

  it('reads a period at its own length, not a month', () => {
    // Three and a half days into a week is half of it.
    expect(
      forecastSpend({
        period: 'week',
        periodStart: '2026-09-01 00:00:00',
        spentCents: 400,
        budgetCents: 1000,
        elapsedDays: 3.5,
      })
    ).toEqual({ landsCents: 800 });
  });

  it('reads a stored ISO timestamp as well as the space form SQLite writes', () => {
    const spaced = forecastSpend({
      ...month,
      spentCents: 1200,
      budgetCents: 2000,
      elapsedDays: 15,
    });
    const iso = forecastSpend({
      period: 'month',
      periodStart: '2026-09-01T00:00:00Z',
      spentCents: 1200,
      budgetCents: 2000,
      elapsedDays: 15,
    });
    expect(iso).toEqual(spaced);
  });

  it('reads an ISO start with no zone as UTC, as SQLite does, in whatever zone the process runs', () => {
    // Read as local time in Los Angeles, a start at 20:00 moved seven hours
    // later and the day the ceiling is reached moved with it.
    const zone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(new Date('2026-09-01T20:00:00').getTimezoneOffset()).not.toBe(0);
      const pace = { period: 'month', spentCents: 1200, budgetCents: 2000, elapsedDays: 15 };
      const spaced = forecastSpend({ ...pace, periodStart: '2026-09-01 20:00:00' });
      const iso = forecastSpend({ ...pace, periodStart: '2026-09-01T20:00:00' });
      expect(spaced?.hitsCeilingOn).toBe('2026-09-26');
      expect(iso).toEqual(spaced);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe('one rule for a period that has run out', () => {
  it('has one table of lengths, and a period nobody named is a month', () => {
    for (const [name, days] of Object.entries(PERIOD_DAYS)) expect(periodLength(name)).toBe(days);
    expect(periodLength(undefined)).toBe(30);
    expect(periodLength(null)).toBe(30);
    expect(periodLength('')).toBe(30);
    expect(periodLength('fortnight')).toBe(30);
  });

  it('holds once a period has run its length, and never without a start', () => {
    const db = graph();
    expect(periodElapsed(db, budgetOf(db, { daysAgo: 40 }))).toBe(true);
    expect(periodElapsed(db, budgetOf(db, { daysAgo: 10 }))).toBe(false);
    expect(periodElapsed(db, budgetOf(db, { daysAgo: null }))).toBe(false);
    // The week is a week: eight days is over and six is not.
    expect(periodElapsed(db, budgetOf(db, { period: 'week', daysAgo: 8 }))).toBe(true);
    expect(periodElapsed(db, budgetOf(db, { period: 'week', daysAgo: 6 }))).toBe(false);
    db.close();
  });
});

describe('what a budget means right now, read without writing', () => {
  it('keeps the spend, the start and the end of a period that is running, and paces it', () => {
    const db = graph();
    const row = budgetOf(db, { spentCents: 1200, daysAgo: 15 });
    const now = budgetStanding(db, row);
    expect(now.spentCents).toBe(1200);
    expect(now.periodStart).toBe(row.period_start);
    // Thirty days after the start, on the day, whatever time of day it began.
    expect(now.periodEndsOn).toBe(
      new Date(Date.parse(`${row.period_start?.replace(' ', 'T')}Z`) + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    );
    expect(now.forecast?.landsCents).toBe(2400);
    expect(now.forecast?.hitsCeilingOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    db.close();
  });

  it('reads a period that has run out as spent-nothing with no start, as the gate reads it', () => {
    const db = graph();
    const now = budgetStanding(db, budgetOf(db, { spentCents: 2000, daysAgo: 40 }));
    expect(now).toEqual({ spentCents: 0, periodStart: null, periodEndsOn: null, forecast: null });
    db.close();
  });

  it('treats a start the clock cannot read as no start', () => {
    const db = graph();
    const row = budgetOf(db, { spentCents: 1200, daysAgo: 15 });
    const now = budgetStanding(db, { ...row, period_start: 'sometime last month' });
    expect(now).toEqual({
      spentCents: 1200,
      periodStart: null,
      periodEndsOn: null,
      forecast: null,
    });
    db.close();
  });

  it('draws no pace for a budget whose clock was never started', () => {
    const db = graph();
    // A budget declared in the config is seeded with no start, until a read of
    // `ambit budget` starts one.
    const now = budgetStanding(db, budgetOf(db, { spentCents: 1200, daysAgo: null }));
    expect(now).toEqual({
      spentCents: 1200,
      periodStart: null,
      periodEndsOn: null,
      forecast: null,
    });
    db.close();
  });
});

describe('recording spend in a period that has run out', () => {
  it('starts the next period, so what it reports is what the gate, the page and the report read', () => {
    // `recordSpend` added onto the old period's total: with 1500 of 2000
    // spent a period ago, a spend of 1900 stored 3400 and said the budget was
    // spent, while the gate, reading the same rule, had all 2000 left.
    const db = graph();
    budgetOf(db, { amount: '$20', spentCents: 1500, daysAgo: 40 });
    const spend = recordSpend(db, 'combo:deploy', 'execute', '', 1900) as {
      recorded: boolean;
      remaining_cents: number;
      note?: string;
    };
    const row = db
      .prepare('SELECT budget_cents, spent_cents, period, period_start FROM budgets')
      .get<{
        budget_cents: number;
        spent_cents: number;
        period: string;
        period_start: string;
      }>()!;

    expect(spend).toMatchObject({ recorded: true, remaining_cents: 100 });
    expect(spend.note).toBeUndefined();
    expect(row.spent_cents).toBe(1900);
    expect(periodElapsed(db, row)).toBe(false);
    expect(canExecute(db, { capability: 'combo:deploy' }).remaining_budget_cents).toBe(100);
    expect(budgetStanding(db, row).spentCents).toBe(1900);
    expect(budgetReport(db).budgets[0]).toMatchObject({ spent: '$19.00', remaining: '$1.00' });
    // Rule 13: spending never writes a budget row, it only updates one.
    expect(db.prepare('SELECT COUNT(*) AS n FROM budgets').get<{ n: number }>()?.n).toBe(1);
    db.close();
  });

  it('starts the next period even when the last one spent nothing', () => {
    const db = graph();
    budgetOf(db, { amount: '$20', spentCents: 0, daysAgo: 40 });
    recordSpend(db, 'combo:deploy', 'execute', '', 700);
    const row = db
      .prepare('SELECT budget_cents, spent_cents, period, period_start FROM budgets')
      .get<{
        budget_cents: number;
        spent_cents: number;
        period: string;
        period_start: string;
      }>()!;
    expect(periodElapsed(db, row)).toBe(false);
    expect(canExecute(db, { capability: 'combo:deploy' }).remaining_budget_cents).toBe(1300);
    db.close();
  });

  it('adds to the period that is still running, as before', () => {
    const db = graph();
    budgetOf(db, { amount: '$20', spentCents: 1500, daysAgo: 10 });
    const spend = recordSpend(db, 'combo:deploy', 'execute', '', 400);
    const row = db.prepare('SELECT spent_cents FROM budgets').get<{ spent_cents: number }>()!;
    db.close();

    expect(spend).toMatchObject({ recorded: true, remaining_cents: 100 });
    expect(row.spent_cents).toBe(1900);
  });
});
