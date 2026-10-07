/**
 * What taking a capability on needs, and how much of it is here.
 *
 * The question before an acquisition is what it needs that is already in place.
 * The graph can answer the required prerequisites, and can say whether each is
 * reached and passing; it cannot say whether a binary is installed or a network
 * is up, and nothing here pretends to. These hold the answer to the engine's
 * own plan, which walks the same prerequisites and lists the failing ones.
 */
import { expect, test } from 'vitest';
import { installText } from '../../engine/catalog';
import { planFor } from '../../engine/planning';
import { makeGraph } from '../../engine/testing/graph';
import { techTreeView } from '../../engine/views';
import type { Connection, Item } from './configImporter';
import { demoSnapshot } from './demoSnapshot';
import { needsOf } from './needs';

const item = (id: string, over: Partial<Item> = {}, meta: Record<string, unknown> = {}): Item => ({
  id,
  name: id.replace(/^[a-z]+:/, ''),
  type: 'possibility',
  status: 'specified',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { era: 1, ...meta },
  ...over,
});
const reached = (id: string, meta: Record<string, unknown> = {}) =>
  item(id, { status: 'built' }, { lifecycle: 'verified', ...meta });
const required = (from: string, to: string): Connection => ({
  from,
  to,
  type: 'hard-dep',
  kind: 'requires',
});

test('an option with two required prerequisites, one reached, is one of two met, and names the other', () => {
  const needs = needsOf(
    [item('combo:goal'), reached('combo:have'), item('combo:lack')],
    [required('combo:have', 'combo:goal'), required('combo:lack', 'combo:goal')],
    'combo:goal'
  );
  expect(needs?.met).toBe(1);
  expect(needs?.required).toEqual([
    { id: 'combo:lack', name: 'lack', met: false, why: 'not reached' },
    { id: 'combo:have', name: 'have', met: true, why: undefined },
  ]);
});

test('a missing prerequisite brings its own needs, nearest first', () => {
  // The goal needs B, and B needs C and D. Reaching B is not the whole job.
  const needs = needsOf(
    [item('combo:goal'), item('combo:b'), item('combo:c'), reached('combo:d')],
    [
      required('combo:b', 'combo:goal'),
      required('combo:c', 'combo:b'),
      required('combo:d', 'combo:b'),
    ],
    'combo:goal'
  );
  expect(needs?.required.map(n => `${n.id} ${n.met ? 'met' : 'missing'}`)).toEqual([
    'combo:b missing',
    'combo:c missing',
    'combo:d met',
  ]);
  expect(needs?.met).toBe(1);
});

test('a prerequisite that is reached and failing is not met, and says why', () => {
  const needs = needsOf(
    [
      item('combo:goal'),
      reached('combo:broken', { lifecycle: 'broken' }),
      reached('combo:fine'),
      reached('combo:mending', { lifecycle: 'degraded' }),
      item('combo:absent'),
    ],
    [
      required('combo:fine', 'combo:goal'),
      required('combo:broken', 'combo:goal'),
      required('combo:mending', 'combo:goal'),
      required('combo:absent', 'combo:goal'),
    ],
    'combo:goal'
  );
  // Never reached first, then failing, then met. Recovering is met: its last
  // check passed, and the latest check decides.
  expect(needs?.required.map(n => [n.id, n.met, n.why])).toEqual([
    ['combo:absent', false, 'not reached'],
    ['combo:broken', false, 'check failing'],
    ['combo:fine', true, undefined],
    ['combo:mending', true, undefined],
  ]);
  expect(needs?.met).toBe(2);
});

test('a capability that is already reached is asked for its own prerequisites only', () => {
  const needs = needsOf(
    [reached('combo:goal'), reached('combo:a'), reached('combo:b'), reached('combo:deeper')],
    [
      required('combo:a', 'combo:goal'),
      required('combo:b', 'combo:goal'),
      required('combo:deeper', 'combo:a'),
    ],
    'combo:goal'
  );
  expect(needs?.required.map(n => n.id)).toEqual(['combo:a', 'combo:b']);
  expect(needs?.met).toBe(2);
});

