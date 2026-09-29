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
import { useAmbitStore } from './ambitStore';
import { demoHistory } from './demo';

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

afterEach(() => useAmbitStore.setState({ history: null, demo: false }));

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
