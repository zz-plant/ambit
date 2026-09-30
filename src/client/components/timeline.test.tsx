/**
 * The frontier through time, on the page.
 *
 * The timeline is the way in: without it the ledger's history is a terminal
 * command. And the page must tell one date at a time: a map drawn as Monday
 * left it under a header counting today, beside a panel naming today's
 * grants, would be three dates on one screen with nothing saying so.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import type { FrontierHistoryResponse, FrontierTick } from '../../shared/api';
import App from '../App';
import { useAmbitStore } from '../store/ambitStore';
import type { Connection, Item } from '../utils/configImporter';
import AppDeck from './AppDeck';
import CivTree from './CivTree';
import { itemsAsOf, tickSecond } from './civ/history';
import { Timeline } from './civ/Timeline';
import NodeDetailPanel from './NodeDetailPanel';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

/** Today: version control reached, proven and granted; CI reached after it. */
const vc: Item = {
  id: 'combo:vc',
  name: 'Version Control',
  type: 'possibility',
  status: 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: {
    domain: 'devops',
    era: 1,
    eraName: 'Foundation',
    state: 'unlocked',
    setupSeconds: 600,
    next: false,
    lifecycle: 'verified',
    authority: { execute: 'autonomous' },
    providers: ['mcp:git'],
  },
};
const ci: Item = {
  ...vc,
  id: 'combo:ci',
  name: 'Continuous Integration',
  meta: { ...vc.meta, era: 2, eraName: 'Automation', providers: undefined },
};
const EDGES: Connection[] = [{ from: vc.id, to: ci.id, type: 'hard-dep', kind: 'requires' }];

/** Monday held version control, failing its check, and no CI at all. */
const MONDAY: FrontierTick = {
  at: '2026-09-21 09:00:00',
  states: { 'combo:vc': 'unlocked' },
  kinds: { 'combo:vc': 'capability' },
  lifecycles: { 'combo:vc': 'broken' },
  moved: 'first observation, reached 1',
};
const FRIDAY: FrontierTick = {
  at: '2026-09-25 17:00:00',
  states: { 'combo:vc': 'unlocked', 'combo:ci': 'unlocked' },
  kinds: { 'combo:vc': 'capability', 'combo:ci': 'capability' },
  lifecycles: { 'combo:vc': 'verified', 'combo:ci': 'configured' },
  moved: 'reached 1 to 2, verified 0 to 1',
};
const HISTORY: FrontierHistoryResponse = { ticks: [MONDAY, FRIDAY], movedSinceLast: null };

