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
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoProposals, demoTreeGraph } from '../store/demo';
import { authorityMark, outageSplit } from './civ/layout';
import { SimulationBanner } from './civ/SimulationBanner';
import AppDeck from './AppDeck';
import CivTree from './CivTree';
import ApprovalModal from './ApprovalModal';
import { RepoDriftPanel } from './EnvironmentPanels';
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
      view="tree"
      counts={{ reached: 1, next: 1, blocked: 1 }}
      entries={null}
      connected={false}
      draftCount={0}
      spotlight={null}
      onSpotlight={() => {}}
      onSearch={() => {}}
      onShowView={() => {}}
      onShare={() => {}}
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

/** Read off the graph, so it answers on a machine whose ledger is empty. */
const GRAPH_STATUS = {
  reached: 12,
  total: 19,
  verified: 8,
  failing: 1,
  degraded: ['postgres'],
  spofs: ['anthropic', 'github'],
  deficits: ['a browser worker'],
  pending: [],
};

test('a ledger with nothing in it still says what the graph proves', () => {
  // The page withheld all of itself until telemetry arrived, though assurance
  // and fragility never needed it. On a real machine that was the first week.
  seed({
    loop: { ...demoSnapshot(), status: GRAPH_STATUS },
    loopSource: 'ledger',
    loopEmpty: true,
  });
  const html = renderToStaticMarkup(<LoopDashboard />);

  expect(html).toContain('What the graph can prove');
  expect(html).toContain('8 of 19 proved');
  // and still asks for the half that is missing
  expect(html).toContain('ambit-telemetry.js');
});

test('the fragilities the payload already carried reach the page', () => {
  // degraded and spofs arrived on every /api/loop response and were read by
  // nothing, so a machine one revoked token from losing a capability was told
  // only how many checks had passed. Deficits moved: they are demand, and
  // head the queue of what to reach.
  seed({
    loop: {
      ...demoSnapshot(),
      status: GRAPH_STATUS,
      demand: [
        {
          id: 'combo:browser',
          name: 'a browser worker',
          times: 3,
          structural: true,
          failing: false,
        },
      ],
    },
    loopSource: 'ledger',
    loopEmpty: false,
  });
  const html = renderToStaticMarkup(<LoopDashboard />);

  expect(html).toContain('What could break');
  expect(html).toContain('postgres');
  expect(html).toContain('anthropic');
  expect(html).toContain('Asked for and never there');
  expect(html).toContain('a browser worker');
  expect(html).toContain('stopped work 3×');
});

