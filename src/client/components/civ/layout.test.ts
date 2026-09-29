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
  blockedBy,
  buildAdjacency,
  buildColumns,
  COL_W,
  columnLabel,
  columnOf,
  columnProgress,
  costOf,
  domainOf,
  edgePath,
  eraLadder,
  eraOf,
  failingNeeds,
  isEntry,
  isNext,
  layoutNodes,
  NODE_R,
  authorityMark,
  isProven,
  jointMark,
  outageCascade,
  outageImpact,
  outageSentence,
  outageSplit,
  ROW_H,
  rungOf,
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

  expect(a.x).toBe(START_X + COL_W / 2 - 16);
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

test('an outage stops only what was working; the rest is cut off or already failing', () => {
  // Hosted Inference in the demo cut off twelve and reached none, and the
  // banner said twelve would stop working.
  const items = [
    item('root'),
    item('ok', { lifecycle: 'proven' }),
    item('failing', { lifecycle: 'degraded' }),
    item('down', { lifecycle: 'broken' }),
    { ...item('never'), status: 'specified' as const },
  ];
  const edges = ['ok', 'failing', 'down', 'never'].map(to => ({
    from: 'root',
    to,
    type: 'hard-dep' as const,
  }));
  const impact = outageImpact(items, outageSplit(items, edges, 'root'));
  expect(impact.stopped.map(i => i.id)).toEqual(['ok']);
  expect(impact.broken.map(i => i.id)).toEqual(['failing', 'down']);
  expect(impact.cutOff.map(i => i.id)).toEqual(['never']);

  const said = outageSentence('Root', impact);
  expect(said.before + said.count + said.after).toBe(
    'If Root went down, 1 capability would stop working. 1 not set up yet would be cut off, and 2 were already failing.'
  );
});

test('an outage that reaches nothing working says so, and names what it cuts off', () => {
  const impact = { stopped: [], broken: [], cutOff: [item('a'), item('b')], thinned: [] };
  const said = outageSentence('Hosted Inference', impact);
  expect(said.count).toBe('');
  expect(said.before + said.after).toBe(
    'If Hosted Inference went down, nothing that works would stop. 2 not set up yet would be cut off.'
  );
  const quiet = outageSentence('this', { stopped: [], broken: [], cutOff: [], thinned: [] });
  expect(quiet.before + quiet.after).toBe('If this went down, nothing else would stop working.');
});

test('the panel reads "other" and keeps the count apart, so it can be emphasised', () => {
  const said = outageSentence(
    'this',
    { stopped: [item('x'), item('y')], broken: [], cutOff: [], thinned: [item('z')] },
    true
  );
  expect(said).toEqual({
    before: 'If this went down, ',
    count: '2 other capabilities',
    after: ' would stop working and 1 would lose a provider.',
  });
});

test('the authority lens paints what the engine answered, and nothing it did not', () => {
  const reached = (authority?: Record<string, unknown>) =>
    item('x', authority ? { authority } : {});
  expect(authorityMark(reached({ execute: 'autonomous' }))).toBe('autonomous');
  expect(authorityMark(reached({ execute: 'confirm', observe: 'autonomous' }))).toBe('confirm');
  // No grant is refused at the gate, and said apart from a refusal someone wrote.
  expect(authorityMark(reached({ execute: 'forbidden', ungranted: true }))).toBe('ungranted');
  expect(authorityMark(reached({ execute: 'forbidden' }))).toBe('forbidden');
  // Absent is not autonomous, and not reached has nothing to act with.
  expect(authorityMark(reached())).toBeUndefined();
  expect(
    authorityMark({ ...reached({ execute: 'autonomous' }), status: 'specified' })
  ).toBeUndefined();
  expect(authorityMark(reached({ execute: 'sometimes' }))).toBeUndefined();
});

test('only a reached node loses a provider; one never reached had none to lose', () => {
  const items = [
    item('a'),
    item('b'),
    item('reached', { providers: ['a', 'b'] }),
    { ...item('never', { providers: ['a', 'b'] }), status: 'specified' as const },
  ];
  const edges = ['reached', 'never'].flatMap(to =>
    ['a', 'b'].map(from => ({ from, to, type: 'hard-dep' as const, kind: 'provides' }))
  );
  const split = outageSplit(items, edges, 'a');
  expect([...split.weakened].sort()).toEqual(['never', 'reached']);
  expect(outageImpact(items, split).thinned.map(i => i.id)).toEqual(['reached']);
});

test('proven is reached with a passing check, the list the engine counts with', () => {
  expect(isProven(item('v', { lifecycle: 'verified' }))).toBe(true);
  expect(isProven(item('r', { lifecycle: 'reliable' }))).toBe(true);
  expect(isProven(item('c', { lifecycle: 'configured' }))).toBe(false);
  expect(isProven(item('b', { lifecycle: 'broken' }))).toBe(false);
  expect(isProven({ ...item('l', { lifecycle: 'verified' }), status: 'specified' })).toBe(false);
});

