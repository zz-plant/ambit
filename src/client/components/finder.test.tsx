/**
 * The finder speaks verbs, and none of them can do harm.
 *
 * It only navigated: choosing a result showed it. It now lists actions beside
 * the nodes, and the actions are the part that needs holding. A simulation
 * changes what the map shows and nothing else. A check is copied and never
 * run, because a route that ran one would run whatever command an agent
 * registered, from a server that is meant to be a reader. A decision on a
 * proposal is made by the buttons in the panel, so the palette only opens it.
 *
 * There is no DOM here, so what Enter does is tested where it is decided: the
 * registry, the search and the two functions the finder's key handler calls.
 * The last tests read the source, to hold that the finder goes through them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProposalRow } from '../../shared/api';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { DEMO_ATTENTION, demoConfigGraph, demoProposals, demoTreeGraph } from '../store/demo';
import type { Item } from '../utils/configImporter';
import {
  activate,
  buildActions,
  keyStep,
  type PaletteAction,
  type PaletteContext,
  type PaletteHandlers,
  paletteRows,
  type Row,
  verifyCommand,
} from '../utils/palette';
import Finder from './Finder';
import NodeDetailPanel from './NodeDetailPanel';

/**
 * Put the store in a state, for a server render.
 *
 * `renderToStaticMarkup` reads the *server* snapshot, zustand's initial state
 * object, so a plain `setState` is invisible to it. Both halves are set here,
 * the way reachable.test.tsx already does it.
 */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

const demo = mergeGraphs(demoTreeGraph(), demoConfigGraph());

beforeEach(() => {
  seed({
    items: demo.items,
    connections: demo.connections,
    proposals: demoProposals(),
    attentionInterventions: DEMO_ATTENTION,
    activeLens: 'default',
    selectedItem: null,
    showDetailPanel: false,
    simulationMode: 'none',
    simulatedNodeId: null,
  });
});

afterEach(() => {
  seed({
    items: [],
    connections: [],
    proposals: [],
    selectedItem: null,
    attentionInterventions: {},
  });
  useAmbitStore.getState().clearSimulation();
  vi.unstubAllGlobals();
});

/** Handlers that only record, so a test can say what an action asked the page to do. */
function recorder() {
  return {
    simulate: vi.fn(),
    lens: vi.fn(),
    proposals: vi.fn(),
    copy: vi.fn(),
  } satisfies PaletteHandlers;
}

function context(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    items: demo.items,
    proposals: demoProposals(),
    activeLens: 'default',
    attention: DEMO_ATTENTION,
    handlers: recorder(),
    ...over,
  };
}

const idOf = (row: Row) => (row.kind === 'action' ? row.action.id : row.item.id);
const actionIds = (rows: Row[]) => rows.flatMap(r => (r.kind === 'action' ? [r.action.id] : []));
const byId = (actions: PaletteAction[], id: string) => actions.find(a => a.id === id);

/** What the finder does for a key: the two functions its handler calls, in its order. */
function press(rows: Row[], active: number, key: string, show: (id: string) => void) {
  const step = keyStep(key, active, rows.length);
  if (step?.kind === 'choose' && rows[active]) activate(rows[active], show);
  return step;
}

// ── The registry ─────────────────────────────────────────────────────────────

test('a node is offered what the detail panel offers it, and only that', () => {
  const actions = buildActions(context());

  // Reached: an outage, never an unlock. Not reached: the reverse.
  expect(byId(actions, 'outage:combo:shell-execution')).toMatchObject({
    label: 'Simulate an outage of Shell Execution',
    group: 'Simulate',
  });
  expect(byId(actions, 'unlock:combo:shell-execution')).toBeUndefined();
  expect(byId(actions, 'unlock:combo:embeddings')).toMatchObject({
    label: 'Simulate unlocking Embeddings',
    group: 'Simulate',
  });
  expect(byId(actions, 'outage:combo:embeddings')).toBeUndefined();

  // A check to copy, for any node on the map.
  expect(byId(actions, 'verify:combo:shell-execution')).toMatchObject({
    label: 'Copy the verify command for Shell Execution',
    group: 'Check',
  });
  expect(byId(actions, 'verify:combo:embeddings')).toBeDefined();
});

test('an entry of the setup is not on the map, so it has no simulation and no check', () => {
  const actions = buildActions(context());
  const entries = demo.items.filter(i => i.meta.era === undefined);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(actions.filter(a => a.id.endsWith(`:${entry.id}`))).toEqual([]);
  }
});