test('nothing fragile draws no finding', () => {
  seed({
    loop: {
      ...demoSnapshot(),
      status: { ...GRAPH_STATUS, degraded: [], spofs: [], deficits: [] },
    },
    loopSource: 'ledger',
    loopEmpty: false,
  });

  expect(renderToStaticMarkup(<LoopDashboard />)).not.toContain('What could break');
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

test('the header counts the three states of the map, and each count is a control', () => {
  // It read "42 of 60 reached" over a tree of 33: entries counted with nodes,
  // and the least informative state leading. Three segments now, each the
  // same control as its legend key.
  const html = deck({ counts: { reached: 12, next: 5, blocked: 3 } });
  expect(html).toContain('Highlight Next step on the map');
  expect(html).toContain('Highlight Blocked on the map');
  expect(html).not.toContain('of 20');

  // Off the map, the pill counts what that view lists.
  const setup = deck({ view: 'config', counts: null, entries: { enabled: 9, total: 11 } });
  expect(setup).toContain('9 of 11 enabled');
  expect(setup).not.toContain('Highlight');
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

test('the governance half is on the page: authority, next steps, and the week', () => {
  // Whether a capability may act without asking, which grants have earned a
  // threshold, what to reach next and why, and what moved: all terminal-only
  // until now, and the most decision-shaped data the engine holds.
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(html).toContain('What may act without asking');
  expect(html).toContain('Earned a threshold nobody set');
  expect(html).toContain('What to reach next');
  expect(html).toContain('emergent');
});

test('a proposal card carries what deciding on it needs', () => {
  // Saves, costs, undo, unlocks, precedent: stored by the engine, shown by
  // nothing. The card had the goal and the steps.
  seed({ proposals: demoProposals() });
  const html = renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />);
  expect(html).toContain('Saves');
  expect(html).toContain('Costs');
  expect(html).toContain('Undo');
  expect(html).toContain('every step is a config change with an inverse');
  expect(html).toContain('privacy local accepted 4 of 4');
});

test('a blocked node says what it is blocked by, and prices the gap', () => {
  const embeddings: Item = {
    id: 'combo:embeddings',
    name: 'Embeddings',
    type: 'possibility',
    status: 'specified',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era: 4, state: 'locked', next: true, setupSeconds: 600 },
  };
  const vectorStore: Item = {
    ...embeddings,
    id: 'combo:vector-store',
    name: 'Vector Store',
    meta: { era: 4, state: 'locked', next: false, setupSeconds: 900 },
  };
  seed({
    items: [embeddings, vectorStore],
    connections: [{ from: embeddings.id, to: vectorStore.id, type: 'hard-dep' }],
    selectedItem: vectorStore.id,
    showDetailPanel: true,
  });
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  expect(html).toContain('Blocked by Embeddings, about 10m of setup first');
  expect(html).toContain('Show the gap on the map');
});

test('an outage tells what stops from what only loses a provider', () => {
  // Two providers of one capability: losing either weakens it, losing both
  // ends it. The cascade painted both the same.
  const git: Item = {
    id: 'mcp:git',
    name: 'git',
    type: 'mcp-server',
    status: 'built',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { domain: 'devops' },
  };
  const github: Item = { ...git, id: 'mcp:github', name: 'github' };
  const vc: Item = {
    ...git,
    id: 'combo:version-control',
    name: 'Version Control',
    type: 'possibility',
    meta: { era: 1, state: 'unlocked', next: false, providers: ['mcp:git', 'mcp:github'] },
  };
  seed({
    items: [git, github, vc],
    connections: [
      { from: git.id, to: vc.id, type: 'hard-dep', kind: 'provides' },
      { from: github.id, to: vc.id, type: 'hard-dep', kind: 'provides' },
    ],
    selectedItem: git.id,
    showDetailPanel: true,
  });
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  expect(html).toContain(
    'If this went down, nothing else would stop working, but 1 capability would lose a provider.'
  );
});

test('an outage of something nothing reached says nothing that works would stop', () => {
  // Hosted Inference in the demo cuts off twelve capabilities and reaches
  // none of them. The banner said all twelve "would stop working".
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const id = 'combo:hosted-inference';
  const { stops, weakened } = outageSplit(items, connections, id);
  const cutOff = items.filter(i => stops.has(i.id) && i.status !== 'built').length;
  expect(cutOff).toBeGreaterThan(0);
  const html = renderToStaticMarkup(
    <SimulationBanner
      simulationMode="outage"
      simulatedNodeId={id}
      simulatedItem={items.find(i => i.id === id)}
      simulatedCascadeIds={stops}
      simulatedWeakenedIds={weakened}
      items={items}
      clearSimulation={() => {}}
    />
  );
  expect(html).not.toMatch(/\d+ capabilit(y|ies) would stop working/);
  expect(html).toContain('nothing that works would stop');
  expect(html).toContain(`${cutOff} not set up yet would be cut off`);
});

test('the panel counts only what was working as stopping, and names the rest', () => {
  const root: Item = { ...server, id: 'mcp:root', name: 'root' };
  const working: Item = {
    ...server,
    id: 'combo:working',
    name: 'Working',
    type: 'possibility',
    meta: { era: 1, lifecycle: 'proven' },
  };
  const failing: Item = { ...working, id: 'combo:failing', meta: { era: 1, lifecycle: 'broken' } };
  const locked: Item = { ...working, id: 'combo:locked', status: 'specified', meta: { era: 2 } };
  seed({
    items: [root, working, failing, locked],
    connections: [working, failing, locked].map(n => ({
      from: root.id,
      to: n.id,
      type: 'hard-dep' as const,
    })),
    selectedItem: root.id,
    showDetailPanel: true,
  });
  const text = renderToStaticMarkup(<NodeDetailPanel />).replace(/<[^>]+>/g, '');
  expect(text).toContain(
    'If this went down, 1 other capability would stop working. 1 not set up yet would be cut off, and 1 was already failing.'
  );
});

test('a proposal can be turned down from the panel, with the reason the next draft learns from', () => {
  // Refusal was recordable from the terminal and not from the panel that asks
  // for the decision, so a no made in the browser vanished.
  seed({ proposals: demoProposals() });
  const html = renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />);
  expect(html).toContain('Turn down');
  expect(html).toContain('Approve and sign');
});

test('the ways to acquire a capability are compared, with the record\u2019s leaning marked', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(html).toContain('Ways to acquire it');
  expect(html).toContain('your record favours this');
  // Cheapest first, so the first option drawn is the cheaper of the two.
  expect(html.indexOf('$4,560/yr')).toBeLessThan(html.indexOf('$5,880/yr'));
});

