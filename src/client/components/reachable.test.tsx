/**
 * The features that existed and could not be reached.
 *
 * Each of these was implemented, wired to an endpoint or a store action, and
 * had nothing on screen that led to it: the loop page rendered only for the
 * hosted demo, the config switch had no control, the share link had no button.
 * A test that renders the surface and looks for the way in is what keeps a
 * capability from going quiet again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import concepts from '../../shared/concepts.json';
import type { Item } from '../utils/configImporter';
import { demoSnapshot } from '../utils/demoSnapshot';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoProposals, demoTreeGraph } from '../store/demo';
import {
  authorityMark,
  buildColumns,
  columnProgress,
  outageSplit,
  visibleItems,
} from './civ/layout';
import { SimulationBanner } from './civ/SimulationBanner';
import AppDeck, { mapCounts } from './AppDeck';
import CivTree from './CivTree';
import ApprovalModal from './ApprovalModal';
import { RepoDriftPanel, UnmappedPanel } from './EnvironmentPanels';
import LoopDashboard from './LoopDashboard';
import NodeDetailPanel from './NodeDetailPanel';
import SetupView from './SetupView';

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
    selectedEra: null,
    loop: null,
    loopSource: null,
    loopEmpty: false,
    backend: 'unknown',
    configMcp: {},
    spotlight: null,
  });
});

const deck = (props: Partial<Parameters<typeof AppDeck>[0]> = {}) =>
  renderToStaticMarkup(
    <AppDeck
      view="tree"
      counts={{ verified: 1, unproven: 0, failing: 0, next: 1, blocked: 1 }}
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

test('each view tab keeps its name where it shows only its icon', () => {
  // Between a phone and a wide screen the tabs give up their words, as the
  // buttons beside them already did, or Proposals and Docs were pushed past
  // the right edge (at 1024px Docs started at x=1035).
  const html = deck();
  for (const name of ['Map', 'My Setup', 'Time &amp; cost', 'Audit']) {
    expect(html).toMatch(
      new RegExp(`<button[^>]*class="app-deck-tab[^"]*"[^>]*aria-label="${name}"`)
    );
  }
  expect(html.match(/class="app-deck-tab-label"/g)).toHaveLength(4);
  // And the one on screen says so: only a class marked it.
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*aria-label="Map"/);
});

test('when the header is short of room the status pill wraps, and nothing else gives way', () => {
  // Every other part keeps its size; the counts wrap onto a second line inside
  // the deck's height. A live engine's indicator, a failing segment and an
  // as-of date all widen the pill, so no breakpoint alone can promise room.
  const css = readFileSync(join(import.meta.dirname, '..', 'App.css'), 'utf8');
  const rule = (selector: string) =>
    css.match(
      new RegExp(`(?:^|\\n)${selector.replace(/[.>*]/g, m => `\\${m}`)}\\s*\\{([^}]*)\\}`)
    )?.[1] ?? '';
  const pill = rule('.app-deck-left > .app-status-pill');
  expect(pill).toMatch(/flex-wrap:\s*wrap/);
  expect(pill).toMatch(/flex-shrink:\s*1/);
  expect(pill).toMatch(/min-width:\s*0/);
  expect(css).toMatch(
    /\.app-deck-left > \*,\s*\.app-deck-center,\s*\.app-deck-right\s*\{[^}]*flex-shrink:\s*0/
  );
});

test('the deck offers a way to copy the link the URL already describes', () => {
  expect(deck()).toContain('Share');
});

test('the sample says it is one, and offers the way to your own setup on every screen', () => {
  // Map yours lived on the tour's last card alone, so a visitor who skipped
  // the tour had no way from the sample to their own setup.
  const sample = deck({ sample: { onReplay: () => {}, onMapYours: () => {} } });
  expect(sample).toContain('app-deck--sample');
  expect(sample).toMatch(/<button[^>]*class="app-sample-tag"[^>]*>Sample<\/button>/);
  expect(sample).toMatch(/app-deck-btn--primary[^>]*>.*Map yours<\/button>/);
  // While the tour plays there is nothing to replay: the tag only says it.
  expect(deck({ sample: { onMapYours: () => {} } })).toMatch(
    /<span class="app-sample-tag">Sample<\/span>/
  );
  // A machine of one's own is nobody's sample.
  expect(deck()).not.toContain('app-sample-tag');
  expect(deck()).not.toContain('Map yours');
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
  expect(html).toContain('a year no longer spent stepping in');
  expect(html).not.toContain('sample data');
});

test('the demo says which of its numbers are illustration', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  expect(renderToStaticMarkup(<LoopDashboard />)).toContain('This is sample data');
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

/** What the global config holds for the servers these tests draw. */
const CONFIG_MCP = {
  git: { type: 'local', command: ['git-mcp'], enabled: true },
  github: { type: 'remote', url: 'https://example.test/mcp', enabled: false },
};

