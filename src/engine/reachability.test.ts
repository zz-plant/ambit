/**
 * Reachability as evidence: what `ambit incidents` records about the devices
 * and services the infrastructure manifest names.
 *
 * A device or service that stopped answering moved no lifecycle. The probe
 * found it, an incident run opened, and every plan and grant went on reading
 * the service as working. Each probe is now a check run on the node it asked,
 * the row `ambit verify` writes, so the lifecycle, the gate and the plans read
 * it with no rule of their own; and an answer stamps when the node was last
 * seen, which nothing used to store.
 *
 * Every address here is a server this file starts on 127.0.0.1, or port 1,
 * where nothing listens. No real manifest or config is read.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { RECENT_RUNS, canExecute, usable } from './assurance.ts';
import { incidents } from './incident.ts';
import { planFor } from './planning.ts';
import { migrate } from './migrate.ts';
import { exportSync } from './sync.ts';
import { recheckCommand } from './vocabulary.ts';
import { makeGraph } from './testing/graph.ts';
import {
  LOCAL_ONLY,
  cli,
  cliAsync,
  dir,
  getDb,
  join,
  readFileSync,
  rows,
  seedWith,
  withEnv,
  writeFileSync,
} from './testing/cli.ts';

const MAPPING = JSON.stringify({
  config_keys: {
    mcp: {
      type: 'mcp',
      domain_field: 'type',
      domain_map: { remote: 'backend', local: 'infra' },
      desc_template: '{type} server',
    },
    agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
    provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' },
    command: { type: 'tool', domain: 'devops', desc_field: 'description' },
  },
  skill_dirs: [],
});

/**
 * A status endpoint whose behaviour the test sets: a status code, or no
 * answer at all, which drops the connection the way a host that went away
 * does.
 */
interface Endpoint {
  url: string;
  status: number;
  answering: boolean;
  close: () => Promise<void>;
}

const open: Server[] = [];

