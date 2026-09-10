/**
 * Nothing on screen may state a fact that was never recorded.
 *
 * The rule is written above `EmptyLedger`: figures that are all zero read as
 * "nothing costs you anything" rather than "nothing has been recorded". It has
 * failed twice in one component, both times as the literal string `undefined`
 * reaching a person. The Details rows printed every key of a node's meta, so a
 * local MCP server with no url showed "Url  undefined"; the evidence banner
 * interpolated an interval a clock-skewed timestamp never produced, so a
 * passing check read "✓ Check passed undefined".
 *
 * Types do not catch it: `era`, `eraName` and `lastChecked` are optional in the
 * API contract on purpose, and what a type cannot say is what absence should
 * *look* like. So the rule is held here, the way vocabulary.test.ts holds the
 * naming rule — render each surface against a node and a ledger that state
 * nothing, and fail on any placeholder that reaches the markup.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { LoopSnapshot } from '../../shared/api';
import type { Item } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import CapabilityListPanel from './CapabilityListPanel';
import CivTree from './CivTree';
import LoopDashboard from './LoopDashboard';
import NodeDetailPanel from './NodeDetailPanel';

/** What a value looks like once a renderer has stringified something absent. */
const PLACEHOLDERS = ['undefined', 'NaN', 'Invalid Date', '[object Object]'];

function expectNothingUnstated(html: string, surface: string) {
  for (const marker of PLACEHOLDERS) {
    expect(html.includes(marker), `${surface} rendered "${marker}"`).toBe(false);
  }
}

/**
 * Put the store in a state, for a server render.
 *
 * `renderToStaticMarkup` reads the *server* snapshot — zustand's initial state
 * object — so a plain `setState` is invisible to it. Both halves are set here,
 * the way reachable.test.tsx already does it.
 */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

/**
 * A capability on a real machine that has answered none of the optional
 * questions — which is every capability, on the day the graph is first built.
 * The absent keys are spelled out rather than omitted because that is how the
 * engine sends them: `views.ts` builds this object with `era`, `eraName` and
 * `lastChecked` present and undefined.
 */
const unstatedNode: Item = {
  id: 'mcp:local',
  name: 'local',
  type: 'mcp-server',
  status: 'built',
  description: 'a server with nothing else recorded about it',
  position: { x: 0, y: 0, z: 0 },
  meta: {
    domain: 'devops',
    state: 'active',
    setupSeconds: 0,
    next: false,
    lifecycle: 'verified',
    era: undefined,
    eraName: undefined,
    lastChecked: undefined,
    url: undefined,
    tags: [],
    region: '',
    owner: null,
  },
};

const neighbour: Item = {
  id: 'runtime:opencode',
  name: 'opencode',
  type: 'runtime',
  status: 'built',
  description: 'the runtime',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'meta', lifecycle: 'reliable' },
};

/** A ledger that has recorded work, and measured none of the optional parts. */
const unstatedLoop: LoopSnapshot = {
  status: {
    reached: 1,
    total: 2,
    verified: 1,
    failing: 0,
    degraded: [],
    spofs: [],
    deficits: [],
    pending: [],
  },
  attention: {
    interventions: 3,
    reducible: [
      {
        kind: 'permission',
        capability: 'local',
        // capability_id absent: the row names no node on the graph.
        times: 3,
        hours: 0.5,
        suggested_fix: 'let it run unattended',
      },
    ],
    keepers: [{ kind: 'review', capability: 'local', times: 1, hours: 0.2 }],
  },
  opportunities: [
    {
      id: 'opp:1',
      title: 'stop approving the same command',
      capability: 'local',
      kind: 'permission',
      burden: { interventions_month: 3, human_hours_month: 0.5, attention_dollars_month: 40 },
      proposal: { action: 'allowlist it', setup_hours: 0.25 },
      expected: { human_hours_month_after: 0, savings_dollars_month: 40 },
      // Nothing is saved, so the setup never pays back.
      payback_months: null,
      confidence: 'low',
    },
  ],
  roi: {
    hours_per_year: 6,
    dollars_per_year: 480,
    // Nothing applied has been measured yet.
    accuracy: null,
    verdict: 'not yet measured',
    monthly_hours: [{ month: '2026-08', hours: 0.5 }],
    forecast: null,
  },
};