test('the config switch appears only where an engine can write the config', () => {
  seed({ items: [server], selectedItem: server.id, backend: 'static', configMcp: CONFIG_MCP });
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
    configMcp: CONFIG_MCP,
  });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('sp-switch');
});

test('a server the config does not name gets no switch, in the panel or in the list', () => {
  // The route answers ok for a name it has no entry for and changes nothing, so
  // a server another runtime declared would flip, reload and flip back, having
  // said it worked. The switch is offered for what the config holds.
  seed({
    items: [server],
    selectedItem: server.id,
    backend: 'live',
    configMcp: { elsewhere: { type: 'local', enabled: true } },
  });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).not.toContain('sp-switch');
  const list = renderToStaticMarkup(<SetupView onShow={() => {}} />);
  expect(list).not.toContain('role="switch"');
  // Nothing to explain, so nothing explained.
  expect(list).not.toContain('switch writes');
});

/** One row of My Setup's markup, by the name it shows. */
function setupRow(html: string, name: string): string {
  const row = html.split('class="setup-row ').find(r => r.includes(`<span>${name}</span>`));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

test('My Setup switches the tool servers the config names, and nothing else', () => {
  const github: Item = { ...server, id: 'mcp:github', name: 'github', status: 'specified' };
  // A server the config does not name, on and off: nothing to write to.
  const strange: Item = { ...server, id: 'mcp:strange', name: 'strange' };
  const strangeOff: Item = {
    ...strange,
    id: 'mcp:strange-off',
    name: 'strange-off',
    status: 'specified',
  };
  // Other kinds have no enabled state to switch.
  const reviewer: Item = {
    ...server,
    id: 'agent:reviewer',
    name: 'reviewer',
    type: 'agent',
    meta: { domain: 'meta' },
  };
  const bash: Item = { ...server, id: 'tool:bash', name: 'bash', type: 'tool' };
  seed({
    backend: 'live',
    configMcp: CONFIG_MCP,
    items: [server, github, strange, strangeOff, reviewer, bash],
  });
  const html = renderToStaticMarkup(<SetupView onShow={() => {}} />);

  // Two switches, and both are real buttons that carry their state.
  expect(html.match(/role="switch"/g)).toHaveLength(2);
  expect(html).toMatch(/<button[^>]*role="switch" aria-checked="true"/);
  expect(html).toMatch(/<button[^>]*role="switch" aria-checked="false"/);
  expect(setupRow(html, 'git')).toMatch(/role="switch" aria-checked="true"/);
  expect(setupRow(html, 'github')).toMatch(/role="switch" aria-checked="false"/);
  expect(setupRow(html, 'git')).toContain('aria-label="Enabled in your config: git"');

  // The switch says what the badge would have, so the row does not say it twice.
  expect(setupRow(html, 'github')).not.toContain('Disabled');
  // Where there is no switch, the exception is still written.
  expect(setupRow(html, 'strange')).not.toContain('role="switch"');
  expect(setupRow(html, 'strange-off')).toContain('Disabled');
  expect(setupRow(html, 'reviewer')).not.toContain('role="switch"');
  expect(setupRow(html, 'bash')).not.toContain('role="switch"');

  // What a switch does is written once, where there is one.
  const text = html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
  expect(text).toContain("A tool server's switch writes enabled to your agent config");
  expect(text).toContain('Restart the runtime');
});

test('the list offers no switch where no engine can write the config', () => {
  seed({ backend: 'static', configMcp: CONFIG_MCP, items: [server] });
  const list = renderToStaticMarkup(<SetupView onShow={() => {}} />);
  expect(list).not.toContain('role="switch"');
  expect(list).not.toContain('switch writes');
  // The hosted demo has no engine either, and shows no switch on any row.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ backend: 'static', items, connections, configMcp: {} });
  expect(renderToStaticMarkup(<SetupView onShow={() => {}} />)).not.toContain('role="switch"');
});

test('a house word carries its own definition, from the one glossary', () => {
  // The definition and the word were in different places: a glossary behind a
  // button, and "reached" on screen for a reader who had not opened it. In the
  // header it rides on the count's tooltip: the count is a button, and the
  // glossary popover is one too, which cannot nest inside it.
  const evidence = concepts.concepts.find(c => c.key === 'evidence')!;
  expect(deck()).toContain(evidence.short);
  expect(deck()).not.toContain('class="term"');
});

test('the header leads with what is verified, and each count is a control', () => {
  // It read "42 of 60 reached" over a tree of 33: entries counted with nodes,
  // and the least informative state leading. Then "16 reached", with a failing
  // check counted like a passing one. Then five counts, which wrapped at
  // 1440px with blocked the largest. It says what a person acts on now, and
  // the tooltip carries the rest.
  const html = deck({ counts: { verified: 9, unproven: 3, failing: 0, next: 5, blocked: 3 } });
  const text = html.replace(/<[^>]+>/g, '');
  expect(text).toMatch(/9\s*verified/);
  expect(text).toMatch(/5\s*next steps/);
  expect(text).not.toMatch(/unproven|blocked/);
  expect(html).toContain('Highlight Verified on the map');
  expect(html).toContain('Highlight Next step on the map');
  expect(html).toContain(
    'title="The map by state: 9 verified, 3 unproven, 5 next steps, 3 blocked"'
  );
  expect(html).not.toContain('of 20');
  // Nothing failing is no segment at all, not a count of zero.
  expect(text).not.toMatch(/failing/);
  // One next step is one.
  const one = deck({ counts: { verified: 9, unproven: 3, failing: 0, next: 1, blocked: 3 } });
  expect(one.replace(/<[^>]+>/g, '')).toMatch(/1\s*next step(?!s)/);

  // A check that fails is its own segment, lit as its legend key lights it.
  const failing = deck({ counts: { verified: 9, unproven: 2, failing: 1, next: 5, blocked: 3 } });
  expect(failing.replace(/<[^>]+>/g, '')).toMatch(/1\s*failing/);
  expect(failing).toContain('Highlight Failing on the map');
  expect(failing).toContain('fig-eras-failing');

  // Off the map, the pill counts what that view lists.
  const setup = deck({ view: 'config', counts: null, entries: { enabled: 9, total: 11 } });
  expect(setup).toContain('9 of 11 enabled');
  expect(setup).not.toContain('Highlight');
});

test('the pill and the era headers count one map: a failing node is apart from reached', () => {
  // Rule 6. The pill filed the demo's failing node under unproven, so it said
  // 13 verified and 3 unproven, 16 reached, over era headers that added up to
  // 15 reached and 1 failing.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const nodes = visibleItems(items);
  const { cols, colOrder } = buildColumns(nodes, connections);
  const columns = colOrder.map(c => columnProgress(cols[c] ?? []));
  const sum = (key: 'reached' | 'failing' | 'next' | 'blocked') =>
    columns.reduce((n, p) => n + p[key], 0);

  const counts = mapCounts(nodes);
  expect(counts.failing).toBe(1);
  expect(counts.verified + counts.unproven).toBe(sum('reached'));
  expect(counts.failing).toBe(sum('failing'));
  expect(counts.next).toBe(sum('next'));
  expect(counts.blocked).toBe(sum('blocked'));
  expect(counts.reached).toBeUndefined();

  // An observation with no lifecycles counts reached whole, and nothing as failing.
  expect(mapCounts(nodes, false).reached).toBe(nodes.filter(i => i.status === 'built').length);

  // Each segment lights what it counts: verified leaves the failing node dim,
  // and failing lights it.
  const opacityOf = (spotlight: string) => {
    seed({ items, connections, spotlight });
    const html = renderToStaticMarkup(
      <CivTree
        items={items}
        connections={connections}
        selectedId={null}
        hoveredId={null}
        onSelect={() => {}}
        onHover={() => {}}
      />
    );
    return html.match(/opacity="([\d.]+)"[^>]*aria-label="Browser Automation, possibility"/)?.[1];
  };
  expect(opacityOf('Verified')).toBe('0.15');
  expect(opacityOf('Failing')).toBe('1');
});

test('a recovering node is reached and unproven, and the panel says it is recovering', () => {
  // The latest check decides. Its last check passed after one that failed, so
  // the pill files it with the unproven, not as failing, and nowhere else is
  // there a count of it; the panel, where a reader would take it for fixed,
  // says how its recent runs went.
  const runs = [true, false, false, true, true].map((passed, i) => ({ id: i + 1, passed }));
  const node = (id: string, lifecycle: string): Item => ({
    id,
    name: id,
    type: 'possibility',
    status: 'built',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era: 3, state: 'unlocked', lifecycle, history: runs },
  });
  const mending = node('combo:mending', 'degraded');
  expect(mapCounts([mending, node('combo:fine', 'verified')])).toEqual({
    verified: 1,
    unproven: 1,
    failing: 0,
    next: 0,
    blocked: 0,
  });

  seed({ items: [mending], selectedItem: mending.id, backend: 'live' });
  const panel = renderToStaticMarkup(<NodeDetailPanel />);
  expect(panel).toContain('Recovering, 3 of the last 5 passed');
  expect(panel).not.toContain('Configured, but not working');
  expect(panel).toContain('Reached');
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
  expect(html).toContain('Proven enough to stop asking');
  expect(html).toContain('What to reach next');
  expect(html).toContain('emergent');
});

