/**
 * What the detail panel has open: a node, or an era's ladder, and never both.
 *
 * An era header opens its ladder in the same panel a node uses. The two share
 * one slot, so opening either has to close the other, and every way of
 * clearing a selection (Escape, the panel's close button, pressing the header
 * again) has to clear the ladder too, or the panel would be left holding a
 * ladder for a selection nobody made.
 */
import { beforeEach, expect, test } from 'vitest';
import { useAmbitStore } from './ambitStore';

const store = () => useAmbitStore.getState();

beforeEach(() => {
  useAmbitStore.setState({ selectedItem: null, selectedEra: null, showDetailPanel: false });
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
