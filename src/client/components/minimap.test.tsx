/**
 * The minimap, and the finding that names a direction.
 *
 * It is a thumbnail of the whole map with the part on screen outlined, drawn
 * only when the map does not fit, and the map's finding says which way a
 * failing node lies when it is out of sight. The rectangle arithmetic is in
 * viewport.test.ts. This holds what is drawn from it: a dot for every node,
 * the failing ones red and on top, the outline as a control that takes
 * focus, nothing at all where there is no scroller to measure, and the
 * sentence that carries the direction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import type { Item } from '../utils/configImporter';
import { findAll, type Props } from '../testing/elements';
import CivTree from './CivTree';
import { mapFindings, rungOf, visibleItems } from './civ/layout';
import { MapFinding } from './civ/MapFinding';
import { Minimap, MinimapView, type MinimapNode, readGeometry } from './civ/Minimap';
import { layoutNodes, buildColumns } from './civ/layout';
import { minimapModel } from './civ/viewport';

const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
const tree = visibleItems(items);
const columns = buildColumns(tree, connections);
const nodes: MinimapNode[] = [...layoutNodes(columns).values()].map(p => ({
  id: p.item.id,
  x: p.x,
  y: p.y,
  state: rungOf(p.item),
}));
const SCENE = { width: 1720, height: 760 };
const BOX = { width: 176, height: 124 };

/** A scroller that shows the top left of the demo map at zoom 1, and not all of it. */
const model = minimapModel(
  {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 1000,
    clientHeight: 600,
    scrollWidth: 1728,
    scrollHeight: 844,
    offsetX: 8,
    offsetY: 84,
    zoom: 1,
  },
  SCENE,
  BOX
)!;

const draw = (extra: Partial<Parameters<typeof MinimapView>[0]> = {}) =>
  renderToStaticMarkup(
    <MinimapView model={model} scene={SCENE} columns={9} nodes={nodes} {...extra} />
  );

test('the thumbnail has an era bar for every column and a dot for every node', () => {
  const html = draw();
  expect(html.match(/civ-minimap-band/g)).toHaveLength(9);
  // The demo tree is 46 curated nodes: the machine's own entries are not on the map.
  expect(nodes).toHaveLength(46);
  expect(html.match(/civ-minimap-dot /g)).toHaveLength(46);
});

test('a failing node is a red dot, drawn last, and larger than the rest', () => {
  const html = draw();
  expect(html.match(/civ-minimap-dot--failing/g)).toHaveLength(1);
  // Drawn after every dot that is fine, so nothing sits on top of it.
  expect(html.lastIndexOf('civ-minimap-dot--failing')).toBeGreaterThan(
    html.lastIndexOf('civ-minimap-dot--reached')
  );
  const radii = [...html.matchAll(/civ-minimap-dot civ-minimap-dot--(\w+)"[^>]*r="([\d.]+)"/g)].map(
    m => ({ state: m[1], r: Number(m[2]) })
  );
  const failing = radii.find(d => d.state === 'failing')!;
  const ordinary = radii.find(d => d.state === 'reached')!;
  expect(failing.r).toBeGreaterThan(ordinary.r);
  // The other three states are drawn too, in their own colours.
  for (const state of ['reached', 'next', 'blocked']) {
    expect(html).toContain(`civ-minimap-dot--${state}`);
  }
});

test('only the failing node of a healthy map is missing from the red dots', () => {
  const healthy = nodes.map(n => (n.state === 'failing' ? { ...n, state: 'reached' as const } : n));
  expect(draw({ nodes: healthy })).not.toContain('civ-minimap-dot--failing');
});

test('the outline is a control the keyboard can reach, and it says how to move it', () => {
  const html = draw();
  // A button takes focus and needs no tabindex; the label is what says what the arrows do.
  expect(html).toMatch(/<button[^>]*class="civ-minimap-view"/);
  // A short name, and how to use it as its description: the name was the sentence.
  expect(html).toContain('aria-label="Part of the map in view"');
  expect(html).toMatch(/aria-describedby="civ-minimap-help"[\s\S]*id="civ-minimap-help"/);
  expect(html).toContain('use the arrow keys to move the view');
  expect(html).toContain('Home');
  expect(html).toContain('Enter goes into the map there');
});

test('the outline is drawn where the model puts it', () => {
  // React writes a zero without its unit.
  const css = (n: number) => (n === 0 ? '0' : `${n}px`);
  const place = (m: typeof model) =>
    `left:${css(m.view.left)};top:${css(m.view.top)};width:${css(m.view.width)};height:${css(m.view.height)}`;
  expect(draw()).toContain(place(model));

  // Scrolled and zoomed, the outline moves and shrinks with it.
  const scrolled = minimapModel(
    {
      scrollLeft: 408,
      scrollTop: 384,
      clientWidth: 1000,
      clientHeight: 600,
      scrollWidth: 2688,
      scrollHeight: 1604,
      offsetX: 8,
      offsetY: 84,
      zoom: 2,
    },
    SCENE,
    BOX
  )!;
  expect(scrolled.view.left).toBeGreaterThan(0);
  expect(draw({ model: scrolled })).toContain(place(scrolled));
  expect(draw({ model: scrolled })).not.toContain(place(model));
});

test('the thumbnail stays left of the detail panel, whatever its width', () => {
  expect(draw({ rightInset: 0 })).toContain('right:12px');
  expect(draw({ rightInset: 340 })).toContain('right:352px');
});

test('the handlers a press and a key are given are the ones the thumbnail carries', () => {
  const seen: string[] = [];
  const tree = MinimapView({
    model,
    scene: SCENE,
    columns: 7,
    nodes,
    onPointerDown: () => seen.push('down'),
    onPointerMove: () => seen.push('move'),
    onPointerRelease: () => seen.push('release'),
    onKeyDown: () => seen.push('key'),
  }) as ReactElement<Props>;
  const body = findAll(tree, e => String(e.props?.className) === 'civ-minimap-body')[0];
  body.props.onPointerDown();
  body.props.onPointerMove();
  body.props.onPointerUp();
  body.props.onPointerCancel();
  findAll(tree, e => String(e.props?.className) === 'civ-minimap-view')[0].props.onKeyDown();
  expect(seen).toEqual(['down', 'move', 'release', 'release', 'key']);
});

// ── Nothing where there is nothing to measure ────────────────────────────────

test('the map draws no minimap on the server, where no scroller has been measured', () => {
  // Every measurement is read in an effect, and an effect never runs on the
  // server: the tree renders there, and the thumbnail is not part of it.
  const html = renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
    />
  );
  expect(html).not.toContain('civ-minimap');

  expect(
    renderToStaticMarkup(
      <Minimap
        containerRef={{ current: null }}
        zoom={1}
        width={SCENE.width}
        height={SCENE.height}
        columns={9}
        nodes={nodes}
      />
    )
  ).toBe('');
});