test('a proposal card carries what deciding on it needs', () => {
  // Forecast, costs, undo, unlocks, precedent: stored by the engine, shown by
  // nothing. The card had the goal and the steps.
  seed({ proposals: demoProposals() });
  const html = renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />);
  expect(html).toContain('Forecast');
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
  expect(html).toContain('Show the steps on the map');
});

test('an era header is a control, and it counts only what is working', () => {
  // Tool Use read "5 of 5" while Browser Automation, in it, is reached and
  // failing its check. The header was a label, and its ladder had no way in.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const html = renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
    />
  );
  expect(html).toContain(
    'aria-label="Tool Use, era 3: 4 of 6 reached, 1 failing. Show its ladder"'
  );
  const text = html.replace(/<[^>]+>/g, '');
  // The count under the name; the era's number and what is left say so on hover.
  expect(text).toContain('Era 3: 4 of 6 reached');
  expect(text).not.toContain('Era 3: 5 of 6');
  // An era with nothing failing counts as it always did.
  expect(text).toContain('Era 1: 4 of 4 reached');
  // The failing node is its own red segment of the bar, in that era alone.
  expect(html.match(/fig-eras-failing/g)).toHaveLength(1);
});

test('an era opens as a ladder in the detail panel: reached, next step with its time, blocked by what', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ items, connections, selectedEra: 4, showDetailPanel: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('<div class="sp-designation">Memory</div>');
  expect(html).toContain('1 of 5 reached · 1 next step · about 1.1h of setup left');
  expect(html).toContain('<span class="sp-rung-state">Next step · 10m</span>');
  expect(html).toContain('<span class="sp-rung-state">Reached</span>');
  expect(html).toContain('<span class="sp-rung-state">Blocked</span>');
  expect(html).toContain('Waits for Embeddings, about 10m of setup first');
  // One rung per node of the era, and no node's own panel beside it.
  expect(html.match(/class="sp-rung /g)).toHaveLength(5);
  expect(html).not.toContain('Simulate');
});

test('the ladder lists a failing node as failing, first, and never among those reached', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ items, connections, selectedEra: 3, showDetailPanel: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  // The count in the header of the era and the rungs agree: four reached, one failing.
  expect(html).toContain('4 of 6 reached · 1 failing');
  expect(html.match(/sp-rung--reached/g)).toHaveLength(4);
  expect(html.match(/sp-rung--failing/g)).toHaveLength(1);
  expect(html).toContain('<span class="sp-rung-state">Failing</span>');
  expect(html).toContain('Configured, but not working');
  expect(html.indexOf('sp-rung--failing')).toBeLessThan(html.indexOf('sp-rung--reached'));
});

