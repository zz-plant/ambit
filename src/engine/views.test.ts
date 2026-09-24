/**
 * The projections the visualiser reads.
 *
 * The type a node is given has now been wrong twice, the same way both times:
 * `views.ts` mapped a capability's category to a node type inline, so any
 * category the client's own union did not list reached the renderer verbatim as
 * a value it had no case for. `tool`, `runtime` and `meta` are all real stored
 * categories, and all three were served that way.
 *
 * The second time, the mapping function existed and simply was not called —
 * dead code, with a lint warning nobody chased. These hold the contract itself
 * rather than the implementation.
 */
import { expect, test } from 'vitest';
import { NODE_TYPES } from '../shared/api.ts';
import { actionsReport, canExecute } from './assurance.ts';
import { makeGraph } from './testing/graph.ts';
import {
  graphSummary,
  interventionHeatmap,
  loopView,
  recentProposals,
  techTreeView,
} from './views.ts';

/** Every `category` the engine writes, across seeding and the curated model. */
const STORED_CATEGORIES = [
  'mcp',
  'agent',
  'provider',
  'model',
  'skill',
  'tool',
  'combo',
  'runtime',
  'meta',
  'action',
  'human',
  'credential',
];

test('every category the engine stores maps to a type the client can draw', () => {
  const db = makeGraph({
    capabilities: STORED_CATEGORIES.map((category, i) => ({
      id: `${category}:node-${i}`,
      name: `Node ${i}`,
      category,
    })),
  });
  const { items } = techTreeView(db);
  db.close();

  expect(items.length).toBe(STORED_CATEGORIES.length);
  for (const item of items) {
    expect(NODE_TYPES as readonly string[]).toContain(item.type);
  }
});

test('a category nobody anticipated becomes config, not itself', () => {
  // The fallback is the point: a renderer given a type it has no case for
  // draws a default and says nothing, which is how this went unnoticed.
  const db = makeGraph({
    capabilities: [{ id: 'weird:one', name: 'Weird', category: 'not-a-real-category' }],
  });
  const { items } = techTreeView(db);
  db.close();
  expect(items[0].type).toBe('config');
});

test('combos and mcp servers keep the names the client renders them under', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:x', name: 'X', category: 'combo' },
      { id: 'mcp:y', name: 'Y', category: 'mcp' },
    ],
  });
  const byId = new Map(techTreeView(db).items.map(i => [i.id, i.type]));
  db.close();
  expect(byId.get('combo:x')).toBe('possibility');
  expect(byId.get('mcp:y')).toBe('mcp-server');
});

test('a locked capability is specified, a reached one is built', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:locked', category: 'combo', state: 'locked' },
      { id: 'combo:reached', category: 'combo', state: 'unlocked' },
    ],
  });
  const byId = new Map(techTreeView(db).items.map(i => [i.id, i.status]));
  db.close();
  expect(byId.get('combo:locked')).toBe('specified');
  expect(byId.get('combo:reached')).toBe('built');
});

test('the summary counts what is reached, and survives an empty graph', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'a:1', state: 'unlocked' },
      { id: 'a:2', state: 'locked' },
    ],
  });
  const summary = graphSummary(db);
  db.close();
  expect(summary.total).toBe(2);
  expect(summary.reached).toBe(1);

  const empty = makeGraph({});
  expect(graphSummary(empty).total).toBe(0);
  empty.close();
});

test('the reading surfaces answer on a graph with nothing in it', () => {
  // Each is guarded separately on purpose: a database predating one of these
  // tables used to throw and zero the counts from the query before it.
  const db = makeGraph({});
  expect(recentProposals(db)).toEqual([]);
  expect(interventionHeatmap(db)).toEqual([]);
  expect(techTreeView(db).items).toEqual([]);
  db.close();
});

// ── What the surfaces need to decide, not only to see ────────────────────────

