/**
 * The store's half of the switch: what it asks the route for, and what it does
 * once the route has answered.
 *
 * Nothing tested `toggleMcpEnabled`, and now two surfaces call it. The API here
 * is a stand-in that answers the way the real routes do, so the request the
 * page sends is held against the contract the server enforces in api.test.ts.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { flipMcp } from '../utils/configSwitch';
import { useAmbitStore } from './ambitStore';

type Config = { mcp: Record<string, { type: string; enabled?: boolean }> };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * The routes the switch touches. The apply route changes an entry that is there
 * and says ok either way, as the real one does; the reads serve what is now in
 * the config.
 */
function fakeApi(config: Config, { refuse = false } = {}) {
  const applied: unknown[] = [];
  const reads: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/config/apply') {
        const body = JSON.parse(String(init?.body));
        applied.push(body);
        if (refuse) return reply({ error: 'Could not write opencode.json.' }, 500);
        for (const name of body.disableMcp ?? []) {
          if (Object.hasOwn(config.mcp, name)) config.mcp[name].enabled = false;
        }
        for (const name of body.enableMcp ?? []) {
          if (Object.hasOwn(config.mcp, name)) config.mcp[name].enabled = true;
        }
        return reply({ ok: true });
      }
      reads.push(path);
      if (path === '/api/health') return reply({ status: 'ok' });
      if (path === '/api/tech-tree') return reply({ items: [], connections: [] });
      if (path === '/api/config') return reply({ config });
      return reply({ error: `unexpected ${path}` }, 404);
    })
  );
  return { applied, reads };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAmbitStore.setState({ items: [], connections: [], configMcp: {} });
});

const entry = (id: string) => useAmbitStore.getState().items.find(i => i.id === id);

test('switching a server off asks the route to disable that name, then reads the config back', async () => {
  const api = fakeApi({ mcp: { git: { type: 'local', enabled: true } } });

  expect(await useAmbitStore.getState().toggleMcpEnabled('git', false)).toBeNull();

  expect(api.applied).toEqual([{ enableMcp: [], disableMcp: ['git'] }]);
  // The row draws from what came back, not from what was asked for.
  expect(useAmbitStore.getState().configMcp.git.enabled).toBe(false);
  expect(entry('mcp:git')?.status).toBe('specified');
});

test('switching it back on asks the route to enable it', async () => {
  const api = fakeApi({ mcp: { git: { type: 'local', enabled: false } } });

  expect(await useAmbitStore.getState().toggleMcpEnabled('git', true)).toBeNull();

  expect(api.applied).toEqual([{ enableMcp: ['git'], disableMcp: [] }]);
  expect(entry('mcp:git')?.status).toBe('built');
});

test('a write the route refused is reported, and nothing on screen changes', async () => {
  const api = fakeApi({ mcp: { git: { type: 'local', enabled: true } } }, { refuse: true });
  useAmbitStore.setState({ configMcp: { git: { type: 'local', enabled: true } } });

  expect(await useAmbitStore.getState().toggleMcpEnabled('git', false)).toBe(
    'Could not write opencode.json.'
  );

  // Nothing was read back, so the row still shows the config as it was.
  expect(api.reads).toEqual([]);
  expect(useAmbitStore.getState().configMcp.git.enabled).toBe(true);

  // And the row says so in words, where it would have flipped and flipped back.
  const message = await flipMcp(
    { name: 'git', status: 'built' },
    useAmbitStore.getState().toggleMcpEnabled
  );
  expect(message).toBe('Could not switch git. Could not write opencode.json.');
});

test('a page that cannot reach the API reports it and does not throw', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    })
  );

  expect(await useAmbitStore.getState().toggleMcpEnabled('git', false)).toBe(
    'The engine did not answer.'
  );
});