/** Both halves of the store, since a server render reads the initial state. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

beforeAll(() => {
  const mediaQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    localStorage: { getItem: () => '1', setItem() {} },
    window: {
      location: { search: '?view=tree&guide=off' },
      matchMedia: () => mediaQuery,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
    },
  });
});

afterEach(() => {
  seed({
    items: [],
    connections: [],
    selectedItem: null,
    selectedEra: null,
    showDetailPanel: false,
    history: null,
    historyAt: null,
    historyOpen: false,
    attentionInterventions: {},
    backend: 'unknown',
  });
});

afterAll(() => {
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
});

test('with two observations the timeline is offered, its playhead on now', () => {
  const html = renderToStaticMarkup(<Timeline history={HISTORY} at={null} onScrub={() => {}} />);
  // A range input: it drags, and the arrow keys, Home and End step it.
  expect(html).toContain('type="range"');
  expect(html).toContain('min="0"');
  expect(html).toContain('max="2"');
  expect(html).toContain('value="2"');
  expect(html).toContain('aria-valuetext="Now"');
  // One tick per observation, and the live end.
  expect(html.match(/<li /g)).toHaveLength(3);
  expect(text(html)).toContain('Nothing has moved since Sep 25.');
  expect(html).not.toContain('Back to now');
});

test('scrubbed to a tick, it says what moved then, and offers the way back', () => {
  const html = renderToStaticMarkup(
    <Timeline history={HISTORY} at={tickSecond(MONDAY)} onScrub={() => {}} />
  );
  expect(html).toContain('value="0"');
  expect(html).toContain('aria-valuetext="Sep 21, 2026, 09:00 UTC"');
  expect(text(html)).toContain('Sep 21: first observation, reached 1.');
  expect(html).toContain('Back to now');
});

test('with fewer than two observations there is no strip at all', () => {
  // One is a point with nothing to scrub; a strip saying so took a row under
  // every first look at the map.
  for (const ticks of [[FRIDAY], []]) {
    const html = renderToStaticMarkup(
      <Timeline history={{ ticks, movedSinceLast: null }} at={null} onScrub={() => {}} />
    );
    expect(html).toBe('');
  }
});

test('the map as Monday left it draws what Monday held, and none of what no snapshot stores', () => {
  seed({ items: [vc, ci], connections: EDGES, attentionInterventions: { 'combo:vc': 4 } });
  const map = (items: Item[], asOf?: string) =>
    renderToStaticMarkup(
      <CivTree
        items={items}
        connections={EDGES}
        selectedId={null}
        hoveredId={null}
        onSelect={() => {}}
        onHover={() => {}}
        asOf={asOf}
      />
    );

  const live = map([vc, ci]);
  expect(live).toContain('Continuous Integration');
  expect(live).toContain('civ-range');

  const past = map(itemsAsOf([vc, ci], EDGES, MONDAY), 'Sep 21, 2026, 09:00 UTC');
  expect(past).toContain('aria-label="Version Control, possibility"');
  expect(past).not.toContain('Continuous Integration');
  // The headline, with its week and its simulations, is today's.
  expect(past).not.toContain('civ-range');
  // Attention and grants are not in a snapshot, and the lens says why it is off.
  expect(past).toContain('records states and checks, not attention or authority');
});

test('the panel as Monday left it says so, and offers nothing drawn on today', () => {
  seed({
    items: [vc, ci],
    connections: EDGES,
    selectedItem: vc.id,
    showDetailPanel: true,
    backend: 'live',
  });
  const live = renderToStaticMarkup(<NodeDetailPanel />);
  expect(live).toContain('Simulate an outage');
  expect(text(live)).toContain('Acts without asking');

  const past = renderToStaticMarkup(
    <NodeDetailPanel items={itemsAsOf([vc, ci], EDGES, MONDAY)} asOf="Sep 21, 2026, 09:00 UTC" />
  );
  expect(text(past)).toContain('As of Sep 21, 2026, 09:00 UTC');
  // Monday's check, and none of today's grants or simulations.
  expect(text(past)).toContain('Configured, but not working');
  expect(past).not.toContain('Simulate an outage');
  expect(text(past)).not.toContain('Acts without asking');
});

const deck = (props: Partial<Parameters<typeof AppDeck>[0]> = {}) =>
  renderToStaticMarkup(
    <AppDeck
      view="tree"
      counts={{ verified: 1, unproven: 0, failing: 0, next: 1, blocked: 1 }}
      entries={null}
      connected={false}
      draftCount={0}
      spotlight={null}
      onSpotlight={() => {}}
      onSearch={() => {}}
      onShowView={() => {}}
      onShare={() => {}}
      onShowProposals={() => {}}
      onShowDocs={() => {}}
      {...props}
    />
  );

test('the header says whose day its counts are, and draws no split nobody measured', () => {
  expect(text(deck({ asOf: 'Sep 21' }))).toContain('as of Sep 21');
  expect(text(deck())).not.toContain('as of');

  // An observation from before lifecycles were recorded: reached is one count.
  const unsplit = text(
    deck({ counts: { verified: 0, unproven: 0, failing: 0, next: 1, blocked: 1, reached: 3 } })
  );
  expect(unsplit).toMatch(/3\s*reached/);
  expect(unsplit).not.toMatch(/verified/);
  expect(unsplit).not.toMatch(/unproven/);
});

test('the page tells one date: the timeline under the map, the header, the panel and the ladder', () => {
  seed({
    items: [vc, ci],
    connections: EDGES,
    history: HISTORY,
    historyAt: tickSecond(MONDAY),
    selectedItem: vc.id,
    showDetailPanel: true,
  });
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('app-scene--timeline');
  expect(text(html)).toContain('Sep 21: first observation, reached 1.');
  expect(text(html)).toContain('as of Sep 21');
  expect(text(html)).toContain('As of Sep 21, 2026, 09:00 UTC');

  // An era's ladder, opened from its header, counts the header's day: on
  // Monday version control was failing its check, so the era had none reached.
  seed({ selectedItem: null, selectedEra: 1 });
  const ladder = text(renderToStaticMarkup(<App />));
  expect(ladder).toContain('0 of 1 reached · 1 failing');
  expect(ladder).toContain('As of Sep 21, 2026, 09:00 UTC, as that observation recorded it.');

  // At now, the page is today's everywhere.
  seed({ historyAt: null });
  const now = text(renderToStaticMarkup(<App />));
  expect(now).toContain('1 of 1 reached');
  expect(now).not.toContain('As of');
  seed({ selectedEra: null, selectedItem: vc.id });
  // At now the strip waits to be opened: a band saying nothing has moved is a
  // band of the screen spent on nothing.
  expect(renderToStaticMarkup(<App />)).not.toContain('app-scene--timeline');
  seed({ historyOpen: true });
  const nowNode = text(renderToStaticMarkup(<App />));
  expect(nowNode).toContain('Nothing has moved since Sep 25.');
  expect(nowNode).not.toContain('as of');
});