test('every action has what a registry entry needs, and no two share an id', () => {
  const actions = buildActions(context());
  expect(actions.length).toBeGreaterThan(0);
  for (const a of actions) {
    expect(a.id).toBeTruthy();
    expect(a.label).toBeTruthy();
    expect(['Simulate', 'Check', 'Map', 'Proposals']).toContain(a.group);
    expect(typeof a.run).toBe('function');
  }
  expect(new Set(actions.map(a => a.id)).size).toBe(actions.length);
});

test('a lens is offered when it has something to paint, and not while it is showing', () => {
  const lenses = (over: Partial<PaletteContext>) =>
    buildActions(context(over))
      .filter(a => a.group === 'Map')
      .map(a => a.label);

  expect(lenses({})).toEqual(['Switch to the Attention lens', 'Switch to the Authority lens']);
  // Showing already: not offered again. Standard is offered from anywhere else.
  expect(lenses({ activeLens: 'attention' })).toEqual([
    'Switch to the Standard lens',
    'Switch to the Authority lens',
  ]);
  // Nothing recorded, so the attention lens would paint nothing: the HUD
  // disables it and the palette leaves it out.
  expect(lenses({ attention: {} })).toEqual(['Switch to the Authority lens']);
  expect(lenses({ attention: { 'combo:data-access': 0 } })).toEqual([
    'Switch to the Authority lens',
  ]);
  // No reached node carries an authority mode.
  const bare = demo.items.map(i => ({ ...i, meta: { ...i.meta, authority: undefined } }));
  expect(lenses({ items: bare })).toEqual(['Switch to the Attention lens']);
});

test('proposals can always be opened, and the waiting ones can be decided on', () => {
  const actions = buildActions(context());
  const waiting = demoProposals().filter(p => p.status === 'draft');
  expect(waiting).toHaveLength(1);

  expect(byId(actions, 'proposals')).toMatchObject({
    label: 'Open Proposals',
    group: 'Proposals',
    hint: '1 waiting',
  });
  expect(byId(actions, `approve:${waiting[0].id}`)?.label).toBe(`Approve “${waiting[0].goal}”`);
  expect(byId(actions, `reject:${waiting[0].id}`)?.label).toBe(`Turn down “${waiting[0].goal}”`);

  // An approved proposal has been decided; there is nothing left to offer on it.
  const approved = demoProposals().find(p => p.status === 'approved') as ProposalRow;
  expect(byId(actions, `approve:${approved.id}`)).toBeUndefined();
  expect(byId(actions, `reject:${approved.id}`)).toBeUndefined();

  // With none waiting the panel can still be opened, and says nothing about a queue.
  const none = buildActions(context({ proposals: [] }));
  expect(byId(none, 'proposals')?.hint).toBeUndefined();
  expect(none.some(a => a.id.startsWith('approve:'))).toBe(false);
});

// ── What the finder lists ────────────────────────────────────────────────────

test('typing "shell" lists the node and the actions for it', () => {
  const rows = paletteRows(demo.items, buildActions(context()), 'shell');
  const ids = rows.map(idOf);

  expect(ids).toContain('combo:shell-execution');
  expect(actionIds(rows)).toEqual(['outage:combo:shell-execution', 'verify:combo:shell-execution']);
  // Nodes first, then what can be done to them.
  const firstAction = rows.findIndex(r => r.kind === 'action');
  expect(rows.slice(0, firstAction).every(r => r.kind === 'node')).toBe(true);
  expect(rows[0]).toMatchObject({ kind: 'node', item: { id: 'combo:shell-execution' } });
});

test('before anything is typed the actions that need no subject come first', () => {
  const rows = paletteRows(demo.items, buildActions(context()), '');
  const leading = rows.findIndex(r => r.kind === 'node');
  const verbs = rows.slice(0, leading);

  expect(verbs.length).toBeGreaterThan(0);
  expect(verbs.every(r => r.kind === 'action')).toBe(true);
  // Opening the panel leads: it is what the `g` key does, and it moves nothing.
  expect(actionIds(rows)).toEqual(['proposals', 'lens:attention', 'lens:authority']);
  // Nothing about a particular node or a particular proposal is listed until asked for.
  expect(actionIds(rows).some(id => /^(outage|unlock|verify|approve|reject):/.test(id))).toBe(
    false
  );
});