async function endpoint(): Promise<Endpoint> {
  const state = { status: 200, answering: true };
  const server = createServer((req, res) => {
    if (!state.answering) {
      req.socket.destroy();
      return;
    }
    res.statusCode = state.status;
    res.end('{}');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  open.push(server);
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}/health`,
    close: () => new Promise<void>(done => server.close(() => done())),
  });
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(s => new Promise<void>(done => s.close(() => done()))));
  delete process.env.INFRA_MANIFEST;
});

/** Seeds this test's graph from LOCAL_ONLY and the given manifest, and returns the manifest's path. */
function seedManifest(manifest: unknown): string {
  const path = join(dir, 'infra.json');
  writeFileSync(path, JSON.stringify(manifest));
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify(LOCAL_ONLY));
  seedWith({
    OPENCODE_CONFIG: config,
    TOOLCHAIN_DB: join(dir, 'graph.db'),
    AMBIT_DB: join(dir, 'graph.db'),
    INFRA_MANIFEST: path,
    CONFIG_MAPPING: MAPPING,
  });
  return path;
}

const probeWith = (manifest: string) =>
  withEnv({ INFRA_MANIFEST: manifest }, () => cliAsync('incidents'));

/** One node's row, read fresh. */
function node(id: string) {
  const db = getDb(join(dir, 'graph.db'));
  try {
    return rows(db, `SELECT lifecycle, last_seen_at, tags FROM capabilities WHERE id = '${id}'`)[0];
  } finally {
    db.close();
  }
}

/** A node's check runs, newest first. */
function checkRuns(id: string): { session_id: string; action: string; notes: string | null }[] {
  const db = getDb(join(dir, 'graph.db'));
  try {
    return rows(
      db,
      `SELECT session_id, action, notes FROM session_learning
       WHERE capability_id = '${id}' AND action IN ('verified', 'failed') ORDER BY id DESC`
    );
  } finally {
    db.close();
  }
}

function setSeen(ids: string[], at: string) {
  const db = getDb(join(dir, 'graph.db'));
  for (const id of ids) {
    db.prepare('UPDATE capabilities SET last_seen_at = ? WHERE id = ?').run(at, id);
  }
  db.close();
}

const LONG_AGO = '2026-01-01 00:00:00';

test('an answered probe is a passing check, and the machine it reached is seen', async () => {
  const up = await endpoint();
  const manifest = seedManifest({
    devices: [
      { id: 'nuc', name: 'NUC', statusUrl: up.url },
      // No status URL of its own: it is seen through the service it runs.
      { id: 'gpu-box', name: 'GPU box' },
    ],
    services: [
      { key: 'ollama', label: 'Ollama', host: 'nuc', url: up.url },
      { key: 'vllm', label: 'vLLM', host: 'gpu-box', url: up.url },
    ],
  });

  const report = await probeWith(manifest);
  expect(report.probed).toBe(3);
  expect(report.online).toBe(3);
  expect(report.incidents).toEqual([]);

  for (const id of ['device:nuc', 'svc:ollama', 'svc:vllm']) {
    expect(checkRuns(id)).toEqual([{ session_id: 'verify', action: 'verified', notes: null }]);
    expect(node(id).lifecycle).toBe('verified');
    expect(node(id).last_seen_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  }
  // Seen, and never checked: nothing asked it directly.
  expect(node('device:gpu-box').last_seen_at).toBeTruthy();
  expect(checkRuns('device:gpu-box')).toEqual([]);

  const ollama = report.probes.find((p: any) => p.id === 'svc:ollama');
  expect(ollama).toMatchObject({
    name: 'Ollama',
    kind: 'service',
    answered: true,
    check: 'passed',
  });
  expect(ollama.last_seen).toBe(node('svc:ollama').last_seen_at);
});

test('a service that stops answering reads broken, leaves every decision, and keeps when it was last seen', async () => {
  const svc = await endpoint();
  const manifest = seedManifest({
    devices: [{ id: 'nuc', name: 'NUC' }],
    services: [{ key: 'ollama', label: 'Ollama', host: 'nuc', url: svc.url }],
  });
  await probeWith(manifest);
  setSeen(['svc:ollama', 'device:nuc'], LONG_AGO);

  svc.answering = false;
  const report = await probeWith(manifest);

  expect(checkRuns('svc:ollama')[0]).toEqual({
    session_id: 'verify',
    action: 'failed',
    notes: 'probe got no answer',
  });
  expect(node('svc:ollama').lifecycle).toBe('broken');
  // No answer, so neither the service nor its machine was seen.
  expect(node('svc:ollama').last_seen_at).toBe(LONG_AGO);
  expect(node('device:nuc').last_seen_at).toBe(LONG_AGO);

  expect(report.now_unavailable).toEqual([
    { id: 'svc:ollama', name: 'Ollama', lifecycle: 'broken' },
  ]);
  expect(report.incidents).toHaveLength(1);
  expect(report.incidents[0]).toMatchObject({ service: 'svc:ollama', status: 'down' });

  // Read with no special case: the gate refuses it, a plan will not stand on
  // it, and the report a person reads next names the command that re-probes.
  const db = getDb(join(dir, 'graph.db'));
  const asked = canExecute(db, { capability: 'svc:ollama', action: 'execute' });
  expect(asked.decision).toBe('DENY');
  expect(asked.refused).toBe('failing');
  expect(planFor(db, 'svc:ollama')).toMatchObject({ reachable: false, degraded: true });
  db.close();

  expect(cli('status').next.command).toBe('ambit incidents');
  const failing = cli('verify', '--failing');
  expect(failing.not_run).toEqual([
    { id: 'svc:ollama', name: 'Ollama', command: 'ambit incidents' },
  ]);
  expect(failing.note).toContain('ambit incidents probes again');
  expect(cli('verify', 'svc:ollama').error).toContain('ambit incidents');
});

test('the next answer takes it off broken, and answers in a row make it usable again', async () => {
  const svc = await endpoint();
  const manifest = seedManifest({
    services: [{ key: 'ollama', label: 'Ollama', url: svc.url }],
  });
  svc.answering = false;
  await probeWith(manifest);
  expect(node('svc:ollama').lifecycle).toBe('broken');
  setSeen(['svc:ollama'], LONG_AGO);

  svc.answering = true;
  await probeWith(manifest);
  expect(checkRuns('svc:ollama')[0].action).toBe('verified');
  expect(node('svc:ollama').lifecycle).not.toBe('broken');
  expect(node('svc:ollama').last_seen_at).not.toBe(LONG_AGO);

  // A pass after failures is worth what the derivation says it is; a run of
  // them is worth everything, under any reading of the one before.
  for (let i = 1; i < RECENT_RUNS; i++) await probeWith(manifest);
  const back = node('svc:ollama').lifecycle;
  expect(usable(back)).toBe(true);
  const db = getDb(join(dir, 'graph.db'));
  expect(canExecute(db, { capability: 'svc:ollama', action: 'execute' }).refused).not.toBe(
    'failing'
  );
  db.close();
});

test('an answer that is not a 2xx fails the check, and still counts as seen', async () => {
  const svc = await endpoint();
  svc.status = 503;
  const manifest = seedManifest({
    services: [{ key: 'ollama', label: 'Ollama', url: svc.url }],
  });

  const report = await probeWith(manifest);
  expect(checkRuns('svc:ollama')[0]).toMatchObject({
    action: 'failed',
    notes: 'probe answered 503',
  });
  expect(node('svc:ollama').lifecycle).toBe('broken');
  expect(node('svc:ollama').last_seen_at).toBeTruthy();
  expect(report.probes[0]).toMatchObject({ answered: true, check: 'failed' });
  expect(report.incidents).toHaveLength(1);
});

test('what rests on a service that stops answering asks a person, and is not itself taken away', async () => {
  // The tree's own pattern: a service named for a local runtime provides it.
  const db = makeGraph({
    capabilities: [
      { id: 'device:nuc', category: 'device', kind: 'resource', lifecycle: 'unknown' },
      { id: 'svc:ollama', category: 'service', kind: 'resource', lifecycle: 'unknown' },
      { id: 'combo:local-runtime', name: 'Local Runtime', kind: 'capability' },
    ],
    dependencies: [
      { from: 'device:nuc', to: 'svc:ollama', kind: 'runs_on' },
      { from: 'svc:ollama', to: 'combo:local-runtime', kind: 'provides' },
    ],
    authority: [{ capability: 'combo:local-runtime', action: 'execute', mode: 'autonomous' }],
  });
  const ask = () => canExecute(db, { capability: 'combo:local-runtime', action: 'execute' });
  expect(ask().decision).toBe('ALLOW');

  const path = join(dir, 'infra.json');
  writeFileSync(
    path,
    JSON.stringify({
      devices: [{ id: 'nuc', name: 'NUC' }],
      services: [{ key: 'ollama', label: 'Ollama', host: 'nuc', url: 'http://127.0.0.1:1/' }],
    })
  );
  process.env.INFRA_MANIFEST = path;
  const report: any = await incidents(db);

  // The service is out; what it provides is still reached and still usable,
  // and a grant that would run it unattended asks until the probe passes.
  const runtime = db
    .prepare("SELECT state, lifecycle FROM capabilities WHERE id = 'combo:local-runtime'")
    .get<{ state: string; lifecycle: string }>();
  expect(runtime?.state).toBe('unlocked');
  expect(usable(runtime?.lifecycle)).toBe(true);
  const decided = ask();
  expect(decided.decision).toBe('CONFIRM');
  expect((decided.narrowed_by as { id: string }[]).map(f => f.id)).toEqual(['svc:ollama']);
  expect(report.narrowed).toEqual([
    expect.objectContaining({
      capability: 'Local Runtime',
      declared: 'autonomous',
      now: 'confirm',
      because: 'ollama is broken',
    }),
  ]);
  // The machine was not asked, so nothing about it moved.
  const nuc = db
    .prepare("SELECT lifecycle, last_seen_at FROM capabilities WHERE id = 'device:nuc'")
    .get<{ lifecycle: string; last_seen_at: string | null }>();
  expect(nuc).toEqual({ lifecycle: 'unknown', last_seen_at: null });
  db.close();
});

test('a probe of something the graph has not seeded is reported and records nothing', async () => {
  const db = makeGraph({});
  const up = await endpoint();
  const path = join(dir, 'infra.json');
  writeFileSync(path, JSON.stringify({ services: [{ key: 'new', url: up.url }] }));
  process.env.INFRA_MANIFEST = path;

  const report: any = await incidents(db);
  expect(report.not_in_graph).toEqual(['svc:new']);
  expect(report.note).toContain('ambit seed');
  expect(report.probes[0]).toMatchObject({ id: 'svc:new', answered: true, check: 'passed' });
  expect(report.probes[0].last_seen).toBeUndefined();
  expect(db.prepare('SELECT COUNT(*) AS n FROM session_learning').get<{ n: number }>()?.n).toBe(0);
  db.close();
});

test("a manifest entry's tags are seeded with it, and leave with it", () => {
  seedManifest({
    devices: [{ id: 'nuc', name: 'NUC', tags: ['gpu', ' always-on ', 'gpu', '', 7] }],
    services: [
      { key: 'ollama', label: 'Ollama', tags: 'inference' },
      { key: 'web', label: 'Web', tags: ['public'] },
    ],
  });
  expect(JSON.parse(node('device:nuc').tags)).toEqual(['gpu', 'always-on']);
  // A value that is not a list states no tags; it is not guessed into one.
  expect(node('svc:ollama').tags).toBeNull();
  expect(JSON.parse(node('svc:web').tags)).toEqual(['public']);

  seedManifest({
    devices: [{ id: 'nuc', name: 'NUC' }],
    services: [{ key: 'web', label: 'Web' }],
  });
  expect(node('device:nuc').tags).toBeNull();
  expect(node('svc:web').tags).toBeNull();
});

test('an older graph gains the two columns and keeps every row', () => {
  seedManifest({ devices: [{ id: 'nuc', name: 'NUC', tags: ['gpu'] }] });
  const db = getDb(join(dir, 'graph.db'));
  const before = rows(db, 'SELECT COUNT(*) n FROM capabilities')[0].n;
  db.prepare('ALTER TABLE capabilities DROP COLUMN last_seen_at').run();
  db.prepare('ALTER TABLE capabilities DROP COLUMN tags').run();

  migrate(db as unknown as Parameters<typeof migrate>[0]);

  const columns = rows(db, 'PRAGMA table_info(capabilities)').map((c: any) => c.name);
  expect(columns).toEqual(expect.arrayContaining(['last_seen_at', 'tags']));
  expect(rows(db, 'SELECT COUNT(*) n FROM capabilities')[0].n).toBe(before);
  expect(
    rows(db, "SELECT last_seen_at, tags FROM capabilities WHERE id = 'device:nuc'")[0]
  ).toEqual({ last_seen_at: null, tags: null });
  db.close();
});

test('when a machine was seen stays on the machine that saw it; the check runs travel', async () => {
  const up = await endpoint();
  const manifest = seedManifest({
    devices: [{ id: 'nuc', name: 'NUC', statusUrl: up.url, tags: ['gpu'] }],
  });
  await probeWith(manifest);
  expect(node('device:nuc').last_seen_at).toBeTruthy();

  const file = join(dir, 'sync.json');
  const db = getDb(join(dir, 'graph.db'));
  const wrote = exportSync(db, file);
  db.close();
  expect(wrote.excluded).toContain('when each device and service was last seen');

  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const nuc = payload.tables.capabilities.find((c: any) => c.id === 'device:nuc');
  expect(nuc).toBeDefined();
  expect(nuc).not.toHaveProperty('last_seen_at');
  expect(nuc).not.toHaveProperty('tags');
  expect(
    payload.tables.session_learning.filter(
      (r: any) => r.capability_id === 'device:nuc' && r.action === 'verified'
    )
  ).toHaveLength(1);
});

test('the command that re-runs a check names the probe for what the manifest names', () => {
  expect(recheckCommand('svc:ollama')).toBe('ambit incidents');
  expect(recheckCommand('device:nuc')).toBe('ambit incidents');
  expect(recheckCommand('combo:version-control')).toBe('ambit verify version-control');
  expect(recheckCommand('skill:x$(rm -rf ~)')).toBe("ambit verify 'skill:x$(rm -rf ~)'");
});