test('the tour has the corner to itself: no minimap while it narrates the map', () => {
  // Nothing measures a scroller on the server, so the thumbnail cannot be seen
  // to be missing from a render; the condition is checked where it is written.
  const source = readFileSync(join(import.meta.dirname, 'CivTree.tsx'), 'utf8');
  expect(source).toMatch(/\{!narrated && [^(]*\(\s*<Minimap/);
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAmbitStore.setState({ items: [], connections: [] });
});

test('the scroller is read the way fit reads it: left padding, and top padding plus the canvas margin', () => {
  const svg = {};
  const el = {
    scrollLeft: 30,
    scrollTop: 40,
    clientWidth: 1000,
    clientHeight: 600,
    scrollWidth: 1600,
    scrollHeight: 1200,
    querySelector: () => svg,
  };
  const styles = new Map<unknown, Record<string, string>>([
    [el, { paddingLeft: '8px', paddingTop: '40px' }],
    [svg, { marginTop: '44px' }],
  ]);
  vi.stubGlobal('getComputedStyle', (node: unknown) => styles.get(node));

  expect(readGeometry(el as unknown as HTMLElement, 1.5)).toEqual({
    scrollLeft: 30,
    scrollTop: 40,
    clientWidth: 1000,
    clientHeight: 600,
    scrollWidth: 1600,
    scrollHeight: 1200,
    offsetX: 8,
    offsetY: 84,
    zoom: 1.5,
  });

  // A phone drops the headline's padding; a scroller with no canvas has no margin to add.
  styles.set(el, { paddingLeft: '8px', paddingTop: '0px' });
  expect(readGeometry(el as unknown as HTMLElement, 1).offsetY).toBe(44);
  el.querySelector = () => null as never;
  expect(readGeometry(el as unknown as HTMLElement, 1).offsetY).toBe(0);
});

// ── The finding names a direction ────────────────────────────────────────────

const broken = items.filter(i => i.meta?.lifecycle === 'broken');
const found = mapFindings(items, connections);
const finding = (where: string | null | undefined, failing: Item[] = found.failing) =>
  renderToStaticMarkup(
    <MapFinding
      findings={{ ...found, failing }}
      onShow={() => {}}
      onPreview={() => {}}
      where={where}
    />
  ).replace(/<[^>]+>/g, '');

test('the failing finding says which way the node lies when it is out of sight', () => {
  expect(broken.map(i => i.name)).toEqual(['Browser Automation']);
  expect(finding('left')).toContain(
    'Browser Automation is configured but failing its check. It is off-screen left.'
  );
  expect(finding('top right')).toContain('It is off-screen top right.');
});

test('in view, or with the whole map on screen, the finding says nothing of direction', () => {
  expect(finding(null)).not.toContain('off-screen');
  expect(finding(undefined)).not.toContain('off-screen');
  expect(finding(null)).toContain('Browser Automation is configured but failing its check.');
});

test('with several failing, the direction is the first one, which is where Show goes', () => {
  const two = [broken[0], { ...broken[0], id: 'combo:other', name: 'Other' }];
  expect(finding('left', two)).toContain(
    'Browser Automation and Other are configured but failing their checks. The first is off-screen left.'
  );
});