test('the panel lists what a capability may do, per action', () => {
  const shell: Item = {
    id: 'combo:shell',
    name: 'Shell Execution',
    type: 'possibility',
    status: 'built',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: {
      era: 1,
      state: 'unlocked',
      next: false,
      authority: { execute: 'confirm' },
      actions: [
        { id: 'act:shell/read_output', name: 'read_output', mode: 'autonomous' },
        { id: 'act:shell/run_command', name: 'run_command', mode: 'confirm' },
      ],
      daysSinceChange: 41,
    },
  };
  seed({ items: [shell], selectedItem: shell.id, showDetailPanel: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);
  expect(html).toContain('Asks before acting');
  expect(html).toContain('read output');
  expect(html).toContain('without asking');
  expect(html).toContain('Config unchanged');
  expect(html).toContain('41 days');
});

test('a repository missing a server the global config has is handed the entry', () => {
  // The endpoint that composes a paste-ready entry existed for exactly this
  // and nothing on screen reached it. A name the global config does not know
  // stays a name: there is no entry to hand over.
  seed({ configMcp: { git: { type: 'local', command: ['git-mcp'] } } });
  const html = renderToStaticMarkup(
    <RepoDriftPanel
      scan={{
        globalStats: { mcps: 1, agents: 0, commands: 0, providers: 0, totalRepos: 1 },
        repos: [
          {
            name: 'acme/site',
            drift: 50,
            driftItems: 2,
            uniqueMcps: [],
            missingMcps: ['git', 'nonesuch'],
            uniqueAgents: [],
            uniqueCommands: [],
            defaultAgent: null,
          },
        ],
      }}
    />
  );
  expect(html).toContain('copy entry');
  expect(html.match(/tp-inline-btn/g)?.length).toBe(1);
  expect(html).toContain('nonesuch');
});

test('the map has an authority lens, keyed by what the demo actually grants', () => {
  // The engine answered "may it act without asking" for every reached node,
  // and only the detail panel said so. The lens puts it on the map.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const marks = new Set(items.map(authorityMark).filter(Boolean));
  expect(marks).toEqual(new Set(['autonomous', 'confirm', 'forbidden', 'ungranted']));
  seed({ items, connections, activeLens: 'authority' });
  const html = renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
    />
  );
  expect(html).toMatch(/aria-pressed="true"[^>]*>Authority</);
  for (const label of ['Acts without asking', 'Asks first', 'Forbidden', 'No grant yet']) {
    expect(html).toContain(label);
  }
});