test('a node carries who supplies it, its authority, and how its checks fared', () => {
  // Every one of these existed in the engine and reached no screen: the map
  // painted every downstream node red whether or not another provider stood,
  // the panel said "passed" for one run and for forty, and nothing on the web
  // said whether a capability may act without asking.
  const db = makeGraph({
    capabilities: [
      { id: 'mcp:git', category: 'mcp', kind: 'provider', state: 'unlocked' },
      { id: 'mcp:github', category: 'mcp', kind: 'provider', state: 'unlocked' },
      {
        id: 'combo:version-control',
        name: 'Version Control',
        category: 'combo',
        kind: 'capability',
        state: 'unlocked',
        lifecycle: 'verified',
      },
    ],
    dependencies: [
      { from: 'mcp:git', to: 'combo:version-control', kind: 'provides', hard: true },
      { from: 'mcp:github', to: 'combo:version-control', kind: 'provides', hard: true },
    ],
    authority: [{ capability: 'combo:version-control', action: 'execute', mode: 'confirm' }],
  });
  const learn = db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score) VALUES ('t', ?, ?, ?)"
  );
  learn.run('combo:version-control', 'verified', 1);
  learn.run('combo:version-control', 'verified', 1);
  learn.run('combo:version-control', 'failed', 0);

  const tree = techTreeView(db);
  db.close();
  const vc = tree.items.find(i => i.id === 'combo:version-control')!;
  expect([...(vc.meta.providers || [])].sort()).toEqual(['mcp:git', 'mcp:github']);
  expect(vc.meta.authority?.execute).toBe('confirm');
  expect(vc.meta.reliability).toEqual({ passed: 2, total: 3 });
  expect(tree.connections.every(c => c.kind === 'provides')).toBe(true);
});

test("the loop view carries authority, what to reach next, and the week's movement", () => {
  const db = makeGraph({
    capabilities: [
      {
        id: 'combo:have',
        name: 'Have',
        category: 'combo',
        kind: 'capability',
        state: 'unlocked',
        lifecycle: 'verified',
      },
      {
        id: 'combo:next',
        name: 'Next',
        category: 'combo',
        kind: 'capability',
        state: 'locked',
        setupSeconds: 600,
      },
      { id: 'mcp:git', category: 'mcp', kind: 'provider', state: 'unlocked' },
    ],
    dependencies: [
      { from: 'combo:have', to: 'combo:next', kind: 'requires', hard: true },
      { from: 'mcp:git', to: 'combo:have', kind: 'provides', hard: true },
    ],
    authority: [{ capability: 'combo:have', action: 'execute', mode: 'autonomous' }],
  });
  const loop = loopView(db);
  db.close();

  expect(loop.authority.autonomous).toBe(1);
  expect(loop.authority.confirm).toBe(0);
  expect(loop.authority.promotable).toEqual([]);
  expect(loop.next.map(n => n.id)).toContain('combo:next');
  expect(loop.next[0].basis).toBe('structural');
  // No second observation yet, so there is no movement to report, and the
  // page says nothing rather than drawing an empty week.
  expect(loop.since).toBeNull();
});

test('a proposal row carries what deciding on it needs', () => {
  const db = makeGraph({});
  db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated, economic_case) VALUES (?, ?, 'draft', ?, ?, ?)"
  ).run(
    'prop-1',
    'reach x',
    JSON.stringify([
      {
        id: 'combo:x',
        name: 'X',
        setup_seconds: 1800,
        privacy: 'local',
        recurring_cost: 'none',
        inverse: { op: 'remove' },
      },
    ]),
    JSON.stringify({
      acquired: [{ id: 'combo:x', name: 'X' }],
      unblocked: [{ id: 'combo:y', name: 'Y' }],
    }),
    JSON.stringify({
      observed: { human_hours_month: 2 },
      predicted: { human_hours_month_after: 0.5, savings_dollars_month: 300 },
      confidence: 'high',
    })
  );
  const [row] = recentProposals(db);
  db.close();

  expect(row.decision).toMatchObject({
    setup_hours: 0.5,
    reversible: true,
    requires_person: false,
    privacy: 'local',
    unlocks: ['X', 'Y'],
  });
  expect(row.decision?.forecast).toMatchObject({
    hours_month_now: 2,
    hours_month_after: 0.5,
    savings_dollars_month: 300,
    confidence: 'high',
  });
});

