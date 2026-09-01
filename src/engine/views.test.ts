/**
 * The projections the visualiser reads.
 *
 * The type a node is given has now been wrong twice, the same way both times:
 * `views.ts` mapped a capability's category to a node type inline, so any
 * category the client's own union did not list reached the renderer verbatim as
 * a value it had no case for. `tool`, `runtime` and `meta` are all real stored
 * categories, and all three were served that way.
 *
 * The second time, the mapping function existed and simply was not called —
 * dead code, with a lint warning nobody chased. These hold the contract itself
 * rather than the implementation.
 */
import { expect, test } from 'vitest';
import { NODE_TYPES } from '../shared/api.ts';
import { makeGraph } from './testing/graph.ts';
import { graphSummary, interventionHeatmap, recentProposals, techTreeView } from './views.ts';

/** Every `category` the engine writes, across seeding and the curated model. */
const STORED_CATEGORIES = [
  'mcp',
  'agent',
  'provider',
  'model',
  'skill',
  'tool',
  'combo',
  'runtime',
  'meta',
  'action',
  'human',
  'credential',
];

test('every category the engine stores maps to a type the client can draw', () => {
  const db = makeGraph({
    capabilities: STORED_CATEGORIES.map((category, i) => ({
      id: `${category}:node-${i}`,
      name: `Node ${i}`,
      category,
    })),
  });
  const { items } = techTreeView(db);
  db.close();

  expect(items.length).toBe(STORED_CATEGORIES.length);
  for (const item of items) {
    expect(NODE_TYPES as readonly string[]).toContain(item.type);
  }
});

test('a category nobody anticipated becomes config, not itself', () => {
  // The fallback is the point: a renderer given a type it has no case for
  // draws a default and says nothing, which is how this went unnoticed.
  const db = makeGraph({
    capabilities: [{ id: 'weird:one', name: 'Weird', category: 'not-a-real-category' }],
  });
  const { items } = techTreeView(db);
  db.close();
  expect(items[0].type).toBe('config');
});

test('combos and mcp servers keep the names the client renders them under', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:x', name: 'X', category: 'combo' },
      { id: 'mcp:y', name: 'Y', category: 'mcp' },
    ],
  });
  const byId = new Map(techTreeView(db).items.map(i => [i.id, i.type]));
  db.close();
  expect(byId.get('combo:x')).toBe('possibility');
  expect(byId.get('mcp:y')).toBe('mcp-server');
});

test('a locked capability is specified, a reached one is built', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:locked', category: 'combo', state: 'locked' },
      { id: 'combo:reached', category: 'combo', state: 'unlocked' },
    ],
  });
  const byId = new Map(techTreeView(db).items.map(i => [i.id, i.status]));
  db.close();
  expect(byId.get('combo:locked')).toBe('specified');
  expect(byId.get('combo:reached')).toBe('built');
});

test('the summary counts what is reached, and survives an empty graph', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'a:1', state: 'unlocked' },
      { id: 'a:2', state: 'locked' },
    ],
  });
  const summary = graphSummary(db);
  db.close();
  expect(summary.total).toBe(2);
  expect(summary.reached).toBe(1);

  const empty = makeGraph({});
  expect(graphSummary(empty).total).toBe(0);
  empty.close();
});

test('the reading surfaces answer on a graph with nothing in it', () => {
  // Each is guarded separately on purpose: a database predating one of these
  // tables used to throw and zero the counts from the query before it.
  const db = makeGraph({});
  expect(recentProposals(db)).toEqual([]);
  expect(interventionHeatmap(db)).toEqual([]);
  expect(techTreeView(db).items).toEqual([]);
  db.close();
});
