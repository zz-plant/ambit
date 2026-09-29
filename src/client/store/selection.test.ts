/**
 * What the detail panel has open: a node, or an era's ladder, and never both.
 *
 * An era header opens its ladder in the same panel a node uses. The two share
 * one slot, so opening either has to close the other, and every way of
 * clearing a selection (Escape, the panel's close button, pressing the header
 * again) has to clear the ladder too, or the panel would be left holding a
 * ladder for a selection nobody made.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAmbitStore } from './ambitStore';

const store = () => useAmbitStore.getState();

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useAmbitStore.setState({
    selectedItem: null,
    selectedEra: null,
    showDetailPanel: false,
    collapsed: false,
    collapseDepth: 2,
    collapseDirection: 'both',
  });
});

test('an era header opens its ladder in the panel, and pressing it again closes it', () => {
  store().selectEra(3);
  expect(store()).toMatchObject({ selectedEra: 3, selectedItem: null, showDetailPanel: true });

  store().selectEra(3);
  expect(store()).toMatchObject({ selectedEra: null, selectedItem: null, showDetailPanel: false });
});

test('a node and an era are never open together', () => {
  store().selectItem('combo:shell-execution');
  store().selectEra(2);
  // The era took the panel, and the node is no longer the selection.
  expect(store()).toMatchObject({ selectedEra: 2, selectedItem: null, showDetailPanel: true });

  store().selectItem('combo:tool-protocol');
  expect(store()).toMatchObject({
    selectedEra: null,
    selectedItem: 'combo:tool-protocol',
    showDetailPanel: true,
  });
});

test('another era replaces the one that is open', () => {
  store().selectEra(3);
  store().selectEra(4);
  expect(store()).toMatchObject({ selectedEra: 4, showDetailPanel: true });
});

test('clearing the selection clears the ladder, which is how Escape and the close button end it', () => {
  store().selectEra(4);
  store().selectItem(null);
  expect(store()).toMatchObject({ selectedEra: null, selectedItem: null, showDetailPanel: false });

  store().selectEra(4);
  store().selectEra(null);
  expect(store()).toMatchObject({ selectedEra: null, showDetailPanel: false });
});

// ── A collapse follows the selection ─────────────────────────────────────────

test('the store opens on the map as it always was: no collapse, two hops, both ways', () => {
  const initial = useAmbitStore.getInitialState();
  expect(initial.collapsed).toBe(false);
  expect(initial.collapseDepth).toBe(2);
  expect(initial.collapseDirection).toBe('both');
});

test('a collapse goes with the selection to another node', () => {
  store().selectItem('combo:shell-execution');
  store().setCollapsed(true);
  store().selectItem('combo:tool-protocol');
  expect(store()).toMatchObject({ selectedItem: 'combo:tool-protocol', collapsed: true });
});

test('with nothing selected there is nothing to collapse to, so clearing the selection ends it', () => {
  // Escape, the panel's close button and pressing the selected node again all
  // clear the selection. A collapse left on would catch the next node picked.
  store().selectItem('combo:shell-execution');
  store().setCollapsed(true);
  store().selectItem(null);
  expect(store()).toMatchObject({ selectedItem: null, collapsed: false });

  store().selectItem('combo:shell-execution');
  store().setCollapsed(true);
  store().selectItem('combo:shell-execution');
  expect(store()).toMatchObject({ selectedItem: null, collapsed: false });

  // And the next node picked is the whole map.
  store().selectItem('combo:tool-protocol');
  expect(store().collapsed).toBe(false);
});

test('opening an era deselects the node, and ends the collapse with it', () => {
  store().selectItem('combo:shell-execution');
  store().setCollapsed(true);
  store().selectEra(3);
  expect(store()).toMatchObject({ selectedItem: null, selectedEra: 3, collapsed: false });
});

test('the depth and the direction are kept while the collapse is off', () => {
  store().selectItem('combo:shell-execution');
  store().setCollapseDepth(3);
  store().setCollapseDirection('needs');
  store().setCollapsed(true);
  store().selectItem(null);
  // Turning it on again finds the reader's choices where they left them.
  expect(store()).toMatchObject({ collapsed: false, collapseDepth: 3, collapseDirection: 'needs' });
});

test('the reset the store offers clears a collapse too', () => {
  store().selectItem('combo:shell-execution');
  store().setCollapsed(true);
  store().reset();
  expect(store()).toMatchObject({ selectedItem: null, collapsed: false });
});

test('a link that asks for a collapse opens the store collapsed, as the address bar said', async () => {
  // The store reads the address bar once, when it is made.
  vi.stubGlobal('location', { search: '?view=tree&collapse=1&depth=3&dir=enables' });
  vi.resetModules();
  const { useAmbitStore: opened } = await import('./ambitStore');
  expect(opened.getState()).toMatchObject({
    collapsed: true,
    collapseDepth: 3,
    collapseDirection: 'enables',
  });

  // And a link that does not is the map as it always was.
  vi.stubGlobal('location', { search: '?view=tree&focus=combo:shell-execution' });
  vi.resetModules();
  const { useAmbitStore: plain } = await import('./ambitStore');
  expect(plain.getState()).toMatchObject({
    collapsed: false,
    collapseDepth: 2,
    collapseDirection: 'both',
  });
});
