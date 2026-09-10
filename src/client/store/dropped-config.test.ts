/**
 * Mapping a config the browser was handed.
 *
 * `loadFromJSON` existed in the store and nothing called it: no drop target,
 * no file picker, no window global — so the answer to "what does this look
 * like for my setup" was "clone the repository". It now backs the welcome
 * screen's drop zone, which means it has to tell an agent config from a graph
 * export, and both from a file that is neither.
 */
import { beforeEach, expect, test } from 'vitest';
import { useAmbitStore } from './ambitStore';

beforeEach(() => {
  useAmbitStore.setState({ items: [], connections: [], demo: true });
});

test('an agent config is mapped in the browser, with no engine behind it', () => {
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      mcp: { github: { type: 'local', command: ['gh', 'mcp'] } },
      agent: { oracle: { description: 'debugging' } },
    })
  );

  expect(ok).toBe(true);
  const { items, demo } = useAmbitStore.getState();
  expect(items.map(i => i.id)).toContain('mcp:github');
  expect(items.map(i => i.id)).toContain('agent:oracle');
  // What is on screen is now the visitor's own setup, not the sample.
  expect(demo).toBe(false);
});

test('an `ambit graph` export is drawn as it stands', () => {
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      items: [{ id: 'combo:deploy', name: 'Deploy', type: 'possibility' }],
      connections: [{ from: 'combo:deploy', to: 'combo:deploy' }],
    })
  );

  expect(ok).toBe(true);
  const { items, connections } = useAmbitStore.getState();
  expect(items[0]).toMatchObject({ id: 'combo:deploy', status: 'built' });
  expect(connections[0].type).toBe('connects');
});

test('anything else is refused rather than drawn as an empty graph', () => {
  const state = useAmbitStore.getState();
  expect(state.loadFromJSON('not json at all')).toBe(false);
  expect(state.loadFromJSON('{"unrelated":true}')).toBe(false);
  expect(state.loadFromJSON('[]')).toBe(false);
  // A refusal leaves the view alone; it does not blank it.
  expect(useAmbitStore.getState().items).toEqual([]);
});
