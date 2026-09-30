/**
 * Collapsing the map to a node's neighbourhood.
 *
 * It is opt-in: a Focus control on the selected node, off until pressed, so
 * every link, the tour and the hero recording that select nodes are unchanged.
 * Pressed, the map keeps only what the node needs and enables within a few
 * hops and skips the rest where it draws, so the columns do not move. The walk
 * is in layout.test.ts and the URL in linkState.test.ts. This holds what the
 * reader sees: the control and its pill, what the map draws and leaves out, and
 * what stays whole, which is the header's counts and a simulation's sentence.
 */
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import App from '../App';
import { linkFocus, readLinkState, writeLinkState } from '../linkState';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import { collapseTo, outageSplit, visibleItems } from './civ/layout';
import { SimulationBanner } from './civ/SimulationBanner';
import CivTree from './CivTree';
import { FocusControls } from './FocusControls';
import NodeDetailPanel from './NodeDetailPanel';

type Props = Record<string, any>;

// The writer the shell hands the view to, watched: see the address bar below.
vi.mock('../linkState', async importOriginal => {
  const actual = await importOriginal<typeof import('../linkState')>();
  return { ...actual, writeLinkState: vi.fn(actual.writeLinkState) };
});

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

beforeAll(() => {
  const mediaQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    localStorage: { getItem: () => '1', setItem() {} },
    window: {
      location: { search: '?view=tree&guide=off' },
      matchMedia: () => mediaQuery,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
    },
  });
});

afterAll(() => {
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
});

function findAll(
  node: ReactNode,
  match: (el: ReactElement<Props>) => boolean,
  out: ReactElement<Props>[] = []
): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, match, out);
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<Props>;
    if (match(el)) out.push(el);
    findAll(el.props?.children, match, out);
  }
  return out;
}

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({
    items: [],
    connections: [],
    selectedItem: null,
    selectedEra: null,
    showDetailPanel: false,
    collapsed: false,
    collapseDepth: 2,
    collapseDirection: 'both',
    simulationMode: 'none',
    simulatedNodeId: null,
    simulatedCascadeIds: new Set<string>(),
    simulatedWeakenedIds: new Set<string>(),
  });
});

const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
const drawn = visibleItems(items);
const ROOT = 'combo:local-runtime';

const controls = (extra: Partial<Parameters<typeof FocusControls>[0]> = {}) => ({
  on: false,
  depth: 2 as const,
  direction: 'both' as const,
  hidden: 23,
  onToggle: () => {},
  onDepth: () => {},
  onDirection: () => {},
  onClear: () => {},
  ...extra,
});

// ── The control ──────────────────────────────────────────────────────────────

test('Focus is off until pressed, and offers nothing else while it is', () => {
  const html = renderToStaticMarkup(<FocusControls {...controls()} />);
  expect(html).toContain('Focus on this node');
  expect(html).toContain('aria-pressed="false"');
  expect(html).not.toContain('sp-seg');
  expect(html).not.toContain('hidden');
});

test('pressed, it offers a direction and a depth, with the current ones marked', () => {
  const html = renderToStaticMarkup(
    <FocusControls {...controls({ on: true, depth: 3, direction: 'needs' })} />
  );
  for (const word of ['Needs', 'Both', 'Enables']) expect(html).toContain(`>${word}<`);
  for (const n of ['1 hop', '2 hops', '3 hops']) expect(html).toContain(`aria-label="${n}"`);

  const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>(?:<[^>]+>)*([^<]+)</g)].map(
    m => m[1]
  );
  // The toggle itself, then the direction, then the depth.
  expect(pressed).toEqual(['Focus on this node', 'Needs', '3']);
});

test('the pill says how many nodes are hidden, and brings them back', () => {
  const html = renderToStaticMarkup(<FocusControls {...controls({ on: true, hidden: 23 })} />);
  expect(html).toContain('<strong>23</strong> hidden · Show all');
  expect(html).not.toContain('Nothing is hidden');
});

test('with nothing hidden it says so, and offers no pill to press', () => {
  const html = renderToStaticMarkup(<FocusControls {...controls({ on: true, hidden: 0 })} />);
  expect(html).toContain('Nothing is hidden at this depth.');
  expect(html).not.toContain('sp-focus-pill');
});

test('each control does what it says', () => {
  const calls: string[] = [];
  const tree = FocusControls(
    controls({
      on: true,
      onToggle: () => calls.push('toggle'),
      onDepth: d => calls.push(`depth ${d}`),
      onDirection: d => calls.push(`direction ${d}`),
      onClear: () => calls.push('clear'),
    })
  ) as ReactElement<Props>;
  const buttons = findAll(tree, e => e.type === 'button');
  const press = (label: (e: ReactElement<Props>) => boolean) =>
    buttons.find(label)!.props.onClick();

  press(e => e.props.className.includes('sp-action-btn--focus'));
  press(e => e.props.children === 'Needs');
  press(e => e.props.children === 'Enables');
  press(e => e.props['aria-label'] === '3 hops');
  press(e => e.props['aria-label'] === '1 hop');
  press(e => e.props.className === 'sp-focus-pill');
  expect(calls).toEqual([
    'toggle',
    'direction needs',
    'direction enables',
    'depth 3',
    'depth 1',
    'clear',
  ]);
});

