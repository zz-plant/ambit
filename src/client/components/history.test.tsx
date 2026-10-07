/**
 * A row is the report: how a check has gone, not only whether it passed.
 *
 * My Setup lists entries, and an entry has no check of its own, so its row shows
 * the runs of the worst node it provides. These hold what that strip has to be:
 * drawn for a row with runs and for no other, honest about whose runs they are,
 * legible without colour, and never a way to run a check from the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { CHECK_HISTORY_RUNS, type CheckRun } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import type { Item } from '../utils/configImporter';
import NodeDetailPanel from './NodeDetailPanel';
import SetupView from './SetupView';

const run = (id: number, passed: boolean): CheckRun => ({ id, passed });

/** A tree node: it carries an era, which is what makes it a node and not an entry. */
const node = (id: string, lifecycle: string, history?: CheckRun[]): Item => ({
  id: `combo:${id}`,
  name: id,
  type: 'possibility',
  status: 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { era: 1, state: 'unlocked', next: false, lifecycle, history },
});

/** A config entry: no era, and no lifecycle of its own. */
const entry = (name: string): Item => ({
  id: `mcp:${name}`,
  name,
  type: 'mcp-server',
  status: 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'devops', lifecycle: 'unknown' },
});

const provides = (server: Item, ...nodes: Item[]) =>
  nodes.map(n => ({ from: server.id, to: n.id, type: 'hard-dep', kind: 'provides' }));

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({ items: [], connections: [], selectedItem: null, searchQuery: '', backend: 'unknown' });
});