test('a rung with no estimate shows none, never a zero', () => {
  const unpriced: Item = {
    id: 'combo:unpriced',
    name: 'Unpriced',
    type: 'possibility',
    status: 'specified',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era: 4, state: 'locked', next: true, setupSeconds: 0 },
  };
  seed({ items: [unpriced], connections: [], selectedEra: 4, showDetailPanel: true });
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('<span class="sp-rung-state">Next step</span>');
  expect(html).not.toMatch(/\b0\s?[mh]\b/);
  // Nothing priced, so no total is claimed either.
  expect(html).not.toContain('of setup left');
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
  expect(html).toContain('Approve this proposal');
});

test('the ways to acquire a capability are compared, with the record\u2019s leaning marked', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(html).toContain('Ways to acquire it');
  expect(html).toContain('your record favors this');
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

test('My Setup lists what the agents used that the map has no node for', () => {
  // The map can only show what the curated tree names; a server used every
  // day and matched by nothing was no part of the range anywhere.
  seed({ backend: 'live', items: [server] });
  expect(renderToStaticMarkup(<SetupView onShow={() => {}} />)).toContain('Not on the map');

  const plain = (html: string) => html.replace(/<[^>]+>/g, '');
  expect(
    plain(renderToStaticMarkup(<UnmappedPanel report={{ days: 30, seen: 0, unmapped: [] }} />))
  ).toContain('No tool use recorded in the last 30 days');
  expect(
    plain(renderToStaticMarkup(<UnmappedPanel report={{ days: 30, seen: 4, unmapped: [] }} />))
  ).toContain('is accounted for by a node on the map');

  const html = plain(
    renderToStaticMarkup(
      <UnmappedPanel
        report={{
          days: 30,
          seen: 3,
          unmapped: [
            {
              entry: { id: 'mcp:linear', name: 'linear' },
              tools: ['mcp__linear__create_issue'],
              lastUsed: 'not a time',
            },
            { tools: ['todowrite'], lastUsed: '2026-09-20 10:00:00' },
          ],
          overlay: '{ "nodes": [] }',
          overlay_note: 'Paste into .ambit/techtree.json',
        }}
      />
    )
  );
  expect(html).toContain('linear');
  expect(html).toContain('mcp__linear__create_issue');
  expect(html).toContain('no overlay can match it');
  expect(html).toContain('Copy overlay');
  // A time that will not parse is left out, never printed as a value.
  expect(html).not.toContain('Invalid Date');
  expect(html).not.toContain('NaN');
});

test('the map marks what needs a person, and the panel says who', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({
    items,
    connections,
    activeLens: 'default',
    selectedItem: 'combo:continuous-delivery',
    showDetailPanel: true,
  });
  const map = renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
    />
  );
  expect(map).toContain('Needs a person: You');
  expect(map).toContain('Needs a person');
  // No node in the demo runs on a device, so there is no key for one.
  expect(map).not.toContain('Runs on a device');

  const panel = renderToStaticMarkup(<NodeDetailPanel />).replace(/<[^>]+>/g, '');
  expect(panel).toContain('Joint capability');
  expect(panel).toContain('A person must approve it (You)');
  expect(panel).toContain('One way to acquire it costs money every month');
});
