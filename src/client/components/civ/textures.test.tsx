/**
 * The map's two textures and the plate in relief.
 *
 * A texture is a filter over one half of a node, and each means one thing: a
 * waver on the ring of a capability that is recovering, and corrosion in the
 * fill of what an outage stops. These hold that each lands on that node, on
 * that half, and nowhere else; that a saved still carries the filters it
 * names; and that the relief keeps to the still's allow-list.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { useAmbitStore } from '../../store/ambitStore';
import { demoTreeGraph } from '../../store/demo';
import CivTree from '../CivTree';
import { outageSplit, recentFailures } from './layout';
import { MapStill, stillLayout } from './MapScene';
import { MapFilters, seedOf, waverOf } from './marks';
import { MapRelief } from './Relief';

/** The demo, whose Observability is recovering: two of its last four runs failed. */
const { items, connections } = demoTreeGraph();
const RECOVERING = 'combo:observability';

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() =>
  seed({
    items: [],
    connections: [],
    simulationMode: 'none',
    simulatedNodeId: null,
    simulatedCascadeIds: new Set(),
    simulatedWeakenedIds: new Set(),
  })
);

/**
 * What the map draws for each node, from its group to the next node's. The
 * map's svg ends the last one, so the key and the strip after it are not read
 * as part of a node.
 */
function nodes(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const scene = html.slice(0, html.indexOf('</svg>', html.lastIndexOf('data-node="')));
  for (const chunk of scene.split('data-node="').slice(1)) {
    out.set(chunk.slice(0, chunk.indexOf('"')), chunk);
  }
  return out;
}

const map = (drawn: Item[] = items) =>
  renderToStaticMarkup(
    <CivTree
      items={drawn}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
      onHover={() => {}}
    />
  );

