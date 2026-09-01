/**
 * The tree's layout arithmetic and graph walking.
 *
 * This is why the split was worth doing. All of it lived inside a 1,067-line
 * React component full of SVG, so none of it was covered — CivTree.tsx was 0%
 * of 289 lines. It is pure, it decides what a reader of the map actually sees,
 * and it can be wrong in ways nobody would catch by looking at a screenshot:
 * a column ordered wrong, a node placed on top of another, a filter admitting
 * the wrong things.
 */
import { expect, test } from 'vitest';
import type { Connection, Item } from '../../utils/configImporter';
import {
  buildAdjacency,
  buildColumns,
  COL_W,
  columnLabel,
  columnOf,
  costOf,
  domainOf,
  eraOf,
  isNext,
  layoutNodes,
  NODE_R,
  ROW_H,
  sceneSize,
  START_X,
  START_Y,
  visibleItems,
} from './layout.ts';

const item = (id: string, meta: Record<string, unknown> = {}, type = 'possibility'): Item =>
  ({
    id,
    name: id,
    type,
    status: 'built',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta,
  }) as Item;

// ── Reading an item ──────────────────────────────────────────────────────────

test('an item without a domain is meta rather than undefined', () => {
  expect(domainOf(item('a'))).toBe('meta');
  expect(domainOf(item('a', { domain: 'infra' }))).toBe('infra');
});

test('only a numeric era counts as an era', () => {
  expect(eraOf(item('a', { era: 3 }))).toBe(3);
  expect(eraOf(item('a', { era: '3' }))).toBeUndefined();
  expect(eraOf(item('a'))).toBeUndefined();
  // Era 0 is a real era and must not be read as absent.
  expect(eraOf(item('a', { era: 0 }))).toBe(0);
});

test('an era decides the column; without one the domain does', () => {
  expect(columnOf(item('a', { era: 2, domain: 'infra' }))).toBe('era:2');
  expect(columnOf(item('a', { domain: 'infra' }))).toBe('infra');
});

test('a column is labelled by its era name when one is carried', () => {
  expect(columnLabel('era:4', [item('a', { eraName: 'Memory' })])).toBe('Memory');
  expect(columnLabel('era:4', [item('a')])).toBe('Era 4');
  expect(columnLabel('infra', [])).toBe('Foundation');
  // An unknown domain reads as itself rather than as blank.
  expect(columnLabel('nonesuch', [])).toBe('nonesuch');
});

test('setup cost reads in minutes below an hour and hours above', () => {
  expect(costOf(item('a', { setupSeconds: 600 }))).toBe('10m');
  expect(costOf(item('a', { setupSeconds: 3600 }))).toBe('1h');
  expect(costOf(item('a', { setupSeconds: 7200 }))).toBe('2h');
  expect(costOf(item('a'))).toBe('');
  expect(costOf(item('a', { setupSeconds: 0 }))).toBe('');
});

test('next means the frontier, and is never inferred', () => {
  expect(isNext(item('a', { next: true }))).toBe(true);
  expect(isNext(item('a', { next: false }))).toBe(false);
  expect(isNext(item('a'))).toBe(false);
});

// ── What is on screen ────────────────────────────────────────────────────────

test('any era at all means the tree, and the tree alone is shown', () => {
  // Mixing config entries into the era columns would make a column mean two
  // things and break reading prerequisites left to right.
  const items = [item('combo:x', { era: 1 }), item('mcp:y', { domain: 'infra' }, 'mcp-server')];
  expect(visibleItems(items, 'all').map(i => i.id)).toEqual(['combo:x']);
});

test('without eras the filter selects by type, and keeps the framework', () => {
  const items = [
    item('mcp:a', {}, 'mcp-server'),
    item('agent:b', {}, 'agent'),
    item('core', {}, 'framework'),
  ];
  expect(visibleItems(items, 'all')).toHaveLength(3);
  expect(visibleItems(items, 'server').map(i => i.id)).toEqual(['mcp:a', 'core']);
  expect(visibleItems(items, 'agent').map(i => i.id)).toEqual(['agent:b', 'core']);
});

// ── Columns ──────────────────────────────────────────────────────────────────

