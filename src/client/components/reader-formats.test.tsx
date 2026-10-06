/**
 * Figures as an English reader writes them, whatever the browser's region.
 *
 * A "$" pasted onto the browser's own grouping read "$9.600" in Berlin. A
 * payback of "0.3 months" is a figure nobody says aloud, "Jan 11h" read as the
 * eleventh of January, and the one ISO date on Time & cost sat beside "Oct 15".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { useAmbitStore } from '../store/ambitStore';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';

/** `renderToStaticMarkup` reads zustand's initial state, so both halves are set. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  vi.unstubAllGlobals();
  seed({ loop: null, loopSource: null, loopEmpty: false });
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

function demo() {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  return text(renderToStaticMarkup(<LoopDashboard />));
}

test('dollars keep US grouping on a German browser', () => {
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });
  const said = demo();
  expect(said).toContain('worth $9,600.');
  expect(said).toContain('$12.40 of $20 spent.');
  expect(said).not.toMatch(/\$\d+\.\d{3}\b/);
});

test('a payback under a month is said in days', () => {
  const said = demo();
  // The demo's soonest is 0.3 months.
  expect(said).toContain('Pays back in 9 days and recovers $248 a month.');
  expect(said).not.toMatch(/0\.\d (mo|months)\b/);
});

test('the hours figure keeps the month apart from the hours', () => {
  const said = demo();
  expect(said).toContain('Jan · 11h');
  expect(said).not.toContain('Jan 11h');
});

test('the since line names a day the way the rest of the page does', () => {
  const said = demo();
  expect(said).toMatch(/Since Sep 8(, \d{4})?:/);
  expect(said).not.toContain('2026-09-08');
});

test('a British browser reads its own day order', () => {
  vi.stubGlobal('navigator', { language: 'en-GB', languages: ['en-GB'] });
  expect(demo()).toMatch(/Since 8 Sept?(,? \d{4})?:/);
});
