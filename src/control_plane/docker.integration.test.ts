/**
 * The Docker adapter against a real daemon: an approved step through the
 * whole gate, run in a container, with its output read back and the container
 * confirmed gone.
 *
 * It runs only where `docker info` answers, and is skipped with the reason
 * everywhere else. CI's ubuntu job has a daemon and sets
 * AMBIT_REQUIRE_DOCKER=1, which turns a missing daemon there into a failure,
 * so the job cannot pass by skipping the one test that touches Docker.
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, type Db } from '../engine/db.ts';
import { approveProposal } from '../engine/governance.ts';
import {
  createInitialSimulatedEnvironment,
  executeThroughControlPlane,
  setupControlPlaneGraph,
  type AgentExecutionRequest,
} from './proxy.ts';
import { DEFAULT_DOCKER_IMAGE, dockerAdapter, type DockerEnvironment } from './docker.ts';

process.env.AMBIT_APPROVAL_KEY = 'test-secret-hmac-key-for-ambit-safety-control-plane-32chars';

const docker = (args: string[], timeout = 30_000) =>
  spawnSync('docker', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });

const info = docker(['info', '--format', '{{.ServerVersion}}'], 20_000);
const daemonUp = info.status === 0;
const SKIP_REASON = `no Docker daemon answered here (docker info: ${
  (info.stderr || info.error?.message || '').trim().split('\n')[0] || 'no output'
}); this test runs where one does, as in CI's ubuntu job`;

/** Skip with the reason, or fail when this run said Docker must be here. */
function needDocker(skip: (condition: boolean, note?: string) => void) {
  if (daemonUp) return;
  if (process.env.AMBIT_REQUIRE_DOCKER === '1')
    throw new Error(`AMBIT_REQUIRE_DOCKER=1, but ${SKIP_REASON}`);
  skip(true, SKIP_REASON);
}

let dir: string;
let envDir: string;
let db: Db;

beforeAll(() => {
  if (!daemonUp) return;
  // The adapter never pulls. The test fetches its image the way a person
  // would, by typing it, before anything asks the adapter to run.
  let pulled = docker(['pull', '--quiet', DEFAULT_DOCKER_IMAGE], 180_000);
  if (pulled.status !== 0) {
    // Retry once in case of a transient registry timeout
    pulled = docker(['pull', '--quiet', DEFAULT_DOCKER_IMAGE], 180_000);
  }
  if (pulled.status !== 0) throw new Error(`docker pull ${DEFAULT_DOCKER_IMAGE}: ${pulled.stderr}`);
  dir = mkdtempSync(join(tmpdir(), 'ambit-docker-live-'));
  envDir = join(dir, 'env');
  db = getDb(join(dir, 'graph.db'));
  setupControlPlaneGraph(db);
  createInitialSimulatedEnvironment(envDir);
}, 200_000);