test('a joint mark is a person or a device, and a recurring cost is neither', () => {
  const withStructure = (structure: string[]) => item('x', { structure });
  expect(jointMark(withStructure(['institutional', 'economic']))).toBe('person');
  expect(jointMark(withStructure(['cognitive']))).toBe('person');
  expect(jointMark(withStructure(['machine-composed-human']))).toBe('person');
  expect(jointMark(withStructure(['physical']))).toBe('device');
  // Asking someone is the costlier dependency, so it is the one marked.
  expect(jointMark(withStructure(['physical', 'institutional']))).toBe('person');
  expect(jointMark(withStructure(['economic']))).toBeUndefined();
  expect(jointMark(item('y'))).toBeUndefined();
});

// ── The era ladder ───────────────────────────────────────────────────────────

/** A node of an era: reached or not, with whatever else the test is about. */
const rung = (
  id: string,
  status: 'built' | 'specified',
  meta: Record<string, unknown> = {},
  era = 3
): Item => ({ ...item(id, { era, ...meta }), status }) as Item;

test('a reached node whose check failed is failing, and never reached', () => {
  expect(rungOf(rung('a', 'built', { lifecycle: 'verified' }))).toBe('reached');
  // Unproven is still reached: only a failed check moves a node out of it.
  expect(rungOf(rung('a', 'built', { lifecycle: 'configured' }))).toBe('reached');
  expect(rungOf(rung('a', 'built', { lifecycle: 'degraded' }))).toBe('failing');
  expect(rungOf(rung('a', 'built', { lifecycle: 'broken' }))).toBe('failing');
  expect(rungOf(rung('n', 'specified', { next: true }))).toBe('next');
  expect(rungOf(rung('b', 'specified', { next: false }))).toBe('blocked');
  // A node not reached has no check to fail, whatever its lifecycle says.
  expect(rungOf(rung('b', 'specified', { lifecycle: 'broken' }))).toBe('blocked');
});

test('the era count and the rungs agree for an era with one failing node', () => {
  const era = [
    rung('a', 'built', { lifecycle: 'verified', setupSeconds: 300 }),
    rung('b', 'built', { lifecycle: 'configured', setupSeconds: 300 }),
    rung('c', 'built', { lifecycle: 'broken', setupSeconds: 900 }),
    rung('d', 'specified', { next: true, setupSeconds: 600 }),
    rung('e', 'specified', { next: false, setupSeconds: 1200 }),
  ];
  const progress = columnProgress(era);
  // The header used to read 3 of 5 here, counting the failing node as reached.
  // Setup time left is what is not reached: a node that is built has been set up.
  expect(progress).toEqual({
    total: 5,
    reached: 2,
    failing: 1,
    next: 1,
    blocked: 1,
    seconds: 1800,
  });

  const ladder = eraLadder(era, [], 3)!;
  expect(ladder.progress).toEqual(progress);
  const count = (state: string) => ladder.rows.filter(r => r.state === state).length;
  expect(count('reached')).toBe(progress.reached);
  expect(count('failing')).toBe(progress.failing);
  expect(count('next')).toBe(progress.next);
  expect(count('blocked')).toBe(progress.blocked);
  expect(ladder.rows).toHaveLength(progress.total);
});

test('the rungs put what needs attention first: failing, then next steps cheapest first, blocked, reached', () => {
  const era = [
    rung('reached-b', 'built', { lifecycle: 'verified' }),
    rung('blocked', 'specified'),
    rung('next-slow', 'specified', { next: true, setupSeconds: 1800 }),
    rung('next-unpriced', 'specified', { next: true, setupSeconds: 0 }),
    rung('failing', 'built', { lifecycle: 'degraded' }),
    rung('next-fast', 'specified', { next: true, setupSeconds: 300 }),
    rung('reached-a', 'built', { lifecycle: 'verified' }),
  ];
  expect(eraLadder(era, [], 3)!.rows.map(r => r.item.id)).toEqual([
    'failing',
    'next-fast',
    'next-slow',
    'next-unpriced',
    'blocked',
    'reached-a',
    'reached-b',
  ]);
});

test('a rung with no estimate shows none, and one with an estimate writes it as the map does', () => {
  const era = [
    rung('priced', 'specified', { next: true, setupSeconds: 600 }),
    rung('hours', 'specified', { next: true, setupSeconds: 7200 }),
    rung('zero', 'specified', { next: true, setupSeconds: 0 }),
    rung('unset', 'specified', { next: true }),
    rung('done', 'built', { setupSeconds: 900 }),
  ];
  const rows = new Map(eraLadder(era, [], 3)!.rows.map(r => [r.item.id, r]));
  expect(rows.get('priced')!.estimate).toBe('10m');
  expect(rows.get('hours')!.estimate).toBe('2h');
  // The tree records zero for a node nobody has priced, and zero minutes would be a claim.
  expect(rows.get('zero')!.estimate).toBeUndefined();
  expect(rows.get('unset')!.estimate).toBeUndefined();
  // What is reached has nothing left to estimate.
  expect(rows.get('done')!.estimate).toBeUndefined();
});

