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
import { MapFinding } from './civ/MapFinding';
import { mapFindings, outageImpact, outageSentence, outageSplit } from './civ/layout';
import LoopDashboard from './LoopDashboard';
import NodeDetailPanel from './NodeDetailPanel';
import SetupView from './SetupView';

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({ items: [], connections: [], selectedItem: null, loop: null, loopSource: null });
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
  seed({ ...merged, connections: [...merged.connections, ...demoConfigGraph().connections] });
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
  const said = outageSentence(
    weakest.item.name,
    outageImpact(items, outageSplit(items, connections, weakest.item.id))
  );
  expect(said.count).toBe(`${weakest.stops} capabilities`);
});

test('the week is stated as movement, and its absence is said, never printed as +0', () => {
  const found = mapFindings(merged.items, merged.connections);
  const render = (since: Parameters<typeof MapFinding>[0]['since']) =>
    text(
      renderToStaticMarkup(
        <MapFinding findings={found} since={since} onShow={() => {}} onPreview={() => {}} />
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
