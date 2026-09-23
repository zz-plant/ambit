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
import { describe, expect, it, test } from 'vitest';
import type { Connection, Item } from '../../utils/configImporter';
import {
  buildAdjacency,
  buildColumns,
  COL_W,
  columnLabel,
  columnOf,
  costOf,
  domainOf,
  edgePath,
  eraOf,
  eraProgress,
  isEntry,
  isNext,
  layoutNodes,
  NODE_R,
  outageCascade,
  ROW_H,
  sceneSize,
  START_X,
  START_Y,
  unlockCascade,
  visibleItems,
  wrapLabel,
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
  // A domain column is named with the glossary's word for the domain, which
  // is the word the detail panel prints. It read "Foundation", which is also
  // the tree's first era.
  expect(columnLabel('infra', [])).toBe('infra');
  expect(columnLabel('nonesuch', [])).toBe('nonesuch');
});

test('a name wraps onto two lines and is cut only past the second', () => {
  expect(wrapLabel('Shell Execution')).toEqual(['Shell Execution']);
  expect(wrapLabel('Private Data Handling')).toEqual(['Private Data', 'Handling']);
  expect(wrapLabel('A Rather Long Capability Name Indeed')).toEqual([
    'A Rather Long',
    'Capability Name…',
  ]);
  expect(wrapLabel('')).toEqual([]);
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

test('any era at all means the tree, and the tree alone is drawn', () => {
  // Mixing config entries into the era columns would make a column mean two
  // things and break reading prerequisites left to right. The entries are
  // what My Setup lists.
  const items = [item('combo:x', { era: 1 }), item('mcp:y', { domain: 'infra' }, 'mcp-server')];
  expect(visibleItems(items).map(i => i.id)).toEqual(['combo:x']);
  expect(items.filter(isEntry).map(i => i.id)).toEqual(['mcp:y']);
});

test('a graph with no eras at all is drawn as it stands', () => {
  const items = [item('mcp:a', {}, 'mcp-server'), item('agent:b', {}, 'agent')];
  expect(visibleItems(items)).toHaveLength(2);
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

// ── Row order ────────────────────────────────────────────────────────────────

const withStatus = (id: string, era: number, status: 'built' | 'specified', next = false) =>
  ({ ...item(id, { era, next }), status }) as Item;

test('rows open in state order: reached, then the frontier, then blocked', () => {
  // Insertion order used to be the row order, so height meant nothing while
  // the Docs said it showed how far up the tree something sat.
  const { cols } = buildColumns([
    withStatus('blocked', 1, 'specified'),
    withStatus('next', 1, 'specified', true),
    withStatus('reached', 1, 'built'),
  ]);
  expect(cols['era:1'].map(i => i.id)).toEqual(['reached', 'next', 'blocked']);
});

test('a node is pulled toward the row of what it connects to', () => {
  // Two columns, two edges that cross under the initial order: a→d and b→c.
  // After ordering, one column has swapped so the edges no longer cross.
  // Which column moves is the heuristic's business; that they uncross is not.
  const items = [
    item('a', { era: 1 }),
    item('b', { era: 1 }),
    item('c', { era: 2 }),
    item('d', { era: 2 }),
  ];
  const edges: Connection[] = [
    { from: 'a', to: 'd', type: 'hard-dep' },
    { from: 'b', to: 'c', type: 'hard-dep' },
  ];
  const { cols } = buildColumns(items, edges);
  const row = (id: string) =>
    Object.values(cols)
      .flat()
      .findIndex(i => i.id === id) % 2;
  const left = Math.sign(row('a') - row('b'));
  const right = Math.sign(row('d') - row('c'));
  expect(left).toBe(right);
});

test('ordering is deterministic and leaves an unconnected node where it was', () => {
  const items = [
    item('a', { era: 1 }),
    item('b', { era: 1 }),
    item('c', { era: 2 }),
    item('lone', { era: 2 }),
  ];
  const edges: Connection[] = [{ from: 'b', to: 'c', type: 'hard-dep' }];
  const once = buildColumns(items, edges).cols['era:2'].map(i => i.id);
  const twice = buildColumns(items, edges).cols['era:2'].map(i => i.id);
  expect(once).toEqual(twice);
  expect(once).toContain('lone');
});

test('an edge leaves and arrives horizontally, and bows out inside one column', () => {
  expect(edgePath(0, 0, 100, 50)).toBe('M0,0 C50,0 50,50 100,50');
  expect(edgePath(10, 0, 10, 80)).toBe('M10,0 C50,0 50,80 10,80');
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

// ── The two cascades ─────────────────────────────────────────────────────────

test('an outage cascades along every hop downstream', () => {
  // a→b→c, x→y: losing a takes b and c, and never x or y.
  expect([...outageCascade(edges, 'a')].sort()).toEqual(['b', 'c']);
  expect(outageCascade(edges, 'c').size).toBe(0);
});

test('an unlock reaches what its required prerequisites then allow, closed over itself', () => {
  const items = [
    withStatus('have', 1, 'built'),
    withStatus('gap', 1, 'specified', true),
    withStatus('then', 2, 'specified'),
    withStatus('later', 3, 'specified'),
    withStatus('optional-only', 2, 'specified'),
  ];
  const deps: Connection[] = [
    { from: 'have', to: 'then', type: 'hard-dep' },
    { from: 'gap', to: 'then', type: 'hard-dep' },
    { from: 'then', to: 'later', type: 'hard-dep' },
    { from: 'gap', to: 'optional-only', type: 'soft-dep' },
  ];
  // Reaching the gap satisfies `then`, which satisfies `later`. A soft edge
  // gates nothing, so the optional target is not claimed.
  expect([...unlockCascade(items, deps, 'gap')].sort()).toEqual(['later', 'then']);
});

test('an unlock claims only what depends on it, not what another step already allows', () => {
  const items = [
    withStatus('have', 1, 'built'),
    withStatus('gap', 1, 'specified', true),
    withStatus('elsewhere', 2, 'specified', true),
    withStatus('after-elsewhere', 3, 'specified'),
    withStatus('after-gap', 2, 'specified'),
  ];
  const deps: Connection[] = [
    { from: 'have', to: 'elsewhere', type: 'hard-dep' },
    { from: 'elsewhere', to: 'after-elsewhere', type: 'hard-dep' },
    { from: 'gap', to: 'after-gap', type: 'hard-dep' },
  ];
  // Every next step used to be credited with everything reachable from
  // anywhere: `gap` claimed `elsewhere` and what follows it, which it has
  // nothing to do with.
  expect([...unlockCascade(items, deps, 'gap')]).toEqual(['after-gap']);
});

describe('eraProgress', () => {
  const item = (id: string, era: number, status: 'built' | 'specified', next = false): Item => ({
    id,
    name: id,
    type: 'possibility',
    status,
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era, eraName: `Era ${era} name`, next },
  });

  it('counts reached, next and total per era, in era order', () => {
    const rows = eraProgress([
      item('c', 2, 'specified', true),
      item('a', 1, 'built'),
      item('b', 1, 'specified'),
      item('d', 2, 'built'),
    ]);
    expect(rows.map(r => r.key)).toEqual(['era:1', 'era:2']);
    expect(rows[0]).toMatchObject({ reached: 1, next: 0, total: 2 });
    expect(rows[1]).toMatchObject({ reached: 1, next: 1, total: 2, label: 'Era 2 name' });
  });

  it('leaves config items, which have no era, out of the strip', () => {
    const cfg: Item = { ...item('x', 1, 'built'), meta: { domain: 'infra' } };
    expect(eraProgress([cfg])).toEqual([]);
  });
});