test('a blocked rung names what it waits for, direct prerequisites first, and prices the gap', () => {
  // c needs b, and b needs a; neither is reached, and b is what to reach first.
  const era = [
    rung('a', 'specified', { next: true, setupSeconds: 600 }, 2),
    rung('b', 'specified', { setupSeconds: 900 }, 2),
    rung('c', 'specified', { setupSeconds: 300 }, 3),
  ];
  const deps: Connection[] = [
    { from: 'a', to: 'b', type: 'hard-dep' },
    { from: 'b', to: 'c', type: 'hard-dep' },
  ];
  const c = eraLadder(era, deps, 3)!.rows[0];
  expect(c.state).toBe('blocked');
  expect(c.detail).toBe('Waits for b and 1 more, about 25m of setup first');

  // A gap nobody has priced names what it waits for and no time.
  const unpriced = [rung('x', 'specified', {}, 2), rung('y', 'specified', {}, 3)];
  const edge: Connection[] = [{ from: 'x', to: 'y', type: 'hard-dep' }];
  expect(eraLadder(unpriced, edge, 3)!.rows[0].detail).toBe('Waits for x');

  // An optional prerequisite gates nothing, so a node behind only one waits for nothing named.
  const soft: Connection[] = [{ from: 'x', to: 'y', type: 'soft-dep' }];
  expect(eraLadder(unpriced, soft, 3)!.rows[0].detail).toBeUndefined();
});

test('a next step whose prerequisite is failing stays a next step, and says what is wrong under it', () => {
  // The tree's `next` is state-only, so it reads this node as one step away
  // while a prerequisite is configured and not working.
  const items = [
    rung('p', 'built', { lifecycle: 'broken' }, 2),
    rung('q', 'built', { lifecycle: 'degraded' }, 2),
    rung('ok', 'built', { lifecycle: 'verified' }, 2),
    rung('n', 'specified', { next: true }, 3),
  ];
  const edges: Connection[] = [
    { from: 'p', to: 'n', type: 'hard-dep' },
    { from: 'ok', to: 'n', type: 'hard-dep' },
  ];
  const one = eraLadder(items, edges, 3)!.rows[0];
  expect(one.state).toBe('next');
  expect(one.detail).toBe('Needs p, which is failing its check');

  const two = eraLadder(items, [...edges, { from: 'q', to: 'n', type: 'hard-dep' }], 3)!.rows[0];
  expect(two.detail).toBe('Needs p and q, which are failing their checks');

  // An optional prerequisite gates nothing, so its failure is not a reason.
  expect(failingNeeds(items, [{ from: 'p', to: 'n', type: 'soft-dep' }], 'n')).toEqual([]);
  // And a passing one is not named.
  expect(failingNeeds(items, [{ from: 'ok', to: 'n', type: 'hard-dep' }], 'n')).toEqual([]);
});

test('the failing rung says the node is configured and not working, and a reached one says nothing', () => {
  const failing = eraLadder([rung('f', 'built', { lifecycle: 'broken' })], [], 3)!.rows[0];
  expect(failing.state).toBe('failing');
  expect(failing.detail).toBe('Configured, but not working');
  const reached = eraLadder([rung('r', 'built', { lifecycle: 'verified' })], [], 3)!.rows[0];
  expect(reached.detail).toBeUndefined();
});

test('an era with no nodes has no ladder, and is named as the tree names it or by its number', () => {
  expect(eraLadder([rung('a', 'built', {}, 2)], [], 5)).toBeNull();
  expect(eraLadder([rung('a', 'built', { eraName: 'Memory' }, 4)], [], 4)!.name).toBe('Memory');
  expect(eraLadder([rung('a', 'built', {}, 4)], [], 4)!.name).toBe('Era 4');
});

test('what a node is blocked by is three names at most, then a count of the rest', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => rung(id, 'specified', { setupSeconds: 600 }, 2));
  const target = rung('t', 'specified', {}, 3);
  const deps: Connection[] = many.map(m => ({ from: m.id, to: 't', type: 'hard-dep' }));
  expect(blockedBy([...many, target], deps, 't')).toEqual({
    names: ['a', 'b', 'c'],
    more: 2,
    seconds: 3000,
  });
  expect(blockedBy([target], [], 't')).toEqual({ names: [], more: 0, seconds: 0 });
});
