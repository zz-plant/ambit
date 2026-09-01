/**
 * The API server, driven over real HTTP.
 *
 * server.ts had no tests at all — 0% of 166 lines — which for the process that
 * reads and writes the agent config, serves the visualiser and ingests
 * telemetry is the least defensible gap in the repo. It boots as a child
 * process here because that is the only way its own startup, routing and
 * static path handling are the thing under test rather than a re-implementation
 * of them.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';

/** `Response.json()` is `unknown` under TypeScript 7; these read fields off it. */
const json = async (r: Response): Promise<any> => await r.json();

const ROOT = join(import.meta.dirname, '..', '..');
const TOKEN = 'b'.repeat(64);

let dir: string;
let server: ChildProcess;
let base: string;

const freePort = (): Promise<number> =>
  new Promise(resolve => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-api-'));
  const configPath = join(dir, 'opencode.json');
  writeFileSync(
    configPath,
    JSON.stringify({ mcp: { git: { type: 'local', enabled: true } }, agent: {} })
  );
  const dbPath = join(dir, 'graph.db');
  const env = {
    ...process.env,
    AMBIT_DB: dbPath,
    TOOLCHAIN_DB: dbPath,
    OPENCODE_CONFIG: configPath,
    INFRA_MANIFEST: join(dir, 'none.json'),
    AMBIT_API_TOKEN: TOKEN,
    NODE_NO_WARNINGS: '1',
  };
  execFileSync(
    'node',
    ['--experimental-sqlite', join(ROOT, 'src', 'engine', 'engine.ts'), 'seed'],
    {
      env,
      stdio: 'ignore',
    }
  );

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('node', ['--experimental-sqlite', join(ROOT, 'server.ts')], {
    env: { ...env, AMBIT_API_PORT: String(port) },
    cwd: ROOT,
    stdio: 'ignore',
  });

  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the API server never came up');
}, 30_000);

afterAll(() => {
  server?.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

test('health reports the paths it resolved, so a misconfigured run is legible', async () => {
  const r = await fetch(`${base}/api/health`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(body.status).toBe('ok');
  expect(body.configExists).toBe(true);
});

test('the graph is served in the shape the client renders', async () => {
  const r = await fetch(`${base}/api/tech-tree`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(body.items.length).toBeGreaterThan(0);
  // The contract in src/shared/api.ts: a renderable type and a meta block.
  for (const item of body.items.slice(0, 20)) {
    expect(typeof item.id).toBe('string');
    expect(typeof item.meta.domain).toBe('string');
    expect(['built', 'specified']).toContain(item.status);
  }
});

test('reading the config needs the token when the caller is not a browser', async () => {
  expect((await fetch(`${base}/api/config`)).status).toBe(401);
  expect(
    (await fetch(`${base}/api/config`, { headers: { 'X-Ambit-Token': 'wrong' } })).status
  ).toBe(401);
  const ok = await fetch(`${base}/api/config`, { headers: { 'X-Ambit-Token': TOKEN } });
  expect(ok.status).toBe(200);
  expect((await json(ok)).config.mcp.git).toBeDefined();
});

test('a foreign origin is refused before routing, not merely un-CORSed', async () => {
  // CORS headers only stop a browser *reading* the reply; a simple request is
  // still delivered and executed. The rejection has to be the request itself.
  const r = await fetch(`${base}/api/tech-tree`, { headers: { Origin: 'https://evil.example' } });
  expect(r.status).toBe(403);
});

test('the config editor changes only what it is allowed to', async () => {
  const r = await fetch(`${base}/api/config/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ambit-Token': TOKEN },
    // The last two must be ignored: creating an entry is how an HTTP request
    // would become code execution, and __proto__ is how it would become worse.
    body: JSON.stringify({
      disableMcp: ['git'],
      updateAgent: { name: 'nonexistent', updates: { description: 'x' } },
      // biome-ignore lint/suspicious/noExplicitAny: deliberately hostile input.
      ...({ enableMcp: ['__proto__'] } as any),
    }),
  });
  expect(r.status).toBe(200);

  const after = await json(
    await fetch(`${base}/api/config`, { headers: { 'X-Ambit-Token': TOKEN } })
  );
  expect(after.config.mcp.git.enabled).toBe(false);
  expect(after.config.agent.nonexistent).toBeUndefined();
  expect(({} as Record<string, unknown>).enabled).toBeUndefined();
});

test('telemetry stays open, because the runtime plugin posts to it unattended', async () => {
  const r = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: { id: 'run-test', goal: 'a task', runType: 'task' } }),
  });
  expect(r.status).toBe(200);
});

test('an unknown path is a 404, and cannot escape dist/', async () => {
  expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  const traversal = await fetch(`${base}/../../../../etc/passwd`);
  expect(traversal.status).toBe(404);
});
