/**
 * Where a budget's marks sit on its bar, and that the demo forecasts what the
 * engine would.
 *
 * The bar runs to the ceiling and only as far past it as the pace goes, so a
 * period that will overshoot shows how far, and one that will not shows the
 * ceiling at the end. The demo's snapshot is written by hand, which is how its
 * forecast could drift from the rule the engine computes it by; the last test
 * holds the two together.
 */
import { expect, test } from 'vitest';
import { forecastSpend } from '../../engine/budgets';
import type { LoopAuthority } from '../../shared/api';
import { budgetBar } from './budgetBar';
import { demoSnapshot } from './demoSnapshot';

const budget = (over: Partial<LoopAuthority['budgets'][number]>) => ({
  capability: 'Hosted Inference',
  action: 'execute',
  ceiling_dollars: 20,
  spent_dollars: 0,
  period: 'month',
  ...over,
});

test('the bar runs to the ceiling when nothing goes past it', () => {
  const bar = budgetBar(budget({ spent_dollars: 12.4 }));
  expect(bar).toEqual({ fill: 0.62, ceiling: 1, lands: undefined, clipped: false });
});

test('a pace that lands inside the ceiling puts the tick before the rule', () => {
  const bar = budgetBar(budget({ spent_dollars: 5, forecast: { lands_dollars: 10 } }));
  expect(bar.ceiling).toBe(1);
  expect(bar.fill).toBe(0.25);
  expect(bar.lands).toBe(0.5);
});

test('a pace that lands past the ceiling runs the bar on, so the distance shows', () => {
  const bar = budgetBar(
    budget({ spent_dollars: 12, forecast: { lands_dollars: 24, hits_ceiling_on: '2026-10-09' } })
  );
  expect(bar.lands).toBe(1);
  expect(bar.ceiling).toBeCloseTo(20 / 24);
  expect(bar.fill).toBe(0.5);
  expect(bar.clipped).toBe(false);
  // The tick is the only mark past the rule.
  expect(bar.lands as number).toBeGreaterThan(bar.ceiling);
});

test('a pace far past the ceiling stops at twice it and pins the tick to the end', () => {
  const bar = budgetBar(budget({ spent_dollars: 8, forecast: { lands_dollars: 100 } }));
  expect(bar.ceiling).toBe(0.5);
  expect(bar.lands).toBe(1);
  expect(bar.clipped).toBe(true);
});

test('a spend already past the ceiling widens the bar to hold it', () => {
  const bar = budgetBar(budget({ spent_dollars: 25 }));
  expect(bar.fill).toBe(1);
  expect(bar.ceiling).toBe(0.8);
  expect(bar.lands).toBeUndefined();
});

test('a ceiling that is not a positive amount draws an empty bar and divides by nothing', () => {
  for (const ceiling_dollars of [0, -5, Number.NaN]) {
    const bar = budgetBar(budget({ ceiling_dollars, spent_dollars: 3 }));
    expect(bar).toEqual({ fill: 0, ceiling: 1, clipped: false });
  }
});

test('the demo forecasts what the engine would from its own figures', () => {
  const [demo] = demoSnapshot().authority.budgets;
  const start = demo.period_start as string;
  const elapsedDays = (Date.now() - Date.parse(`${start.replace(' ', 'T')}Z`)) / 86_400_000;
  const engine = forecastSpend({
    spentCents: Math.round(demo.spent_dollars * 100),
    budgetCents: Math.round(demo.ceiling_dollars * 100),
    period: demo.period,
    periodStart: start,
    elapsedDays,
  });

  expect(engine?.landsCents).toBe(Math.round((demo.forecast?.lands_dollars ?? 0) * 100));
  // The sample is dated from the day it is opened, so the engine's day and the
  // sample's are the same to within the time of day the page was opened.
  const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
  expect(
    Math.abs(noon(engine?.hitsCeilingOn as string) - noon(demo.forecast?.hits_ceiling_on as string))
  ).toBeLessThanOrEqual(86_400_000);
  // And it ends thirty days after it began, as a month does.
  expect(noon(demo.period_ends_on as string) - noon(start.slice(0, 10))).toBe(30 * 86_400_000);
});