test('an action is found by what it does as well as what it is about', () => {
  const actions = buildActions(context());
  const outages = actionIds(paletteRows(demo.items, actions, 'outage'));
  expect(outages.length).toBeGreaterThan(1);
  expect(outages.every(id => id.startsWith('outage:'))).toBe(true);

  // Both halves of the query, in either order.
  expect(actionIds(paletteRows(demo.items, actions, 'shell outage'))).toEqual([
    'outage:combo:shell-execution',
  ]);
  expect(actionIds(paletteRows(demo.items, actions, 'outage shell'))).toEqual([
    'outage:combo:shell-execution',
  ]);
  // A word that is not in the label but is what the action does.
  expect(actionIds(paletteRows(demo.items, actions, 'reject'))).toContain(
    'reject:prop-deploy-staging-42'
  );
  expect(actionIds(paletteRows(demo.items, actions, 'zzz'))).toEqual([]);
});

test('a query that matches everything still lists a bounded number of actions', () => {
  const rows = paletteRows(demo.items, buildActions(context()), 'e');
  expect(actionIds(rows).length).toBeLessThanOrEqual(12);
});

// ── Enter ────────────────────────────────────────────────────────────────────

test('Enter on an outage action plays the simulation, and changes nothing on disk', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const store = useAmbitStore.getState();
  const before = { items: store.items, proposals: store.proposals };
  const handlers = recorder();
  // The page's own wiring: the store's simulation, exactly as the panel's button calls it.
  handlers.simulate.mockImplementation((id: string, mode: 'outage' | 'acquisition') =>
    mode === 'outage' ? store.startOutageSimulation(id) : store.startAcquisitionSimulation(id)
  );

  const rows = paletteRows(demo.items, buildActions(context({ handlers })), 'shell outage');
  expect(rows).toHaveLength(1);
  const show = vi.fn();
  expect(press(rows, 0, 'Enter', show)).toEqual({ kind: 'choose' });

  const after = useAmbitStore.getState();
  expect(handlers.simulate).toHaveBeenCalledWith('combo:shell-execution', 'outage');
  expect(after.simulationMode).toBe('outage');
  expect(after.simulatedNodeId).toBe('combo:shell-execution');
  expect(after.simulatedCascadeIds.size).toBeGreaterThan(0);

  // Nothing else moved, and nothing was asked of a server.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
  expect(handlers.copy).not.toHaveBeenCalled();
  expect(handlers.proposals).not.toHaveBeenCalled();
  expect(after.items).toBe(before.items);
  expect(after.proposals).toBe(before.proposals);
});

test('Enter on an unlock action plays the unlock, and on a node goes to it', () => {
  const store = useAmbitStore.getState();
  const handlers = recorder();
  handlers.simulate.mockImplementation((id: string, mode: 'outage' | 'acquisition') =>
    mode === 'outage' ? store.startOutageSimulation(id) : store.startAcquisitionSimulation(id)
  );
  const actions = buildActions(context({ handlers }));

  const unlock = paletteRows(demo.items, actions, 'unlocking embeddings');
  press(unlock, 0, 'Enter', vi.fn());
  expect(useAmbitStore.getState().simulationMode).toBe('acquisition');
  expect(useAmbitStore.getState().simulatedNodeId).toBe('combo:embeddings');

  // A node row still navigates, as it always did.
  const show = vi.fn();
  const nodes = paletteRows(demo.items, actions, 'shell');
  press(nodes, 0, 'Enter', show);
  expect(show).toHaveBeenCalledWith('combo:shell-execution');
});

test('Enter on the verify action copies the command and runs nothing', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const handlers = recorder();
  const rows = paletteRows(demo.items, buildActions(context({ handlers })), 'verify shell');
  expect(actionIds(rows)).toEqual(['verify:combo:shell-execution']);

  press(rows, 0, 'Enter', vi.fn());

  expect(handlers.copy).toHaveBeenCalledTimes(1);
  expect(handlers.copy).toHaveBeenCalledWith(
    'ambit verify combo:shell-execution',
    expect.stringContaining('only where you type it')
  );
  // Nothing was run, asked of a server, played on the map or opened.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(handlers.simulate).not.toHaveBeenCalled();
  expect(handlers.proposals).not.toHaveBeenCalled();
  expect(useAmbitStore.getState().simulationMode).toBe('none');
});

test('approving and turning down only open the panel where the decision is made', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const before = useAmbitStore.getState().proposals;
  const handlers = recorder();
  const actions = buildActions(context({ handlers }));

  for (const word of ['approve', 'turn down']) {
    const rows = paletteRows(demo.items, actions, word);
    const decide = rows.findIndex(
      r => r.kind === 'action' && /^(approve|reject):/.test(r.action.id)
    );
    expect(decide).toBeGreaterThanOrEqual(0);
    press(rows, decide, 'Enter', vi.fn());
  }

  expect(handlers.proposals).toHaveBeenCalledTimes(2);
  // Nothing was signed or recorded: no request, and the proposal is still waiting.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(useAmbitStore.getState().proposals).toBe(before);
  expect(
    useAmbitStore.getState().proposals.find(p => p.id === 'prop-deploy-staging-42')?.status
  ).toBe('draft');
});

