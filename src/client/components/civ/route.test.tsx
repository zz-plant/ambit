/**
 * The route: the gap to a node, numbered in the order it can be closed.
 *
 * The gap was a set lit all at once, which says what stands in the way and
 * not where to start. These hold the order on the demo map, for every node
 * that has one: it covers the gap exactly, and no step comes before a step it
 * needs.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { mergeGraphs, useAmbitStore } from '../../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../../store/demo';
import NodeDetailPanel from '../NodeDetailPanel';
import { gapOf, routeTo, unlockedSince } from './layout.ts';

const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());

afterEach(() => {
  const empty = { items: [], connections: [], selectedItem: null, showDetailPanel: false };
  Object.assign(useAmbitStore.getInitialState(), empty);
  useAmbitStore.setState(empty);
});

test('every route covers its gap and puts each step after everything it needs', () => {
  const required = (id: string) =>
    connections.filter(c => c.type === 'hard-dep' && c.to === id).map(c => c.from);
  let routes = 0;
  for (const item of items.filter(i => i.status !== 'built')) {
    const gap = gapOf(items, connections, item.id).missing;
    const route = routeTo(items, connections, item.id);
    expect(new Set(route)).toEqual(gap);
    for (const [i, step] of route.entries()) {
      for (const need of required(step).filter(n => gap.has(n))) {
        expect([step, route.indexOf(need) < i]).toEqual([step, true]);
      }
    }
    if (route.length > 1) routes++;
  }
  // Launch Ready alone has six steps across four columns on the demo.
  expect(routes).toBeGreaterThan(3);
  expect(routeTo(items, connections, 'combo:launch-ready')[0]).toBe('combo:hosting');
});

test('the panel lists the steps in that order, under the sentence that names what blocks it', () => {
  // Server rendering reads the initial state, so both are set.
  const state = {
    items,
    connections,
    selectedItem: 'combo:launch-ready',
    showDetailPanel: true,
  };
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  const route = routeTo(items, connections, 'combo:launch-ready');
  const listed = [...html.matchAll(/<li><span>([^<]+)<\/span>/g)].map(m => m[1]);
  expect(listed).toEqual(route.map(id => items.find(i => i.id === id)?.name));
  expect(html).toContain('Show the steps on the map');
});

test('a rebuild that reached something says what, and what it makes a next step', () => {
  const hostingReached = items.map(i =>
    i.id === 'combo:hosting'
      ? { ...i, status: 'built' as const, meta: { ...i.meta, next: false } }
      : i.id === 'combo:error-tracking'
        ? { ...i, meta: { ...i.meta, next: true } }
        : i
  );
  expect(unlockedSince(items, hostingReached)).toBe(
    'Hosting reached, which makes Error Tracking a next step.'
  );
  // Nothing reached: no news, and the page says only that it reloaded.
  expect(unlockedSince(items, items)).toBeNull();
  // A node the old graph did not hold is the model growing, not the machine.
  expect(
    unlockedSince(
      items.filter(i => i.id !== 'combo:hosting'),
      hostingReached
    )
  ).toBeNull();
});
