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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getDb } from '../engine/db.ts';
import { recordFrontier } from '../engine/ledger.ts';

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
    // An approval signs with this, so no test reads or creates the real key.
    AMBIT_APPROVAL_KEY: 'api-test-approval-key',
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
  server = spawn('node', ['--experimental-sqlite', join(ROOT, 'src', 'server', 'api.ts')], {
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

test('the loop carries the governance half: authority, next steps, movement', async () => {
  const r = await fetch(`${base}/api/loop`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(typeof body.authority.autonomous).toBe('number');
  expect(Array.isArray(body.authority.promotable)).toBe(true);
  expect(Array.isArray(body.next)).toBe(true);
  expect('since' in body).toBe(true);
});

test('the browser can decide either way, and the graph knows who decided', async () => {
  // Approval from the panel failed on every machine that had not declared a
  // `web` actor by hand, and refusal had no route at all. Both declare the
  // person at the loopback port and record the decision.
  execFileSync(
    'node',
    [
      '--experimental-sqlite',
      join(ROOT, 'src', 'engine', 'engine.ts'),
      'propose',
      'local-embeddings',
    ],
    {
      env: {
        ...process.env,
        AMBIT_DB: join(dir, 'graph.db'),
        OPENCODE_CONFIG: join(dir, 'opencode.json'),
      },
      stdio: 'ignore',
    }
  );
  const list = await json(await fetch(`${base}/api/proposals`));
  const drafts = list.proposals.filter((p: any) => p.status === 'draft');
  expect(drafts.length).toBeGreaterThan(0);
  expect(drafts[0].decision).toBeDefined();

  const rejected = await fetch(`${base}/api/proposals/${drafts[0].id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'not this quarter' }),
  });
  expect(rejected.status).toBe(200);
  const body = await json(rejected);
  expect(body.rejected_by).toBe('human:web');
  expect(body.reason).toBe('not this quarter');

  const after = await json(await fetch(`${base}/api/proposals`));
  expect(after.proposals.find((p: any) => p.id === drafts[0].id).status).toBe('rejected');
});

test('the briefing the agent is given can be read by the person', async () => {
  const r = await fetch(`${base}/api/briefing`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(body.text).toContain('Ambit ·');
  expect(body.budget).toBeGreaterThan(0);
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
      // Deliberately hostile input.
      ...({ enableMcp: ['__proto__'] } as Record<string, unknown>),
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

test('an edit from the visualiser keeps the config it replaced in a .bak', async () => {
  // SECURITY.md says the config editing writes a `.bak` first. Only `ambit
  // apply` did, so the promise held for the terminal and not for the browser.
  const configPath = join(dir, 'opencode.json');
  const edit = (body: object) =>
    fetch(`${base}/api/config/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ambit-Token': TOKEN },
      body: JSON.stringify(body),
    });

  // Whichever way git stands, flip it: an edit that changed nothing would
  // leave a backup identical to the config, and prove nothing about the copy.
  const before = readFileSync(configPath, 'utf8');
  const was = JSON.parse(before).mcp.git.enabled;
  expect((await edit(was ? { disableMcp: ['git'] } : { enableMcp: ['git'] })).status).toBe(200);

  const after = readFileSync(configPath, 'utf8');
  expect(JSON.parse(after).mcp.git.enabled).toBe(!was);
  expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(before);

  // Put it back, and the backup moves with the edit: it is the config before
  // the latest one, not the first.
  expect((await edit(was ? { enableMcp: ['git'] } : { disableMcp: ['git'] })).status).toBe(200);
  expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(after);
});

test('switching a server the config does not have changes nothing and creates nothing', async () => {
  // The page offers its switch only for servers the config holds, because this
  // route answers ok for a name it has no entry for. That answer is a no-op and
  // has to stay one: an entry an HTTP request could create is an entry that a
  // runtime would later execute.
  const configPath = join(dir, 'opencode.json');
  const before = JSON.parse(readFileSync(configPath, 'utf8'));
  for (const body of [{ enableMcp: ['nonesuch'] }, { disableMcp: ['nonesuch'] }]) {
    const r = await fetch(`${base}/api/config/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ambit-Token': TOKEN },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(200);
  }
  const after = JSON.parse(readFileSync(configPath, 'utf8'));
  expect(after.mcp.nonesuch).toBeUndefined();
  expect(after.mcp).toEqual(before.mcp);
});

test('telemetry stays open, because the runtime plugin posts to it unattended', async () => {
  const r = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: { id: 'run-test', goal: 'a task', runType: 'task' } }),
  });
  expect(r.status).toBe(200);
});

/** Drafts written into the test graph the way a propose leaves them. */
function drafts(...ids: string[]) {
  const db = new DatabaseSync(join(dir, 'graph.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const insert = db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, ?, 'draft', '[]', '{}')"
  );
  for (const id of ids) insert.run(id, `reach what ${id} names`);
  db.close();
}

/** The proposals as the page reads them, and each one's shown hash. */
async function shown(...ids: string[]) {
  const { proposals } = await json(await fetch(`${base}/api/proposals`));
  const byId = new Map(proposals.map((p: any) => [p.id, p]));
  return {
    byId,
    items: ids.map(id => ({ id, proposalHash: (byId.get(id) as any).proposal_hash })),
  };
}

const queue = (decision: 'approve' | 'reject', body: unknown, headers: Record<string, string>) =>
  fetch(`${base}/api/proposals/${decision}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('approving one draft signs it as the person at the page and applies nothing', async () => {
  drafts('prop-one');
  const r = await fetch(`${base}/api/proposals/prop-one/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.approved_by).toBe('human:web');
  expect(body.artifact.sig).toMatch(/^[0-9a-f]{64}$/);
  const { byId } = await shown();
  expect(byId.get('prop-one')).toMatchObject({ status: 'approved', applied_at: null });
});

