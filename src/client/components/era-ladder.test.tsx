/**
 * The way into an era's ladder, and back out of it.
 *
 * The header of a column is drawn in SVG and the ladder opens in the detail
 * panel, and there is no DOM in this suite to click on. The pieces that carry
 * the wiring have no hooks, so they are called as functions and their handlers
 * pressed directly: what the header does on a click and on a key, what a rung
 * does, and what closes the ladder. The shell that decides the panel is open
 * for an era is rendered the way ui-density.test.tsx renders it.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import App from '../App';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import { findAll, type Props } from '../testing/elements';
import { eraLadder } from './civ/layout';
import { ColumnHead } from './CivTree';
import { EraLadderView } from './EraLadder';

/** The props the shell last handed the deck, so a test can press a view tab's own handler. */
const deck: { props?: Props } = {};
vi.mock('./AppDeck', async importOriginal => {
  const actual = await importOriginal<typeof import('./AppDeck')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      deck.props = props;
      return actual.default(props);
    },
  };
});

const progress = { total: 5, reached: 4, failing: 1, next: 0, blocked: 0, seconds: 0 };

const head = (
  column: string,
  onOpen: (era: number) => void = () => {},
  openEra: number | null = null
) =>
  ColumnHead({
    column,
    index: 2,
    label: 'Tool Use',
    progress,
    largest: 6,
    term: 'era',
    openEra,
    onOpen,
  }) as ReactElement<Props>;

test('an era header opens its era on a click, and on Enter or Space', () => {
  const opened: number[] = [];
  const el = head('era:3', era => opened.push(era));
  expect(el.props.role).toBe('button');

  el.props.onClick();
  const press = (key: string) => {
    let prevented = false;
    el.props.onKeyDown({ key, preventDefault: () => (prevented = true) });
    return prevented;
  };
  expect(press('Enter')).toBe(true);
  expect(press(' ')).toBe(true);
  // Any other key is left to the page: Escape closes things, the arrows scroll.
  expect(press('Escape')).toBe(false);
  expect(press('ArrowDown')).toBe(false);
  expect(opened).toEqual([3, 3, 3]);
});

test('an open era reads as pressed, and the others do not', () => {
  expect(head('era:3', () => {}, 3).props['aria-pressed']).toBe(true);
  expect(head('era:3', () => {}, 4).props['aria-pressed']).toBe(false);
  expect(head('era:3', () => {}, null).props['aria-pressed']).toBe(false);
});

test('a domain column has no ladder to open, so its header is not a control', () => {
  // The setup view's columns are domains: a name and a count, with nothing behind them.
  const el = head('infra');
  expect(findAll(el, e => e.props?.role === 'button')).toEqual([]);
});

test('a rung opens its node, and the ladder closes from its own button', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const ladder = eraLadder(items, connections, 3)!;
  const shown: string[] = [];
  let closed = 0;
  const tree = EraLadderView({
    ladder,
    onShow: id => shown.push(id),
    onClose: () => closed++,
  });

  const rungs = findAll(tree, e => String(e.props?.className ?? '').startsWith('sp-rung '));
  expect(rungs).toHaveLength(ladder.rows.length);
  rungs[0].props.onClick();
  rungs[rungs.length - 1].props.onClick();
  expect(shown).toEqual([ladder.rows[0].item.id, ladder.rows[ladder.rows.length - 1].item.id]);

  findAll(tree, e => e.props?.['aria-label'] === 'Close the ladder')[0].props.onClick();
  expect(closed).toBe(1);
});

// ── The shell ────────────────────────────────────────────────────────────────

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

beforeAll(() => {
  const mediaQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    localStorage: { getItem: () => '1', setItem() {} },
    window: {
      location: { search: '?guide=off' },
      matchMedia: () => mediaQuery,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
    },
  });
});

afterEach(() => {
  const clear = {
    items: [],
    connections: [],
    selectedItem: null,
    selectedEra: null,
    showDetailPanel: false,
  };
  Object.assign(useAmbitStore.getInitialState(), clear);
  useAmbitStore.setState(clear);
});

afterAll(() => {
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
});

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

test('an open era is a reason for the detail panel to be open, with nothing else selected', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ items, connections, selectedEra: 3, showDetailPanel: true });
  const open = renderToStaticMarkup(<App />);
  expect(open).toContain('app-detail-panel');
  expect(open).toContain('sp-ladder');

  seed({ selectedEra: null, showDetailPanel: false });
  expect(renderToStaticMarkup(<App />)).not.toContain('app-detail-panel');
});

test('leaving the map closes an era ladder, and a node keeps its panel in My Setup', () => {
  // The ladder stayed open over My Setup, covering the right edge of the list.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ items, connections, selectedEra: 3, showDetailPanel: true });
  renderToStaticMarkup(<App />);
  deck.props!.onShowView('config');
  expect(useAmbitStore.getState()).toMatchObject({ selectedEra: null, showDetailPanel: false });

  // A node's panel means the same thing over the list, so it stays.
  seed({ selectedEra: null, selectedItem: 'combo:shell-execution', showDetailPanel: true });
  renderToStaticMarkup(<App />);
  deck.props!.onShowView('config');
  expect(useAmbitStore.getState()).toMatchObject({
    selectedItem: 'combo:shell-execution',
    showDetailPanel: true,
  });

  // And back on the map, a ladder opened there is left alone.
  seed({ selectedItem: null, selectedEra: 2, showDetailPanel: true });
  renderToStaticMarkup(<App />);
  deck.props!.onShowView('tree');
  expect(useAmbitStore.getState().selectedEra).toBe(2);
});