test('a recovering ring wavers by how many recent runs failed, and its fill stays true', () => {
  expect(recentFailures(items.find(i => i.id === RECOVERING)!)).toBe(2);
  seed({ items, connections });
  const drawn = nodes(map());
  const node = drawn.get(RECOVERING)!;
  const waver = `-waver-2-${seedOf(RECOVERING)})`;
  // The fill circle carries no filter, and the ring after it carries the waver.
  expect(node).toMatch(
    new RegExp(`fill="none"[^>]*filter="url\\(#[^"]*${waver.replace(/[()]/g, '\\$&')}"`)
  );
  expect(node.match(/filter="/g)).toHaveLength(1);
  // And says so in words, where the slip cannot be seen.
  expect(map()).toContain(
    'aria-label="Observability, Combo, reached, recovering: 2 of the last 4 passed"'
  );
  // The strip under the map names it, as the key does, and lights it when pressed.
  const strip = (html: string) => {
    const at = html.indexOf('class="civ-strip"');
    return html.slice(at, html.indexOf('</div>', at));
  };
  expect(strip(map())).toMatch(/aria-pressed="false"[^>]*>(<svg.*?<\/svg>)?Recovering</);
  // With nothing recovering, the strip leaves it out.
  const healthy = items.map(i =>
    i.id === RECOVERING ? { ...i, meta: { ...i.meta, lifecycle: 'verified' } } : i
  );
  seed({ items: healthy, connections });
  expect(strip(map(healthy))).not.toContain('Recovering');
  seed({ items, connections });
  // Nothing else on the map wavers, and nothing corrodes at rest.
  for (const [id, body] of drawn) {
    if (id !== RECOVERING) expect([id, body.includes('-waver-')]).toEqual([id, false]);
    expect([id, body.includes('-corrode-')]).toEqual([id, false]);
  }
});

test('the waver steps from one to four, the same pattern every draw', () => {
  expect(waverOf('p', 0, 0).url).toBe('url(#p-waver-1-0)');
  expect(waverOf('p', 9, 2).url).toBe('url(#p-waver-4-2)');
  expect(seedOf(RECOVERING)).toBe(seedOf(RECOVERING));
  const defs = renderToStaticMarkup(
    <svg>
      <title>Filters</title>
      <MapFilters prefix="p" />
    </svg>
  );
  expect(defs.match(/id="p-waver-/g)).toHaveLength(12);
  expect(defs.match(/id="p-corrode-/g)).toHaveLength(3);
});

test('an outage corrodes the fill of what it stops, inside a ring that holds', () => {
  const root = 'combo:shell-execution';
  const { stops, weakened } = outageSplit(items, connections, root);
  seed({
    items,
    connections,
    simulationMode: 'outage',
    simulatedNodeId: root,
    simulatedCascadeIds: stops,
    simulatedWeakenedIds: weakened,
  });
  const drawn = nodes(map());
  const byId = new Map(items.map(i => [i.id, i]));
  const corroded = [...drawn].filter(([, body]) => body.includes('-corrode-')).map(([id]) => id);
  const expected = [...stops].filter(
    id =>
      drawn.has(id) &&
      byId.get(id)?.status === 'built' &&
      byId.get(id)?.meta?.lifecycle !== 'broken' &&
      !weakened.has(id)
  );
  expect(corroded.sort()).toEqual(expected.sort());
  expect(corroded.length).toBeGreaterThan(3);
  // The root is down, solid, with its callout; it is not eaten.
  expect(drawn.get(root)).not.toContain('-corrode-');
  // A corroded node's filter is on its fill, and its ring is drawn whole after it.
  const body = drawn.get(corroded[0])!;
  expect(body).toMatch(
    /stroke="none"[^>]*filter="url\(#[^"]*-corrode-\d\)"[^>]*>(<\/circle>)?<circle[^>]*fill="none" stroke="var\(--error\)"/
  );
  // The strip under the map names the outage's marks, as words that light nothing.
  const html = map();
  const strip = html.slice(html.indexOf('class="civ-strip"'));
  expect(strip).toContain('role="group"');
  expect(strip).toContain('Stops working');
  expect(strip).not.toContain('<button');
  // A screen reader hears what the texture says.
  expect(html).toContain(`aria-label="${byId.get(corroded[0])!.name}, Combo, reached`);
  expect(html).toMatch(/aria-label="[^"]*stops working in this simulation"/);
  // During a simulation the recovering ring is drawn true: the simulation paints the node.
  expect(drawn.get(RECOVERING)).not.toContain('-waver-');
  // Nor does a node it paints keep its check badge: "passing" on a node that stops.
  const badge = /fill="var\(--(ok|error)\)" stroke="var\(--bg-canvas\)"/;
  for (const id of [root, ...stops, ...weakened].filter(id => drawn.has(id))) {
    expect([id, badge.test(drawn.get(id)!)]).toEqual([id, false]);
  }
});

test('at rest a passing check keeps its badge', () => {
  seed({ items, connections });
  expect(map()).toMatch(/fill="var\(--ok\)" stroke="var\(--bg-canvas\)"/);
});

test('a saved still defines every filter its nodes name', () => {
  const { stops, weakened } = outageSplit(items, connections, 'combo:shell-execution');
  const layout = stillLayout(items, connections);
  const svg = renderToStaticMarkup(
    <MapStill
      items={items}
      connections={connections}
      layout={layout}
      simulation={{ mode: 'outage', rootId: 'combo:shell-execution', cascade: stops, weakened }}
    />
  );
  const named = new Set([...svg.matchAll(/filter="url\(#([^)]+)\)"/g)].map(m => m[1]));
  expect(named.size).toBeGreaterThan(0);
  for (const id of named) expect([id, svg.includes(`id="${id}"`)]).toEqual([id, true]);
});

test('the relief names no node, and counts what the map counts', () => {
  const layout = stillLayout(items, connections);
  const svg = renderToStaticMarkup(
    <MapRelief connections={connections} layout={layout} now={new Date(2026, 9, 21)} />
  );
  // No node's name: the plate is the shape of the reach, and the eras.
  for (const p of layout.positions.values()) {
    expect([p.item.id, svg.includes(`>${p.item.name}<`)]).toEqual([p.item.id, false]);
  }
  const drawn = [...layout.positions.values()].map(p => p.item);
  const ground = drawn.filter(i => i.status === 'built' && i.meta?.lifecycle !== 'broken');
  expect(svg).toContain(`${ground.length} of ${drawn.length} reached`);
  expect(svg).toContain('1 failing its check');
  expect(svg).toContain('21 Oct 2026');
  expect(svg).toContain('url(#relief)');
});