test('the queue signs each shown draft on its own, as the web actor, and never applies', async () => {
  drafts('prop-q1', 'prop-q2', 'prop-q3', 'prop-q4');
  const { items } = await shown('prop-q1', 'prop-q2', 'prop-q3');

  // Something with no browser behind it and no token decides nothing.
  expect((await queue('approve', { items }, {})).status).toBe(401);

  // One of them changes after the page drew it.
  const db = new DatabaseSync(join(dir, 'graph.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare("UPDATE proposals SET goal = 'reach something else' WHERE id = 'prop-q2'").run();
  db.close();

  // An actor in the body is not read: the queue decides as the person at the page.
  const r = await queue('approve', { items, actor: 'human:mallory' }, { 'X-Ambit-Token': TOKEN });
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.decided_by).toBe('human:web');
  expect(body.results.map((x: any) => [x.id, x.decided])).toEqual([
    ['prop-q1', true],
    ['prop-q2', false],
    ['prop-q3', true],
  ]);
  expect(body.results[1].refused).toContain('changed after it was shown');

  const { byId } = await shown();
  expect(byId.get('prop-q1')).toMatchObject({ status: 'approved', approved_by: 'human:web' });
  expect((byId.get('prop-q1') as any).applied_at).toBeNull();
  expect((byId.get('prop-q2') as any).status).toBe('draft');
  expect((byId.get('prop-q4') as any).status).toBe('draft');
});

test('turning down from the queue refuses an approved proposal and keeps its approval', async () => {
  drafts('prop-r1', 'prop-r2');
  const first = await shown('prop-r1');
  await queue('approve', { items: first.items }, { 'X-Ambit-Token': TOKEN });
  const { items, byId } = await shown('prop-r1', 'prop-r2');
  const artifact = (byId.get('prop-r1') as any).approval_artifact;
  expect(artifact).toBeTruthy();

  // The page itself, on a local origin, needs no token.
  const r = await queue('reject', { items }, { Origin: 'http://localhost:3000' });
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.results[0]).toMatchObject({ id: 'prop-r1', decided: false });
  expect(body.results[0].refused).toContain('drafts only');
  expect(body.results[1]).toEqual({ id: 'prop-r2', decided: true });

  const after = await shown();
  expect(after.byId.get('prop-r1')).toMatchObject({
    status: 'approved',
    approval_artifact: artifact,
  });
  expect((after.byId.get('prop-r2') as any).status).toBe('rejected');

  // A list it cannot read is refused whole.
  expect((await queue('reject', { items: [] }, { 'X-Ambit-Token': TOKEN })).status).toBe(400);
});

test('the trail is one stream, newest first, with an outcome only where one was recorded', async () => {
  const post = (body: unknown) =>
    fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await post({ run: { id: 'run-audit', goal: 'audit me', runType: 'task' } });
  await post({ end: { runId: 'run-audit', outcome: 'completed' } });

  const r = await fetch(`${base}/api/audit`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(body.days).toBe(30);
  const times = body.events.map((e: any) => e.at);
  expect(times).toEqual([...times].sort().reverse());
  const of = (action: string) =>
    body.events.find((e: any) => e.target === 'run-audit' && e.action === action);
  expect(of('ended').outcome).toEqual({ word: 'completed', tone: 'good' });
  expect('outcome' in of('started')).toBe(false);

  // It reads the ledger and writes nothing, so there is nothing to POST to.
  expect((await fetch(`${base}/api/audit`, { method: 'POST' })).status).toBe(404);
});

test('the frontier through time is read, one tick per observation, in the terminal’s words', async () => {
  const r = await fetch(`${base}/api/frontier`);
  const body = await json(r);
  expect(r.status).toBe(200);
  // The seed recorded one observation, and the first says so.
  expect(body.ticks).toHaveLength(1);
  expect(body.ticks[0].moved).toMatch(/^first observation, reached \d+$/);
  expect(Object.keys(body.ticks[0].states).length).toBeGreaterThan(0);
  expect('movedSinceLast' in body).toBe(true);

  // An observation dated before the seed's is a second tick, and the step
  // between the two reads as `ambit history since` prints it.
  const db = getDb(join(dir, 'graph.db'));
  recordFrontier(db, '2026-01-01 00:00:00');
  db.close();
  const after = await json(await fetch(`${base}/api/frontier`));
  expect(after.ticks).toHaveLength(2);
  const [first, second] = after.ticks;
  expect(first.at).toBe('2026-01-01 00:00:00');
  const terminal = JSON.parse(
    execFileSync(
      'node',
      [
        '--experimental-sqlite',
        join(ROOT, 'src', 'engine', 'engine.ts'),
        'history',
        'since',
        first.at,
        second.at,
        '--json',
      ],
      {
        env: { ...process.env, AMBIT_DB: join(dir, 'graph.db'), NODE_NO_WARNINGS: '1' },
        encoding: 'utf8',
      }
    )
  );
  expect(second.moved).toBe(terminal.moved);

  // Reading history is still behind the origin rule every route is.
  const foreign = await fetch(`${base}/api/frontier`, {
    headers: { Origin: 'https://evil.example' },
  });
  expect(foreign.status).toBe(403);
});

test('an unknown path is a 404, and cannot escape dist/', async () => {
  expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  const traversal = await fetch(`${base}/../../../../etc/passwd`);
  expect(traversal.status).toBe(404);
});
