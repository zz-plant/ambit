/**
 * The features that existed and could not be reached.
 *
 * Each of these was implemented, wired to an endpoint or a store action, and
 * had nothing on screen that led to it: the loop page rendered only for the
 * hosted demo, the config switch had no control, the share link had no button.
 * A test that renders the surface and looks for the way in is what keeps a
 * capability from going quiet again.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { Item } from '../utils/configImporter';
import { demoSnapshot } from '../utils/demoSnapshot';
import { useAmbitStore } from '../store/ambitStore';
import AppDeck from './AppDeck';
import LoopDashboard from './LoopDashboard';
import NodeDetailPanel from './NodeDetailPanel';

const server: Item = {
  id: 'mcp:git',
  name: 'git',
  type: 'mcp-server',
  status: 'built',
  description: 'local MCP server',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'devops' },
};

/**
 * Put the store in a state, for a server render.
 *
 * `renderToStaticMarkup` reads the *server* snapshot — zustand's initial state
 * object — so a plain `setState` is invisible to it. Both halves are set here,
 * the way ui-density.test.tsx already does it.
 */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({
    items: [],
    connections: [],
    selectedItem: null,
    loop: null,
    loopSource: null,
    loopEmpty: false,
    backend: 'unknown',
  });
});

const deck = (props: Partial<Parameters<typeof AppDeck>[0]> = {}) =>
  renderToStaticMarkup(
    <AppDeck
      reached={1}
      next={1}
      total={3}
      view="graph"
      source="tree"
      connected={false}
      draftCount={0}
      leftOpen={false}
      onToggleSidebar={() => {}}
      onShare={() => {}}
      onShowTree={() => {}}
      onShowSetup={() => {}}
      onShowLoop={() => {}}
      onShowProposals={() => {}}
      onShowDocs={() => {}}
      {...props}
    />
  );

test('the time-and-cost view is offered on a real machine, not only in the demo', () => {
  // The tab was rendered behind `demo &&`, so the half of the product that
  // prices your time was invisible to anyone running it on their own setup.
  expect(deck()).toContain('Time &amp; cost');
});

test('the deck offers a way to copy the link the URL already describes', () => {
  expect(deck()).toContain('Share');
});

test('the live indicator appears only while the stream is attached', () => {
  expect(deck({ connected: false })).not.toContain('app-live-dot');
  expect(deck({ connected: true })).toContain('app-live-dot');
});

test('a real ledger with nothing in it says so instead of drawing zeroes', () => {
  seed({ loop: null, loopSource: 'ledger', loopEmpty: true });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(html).toContain('Nothing recorded yet');
  expect(html).toContain('ambit-telemetry.js');
});

test("a machine's own figures are not labelled as samples", () => {
  seed({ loop: demoSnapshot(), loopSource: 'ledger', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(html).toContain('Where the time goes');
  expect(html).not.toContain('Sample data');
});

test('the demo says which of its numbers are illustration', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  expect(renderToStaticMarkup(<LoopDashboard />)).toContain('Sample data');
});

test('a priced opportunity offers the map only when the node is on the graph in front of you', () => {
  // Every row named a node it was not about: the button matched the row's *id*
  // against three hardcoded strings and fell through to the same fallback, so
  // all three led to Wrangler.
  const tree = demoSnapshot().opportunities.map(o => ({
    id: o.capability_id as string,
    name: o.capability,
    type: 'possibility' as const,
    status: 'specified' as const,
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { domain: 'meta' },
  }));
  seed({ items: tree, loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });

  const html = renderToStaticMarkup(<LoopDashboard onShowOnMap={() => {}} />);
  for (const o of demoSnapshot().opportunities) {
    expect(html).toContain(`Show ${o.capability} on the map`);
  }

  // Without a way to reach the map, the button is not offered at all.
  expect(renderToStaticMarkup(<LoopDashboard />)).not.toContain('fig-row-btn');
});

test('the config switch appears only where an engine can write the config', () => {
  seed({ items: [server], selectedItem: server.id, backend: 'static' });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('sp-switch');

  seed({ backend: 'live' });
  const live = renderToStaticMarkup(<NodeDetailPanel />);
  expect(live).toContain('sp-switch');
  expect(live).toContain('Enabled');
});

test('a tech-tree node offers no config switch: it names no config entry', () => {
  seed({
    items: [{ ...server, meta: { ...server.meta, era: 3, state: 'unlocked' } }],
    selectedItem: server.id,
    backend: 'live',
  });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('sp-switch');
});

test('a house word carries its own definition, from the one glossary', () => {
  // The definition and the word were in different places: a glossary behind a
  // button, and "reached" on screen for a reader who had not opened it.
  expect(deck()).toContain('class="term"');
});

test('the detail panel words a status for the graph the node came from', () => {
  // "Tool server · Reached" sat directly above a switch reading "Enabled":
  // two words for one fact, disagreeing. A config entry is enabled or not.
  seed({ items: [server], selectedItem: server.id, backend: 'live' });
  const config = renderToStaticMarkup(<NodeDetailPanel />);
  expect(config).toContain('Enabled');
  expect(config).not.toContain('Reached');

  seed({
    items: [{ ...server, meta: { ...server.meta, era: 3, state: 'unlocked' } }],
    selectedItem: server.id,
    backend: 'live',
  });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).toContain('Reached');
});
