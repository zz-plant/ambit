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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getDb, migrate } from './testing/cli.ts';
import { ingestTrackerSpool } from './tracker-spool.ts';

const PLUGINS = join(import.meta.dirname, '..', '..', 'plugins');
const load = (name: string) => import(pathToFileURL(join(PLUGINS, name)).href);

const posts: any[] = [];
/** The X-Ambit-Token each post carried, in the order they arrived. */
const tokens: Array<string | undefined> = [];
const TOKEN = 'plugin-test-token';
let close: () => void;
const scratch = mkdtempSync(join(tmpdir(), 'ambit-plugins-'));
const dbPath = join(scratch, 'tracker.db');
const trackerSpool = join(scratch, 'tracker.jsonl');

beforeAll(async () => {
  // The tracker spools its changes for the engine; the spool and the graph
  // that reads it are this test's own, so nothing reaches a real one.
  process.env.AMBIT_TRACKER_SPOOL = trackerSpool;
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
      tokens.push(req.headers['x-ambit-token'] as string | undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body.run ? { run: `run-${posts.length}` } : { ok: true }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  process.env.AMBIT_SERVER = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The route refuses a post without the API token; the bridge has to send it.
  process.env.AMBIT_API_TOKEN = TOKEN;
  close = () => server.close();
});

afterAll(() => {
  close?.();
  delete process.env.AMBIT_SERVER;
  delete process.env.AMBIT_API_TOKEN;
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

  // Each failure or use is posted after its call's event, so wait for those too.
  await until(
    () =>
      posts.filter(p => p.event).length === 3 &&
      posts.filter(p => p.failure).length === 2 &&
      posts.some(p => p.use) &&
      posts.some(p => p.intervention)
  );
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
  // The call that worked is a use, named by its tool for the engine to place.
  // No start was seen, so it carries no length, and not a zero either.
  expect(posts.filter(p => p.use).map(p => p.use)).toEqual([
    { runId: expect.any(String), tool: 'read', source: 'opencode' },
  ]);
  const interventions = posts.filter(p => p.intervention).map(p => p.intervention);
  expect(interventions).toHaveLength(1);
  expect(interventions[0]).toMatchObject({
    kind: 'authority',
    action: 'shell',
    outcome: 'rejected',
  });
  expect(interventions[0].startedAt).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  // Every post, the run's opening included, presented the token.
  expect(tokens.length).toBe(posts.length);
  expect(new Set(tokens)).toEqual(new Set([TOKEN]));
});

test('telemetry times a call from its start, and leaves the length off where it cannot say one', async () => {
  const hooks: Record<string, (e: any) => void> = {};
  let ask!: () => void;
  const asking = new Promise<void>(r => {
    ask = r;
  });
  const ctx = {
    tool: {
      hook: async (name: string, cb: (e: any) => void) => {
        hooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    event: {
      subscribe: () =>
        (async function* () {
          await asking;
          yield { type: 'permission.asked', data: { id: 'p9', sessionID: 's2', action: 'shell' } };
          yield {
            type: 'permission.replied',
            data: { sessionID: 's2', requestID: 'p9', reply: 'once' },
          };
        })(),
    },
  };
  const { default: plugin } = await load('ambit-telemetry.js');
  const cleanup = await plugin.setup(ctx);
  const from = posts.length;
  const call = { sessionID: 's2', agent: 'build', messageID: 'm', input: {} };
  const done = { ...call, status: 'completed', result: {} };

  hooks['execute.before']({ ...call, id: 'timed', tool: 'read' });
  await new Promise(r => setTimeout(r, 30));
  hooks['execute.after']({ ...done, id: 'timed', tool: 'read' });
  // Its start was never seen.
  hooks['execute.after']({ ...done, id: 'unseen', tool: 'grep' });
  // A person was asked while it ran, so its span holds their wait.
  hooks['execute.before']({ ...call, id: 'waited', tool: 'shell' });
  ask();
  await until(() => posts.slice(from).some(p => p.intervention));
  hooks['execute.after']({ ...done, id: 'waited', tool: 'shell' });

  const uses = () => posts.slice(from).flatMap(p => (p.use ? [p.use] : []));
  await until(() => uses().length === 3);
  cleanup?.();

  const byTool = Object.fromEntries(uses().map(u => [u.tool, u]));
  expect(byTool.read.durationSeconds).toBeGreaterThanOrEqual(0.02);
  expect(byTool.read.durationSeconds).toBeLessThan(5);
  expect(byTool.read.at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  expect(byTool.grep).not.toHaveProperty('durationSeconds');
  expect(byTool.shell).not.toHaveProperty('durationSeconds');
});

test('under OpenCode 1 a call is timed the same way, and a permission ask costs it its length', async () => {
  const { default: plugin } = await load('ambit-telemetry.js');
  const hooks = await plugin.server({});
  const from = posts.length;
  await hooks['tool.execute.before']({ tool: 'read', sessionID: 'v1', callID: 'a' });
  await new Promise(r => setTimeout(r, 20));
  await hooks['tool.execute.after']({ tool: 'read', sessionID: 'v1', callID: 'a' });
  await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'v1', callID: 'b' });
  await hooks['permission.ask']({ sessionID: 'v1', type: 'bash' }, { status: 'ask' });
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 'v1', callID: 'b' });
  await hooks['tool.execute.after']({ tool: 'glob', sessionID: 'v1', callID: 'c' });

  const uses = posts.slice(from).flatMap(p => (p.use ? [p.use] : []));
  expect(uses.map(u => [u.tool, typeof u.durationSeconds])).toEqual([
    ['read', 'number'],
    ['bash', 'undefined'],
    ['glob', 'undefined'],
  ]);
  expect(uses[0].durationSeconds).toBeGreaterThanOrEqual(0.015);
});

test('telemetry finds the token in the file the API server made', async () => {
  // As readApiToken in src/server/config.ts finds it, which this transcribes.
  const home = mkdtempSync(join(tmpdir(), 'ambit-plugin-home-'));
  const saved = { HOME: process.env.HOME, AMBIT_API_TOKEN: process.env.AMBIT_API_TOKEN };
  try {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'ambit-api.token'), 'from-the-file\n');
    process.env.HOME = home;
    delete process.env.AMBIT_API_TOKEN;
    const { default: plugin } = await load('ambit-telemetry.js');
    // OpenCode 1's hooks: an error needs no run, so it is one post.
    const hooks = await plugin.server({});
    const before = posts.length;
    await hooks['tool.execute.error']({ tool: 'bash', error: { message: 'boom' } });
    await until(() => posts.length > before);
    expect(posts.at(-1).failure).toMatchObject({ tool: 'bash', message: 'boom' });
    expect(tokens.at(-1)).toBe('from-the-file');
  } finally {
    process.env.HOME = saved.HOME;
    process.env.AMBIT_API_TOKEN = saved.AMBIT_API_TOKEN;
    rmSync(home, { recursive: true, force: true });
  }
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
      ingestTrackerSpool(g, trackerSpool);
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