afterAll(() => {
  if (!daemonUp) return;
  (db as Db | undefined)?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Rule 7's example: a command once a shell reads it, text once one does not. */
const HOSTILE = 'skill:x$(rm -rf ~)';

test('an approved step runs in a container, prints its output, and leaves no container', ctx => {
  needDocker(ctx.skip);

  const adapter = dockerAdapter(envDir);
  const deploy: AgentExecutionRequest = {
    agent_id: 'agent:deployer',
    intent: 'Deploy release v2.0.0 to production',
    tool: 'deploy_to_production',
    capability_id: 'combo:deploy-to-production',
    action: 'execute',
    target: 'env:production',
    payload: { target_version: 'v2.0.0', command: ['echo', HOSTILE] },
    hmac_approval_token: null,
  };

  const blocked = executeThroughControlPlane(db, envDir, deploy, adapter);
  expect(blocked.status_code).toBe('AMBIT_BLOCKED_UNAUTHORIZED');
  expect(blocked.state_unchanged).toBe(true);

  db.prepare("UPDATE capabilities SET lifecycle = 'verified' WHERE id = ?").run(
    'combo:staging-healthcheck'
  );
  approveProposal(db, blocked.remediation_proposal_id!, 'human:security-lead');

  const result = executeThroughControlPlane(
    db,
    envDir,
    { ...deploy, hmac_approval_token: blocked.remediation_proposal_id },
    adapter
  );

  expect(result.status_code).toBe('AMBIT_EXECUTION_AUTHORIZED');
  expect(result.trace.attributes['ambit.adapter']).toBe('docker');
  const run = (result.post_state as DockerEnvironment).last_run!;
  expect(run.exit_code).toBe(0);
  expect(run.stdout).toBe(`${HOSTILE}\n`);
  expect(run.network).toBe('none');
  expect(run.removed).toBe(true);

  // Docker itself, asked directly: no container by that name, or with the
  // adapter's label, is left.
  const left = docker(['ps', '--all', '--quiet', '--filter', `name=${run.container}`]);
  expect(left.status).toBe(0);
  expect(left.stdout.trim()).toBe('');
  expect((result.post_state as DockerEnvironment).active_containers).toEqual([]);
}, 120_000);

/** What one command prints inside a step's container, run by the adapter. */
function inStep(command: string[], workdir?: string): string {
  const state = dockerAdapter(envDir, { workdir }).apply(
    {},
    { capability_id: 'combo:deploy-to-production', tool: 'probe', command, network: false }
  );
  return state.last_run!.stdout;
}

/** The options /proc/mounts lists for one mount point. */
const mountOptions = (mounts: string, at: string) =>
  mounts
    .split('\n')
    .map(line => line.split(' '))
    .find(fields => fields[1] === at)?.[3]
    ?.split(',') ?? [];

test('a step has no network, a read-only root, no capabilities and no way to gain them', ctx => {
  needDocker(ctx.skip);
  // Only loopback, which is --network=none, shown without reaching for anything.
  expect(inStep(['ls', '/sys/class/net'])).toBe('lo\n');
  expect(inStep(['id', '-u'])).toBe('65534\n');

  // Read from the kernel: an unprivileged user cannot write to / even on a
  // writable root, so a failed write would prove nothing.
  const mounts = inStep(['cat', '/proc/mounts']);
  expect(mountOptions(mounts, '/')).toContain('ro');
  expect(mountOptions(mounts, '/tmp')).toEqual(expect.arrayContaining(['rw', 'noexec', 'nosuid']));

  const status = inStep(['cat', '/proc/self/status']);
  expect(status).toMatch(/^CapEff:\s+0+$/m);
  expect(status).toMatch(/^NoNewPrivs:\s+1$/m);
}, 120_000);

test('a working directory is readable at /work and mounted read-only', ctx => {
  needDocker(ctx.skip);
  const work = mkdtempSync(join(tmpdir(), 'ambit-docker-work-'));
  try {
    writeFileSync(join(work, 'hello.txt'), 'from the host\n');
    // The step runs as an unprivileged user, which must be able to read it.
    chmodSync(work, 0o755);
    chmodSync(join(work, 'hello.txt'), 0o644);
    expect(inStep(['cat', 'hello.txt'], work)).toBe('from the host\n');
    expect(mountOptions(inStep(['cat', '/proc/mounts'], work), '/work')).toContain('ro');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);

test('a step that fails is reported with its exit code, and its container is gone too', ctx => {
  needDocker(ctx.skip);
  const adapter = dockerAdapter(envDir);
  expect(() =>
    adapter.apply(
      {},
      {
        capability_id: 'combo:x',
        tool: 't',
        command: ['sh', '-c', 'echo no >&2; exit 3'],
        network: false,
      }
    )
  ).toThrow('the step exited 3: no');
  const state = adapter.read();
  expect(state.last_run?.exit_code).toBe(3);
  expect(state.last_run?.removed).toBe(true);
  expect(state.active_containers).toEqual([]);
}, 120_000);