const rows = (html: string) => html.split('class="setup-row ').slice(1);
/** The markup of one row. A row that is not there is an error, so no `not.toContain` passes on nothing. */
function rowOf(html: string, name: string): string {
  const row = rows(html).find(r => r.includes(`<span>${name}</span>`));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

test('a row with runs draws its strip, and a row with none draws none', () => {
  const steady = node('steady', 'verified', [run(1, true), run(2, true)]);
  const unchecked = node('unchecked', 'configured');
  const git = entry('git');
  const memory = entry('memory');
  seed({
    items: [git, memory, steady, unchecked],
    connections: [...provides(git, steady), ...provides(memory, unchecked)],
  });
  const html = renderToStaticMarkup(<SetupView onShow={() => {}} />);

  expect(rowOf(html, 'git')).toContain('fig-history');
  // Nothing recorded is nothing drawn (rule 16): not fourteen empty slots, which
  // would say a check exists that has never run.
  expect(rowOf(html, 'memory')).not.toContain('fig-history');
  expect(rowOf(html, 'memory')).not.toContain('fig-history-bar');
});

test('the strip is a fixed window: runs at the new end, a faint tick for the rest', () => {
  const n = node('two-runs', 'degraded', [run(4, false), run(5, true)]);
  const git = entry('git');
  seed({ items: [git, n], connections: provides(git, n) });
  const row = rowOf(renderToStaticMarkup(<SetupView onShow={() => {}} />), 'git');

  expect(count(row, 'fig-history-bar ')).toBe(CHECK_HISTORY_RUNS);
  expect(count(row, 'fig-history-bar--none')).toBe(CHECK_HISTORY_RUNS - 2);
  // Oldest to newest: the failure came first, and the pass is the last bar.
  const bars = [...row.matchAll(/fig-history-bar--(none|pass|fail)/g)].map(m => m[1]);
  expect(bars.slice(-2)).toEqual(['fail', 'pass']);
  expect(bars.slice(0, -2).every(b => b === 'none')).toBe(true);
});

test('a row shows the worst node it provides, and says whose runs they are', () => {
  const broken = node('browser-automation', 'broken', [run(3, true), run(4, false)]);
  const fine = node('tool-protocol', 'reliable', [run(1, true), run(2, true), run(5, true)]);
  const playwright = entry('playwright');
  seed({
    items: [playwright, fine, broken],
    connections: provides(playwright, fine, broken),
  });
  const row = rowOf(renderToStaticMarkup(<SetupView onShow={() => {}} />), 'playwright');

  expect(row).toContain('aria-label="browser-automation: last 2 checks, oldest first');
  expect(row).toContain('The latest failed.');
  expect(row).not.toContain('tool-protocol: last');
  // The verdict and the strip agree: the row says failing, the strip ends red.
  expect(row).toContain('check failing');
});

test('a recovering row says so, with how its runs went, and offers nothing to repair', () => {
  // The last check passed after one that failed. "check passed" over a strip
  // with a red bar in it would read as fixed; "check failing" would be wrong.
  const mending = node('browser-automation', 'degraded', [run(3, false), run(4, true)]);
  const playwright = entry('playwright');
  seed({ items: [playwright, mending], connections: provides(playwright, mending) });
  const row = rowOf(renderToStaticMarkup(<SetupView onShow={() => {}} />), 'playwright');

  expect(row).toContain('>recovering<');
  expect(row).toContain('title="Recovering: browser-automation, 1 of the last 2 passed"');
  expect(row).not.toContain('check failing');
  expect(row).not.toContain('Copy ambit verify');
});

test('a failing row copies ambit verify for the failing node, where a reason link will go', () => {
  const broken = node('browser-automation', 'broken', [run(4, false)]);
  const fine = node('tool-protocol', 'reliable', [run(1, true), run(2, true)]);
  const playwright = entry('playwright');
  const git = entry('git');
  seed({
    items: [playwright, git, fine, broken],
    connections: [...provides(playwright, fine, broken), ...provides(git, fine)],
  });
  const html = renderToStaticMarkup(<SetupView onShow={() => {}} />);

  const failing = rowOf(html, 'playwright');
  expect(failing).toContain('Copy ambit verify');
  expect(failing).toContain('aria-label="Copy command ambit verify combo:browser-automation"');
  // A passing row offers nothing to copy: there is no reason to look for.
  expect(rowOf(html, 'git')).not.toContain('Copy ambit verify');
  // The page cannot run a check, so what it offers is text, not an action.
  expect(html).not.toMatch(/\/api\/verify/);
});

test('a failing row with no recorded runs still names the command, and draws no strip', () => {
  // A dropped graph, or an older engine: the lifecycle says failing and no
  // history came with it. The finding stands and the strip is absent.
  const broken = node('browser-automation', 'broken');
  const playwright = entry('playwright');
  seed({ items: [playwright, broken], connections: provides(playwright, broken) });
  const row = rowOf(renderToStaticMarkup(<SetupView onShow={() => {}} />), 'playwright');

  expect(row).toContain('check failing');
  expect(row).toContain('Copy ambit verify');
  expect(row).not.toContain('fig-history');
});

test('when nodes are failing, the strip is one of theirs, never a passing neighbour', () => {
  // The only failing node has no runs; its neighbour has. A strip of the
  // neighbour's green runs under "check failing" would say the opposite of the
  // row, so the row draws none.
  const failingNoRuns = node('a-failing', 'broken');
  const passing = node('b-passing', 'reliable', [run(1, true), run(2, true), run(3, true)]);
  const git = entry('git');
  seed({
    items: [git, failingNoRuns, passing],
    connections: provides(git, failingNoRuns, passing),
  });
  const row = rowOf(renderToStaticMarkup(<SetupView onShow={() => {}} />), 'git');

  expect(row).toContain('check failing');
  expect(row).not.toContain('fig-history');
});

test('the detail panel draws the same strip for the node itself', () => {
  const n = node('browser-automation', 'broken', [run(1, true), run(2, false)]);
  seed({ items: [n], selectedItem: n.id, showDetailPanel: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('sp-history');
  expect(html).toContain('Recent checks');
  expect(html).toContain('browser-automation: last 2 checks, oldest first: 1 passed, 1 failed');
  // The Details list is for facts nothing above has stated: the raw array is
  // not one of them.
  expect(html).not.toContain('History');
  expect(html).not.toContain('[object Object]');
});

test('a node with no runs has no strip in the panel', () => {
  const n = node('code-intelligence', 'configured');
  seed({ items: [n], selectedItem: n.id, showDetailPanel: true });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('sp-history');
});

test('a failure is taller than a pass, so it reads without colour', () => {
  // Some readers see red and green as one hue. The strip's second encoding is
  // height, which lives in the stylesheet; hold it there.
  const css = readFileSync(join(import.meta.dirname, '..', 'App.css'), 'utf8');
  const heightOf = (kind: string) =>
    Number(
      css.match(new RegExp(`\\.fig-history-bar--${kind}\\s*\\{[^}]*?height:\\s*(\\d+)px`))?.[1]
    );
  expect(heightOf('fail')).toBeGreaterThan(heightOf('pass'));
  expect(heightOf('pass')).toBeGreaterThan(heightOf('none'));
});