test('a node lists the actions it confers, each with its own mode', () => {
  // Authority is per action. The panel said "asks before acting" for the
  // capability, which is the narrowest of these; what the agent may actually
  // do is read the output without asking and run a command with.
  const db = makeGraph({
    capabilities: [
      {
        id: 'combo:shell',
        name: 'Shell',
        category: 'combo',
        kind: 'capability',
        state: 'unlocked',
        updatedAt: '2026-08-01 00:00:00',
      },
      { id: 'act:shell/run', name: 'run', category: 'action', kind: 'action', state: 'unlocked' },
      { id: 'act:shell/read', name: 'read', category: 'action', kind: 'action', state: 'unlocked' },
    ],
    dependencies: [
      { from: 'combo:shell', to: 'act:shell/run', kind: 'provides', hard: true },
      { from: 'combo:shell', to: 'act:shell/read', kind: 'provides', hard: true },
    ],
    authority: [
      { capability: 'act:shell/run', action: 'execute', mode: 'confirm' },
      { capability: 'act:shell/read', action: 'execute', mode: 'autonomous' },
    ],
  });
  const shell = techTreeView(db).items.find(i => i.id === 'combo:shell')!;
  db.close();
  expect(shell.meta.actions).toEqual([
    { id: 'act:shell/read', name: 'read', mode: 'autonomous' },
    { id: 'act:shell/run', name: 'run', mode: 'confirm' },
  ]);
  // Days since the row last changed: what has stopped being tended.
  expect(shell.meta.daysSinceChange).toBeGreaterThan(30);
});

test('what work asked for and never had heads the loop payload', () => {
  const db = makeGraph({
    capabilities: [
      {
        id: 'combo:vector',
        name: 'Vector Store',
        category: 'combo',
        kind: 'capability',
        state: 'locked',
      },
    ],
  });
  const learn = db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score) VALUES ('t', ?, ?, 0)"
  );
  for (let i = 0; i < 4; i++) learn.run('combo:vector', 'blocked:tool');
  const loop = loopView(db);
  db.close();
  expect(loop.demand).toEqual([
    { id: 'combo:vector', name: 'Vector Store', times: 4, structural: true, failing: false },
  ]);
});

test('a reached node no grant names reads the way the gate answers it', () => {
  // The panel said an ungranted action ran without asking, and `canExecute`
  // refused it with "No grant covers". The map now says what the gate says.
  const db = makeGraph({
    capabilities: [
      {
        id: 'combo:shell',
        name: 'Shell',
        category: 'combo',
        kind: 'capability',
        state: 'unlocked',
      },
      { id: 'combo:far', name: 'Far', category: 'combo', kind: 'capability', state: 'locked' },
      { id: 'act:shell/read', name: 'read', category: 'action', kind: 'action', state: 'unlocked' },
    ],
    dependencies: [{ from: 'combo:shell', to: 'act:shell/read', kind: 'provides', hard: true }],
  });
  const items = techTreeView(db).items;
  const gate = canExecute(db, { capability: 'combo:shell' });
  const actionGate = canExecute(db, { capability: 'act:shell/read' });
  // `ambit authority shell` said exercisable, on the same fallback.
  const report = actionsReport(db, 'shell') as any;
  db.close();
  expect(report.exercisable).toEqual([]);
  expect(report.forbidden).toEqual(['act:shell/read']);
  const shell = items.find(i => i.id === 'combo:shell')!;
  expect(gate.verdict).toBe('no');
  expect(shell.meta.authority).toEqual({ execute: 'forbidden', ungranted: true });
  expect(actionGate.verdict).toBe('no');
  expect(shell.meta.actions).toEqual([
    { id: 'act:shell/read', name: 'read', mode: 'forbidden', ungranted: true },
  ]);
  // Locked has nothing to act with, and is given no answer.
  expect(items.find(i => i.id === 'combo:far')!.meta.authority).toBeUndefined();
});

test("the tree carries the week's movement, and says nothing before a second observation", () => {
  const db = makeGraph({
    capabilities: [
      {
        id: 'combo:shell',
        name: 'Shell',
        category: 'combo',
        kind: 'capability',
        state: 'unlocked',
      },
    ],
  });
  const view = techTreeView(db);
  db.close();
  // One seed is one observation: there is no week to compare against yet.
  expect(view.since).toBeNull();
});