test('the arrow keys stay inside the list, and only Enter and Escape act', () => {
  expect(keyStep('ArrowDown', 0, 3)).toEqual({ kind: 'move', active: 1 });
  expect(keyStep('ArrowDown', 2, 3)).toEqual({ kind: 'move', active: 2 });
  expect(keyStep('ArrowUp', 2, 3)).toEqual({ kind: 'move', active: 1 });
  expect(keyStep('ArrowUp', 0, 3)).toEqual({ kind: 'move', active: 0 });
  // An empty list has nowhere to go.
  expect(keyStep('ArrowDown', 0, 0)).toEqual({ kind: 'move', active: 0 });
  expect(keyStep('Enter', 1, 3)).toEqual({ kind: 'choose' });
  expect(keyStep('Escape', 1, 3)).toEqual({ kind: 'close' });
  expect(keyStep('a', 1, 3)).toBeUndefined();
  expect(keyStep('/', 1, 3)).toBeUndefined();
});

test('Enter on an empty list does nothing', () => {
  const show = vi.fn();
  expect(press([], 0, 'Enter', show)).toEqual({ kind: 'choose' });
  expect(show).not.toHaveBeenCalled();
});

// ── The way in ───────────────────────────────────────────────────────────────

const finder = (props: Partial<Parameters<typeof Finder>[0]> = {}) =>
  renderToStaticMarkup(
    <Finder open onClose={() => {}} onShow={() => {}} handlers={recorder()} {...props} />
  );

test('the finder lists its actions, under a heading of their own', () => {
  const html = finder();
  expect(html).toContain('Actions');
  expect(html).toContain('Open Proposals');
  expect(html).toContain('1 waiting');
  expect(html).toContain('Switch to the Attention lens');
  expect(html).toContain('Key 2');
  // The nodes are still there, under theirs. Nothing typed lists the first
  // twelve by name, which is how it always opened.
  expect(html).toContain('On the map');
  expect(html).toContain('Automated Tests');
  // The verbs lead: the first row, the one Enter would run, opens the panel.
  expect(html.indexOf('Open Proposals')).toBeLessThan(html.indexOf('Automated Tests'));
  expect(html).toMatch(/aria-current="true"[^>]*>(?:(?!<\/button>).)*Open Proposals/);
  // The box says it does more than find.
  expect(html).toContain('type an action');
  expect(html).not.toContain('undefined');
});

test('without handlers the finder only finds', () => {
  const html = finder({ handlers: undefined });
  expect(html).not.toContain('Actions');
  expect(html).not.toContain('Open Proposals');
  expect(html).toContain('Automated Tests');
});

test('a closed finder draws nothing', () => {
  expect(finder({ open: false })).toBe('');
});

// ── What must stay true of the code ──────────────────────────────────────────

/** Source with its comments removed, so a sentence about a route is not read as one. */
function code(path: string): string {
  return readFileSync(join(import.meta.dirname, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the palette never reaches the network, and never decides on a proposal', () => {
  // Verify stays a copied command because a route would run agent-registered
  // check commands from a server that is a reader. Decisions stay in the panel
  // for the same reason a keystroke in a search box must not sign a receipt.
  for (const path of ['../utils/palette.ts', './Finder.tsx']) {
    const source = code(path);
    expect(source, path).not.toMatch(
      /\bfetch\s*\(|\/api\/|XMLHttpRequest|sendBeacon|WebSocket|EventSource/
    );
    expect(source, path).not.toMatch(/approveProposal|rejectProposal/);
  }
});

test('the finder chooses through the functions tested here', () => {
  // The key handler has no DOM to run under, so hold that it is the code above.
  const source = code('./Finder.tsx');
  expect(source).toMatch(/keyStep\(e\.key, active, rows\.length\)/);
  expect(source).toMatch(/activate\(row, onShow\)/);
});

test('the check the palette copies is the one the detail panel offers', () => {
  const node = demo.items.find(i => i.id === 'combo:shell-execution') as Item;
  seed({ selectedItem: node.id, showDetailPanel: true });
  expect(renderToStaticMarkup(<NodeDetailPanel />)).toContain(verifyCommand(node));
  expect(verifyCommand(node)).toBe('ambit verify combo:shell-execution');
});
