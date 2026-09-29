/**
 * Where the map's history comes from.
 *
 * Every loader in the store has two paths, the engine's and the demo's, and a
 * timeline is only as honest as the one it took: the demo must never ask an
 * engine for a machine it is not showing, and a live page must never show the
 * demo's series as this machine's past.
 */
import { afterEach, expect, test } from 'vitest';
import type { FrontierHistoryResponse } from '../../shared/api';
import { tickSecond } from '../components/civ/history';
import { outageSplit } from '../components/civ/layout';
import { mergeGraphs, useAmbitStore } from './ambitStore';
import { demoConfigGraph, demoHistory, demoTreeGraph } from './demo';

const LEDGER: FrontierHistoryResponse = {
  ticks: [
    {
      at: '2026-09-21 09:00:00',
      states: { 'combo:shell': 'locked' },
      kinds: { 'combo:shell': 'capability' },
      lifecycles: { 'combo:shell': 'unknown' },
      moved: 'first observation, reached 0',
    },
    {
      at: '2026-09-25 17:00:00',
      states: { 'combo:shell': 'unlocked' },
      kinds: { 'combo:shell': 'capability' },
      lifecycles: { 'combo:shell': 'verified' },
      moved: 'reached 0 to 1, verified 0 to 1',
    },
  ],
  movedSinceLast: null,
};

/** An engine on loopback: health answers, and so does whatever `routes` names. */
function engine(routes: Record<string, unknown>) {
  const asked: string[] = [];
  globalThis.fetch = (async (path: string) => {
    asked.push(path);
    if (path === '/api/health') return { ok: true, json: async () => ({ status: 'ok' }) };
    if (path in routes) return { ok: true, json: async () => routes[path] };
    return { ok: false, json: async () => ({ error: 'Not found' }) };
  }) as unknown as typeof fetch;
  return asked;
}

afterEach(() =>
  useAmbitStore.setState({
    history: null,
    historyAt: null,
    demo: false,
    items: [],
    connections: [],
    activeLens: 'default',
  })
);

test('the demo answers from its own series and asks no engine', async () => {
  globalThis.fetch = (async () => {
    throw new Error('the demo asked an engine');
  }) as unknown as typeof fetch;
  useAmbitStore.setState({ demo: true });
  await useAmbitStore.getState().loadHistory();
  expect(useAmbitStore.getState().history).toEqual(demoHistory());
});

test('a live engine answers from its ledger', async () => {
  const asked = engine({ '/api/frontier': LEDGER });
  await useAmbitStore.getState().loadHistory();
  expect(asked).toContain('/api/frontier');
  expect(useAmbitStore.getState().history).toEqual(LEDGER);
});

test('an engine that serves no history leaves the map without a timeline', async () => {
  engine({});
  await useAmbitStore.getState().loadHistory();
  expect(useAmbitStore.getState().history).toBeNull();
});

test('a playhead no tick has falls back to now once the series arrives', async () => {
  engine({ '/api/frontier': LEDGER });
  // A link from another machine, whose ledger has a second this one does not.
  useAmbitStore.setState({ historyAt: '2026-01-01T00:00:00Z' });
  await useAmbitStore.getState().loadHistory();
  expect(useAmbitStore.getState().historyAt).toBeNull();

  useAmbitStore.setState({ historyAt: '2026-09-21T09:00:00Z' });
  await useAmbitStore.getState().loadHistory();
  expect(useAmbitStore.getState().historyAt).toBe('2026-09-21T09:00:00Z');
});

test('the demo keeps a playhead on one of its own ticks, and drops any other', () => {
  const [first] = demoHistory().ticks;
  const second = `${first.at.replace(' ', 'T')}Z`;
  useAmbitStore.setState({ historyAt: second });
  useAmbitStore.getState().seedDemo();
  expect(useAmbitStore.getState().historyAt).toBe(second);

  useAmbitStore.setState({ historyAt: '2026-01-01T00:00:00Z' });
  useAmbitStore.getState().seedDemo();
  expect(useAmbitStore.getState().historyAt).toBeNull();
});

test('a simulation started while the map is scrubbed plays on now, the graph it walked', () => {
  // The finder's "Simulate an outage of…" and Time & cost's "Show it on the
  // map" both start one while the playhead can be in the past. The cascade is
  // the live graph's, so a map left on Aug 17 drew today's cascade over Aug
  // 17's states, beside a panel saying simulations wait for now.
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const past = tickSecond(demoHistory().ticks[1]);
  const store = () => useAmbitStore.getState();
  useAmbitStore.setState({ items, connections, history: demoHistory() });

  for (const start of [
    () => store().startOutageSimulation('combo:shell-execution'),
    () => store().startAcquisitionSimulation('combo:embeddings'),
    () => store().startGapSimulation('combo:embeddings'),
  ]) {
    useAmbitStore.setState({ historyAt: past });
    start();
    expect(store().historyAt).toBeNull();
    expect(store().simulationMode).not.toBe('none');
  }
  // The outage the banner counts is the live one.
  useAmbitStore.setState({ historyAt: past });
  store().startOutageSimulation('combo:shell-execution');
  expect(store().simulatedCascadeIds).toEqual(
    outageSplit(items, connections, 'combo:shell-execution').stops
  );
  store().clearSimulation();
});

test('a lens no observation can paint returns the map to now, and the standard one does not', () => {
  const past = tickSecond(demoHistory().ticks[1]);
  useAmbitStore.setState({ history: demoHistory(), historyAt: past, activeLens: 'default' });
  // Attention and grants are not in a snapshot: chosen from the finder while
  // scrubbed, the lens used to be written to the URL and change nothing.
  useAmbitStore.getState().setActiveLens('attention');
  expect(useAmbitStore.getState()).toMatchObject({ activeLens: 'attention', historyAt: null });

  useAmbitStore.setState({ historyAt: past });
  useAmbitStore.getState().setActiveLens('authority');
  expect(useAmbitStore.getState().historyAt).toBeNull();

  // The past is drawn in the standard lens, so asking for it keeps the playhead.
  useAmbitStore.setState({ historyAt: past });
  useAmbitStore.getState().setActiveLens('default');
  expect(useAmbitStore.getState()).toMatchObject({ activeLens: 'default', historyAt: past });
});

test('scrubbing into the past ends a simulation, which walks the live graph', () => {
  useAmbitStore.setState({ simulationMode: 'outage', simulatedNodeId: 'combo:shell' });
  useAmbitStore.getState().setHistoryAt('2026-09-21T09:00:00Z');
  expect(useAmbitStore.getState().simulationMode).toBe('none');
  expect(useAmbitStore.getState().simulatedNodeId).toBeNull();
  expect(useAmbitStore.getState().historyAt).toBe('2026-09-21T09:00:00Z');
});
