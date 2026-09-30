/**
 * The two OpenCode plugins, loaded as OpenCode 2 loads them.
 *
 * OpenCode 2 does not run a V1 plugin: it reads a default export with an `id`
 * and a `setup`, and a file with only V1's named exports fails to load and
 * records nothing. These drive `setup` with a stand-in for the context V2 hands
 * it, in the shapes `@opencode/plugin` 2.0 declares, and check what reaches the
 * ledger and the graph.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getDb, migrate } from './testing/cli.ts';

const PLUGINS = join(import.meta.dirname, '..', '..', 'plugins');
const load = (name: string) => import(pathToFileURL(join(PLUGINS, name)).href);

const posts: any[] = [];
let close: () => void;
const scratch = mkdtempSync(join(tmpdir(), 'ambit-plugins-'));
const dbPath = join(scratch, 'tracker.db');

beforeAll(async () => {
  // The tracker resolves its graph on import, and from a checkout that is the
  // checkout's own. Set before the first import, or a test writes there.
  const db = getDb(dbPath);
  migrate(db);
  db.close();
  process.env.AMBIT_DB = dbPath;

  // Both plugins read where to report when they are imported.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
    });
    req.on('end', () => {
      const body = JSON.parse(raw);
      posts.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body.run ? { run: `run-${posts.length}` } : { ok: true }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  process.env.AMBIT_SERVER = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => {
  close?.();
  delete process.env.AMBIT_SERVER;
  delete process.env.AMBIT_DB;
  rmSync(scratch, { recursive: true, force: true });
});

/** An event stream that yields what it is given, then ends. */
function stream(events: unknown[]) {
  return {
    subscribe: () =>
      (async function* () {
        for (const e of events) {
          await new Promise(r => setTimeout(r, 5));
          yield e;
        }
      })(),
  };
}

async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await new Promise(r => setTimeout(r, 10));
}

test('both plugins export what each major version reads', async () => {
  for (const name of ['ambit-telemetry.js', 'ambit-tracker.js']) {
    const mod = await load(name);
    expect(typeof mod.default.id, name).toBe('string');
    expect(typeof mod.default.setup, name).toBe('function');
    // OpenCode 1 calls `server` and ignores the rest.
    expect(typeof mod.default.server, name).toBe('function');
  }
});

test('telemetry records a session’s tool calls, failures and answered prompts', async () => {
  const hooks: Record<string, (e: any) => void> = {};
  const ctx = {
    tool: {
      hook: async (name: string, cb: (e: any) => void) => {
        hooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    event: stream([
      { type: 'permission.asked', data: { id: 'p1', sessionID: 's1', action: 'shell' } },
      { type: 'permission.replied', data: { sessionID: 's1', requestID: 'p1', reply: 'reject' } },
      // Asked and never answered: not a decision, so not recorded as one.
      { type: 'permission.asked', data: { id: 'p2', sessionID: 's1', action: 'edit' } },
    ]),
  };
  const { default: plugin } = await load('ambit-telemetry.js');
  const cleanup = await plugin.setup(ctx);

  const call = { sessionID: 's1', agent: 'build', messageID: 'm', id: 'c', input: {} };
  hooks['execute.after']({ ...call, tool: 'read', status: 'completed', result: {} });
  hooks['execute.after']({
    ...call,
    tool: 'shell',
    status: 'completed',
    result: { metadata: { exitCode: 2, stderr: 'permission denied' } },
  });
  hooks['execute.after']({
    ...call,
    tool: 'webfetch',
    status: 'error',
    error: { message: 'ECONNREFUSED' },
  });

  await until(() => posts.filter(p => p.event).length === 3 && posts.some(p => p.intervention));
  cleanup?.();

  // One run for the session, however many calls it made.
  expect(posts.filter(p => p.run)).toHaveLength(1);
  expect(
    posts
      .filter(p => p.event)
      .map(p => p.event.action)
      .sort()
  ).toEqual(['read', 'shell', 'webfetch']);
  expect(posts.filter(p => p.failure).map(p => p.failure)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tool: 'shell', exitCode: 2, message: 'permission denied' }),
      expect.objectContaining({ tool: 'webfetch', message: 'ECONNREFUSED' }),
    ])
  );
  const interventions = posts.filter(p => p.intervention).map(p => p.intervention);
  expect(interventions).toHaveLength(1);
  expect(interventions[0]).toMatchObject({
    kind: 'authority',
    action: 'shell',
    outcome: 'rejected',
  });
  expect(interventions[0].startedAt).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('the tracker records what a changed config added and removed', async () => {
  let listing = 0;
  const servers = [
    [{ name: 'git' }, { name: 'old' }],
    [{ name: 'git' }, { name: 'playwright' }],
  ];
  const ctx = {
    mcp: { list: async () => ({ data: servers[Math.min(listing++, 1)] }) },
    agent: { list: async () => ({ data: [{ id: 'build', name: 'build' }] }) },
    event: stream([{ type: 'config.updated', data: {} }]),
  };
  {
    const { default: plugin } = await load('ambit-tracker.js');
    const cleanup = await plugin.setup(ctx);
    const learned = () => {
      const g = getDb(dbPath);
      const r = g
        .prepare(
          "SELECT capability_id c, action a FROM session_learning WHERE session_id = 'config'"
        )
        .all() as Array<{ c: string; a: string }>;
      g.close();
      return r;
    };
    await until(() => learned().length === 2);
    cleanup?.();
    expect(learned().sort((x, y) => x.c.localeCompare(y.c))).toEqual([
      { c: 'mcp:old', a: 'removed' },
      { c: 'mcp:playwright', a: 'built' },
    ]);
  }
});