test('a capability is listed before the entries that supply it', () => {
  const server = { ...reached('mcp:server'), type: 'mcp-server' as const };
  const helper = { ...reached('agent:helper'), type: 'agent' as const };
  const needs = needsOf(
    [item('combo:goal'), server, reached('combo:cap'), helper],
    [
      required('mcp:server', 'combo:goal'),
      required('agent:helper', 'combo:goal'),
      required('combo:cap', 'combo:goal'),
    ],
    'combo:goal'
  );
  expect(needs?.required.map(n => n.id)).toEqual(['combo:cap', 'mcp:server', 'agent:helper']);
});

test('an optional prerequisite is not a need', () => {
  const needs = needsOf(
    [item('combo:goal'), item('combo:nice')],
    [{ from: 'combo:nice', to: 'combo:goal', type: 'soft-dep', kind: 'optional' }],
    'combo:goal'
  );
  expect(needs?.required).toEqual([]);
});

test('a capability that is not on this graph has no needs to state', () => {
  expect(needsOf([item('combo:other')], [], 'combo:goal')).toBeNull();
  expect(needsOf([], [], '')).toBeNull();
});

test('a declared credential is named once, from whatever supplies what it rests on', () => {
  // The prerequisite is supplied by two servers that present one token: one
  // credential, named once, and never marked met, because nothing checks it.
  const needs = needsOf(
    [
      item('combo:goal'),
      reached('combo:vc', { providers: ['mcp:git', 'mcp:github'] }),
      reached('mcp:git', { credentials: ['cred:gh'] }),
      reached('mcp:github', { credentials: ['cred:gh', 'cred:other'] }),
      item('cred:gh', { name: 'GitHub user token', status: 'built', type: 'config' }),
    ],
    [required('combo:vc', 'combo:goal')],
    'combo:goal'
  );
  expect(needs?.credentials).toEqual([
    { id: 'cred:gh', name: 'GitHub user token' },
    // A credential whose node is not on the graph keeps its id, not a blank.
    { id: 'cred:other', name: 'cred:other' },
  ]);
});

test('with none declared, there are no credentials to name', () => {
  const needs = needsOf(
    [item('combo:goal'), reached('combo:a')],
    [required('combo:a', 'combo:goal')],
    'combo:goal'
  );
  expect(needs?.credentials).toEqual([]);
});

test('the answer is the engine plan: what it would acquire and what it says is failing', () => {
  // G needs A (reached), and B; B needs C, which is reached and failing. The
  // plan orders B then G and lists C under `degraded`, the older name of its
  // failing list: exactly the missing ones.
  const db = makeGraph({
    capabilities: [
      { id: 'combo:g', name: 'G', category: 'combo', state: 'locked' },
      { id: 'combo:a', name: 'A', category: 'combo', lifecycle: 'verified' },
      { id: 'combo:b', name: 'B', category: 'combo', state: 'locked' },
      { id: 'combo:c', name: 'C', category: 'combo', lifecycle: 'broken' },
    ],
    dependencies: [
      { from: 'combo:a', to: 'combo:g' },
      { from: 'combo:b', to: 'combo:g' },
      { from: 'combo:c', to: 'combo:b' },
    ],
  });
  const plan = planFor(db, 'combo:g') as {
    order: { id: string }[];
    degraded?: { id: string }[];
  };
  const tree = techTreeView(db);
  db.close();

  const needs = needsOf(tree.items as unknown as Item[], tree.connections, 'combo:g');
  const missing = needs?.required.filter(n => !n.met).map(n => n.id);
  const fromPlan = [
    ...plan.order.map(o => o.id).filter(id => id !== 'combo:g'),
    ...(plan.degraded ?? []).map(d => d.id),
  ];
  expect((missing ?? []).sort()).toEqual(fromPlan.sort());
  expect(needs?.required.filter(n => n.met).map(n => n.id)).toEqual(['combo:a']);
});

test("the demo's install entry is the text the engine serves for that alternative", () => {
  // The sample is written by hand, and an entry written by hand is a place for
  // a command to drift from the tree it says it came from.
  const shown = demoSnapshot().opportunities.flatMap(o =>
    (o.acquisition_options ?? [])
      .filter(a => a.install)
      .map(a => ({ capability: o.capability_id as string, ...a }))
  );
  expect(shown).toHaveLength(1);
  const [entry] = shown;
  expect(entry.install).toBe(
    installText(entry.capability, {
      provider: entry.provider,
      source: 'techtree',
      rollback: 'reversible',
    })
  );
});
