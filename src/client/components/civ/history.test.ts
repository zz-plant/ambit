/**
 * The map as a past observation left it.
 *
 * A snapshot holds states, kinds and lifecycles and nothing else, so a past
 * map is today's tree redrawn from those. The two ways to get it wrong are
 * both quiet: draw a node the snapshot never held, or carry today's grants,
 * providers and check times into a day that recorded none of them.
 */
import { expect, test } from 'vitest';
import type { FrontierHistoryResponse, FrontierTick } from '../../../shared/api';
import type { Connection, Item } from '../../utils/configImporter';
import { dayOf, itemsAsOf, momentOf, tickAt, tickSecond, timelineSentence } from './history';

const node = (id: string, era: number, meta: Record<string, unknown>): Item => ({
  id,
  name: id.split(':')[1],
  type: 'possibility',
  status: meta.state === 'locked' ? 'specified' : 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'devops', era, eraName: `Era ${era}`, setupSeconds: 600, ...meta },
});

/** Today: everything reached, proven, granted, supplied and recently checked. */
const TODAY: Item[] = [
  node('combo:vc', 1, {
    state: 'unlocked',
    next: false,
    lifecycle: 'verified',
    authority: { execute: 'autonomous' },
    providers: ['mcp:git'],
    reliability: { passed: 3, total: 3 },
    lastChecked: '2026-09-28 10:00:00',
    daysSinceChange: 2,
    structure: ['physical'],
    devices: ['nuc'],
  }),
  node('combo:ci', 2, { state: 'unlocked', next: false, lifecycle: 'verified' }),
  node('combo:deploy', 3, { state: 'unlocked', next: false, lifecycle: 'configured' }),
];

const EDGES: Connection[] = [
  { from: 'combo:vc', to: 'combo:ci', type: 'hard-dep' },
  { from: 'combo:ci', to: 'combo:deploy', type: 'hard-dep' },
];

/** A Friday when version control's check was failing and deploy was not yet modelled. */
const FRIDAY: FrontierTick = {
  at: '2026-09-25 17:00:00',
  states: { 'combo:vc': 'unlocked', 'combo:ci': 'locked' },
  kinds: { 'combo:vc': 'capability', 'combo:ci': 'capability' },
  lifecycles: { 'combo:vc': 'broken', 'combo:ci': 'detected' },
  moved: 'reached 0 to 1, 1 went failing',
};

const MONDAY: FrontierTick = {
  ...FRIDAY,
  at: '2026-09-21 09:00:00',
  states: { 'combo:vc': 'locked', 'combo:ci': 'locked' },
  lifecycles: { 'combo:vc': 'detected', 'combo:ci': 'unknown' },
  moved: 'first observation, reached 0',
};

const HISTORY: FrontierHistoryResponse = { ticks: [MONDAY, FRIDAY], movedSinceLast: null };

test('a past map draws only what the observation held', () => {
  const past = itemsAsOf(TODAY, EDGES, FRIDAY);
  expect(past.map(i => i.id)).toEqual(['combo:vc', 'combo:ci']);
});

test('state and check are the observation’s, and nothing it did not record survives', () => {
  const vc = itemsAsOf(TODAY, EDGES, FRIDAY).find(i => i.id === 'combo:vc')!;
  expect(vc.status).toBe('built');
  expect(vc.meta).toEqual({
    // The tree's own facts, which no machine changes.
    domain: 'devops',
    era: 1,
    eraName: 'Era 1',
    setupSeconds: 600,
    // The snapshot's.
    state: 'unlocked',
    next: false,
    lifecycle: 'broken',
  });
});

test('a next step is read off the observation’s states over today’s edges', () => {
  const ci = itemsAsOf(TODAY, EDGES, FRIDAY).find(i => i.id === 'combo:ci')!;
  expect(ci.status).toBe('specified');
  // Version control was reached that Friday, so CI was one step away.
  expect(ci.meta.next).toBe(true);
  // On Monday it was not, so CI was blocked.
  expect(itemsAsOf(TODAY, EDGES, MONDAY).find(i => i.id === 'combo:ci')!.meta.next).toBe(false);
});

test('an observation from before lifecycles were recorded gives no check at all', () => {
  const past = itemsAsOf(TODAY, EDGES, { ...FRIDAY, lifecycles: null });
  for (const item of past) expect('lifecycle' in item.meta).toBe(false);
});

test('the playhead names a tick by its second, and a second no tick has is now', () => {
  expect(tickSecond(FRIDAY)).toBe('2026-09-25T17:00:00Z');
  expect(tickAt(HISTORY, '2026-09-25T17:00:00Z')).toBe(FRIDAY);
  expect(tickAt(HISTORY, '2026-09-25T17:00:01Z')).toBeNull();
  expect(tickAt(HISTORY, null)).toBeNull();
  expect(tickAt(null, '2026-09-25T17:00:00Z')).toBeNull();
});

test('a tick is dated on the ledger’s clock, whatever the reader’s is', () => {
  expect(dayOf('2026-09-26 23:59:59')).toBe('Sep 26');
  expect(momentOf('2026-09-26 23:59:59')).toBe('Sep 26, 2026, 23:59 UTC');
});

test('the timeline says what moved at the tick, or since the newest one', () => {
  expect(timelineSentence(HISTORY, FRIDAY)).toBe('Sep 25: reached 0 to 1, 1 went failing.');
  expect(timelineSentence(HISTORY, null)).toBe('Nothing has moved since Sep 25.');
  expect(timelineSentence({ ...HISTORY, movedSinceLast: 'reached 1, verified 0 to 1' }, null)).toBe(
    'Since Sep 25: reached 1, verified 0 to 1.'
  );
});