beforeAll(() => {
  const mediaQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    localStorage: { getItem: () => '1', setItem() {} },
    window: {
      location: { search: '?guide=off' },
      matchMedia: () => mediaQuery,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
    },
  });
});

afterEach(() => {
  seed({
    items: [],
    connections: [],
    selectedItem: null,
    loop: null,
    loopSource: null,
    loopEmpty: false,
    searchQuery: '',
  });
});

test('the detail panel states nothing about a node that recorded nothing', () => {
  seed({
    items: [unstatedNode, neighbour],
    connections: [{ from: unstatedNode.id, to: neighbour.id, type: 'hard-dep' }],
    selectedItem: unstatedNode.id,
    showDetailPanel: true,
  });

  expectNothingUnstated(renderToStaticMarkup(<NodeDetailPanel />), 'NodeDetailPanel');
});

test('the capability list states nothing about a node that recorded nothing', () => {
  seed({ items: [unstatedNode, neighbour], selectedItem: null, searchQuery: '' });

  expectNothingUnstated(renderToStaticMarkup(<CapabilityListPanel />), 'CapabilityListPanel');
});

test('the map states nothing about a node that recorded nothing', () => {
  seed({ items: [unstatedNode, neighbour] });

  const html = renderToStaticMarkup(
    <CivTree
      items={[unstatedNode, neighbour]}
      connections={[{ from: unstatedNode.id, to: neighbour.id, type: 'hard-dep' }]}
      selectedId={unstatedNode.id}
      hoveredId={null}
      onSelect={() => {}}
      onHover={() => {}}
    />
  );

  expectNothingUnstated(html, 'CivTree');
});

test('the loop page states nothing the ledger did not measure', () => {
  seed({ loop: unstatedLoop, loopSource: 'ledger', loopEmpty: false });

  expectNothingUnstated(renderToStaticMarkup(<LoopDashboard />), 'LoopDashboard');
});

/**
 * The two regressions this rule was written for, kept as named cases so a
 * future rewrite of the banner has to answer them directly.
 */
test('a check whose timestamp the clock disagrees with drops the interval, not prints it', () => {
  // The machine that wrote the evidence runs ahead of the browser reading it —
  // routine once a graph is federated across machines.
  const skewed = new Date(Date.now() + 5 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
  seed({
    items: [{ ...unstatedNode, meta: { lifecycle: 'verified', lastChecked: skewed } }],
    selectedItem: unstatedNode.id,
    showDetailPanel: true,
  });

  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expectNothingUnstated(html, 'NodeDetailPanel with a future lastChecked');
  // The claim it can still make, it still makes.
  expect(html).toContain('Check passed');
});

test('a check whose timestamp cannot be read drops the interval, not prints it', () => {
  seed({
    items: [{ ...unstatedNode, meta: { lifecycle: 'reliable', lastChecked: 'not a timestamp' } }],
    selectedItem: unstatedNode.id,
    showDetailPanel: true,
  });

  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expectNothingUnstated(html, 'NodeDetailPanel with an unreadable lastChecked');
  expect(html).toContain('Check passing consistently');
});

/**
 * The sweep above is only an invariant while it covers every surface that reads
 * a node's metadata. A new one — or an old one that starts reading `meta` —
 * fails here until it is either rendered above or argued out of the list.
 */
test('every surface that reads a node’s metadata is swept above', () => {
  const swept = ['CivTree', 'NodeDetailPanel'];

  // `.meta` on anything but `import`, which is Vite's and not a node's.
  const readsMeta = /(?<!import)\.meta\b/;

  const dir = import.meta.dirname;
  const readers = readdirSync(dir)
    .filter(f => f.endsWith('.tsx') && !f.includes('.test.'))
    .filter(f => readsMeta.test(readFileSync(join(dir, f), 'utf8')))
    .map(f => f.replace(/\.tsx$/, ''))
    .sort();

  expect(readers).toEqual(swept.sort());
});
