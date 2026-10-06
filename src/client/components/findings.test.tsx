/**
 * Every view states its finding before its evidence.
 *
 * The interface computed what mattered and then printed it in the quietest
 * type on the page: a failing check as a red dot among sixty circles, "never
 * verified" in muted grey under a green "Reached", a column reading "Enabled"
 * twenty-eight times, and the page's best number in the first of five equal
 * cards. These pin the sentence each surface now leads with, and that the
 * demo's pages agree about what is broken.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import type { Item } from '../utils/configImporter';
import { demoSnapshot } from '../utils/demoSnapshot';
import CivTree from './CivTree';
import { MapFinding } from './civ/MapFinding';
import {
  headlineReserve,
  mapFindings,
  outageImpact,
  outageSentence,
  outageSplit,
} from './civ/layout';
import LoopDashboard from './LoopDashboard';
import NodeDetailPanel from './NodeDetailPanel';
import SetupView from './SetupView';

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
    loop: null,
    loopSource: null,
  });
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;|&rsquo;/g, "'");

const tree = demoTreeGraph();
const merged = {
  items: [
    ...tree.items,
    ...demoConfigGraph().items.filter(i => !tree.items.some(t => t.id === i.id)),
  ],
  connections: tree.connections,
};

test('the demo pages agree about what is broken', () => {
  // Time & cost reported "E2E on Edge" failing, a name no node on the map had,
  // and 38 checks passing over a map on which nothing had been checked.
  const failingOnMap = tree.items
    .filter(i => ['degraded', 'broken'].includes(String(i.meta?.lifecycle)))
    .map(i => i.name);
  const { status } = demoSnapshot();
  expect(failingOnMap.length).toBeGreaterThan(0);
  expect(status.degraded).toEqual(failingOnMap);
  expect(status.verified).toBe(
    tree.items.filter(i => ['verified', 'reliable'].includes(String(i.meta?.lifecycle))).length
  );
});

test('the map names the failing check first, and otherwise the best next step', () => {
  const found = mapFindings(tree.items, tree.connections);
  expect(found.failing.map(i => i.name)).toContain('Browser Automation');
  expect(found.best).toBeDefined();

  // With nothing failing, the next step that reaches the most is the finding.
  const healthy = tree.items.map(i => ({ ...i, meta: { ...i.meta, lifecycle: 'verified' } }));
  const calm = mapFindings(healthy, tree.connections);
  expect(calm.failing).toEqual([]);
  const next = healthy.filter(i => i.status !== 'built' && i.meta?.next === true);
  expect(next.map(i => i.id)).toContain(calm.best?.item.id);
});

test('an unchecked node says so first, in a colour, with the command that settles it', () => {
  const node = tree.items.find(i => i.id === 'combo:code-intelligence') as Item;
  expect(node.meta?.lifecycle).toBe('configured');
  seed({ ...merged, selectedItem: node.id });
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  expect(html).toContain('sp-verdict--warn');
  expect(html).toContain('Configured, never checked');
  expect(html).toContain('sp-status--warn');
  expect(html.indexOf('sp-verdict')).toBeLessThan(html.indexOf('sp-impact'));
});

test('a failing node reads as not working, never as a green "Reached"', () => {
  seed({ ...merged, selectedItem: 'combo:browser-automation' });
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  expect(html).toContain('Configured, but not working');
  expect(html).toContain('sp-status--bad');
  expect(html).not.toContain('sp-status--built');
});

test('My Setup leads with what is failing and what provides nothing', () => {
  // In the sample every server supplies Tool Protocol at least, so two are
  // stripped of their edges to stand for servers that supply nothing. They
  // looked idle in the sample itself only while the seed kept six providers
  // a capability and dropped the rest.
  const idle = new Set(['mcp:grafana', 'mcp:kubernetes']);
  const connections = [...merged.connections, ...demoConfigGraph().connections].filter(
    c => !idle.has(c.from)
  );
  seed({ ...merged, connections });
  const html = text(renderToStaticMarkup(<SetupView onShow={() => {}} />));
  expect(html).toContain('playwright provides something whose check is failing');
  expect(html).toContain('grafana and kubernetes are enabled but provide nothing on the map');
  expect(html).toContain('check failing');
  expect(html).toContain('check passed');
});

test('Time & cost opens on the saving and the move that pays back soonest', () => {
  seed({ ...merged, loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard onShowOnMap={() => {}} />);
  const soonest = [...demoSnapshot().opportunities]
    .filter(o => o.payback_months != null)
    .sort((a, b) => (a.payback_months as number) - (b.payback_months as number))[0];
  expect(html).toContain('loop-lead');
  expect(text(html)).toContain(`Next: ${soonest.title}`);
  // Something configured and not working is an alert above the figures.
  expect(html.indexOf('fig--alert')).toBeGreaterThan(-1);
  expect(html.indexOf('fig--alert')).toBeLessThan(html.indexOf('fig-kpis'));
});

test('the map leads with the verified range, and the one loss that would stop the most', () => {
  const { items, connections } = merged;
  const found = mapFindings(items, connections);
  // The count the header and Time & cost report: tree nodes with a passing check.
  expect(found.verified).toBe(demoSnapshot().status.verified);
  // The weakest point is a piece of the setup, not the agent runtime itself,
  // and its count is the one the outage banner states when it is simulated.
  const weakest = found.weakest!;
  expect(weakest.item.type).not.toBe('runtime');
  // A node the map draws, never an entry that happens to share its name.
  expect(weakest.item.meta?.era).toBeDefined();
  const said = outageSentence(
    weakest.item.name,
    outageImpact(items, outageSplit(items, connections, weakest.item.id))
  );
  expect(said.count).toBe(`${weakest.stops} capabilities`);
});

test('the week is stated as movement, and its absence is said, never printed as +0', () => {
  const found = mapFindings(merged.items, merged.connections);
  // The range line follows a headline about the next step; a failing check
  // stands alone, so this reads the demo as though nothing were failing.
  const render = (since: Parameters<typeof MapFinding>[0]['since']) =>
    text(
      renderToStaticMarkup(
        <MapFinding
          findings={{ ...found, failing: [] }}
          since={since}
          onShow={() => {}}
          onPreview={() => {}}
        />
      )
    );
  const week = render(demoSnapshot().since);
  expect(week).toContain(`${found.verified} verified`);
  expect(week).toContain('+2');
  expect(week).toContain('−1');
  expect(week).toContain('this week');
  expect(render(null)).toContain('no earlier observation to compare yet');
  expect(render(null)).not.toContain('+0');
  expect(
    render({ from: '2026-09-01', gained: [], emergent: [], lost: [], diminished: [] })
  ).toContain('no change this week');
});

test('the headline gives way to an open ladder, as it does to an open node', () => {
  // It stayed up with a ladder open, and with the panel's inset squeezing it
  // the range line ran under the lens switch by 21 to 45px.
  seed({ items: merged.items, connections: merged.connections });
  const map = () =>
    renderToStaticMarkup(
      <CivTree
        items={merged.items}
        connections={merged.connections}
        selectedId={null}
        hoveredId={null}
        onSelect={() => {}}
        onHover={() => {}}
      />
    );
  expect(map()).toContain('civ-finding');
  seed({ selectedEra: 3 });
  expect(map()).not.toContain('civ-finding');
  expect(map()).not.toContain('civ-range');
});

test('the canvas starts below the headline, however many lines it wraps to', () => {
  // A line of range (33px), the gap (6px) and a line of finding (43px): the 40px
  // the canvas always reserved. At 900px the range is two lines, at 769 three.
  expect(headlineReserve(33 + 6 + 43)).toBe(40);
  expect(headlineReserve(58 + 6 + 43)).toBe(65);
  expect(headlineReserve(78 + 6 + 43)).toBe(85);
  // A range line alone sits on the controls' row, and needs nothing below it.
  expect(headlineReserve(33)).toBe(0);
  // Before anything is measured, the two lines it usually is.
  expect(headlineReserve(null)).toBe(40);
  seed({ items: merged.items, connections: merged.connections });
  expect(
    renderToStaticMarkup(
      <CivTree
        items={merged.items}
        connections={merged.connections}
        selectedId={null}
        hoveredId={null}
        onSelect={() => {}}
        onHover={() => {}}
      />
    )
  ).toContain('--headline-pad:40px');
});

test('a failing check is the headline, alone', () => {
  // The range line led, so the first thing read was "losing Shell Execution
  // stops 9", a hypothetical, above a check that was failing now. Then it
  // followed as a second band, saying the week and the worst loss under a
  // sentence about something broken.
  const found = mapFindings(merged.items, merged.connections);
  expect(found.failing.length).toBeGreaterThan(0);
  const html = renderToStaticMarkup(
    <MapFinding findings={found} since={null} onShow={() => {}} onPreview={() => {}} />
  );
  expect(html).toContain('civ-finding--bad');
  expect(html).not.toContain('civ-range');
  // With nothing failing, the next step leads and the range follows it; the
  // count the header's pill already says is marked so a wide screen drops it.
  const calm = renderToStaticMarkup(
    <MapFinding
      findings={{ ...found, failing: [] }}
      since={null}
      onShow={() => {}}
      onPreview={() => {}}
    />
  );
  expect(calm.indexOf('civ-finding')).toBeLessThan(calm.indexOf('civ-range'));
  expect(calm).toContain('civ-range-count');
});

/** The demo's tree, rendered with a node selected, or none. */
const drawn = (selectedId: string | null, narrated = false) => {
  seed({ items: merged.items, connections: merged.connections });
  return renderToStaticMarkup(
    <CivTree
      items={merged.items}
      connections={merged.connections}
      selectedId={selectedId}
      hoveredId={null}
      onSelect={() => {}}
      onHover={() => {}}
      narrated={narrated}
    />
  );
};

/** The markup of one node's group, by the name its aria-label starts with. */
const nodeOf = (html: string, name: string) => {
  const at = html.indexOf(`aria-label="${name},`);
  return html.slice(at, html.indexOf('</g>', html.indexOf('civ-node-label', at)));
};

test('a failing node keeps its red ring when it is the one selected', () => {
  // Selection drew it in the selection's colour, so the tour's step about a
  // broken node showed it looking like every working one.
  const failing = mapFindings(merged.items, merged.connections).failing[0];
  // The node's own disc is the circle that carries a fill opacity.
  const ring = (html: string) =>
    nodeOf(html, failing.name).match(/<circle[^>]*fill-opacity[^>]*>/)?.[0];
  expect(ring(drawn(null))).toContain('var(--error)');
  expect(ring(drawn(failing.id))).toContain('var(--error)');
});

test('the source line is drawn only while the map is idle', () => {
  expect(drawn(null)).toContain('civ-source');
  const any = merged.items.find(i => i.status === 'built' && i.type === 'possibility')!;
  expect(drawn(any.id)).not.toContain('civ-source');
  expect(drawn(null, true)).not.toContain('civ-source');
});