// ── The panel offers it, on the nodes that have a place to collapse to ───────

test('the panel offers Focus on a node of the map, and not on an entry of My Setup', () => {
  seed({ items, connections, selectedItem: ROOT, showDetailPanel: true });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).toContain('Focus on this node');

  // mcp:git is something the machine declares, and it has no column on the map.
  seed({ selectedItem: 'mcp:git' });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('Focus on this node');
});

test('the pill in the panel counts what the map hides: the whole map less what is drawn', () => {
  seed({ items, connections, selectedItem: ROOT, showDetailPanel: true, collapsed: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  const c = collapseTo(items, connections, ROOT, 2, 'both')!;
  expect(c.total).toBe(drawn.length);
  expect(c.hidden).toBe(drawn.length - c.shown.size);
  expect(c.hidden).toBeGreaterThan(0);
  expect(html).toContain(`<strong>${c.hidden}</strong> hidden · Show all`);

  // A change of depth or direction changes what is hidden, and the pill follows.
  seed({ collapseDepth: 1, collapseDirection: 'needs' });
  const narrow = collapseTo(items, connections, ROOT, 1, 'needs')!;
  expect(narrow.hidden).toBeGreaterThan(c.hidden);
  expect(renderToStaticMarkup(<NodeDetailPanel />)).toContain(
    `<strong>${narrow.hidden}</strong> hidden`
  );
});

// ── The map ──────────────────────────────────────────────────────────────────

const map = (extra: Partial<Parameters<typeof CivTree>[0]> = {}) =>
  renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={ROOT}
      hoveredId={null}
      onSelect={() => {}}
      {...extra}
    />
  );

/** Each node's place on the map, by name: the translate its group is drawn at. */
const places = (html: string) =>
  new Map(
    [
      ...html.matchAll(
        /<g transform="translate\(([\d.]+), ([\d.]+)\)"[^>]*aria-label="([^"]+), possibility"/g
      ),
    ].map(m => [m[3], `${m[1]},${m[2]}`])
  );
