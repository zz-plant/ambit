/**
 * A budget against its ceiling, and what the page will not draw from nothing.
 *
 * The bar used to be a fill and a sentence: how much of the ceiling was spent,
 * with no answer to the question a person delegating spend actually has, which
 * is whether it lasts the period. The ceiling is on the bar now, with a hollow
 * ring where the period lands at the pace so far, and the day the ceiling is
 * reached when the ring is past it. A budget with nothing recorded against it
 * has no pace, so it draws no ring and no day, and the page says what records
 * spend instead of drawing a forecast from zero.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LoopAuthority } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';

type Budget = LoopAuthority['budgets'][number];

/** `renderToStaticMarkup` reads zustand's initial state, so both halves are set. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

// The budgets below are dated 2026, and a day in another year carries its
// year, so the clock is held inside the period they describe.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-28T12:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
  seed({ loop: null, loopSource: null, loopEmpty: false });
});

const budget = (over: Partial<Budget> = {}): Budget => ({
  capability: 'Hosted Inference',
  action: 'execute',
  ceiling_dollars: 20,
  spent_dollars: 0,
  period: 'month',
  ...over,
});

/** The page with these budgets, as the ledger served them. */
function page(...budgets: Budget[]) {
  const snapshot = demoSnapshot();
  seed({
    loop: { ...snapshot, authority: { ...snapshot.authority, budgets } },
    loopSource: 'ledger',
    loopEmpty: false,
  });
  return renderToStaticMarkup(<LoopDashboard />);
}

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const leftOf = (html: string, mark: string) =>
  Number(html.match(new RegExp(`fig-budget-${mark}" style="left:([\\d.]+)%`))?.[1]);

/** Sixty percent of the ceiling spent after half the period. */
const pacing = budget({
  spent_dollars: 12,
  period_start: '2026-09-14 09:00:00',
  period_ends_on: '2026-10-14',
  forecast: { lands_dollars: 24, hits_ceiling_on: '2026-10-09' },
});

test('a budget at 60% after half the period draws its tick past the ceiling, and the day it is reached', () => {
  const html = page(pacing);

  expect(html).toContain('fig-budget-tick');
  expect(leftOf(html, 'tick')).toBeGreaterThan(leftOf(html, 'ceiling'));
  // The region the tick sits in is marked as over.
  expect(html).toContain('fig-budget-over');
  expect(text(html)).toContain(
    '$12 of $20 spent. At this pace the period lands at $24 and the ceiling is reached on Oct 9.'
  );
});

test('past the ceiling a spend is refused until the period turns over, which is what the gate answers', () => {
  // A spend that does not fit is a refusal from `canExecute`, not a question
  // put to a person, so the page does not promise one.
  const said = text(page(pacing));
  expect(said).toContain('After that a spend is refused until the period turns over on Oct 14.');
  expect(said).not.toContain('asks you again');
});

test('a budget with no recorded spend draws no tick and no day, and says what records spend', () => {
  const html = page(budget({ period_start: '2026-09-14 09:00:00', period_ends_on: '2026-10-14' }));
  const said = text(html);

  expect(html).not.toContain('fig-budget-tick');
  expect(html).not.toContain('fig-budget-over');
  expect(said).not.toContain('is reached on');
  expect(said).toContain('No spend recorded, so there is no pace to draw.');
  expect(said).toContain('recorded as a spend on Hosted Inference when it ends');
  expect(said).toContain('ambit economics price');
  expect(said).toContain('Nothing else records spend on its own; an integration calls recordSpend');
});

test('the note about what records spend is drawn once, and only while a budget needs it', () => {
  const both = text(page(budget(), budget({ capability: 'Search', spent_dollars: 4 })));
  expect(both.match(/Nothing else records spend on its own/g)).toHaveLength(1);
  expect(text(page(budget({ spent_dollars: 4 })))).not.toContain('records spend on its own');
});

test('a pace that stays inside the ceiling names no day', () => {
  const said = text(
    page(
      budget({ spent_dollars: 5, period_ends_on: '2026-10-14', forecast: { lands_dollars: 10 } })
    )
  );
  expect(said).toContain('At this pace the period lands at $10, inside the ceiling.');
  expect(said).not.toContain('is reached on');
});

test('a spend too early in the period for a pace says so, and draws no tick', () => {
  const html = page(budget({ spent_dollars: 1, period_start: '2026-09-14 09:00:00' }));
  expect(text(html)).toContain('Too early in the period to tell a pace.');
  expect(html).not.toContain('fig-budget-tick');
});

test('a ceiling that has been reached says so, and draws no forecast', () => {
  const html = page(budget({ spent_dollars: 20, period_ends_on: '2026-10-14' }));
  expect(text(html)).toContain(
    'The ceiling is reached, so a spend is refused until the period turns over on Oct 14.'
  );
  expect(html).not.toContain('fig-budget-tick');
});

test('a day that will not read is left out of the sentence, never printed', () => {
  const said = text(
    page(
      budget({
        spent_dollars: 12,
        period_ends_on: 'not a day',
        forecast: { lands_dollars: 24, hits_ceiling_on: 'not a day' },
      })
    )
  );
  expect(said).toContain('At this pace the period lands at $24, past the ceiling.');
  expect(said).not.toContain('Invalid Date');
  expect(said).not.toContain('is reached on');
});

test('a server that predates the forecast is drawn from what it sent', () => {
  // No period_start, no period_ends_on, no forecast: the older shape.
  const html = page(budget({ spent_dollars: 12.4 }));
  for (const placeholder of ['undefined', 'NaN', 'Invalid Date', 'null']) {
    expect(html, placeholder).not.toContain(placeholder);
  }
  expect(text(html)).toContain('$12.40 of $20 spent.');
  expect(html).toContain('fig-budget-fill');
  expect(html).not.toContain('fig-budget-tick');
});

test('the demo shows a forecast, with the day the ceiling is reached', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).toMatch(
    /At this pace the period lands at \$24\.80 and the ceiling is reached on [A-Z][a-z]{2} \d{1,2}\./
  );
  expect(said).toMatch(/until the period turns over on [A-Z][a-z]{2} \d{1,2}\./);
});