test('eras order numerically, not as strings', () => {
  // The bug this guards: 'era:10' sorts before 'era:2' lexically, which would
  // put the tenth era second and make the whole tree read wrong.
  const { colOrder } = buildColumns([
    item('c', { era: 10 }),
    item('a', { era: 2 }),
    item('b', { era: 1 }),
  ]);
  expect(colOrder).toEqual(['era:1', 'era:2', 'era:10']);
});

test('domain columns follow the declared order, and unknown ones come last', () => {
  const { colOrder } = buildColumns([
    item('a', { domain: 'quality' }),
    item('b', { domain: 'infra' }),
    item('c', { domain: 'zzz-unknown' }),
  ]);
  expect(colOrder.indexOf('infra')).toBeLessThan(colOrder.indexOf('quality'));
  expect(colOrder[colOrder.length - 1]).toBe('zzz-unknown');
});

test('every item lands in exactly one column', () => {
  const items = [item('a', { era: 1 }), item('b', { era: 1 }), item('c', { era: 2 })];
  const { cols } = buildColumns(items);
  expect(cols['era:1'].map(i => i.id)).toEqual(['a', 'b']);
  expect(cols['era:2'].map(i => i.id)).toEqual(['c']);
});

// ── Placement ────────────────────────────────────────────────────────────────

test('nodes step across by column and down by row', () => {
  const columns = buildColumns([
    item('a', { era: 1 }),
    item('b', { era: 1 }),
    item('c', { era: 2 }),
  ]);
  const placed = layoutNodes(columns);

  const a = placed.get('a')!;
  const b = placed.get('b')!;
  const c = placed.get('c')!;

  expect(a.x).toBe(START_X + COL_W / 2 - 40);
  expect(a.y).toBe(START_Y + NODE_R);
  expect(b.x).toBe(a.x); // same column
  expect(b.y).toBe(a.y + ROW_H); // next row
  expect(c.x).toBe(a.x + COL_W); // next column
  expect(c.y).toBe(a.y); // first row again
});

test('no two nodes are placed on top of each other', () => {
  const items = Array.from({ length: 30 }, (_, i) => item(`n${i}`, { era: (i % 5) + 1 }));
  const placed = layoutNodes(buildColumns(items));
  const spots = [...placed.values()].map(p => `${p.x},${p.y}`);
  expect(new Set(spots).size).toBe(items.length);
});

test('the scene is wide enough for its columns and tall enough for its rows', () => {
  const columns = buildColumns([
    item('a', { era: 1 }),
    item('b', { era: 1 }),
    item('c', { era: 2 }),
  ]);
  const { width, height } = sceneSize(columns);
  const placed = [...layoutNodes(columns).values()];
  for (const p of placed) {
    expect(p.x).toBeLessThan(width);
    expect(p.y).toBeLessThan(height);
  }
});

test('an empty graph still has a canvas with a size', () => {
  const { width, height } = sceneSize(buildColumns([]));
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
});

// ── Adjacency ────────────────────────────────────────────────────────────────

const edges: Connection[] = [
  { from: 'a', to: 'b', type: 'requires' },
  { from: 'b', to: 'c', type: 'requires' },
  { from: 'x', to: 'y', type: 'requires' },
];

test('edges are indexed in both directions', () => {
  const { downstream, upstream } = buildAdjacency(edges, null);
  expect(downstream.get('a')).toEqual(['b']);
  expect(upstream.get('b')).toEqual(['a']);
  expect(downstream.get('c')).toBeUndefined();
});

test('the chain follows edges both ways from the selection', () => {
  // Selecting b must light a and c: what it needs and what needs it.
  const { chainIds } = buildAdjacency(edges, 'b');
  expect([...chainIds].sort()).toEqual(['a', 'b', 'c']);
  expect(chainIds.has('x')).toBe(false);
});

test('nothing selected lights nothing', () => {
  expect(buildAdjacency(edges, null).chainIds.size).toBe(0);
});

test('a cycle terminates rather than hanging the walk', () => {
  const cyclic: Connection[] = [
    { from: 'a', to: 'b', type: 'requires' },
    { from: 'b', to: 'a', type: 'requires' },
  ];
  expect([...buildAdjacency(cyclic, 'a').chainIds].sort()).toEqual(['a', 'b']);
});