const edgesIn = (html: string) => html.match(/d="M-?[\d.]+,-?[\d.]+ C/g)?.length ?? 0;

test('the map draws every node until a collapse is asked for', () => {
  seed({ items, connections });
  expect(places(map()).size).toBe(drawn.length);
});

test('a collapse draws the neighbourhood and leaves the rest out', () => {
  seed({ items, connections, collapsed: true, collapseDepth: 2, collapseDirection: 'both' });
  const { shown } = collapseTo(items, connections, ROOT, 2, 'both')!;
  const seen = places(map());

  expect([...seen.keys()].sort()).toEqual(
    drawn
      .filter(i => shown.has(i.id))
      .map(i => i.name)
      .sort()
  );
  expect(seen.size).toBeLessThan(drawn.length);
  // The node in focus is always there.
  expect(seen.has('Local Runtime')).toBe(true);
});

test('the nodes that stay keep their places, so the columns do not jump', () => {
  seed({ items, connections });
  const whole = places(map());
  seed({ collapsed: true });
  const collapsed = places(map());

  expect(collapsed.size).toBeGreaterThan(1);
  for (const [name, at] of collapsed) expect(at).toBe(whole.get(name));
});

test('an edge is drawn only between two nodes the map draws', () => {
  seed({ items, connections });
  const before = edgesIn(map());
  seed({ collapsed: true });
  const { shown } = collapseTo(items, connections, ROOT, 2, 'both')!;
  const between = connections.filter(c => shown.has(c.from) && shown.has(c.to)).length;

  expect(edgesIn(map())).toBe(between);
  expect(between).toBeLessThan(before);
});

test('the header counts stay whole-map, whatever the collapse hides', () => {
  const headers = (html: string) => html.match(/>Era \d: [^<]*</g);
  seed({ items, connections });
  const whole = headers(map());
  seed({ collapsed: true, collapseDepth: 1, collapseDirection: 'needs' });
  const collapsed = headers(map());

  expect(whole).toHaveLength(7);
  expect(collapsed).toEqual(whole);
});

test('a collapse keys on the selection, never on what the pointer is over', () => {
  seed({ items, connections, collapsed: true });
  const { shown } = collapseTo(items, connections, ROOT, 2, 'both')!;
  const outside = drawn.find(i => !shown.has(i.id))!;
  const inside = drawn.find(i => i.id !== ROOT && shown.has(i.id))!;

  // Hovering a node the collapse hides does not bring it back, or move the collapse there.
  const hidden = places(map({ hoveredId: outside.id }));
  expect(hidden.has(outside.name)).toBe(false);
  expect(hidden.size).toBe(shown.size);
  expect(hidden.size).toBe(places(map({ hoveredId: null })).size);
  expect(hidden.size).toBe(places(map({ hoveredId: inside.id })).size);
});

test('hovering a node the collapse hides draws no tooltip for it, and one that is drawn does', () => {
  seed({ items, connections });
  const { shown } = collapseTo(items, connections, ROOT, 2, 'both')!;
  const outside = drawn.find(i => !shown.has(i.id))!;
  const inside = drawn.find(i => i.id !== ROOT && shown.has(i.id))!;
  const tip = 'Click: details, and simulate';

  // On the whole map the tooltip is there for either.
  expect(map({ hoveredId: outside.id })).toContain(tip);

  seed({ collapsed: true });
  expect(map({ hoveredId: outside.id })).not.toContain(tip);
  expect(map({ hoveredId: inside.id })).toContain(tip);
});

test('with nothing selected the map is whole, even with the collapse on', () => {
  seed({ items, connections, collapsed: true });
  expect(places(map({ selectedId: null })).size).toBe(drawn.length);
});

// ── A simulation ignores the collapse, and says so ───────────────────────────

const banner = (html: string) =>
  html.match(/civ-sim-banner[^>]*>.*?<span>(.*?)<\/span>/)?.[1].replace(/<[^>]+>/g, '') ?? '';

test('a simulation counts the whole cascade and says how much of it the collapse hides', () => {
  const { stops, weakened } = outageSplit(items, connections, ROOT);
  seed({
    items,
    connections,
    collapsed: true,
    collapseDepth: 1,
    collapseDirection: 'both',
    simulationMode: 'outage',
    simulatedNodeId: ROOT,
    simulatedCascadeIds: stops,
    simulatedWeakenedIds: weakened,
  });
  const { shown } = collapseTo(items, connections, ROOT, 1, 'both')!;
  const onMap = new Set(drawn.map(i => i.id));
  const hiding = [...stops, ...weakened].filter(id => onMap.has(id) && !shown.has(id)).length;
  expect(hiding).toBeGreaterThan(0);

  const collapsed = banner(map());
  expect(collapsed).toContain(`The focus hides ${hiding} of them.`);

  // The sentence itself is the same one the whole map says: the counts are the whole cascade.
  seed({ collapsed: false });
  const whole = banner(map());
  expect(whole).not.toContain('The focus hides');
  expect(collapsed.replace(/ The focus hides \d+ of them\./, '')).toBe(whole);
});

test('a simulation that reaches nothing the collapse hides says nothing of it', () => {
  const props = {
    simulationMode: 'outage',
    simulatedNodeId: ROOT,
    simulatedItem: items.find(i => i.id === ROOT),
    simulatedCascadeIds: new Set(['combo:model-routing']),
    items,
    clearSimulation: () => {},
  };
  const plain = (hiddenByFocus?: number) =>
    renderToStaticMarkup(<SimulationBanner {...props} hiddenByFocus={hiddenByFocus} />);
  expect(plain()).not.toContain('The focus');
  expect(plain(0)).not.toContain('The focus');
  expect(plain(1)).toContain('The focus hides 1 of them.');
  expect(plain(7)).toContain('The focus hides 7 of them.');
});

// ── The address bar ──────────────────────────────────────────────────────────

test('the shell hands the collapse to the address bar with the rest of the view', () => {
  // The address bar is written in an effect, which a server render never runs,
  // so what the shell hands the writer is read off the writer itself.
  seed({
    items,
    connections,
    selectedItem: ROOT,
    showDetailPanel: true,
    collapsed: true,
    collapseDepth: 1,
    collapseDirection: 'needs',
  });
  vi.mocked(writeLinkState).mockClear();
  renderToStaticMarkup(<App />);
  expect(vi.mocked(writeLinkState).mock.lastCall?.[0]).toMatchObject({
    view: 'tree',
    focusId: ROOT,
    collapse: true,
    depth: 1,
    dir: 'needs',
  });
});

test('a link lands collapsed only on a node the graph holds, and the address bar says so', () => {
  // What the shell does with a link once the graph is read: find its node
  // (linkFocus), select it, apply the collapse, and write the view back.
  const land = (search: string) => {
    const link = readLinkState(search);
    seed({ items, connections, selectedItem: null, collapsed: false });
    const found = linkFocus(link, items);
    if (found) {
      useAmbitStore.getState().selectItem(found.id);
      if (found.collapse) useAmbitStore.getState().setCollapsed(true);
    }
    const s = useAmbitStore.getState();
    return writeLinkState({
      view: link.view,
      focusId: s.selectedItem,
      docsOpen: false,
      demo: false,
      lens: 'default',
      collapse: s.collapsed,
      depth: link.depth,
      dir: link.dir,
    });
  };
  expect(land(`?view=tree&focus=${ROOT}&collapse=1&depth=1`)).toBe(
    `?view=tree&focus=${encodeURIComponent(ROOT)}&collapse=1&depth=1`
  );
  // With no node, or one this graph lacks, the collapse is dropped from the
  // address bar, and the first node clicked is the whole map.
  expect(land('?view=tree&collapse=1')).toBe('?view=tree');
  expect(land('?view=tree&focus=combo:nope&collapse=1')).toBe('?view=tree');
  useAmbitStore.getState().selectItem('combo:model-routing');
  expect(useAmbitStore.getState().collapsed).toBe(false);
  expect(places(map({ selectedId: 'combo:model-routing' })).size).toBe(drawn.length);
});
