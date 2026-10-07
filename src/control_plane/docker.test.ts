/**
 * The Docker adapter without a Docker daemon: a fake runner stands in for the
 * docker CLI and records every argument vector it is handed, so these tests
 * read exactly what would have been run. The run against a real daemon is in
 * docker.integration.test.ts.
 */
import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, type Db } from '../engine/db.ts';
import { approveProposal } from '../engine/governance.ts';
import {
  computeStateHash,
  createInitialSimulatedEnvironment,
  executeThroughControlPlane,
  setupControlPlaneGraph,
  simulatedAdapter,
  type AgentExecutionRequest,
} from './proxy.ts';
import {
  AdapterRefusal,
  checkWorkdir,
  commandProblem,
  DEFAULT_DOCKER_IMAGE,
  dockerAdapter,
  dockerRunArgv,
  imageProblem,
  MAX_OUTPUT,
  selectAdapter,
  type DockerEnvironment,
  type DockerResult,
  type DockerRunner,
} from './docker.ts';

process.env.AMBIT_APPROVAL_KEY = 'test-secret-hmac-key-for-ambit-safety-control-plane-32chars';

/** Rule 7's example: an id that is a command once a shell reads it. */
const HOSTILE = 'skill:x$(rm -rf ~)';

const ok = (stdout = ''): DockerResult => ({ status: 0, stdout, stderr: '' });

/**
 * A docker CLI that answers from memory. `step` decides what `docker run`
 * returns; `after` what `docker ps` says is left once the step is over.
 */
function fakeDocker(
  over: { version?: DockerResult; image?: DockerResult; step?: DockerResult; after?: string } = {}
) {
  const calls: string[][] = [];
  let stepDone = false;
  const run: DockerRunner = args => {
    calls.push(args);
    switch (args[0]) {
      case 'version':
        return over.version ?? ok('29.0.0\n');
      case 'image':
        return over.image ?? ok('sha256:feedface\n');
      case 'run':
        stepDone = true;
        return over.step ?? ok('hello\n');
      case 'rm':
        return ok();
      case 'ps':
        return ok(stepDone && args.includes('--quiet') ? (over.after ?? '') : '');
      default:
        return { status: 1, stdout: '', stderr: `unexpected docker ${args[0]}` };
    }
  };
  /** Every call that could start, change or remove a container. */
  const acted = () => calls.filter(c => ['run', 'create', 'start', 'exec', 'rm'].includes(c[0]));
  const runs = () => calls.filter(c => c[0] === 'run');
  return { run, calls, acted, runs };
}

// ── Arguments ────────────────────────────────────────────────────────────────

const STEP = {
  name: 'ambit-step-0123456789ab',
  image: DEFAULT_DOCKER_IMAGE,
  command: ['echo', HOSTILE],
  network: 'none' as const,
  workdir: null,
};

/** Flags and paths that would hand a container the host. */
const FORBIDDEN = [
  /^-v$/,
  /^--volume/,
  /^--privileged/,
  /^--device/,
  /^--use-api-socket/,
  /^--cap-add/,
  /^--(pid|ipc|uts|userns|cgroupns)=host/,
  /^--network=(host|container:)/,
  /^-e$/,
  /^--env/,
  /docker\.sock/,
  /\.ssh|\.aws|\.config/,
];

test('docker run is an argument array with the isolation defaults and the command last', () => {
  const argv = dockerRunArgv(STEP);
  const image = argv.indexOf(DEFAULT_DOCKER_IMAGE);

  expect(argv[0]).toBe('run');
  for (const flag of [
    '--rm',
    '--pull=never',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=65534:65534',
    '--memory=512m',
    '--cpus=1',
    '--pids-limit=256',
    '--entrypoint=',
  ])
    expect(argv.slice(0, image)).toContain(flag);

  // The untrusted value is one element, verbatim, after the image: docker
  // hands it to the program and never reads it as an option or a line.
  expect(argv.slice(image + 1)).toEqual(['echo', HOSTILE]);
  expect(argv.filter(a => a.includes('$('))).toEqual([HOSTILE]);
  expect(argv.slice(0, image).some(a => a.includes(HOSTILE))).toBe(false);
});

test('a command that looks like a docker flag stays an argument to the program', () => {
  const argv = dockerRunArgv({ ...STEP, command: ['--privileged', '-v', '/:/host'] });
  const image = argv.indexOf(DEFAULT_DOCKER_IMAGE);
  expect(argv.slice(image + 1)).toEqual(['--privileged', '-v', '/:/host']);
  expect(argv.slice(0, image).some(a => FORBIDDEN.some(re => re.test(a)))).toBe(false);
});

test('nothing from the host is mounted unless a working directory is named, and then read-only', () => {
  const bare = dockerRunArgv(STEP);
  expect(bare.some(a => a.startsWith('--mount'))).toBe(false);
  for (const a of bare) for (const re of FORBIDDEN) expect(a.slice(0, 40)).not.toMatch(re);

  const mounted = dockerRunArgv({ ...STEP, workdir: '/srv/project' });
  const mounts = mounted.filter(a => a.startsWith('--mount'));
  expect(mounts).toEqual(['--mount=type=bind,source=/srv/project,target=/work,readonly']);
  expect(mounted).toContain('--workdir=/work');
});

test('the argument builder refuses a name, image or network it did not expect', () => {
  expect(() => dockerRunArgv({ ...STEP, name: 'mine' })).toThrow(/generated/);
  expect(() => dockerRunArgv({ ...STEP, image: '--privileged' })).toThrow(/image reference/);
  expect(() => dockerRunArgv({ ...STEP, network: 'host' as never })).toThrow(/loopback/);
  expect(() => dockerRunArgv({ ...STEP, command: [] })).toThrow(/payload.command/);
});

test('an image reference cannot be a flag or carry a shell', () => {
  for (const good of [
    'alpine:3.20',
    'ghcr.io/org/tool:1.2.3',
    'localhost:5000/team/app',
    `alpine@sha256:${'a'.repeat(64)}`,
  ])
    expect(imageProblem(good)).toBeNull();
  for (const bad of ['', '-v', '--privileged', 'alpine;rm -rf /', 'Alpine', 'a b', 'x:$(id)'])
    expect(imageProblem(bad)).not.toBeNull();
});

test('a command is a non-empty vector of strings, and nothing else', () => {
  expect(commandProblem(['echo', HOSTILE])).toBeNull();
  expect(commandProblem(undefined)).toMatch(/carries none/);
  expect(commandProblem('echo hi')).toMatch(/carries none/);
  expect(commandProblem([])).toMatch(/carries none/);
  expect(commandProblem(['echo', 1])).toMatch(/string/);
  expect(commandProblem([''])).toMatch(/names the program/);
  expect(commandProblem(['echo', 'a\0b'])).toMatch(/NUL/);
  expect(commandProblem(Array(300).fill('x'))).toMatch(/more than/);
});

// ── The working directory ────────────────────────────────────────────────────

describe('a working directory', () => {
  let root: string;
  let home: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ambit-workdir-'));
    home = join(root, 'home');
    for (const d of ['project', '.ssh', '.aws/sso', '.config/opencode'])
      mkdirSync(join(home, d), { recursive: true });
    mkdirSync(join(root, 'run'), { recursive: true });
    mkdirSync(join(root, 'a,target=etc'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const refused = (p: string) => {
    const r = checkWorkdir(p, home, [join(root, 'run', 'docker.sock')]);
    return 'problem' in r ? r.problem : null;
  };

  test('a project under home is mounted, by its real path', () => {
    const r = checkWorkdir(join(home, 'project'), home, []);
    expect('path' in r && r.path.endsWith(join('home', 'project'))).toBe(true);
  });

  test('home, anything above it, and its dot-directories are refused', () => {
    expect(refused(home)).toMatch(/home directory/);
    expect(refused(root)).toMatch(/home directory/);
    expect(refused('/')).toMatch(/home directory/);
    expect(refused(join(home, '.ssh'))).toMatch(/dot-directory/);
    expect(refused(join(home, '.aws', 'sso'))).toMatch(/dot-directory/);
    expect(refused(join(home, '.config', 'opencode'))).toMatch(/dot-directory/);
  });

  test('a directory holding the Docker socket is refused', () => {
    expect(refused(join(root, 'run'))).toMatch(/Docker socket/);
  });

  test('a path the mount syntax could misread, or one that is not there, is refused', () => {
    expect(refused(join(root, 'a,target=etc'))).toMatch(/misread/);
    expect(refused(join(root, 'missing'))).toMatch(/not a directory/);
  });
});

// ── Refusal before anything runs ─────────────────────────────────────────────

describe('choosing Docker when it cannot run a step', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ambit-docker-refuse-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('no docker command is a refusal, never the simulator', () => {
    const docker = fakeDocker({
      version: { status: null, stdout: '', stderr: '', missing: true, error: 'ENOENT' },
    });
    expect(() => dockerAdapter(dir, { run: docker.run })).toThrow(AdapterRefusal);
    expect(() => dockerAdapter(dir, { run: docker.run })).toThrow(/not installed.*Nothing ran/s);
    expect(docker.acted()).toEqual([]);
  });

  test('a daemon that does not answer is a refusal that says so', () => {
    const docker = fakeDocker({
      version: { status: 1, stdout: '', stderr: 'failed to connect to the docker API\n' },
    });
    expect(() => selectAdapter(dir, { adapter: 'docker', run: docker.run, env: {} })).toThrow(
      /did not answer \(failed to connect.*simulated environment was not used/s
    );
    expect(docker.acted()).toEqual([]);
  });

  test('an image that is not on the machine is refused, not pulled', () => {
    const docker = fakeDocker({ image: { status: 1, stdout: '', stderr: 'No such image' } });
    expect(() => dockerAdapter(dir, { run: docker.run })).toThrow(/docker pull alpine:3.20/);
    expect(docker.calls.some(c => c[0] === 'pull')).toBe(false);
  });

  test('host networking, an unknown adapter and a home mount are refused by name', () => {
    const docker = fakeDocker();
    expect(() =>
      selectAdapter(dir, {
        env: { AMBIT_ADAPTER: 'docker', AMBIT_DOCKER_NETWORK: 'host' },
        run: docker.run,
      })
    ).toThrow(/loopback/);
    expect(() => selectAdapter(dir, { adapter: 'kubernetes', env: {} })).toThrow(
      /not an adapter.*simulated \(the default\), docker/
    );
    expect(() => dockerAdapter(dir, { run: docker.run, workdir: dir, home: dir })).toThrow(
      /home directory/
    );
    expect(docker.acted()).toEqual([]);
  });

  test('the simulator is the default, and the flag outranks the environment', () => {
    expect(selectAdapter(dir, { env: {} }).name).toBe('simulated');
    expect(selectAdapter(dir, { env: { AMBIT_ADAPTER: '' } }).name).toBe('simulated');
    expect(
      selectAdapter(dir, { adapter: 'simulated', env: { AMBIT_ADAPTER: 'docker' } }).name
    ).toBe('simulated');
    const docker = fakeDocker();
    expect(selectAdapter(dir, { env: { AMBIT_ADAPTER: 'Docker' }, run: docker.run }).name).toBe(
      'docker'
    );
  });
});

// ── Through the gate ─────────────────────────────────────────────────────────

describe('the Docker adapter behind the gate', () => {
  let dir: string;
  let envDir: string;
  let db: Db;

  const DEPLOY: AgentExecutionRequest = {
    agent_id: 'agent:deployer',
    intent: 'Deploy release v2.0.0 to production',
    tool: 'deploy_to_production',
    capability_id: 'combo:deploy-to-production',
    action: 'execute',
    target: 'env:production',
    payload: { target_version: 'v2.0.0', command: ['echo', HOSTILE] },
    hmac_approval_token: null,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ambit-docker-gate-'));
    envDir = join(dir, 'env');
    db = getDb(join(dir, 'graph.db'));
    setupControlPlaneGraph(db);
    createInitialSimulatedEnvironment(envDir);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const verifyStaging = () =>
    db
      .prepare("UPDATE capabilities SET lifecycle = 'verified' WHERE id = ?")
      .run('combo:staging-healthcheck');

  /** Block once, verify staging and approve: the token the gate will accept. */
  function approved(adapter = dockerAdapter(envDir, { run: fakeDocker().run })) {
    const blocked = executeThroughControlPlane(db, envDir, DEPLOY, adapter);
    verifyStaging();
    approveProposal(db, blocked.remediation_proposal_id!, 'human:security-lead');
    return blocked.remediation_proposal_id!;
  }

  const outcomeOf = (runId: string) =>
    db.prepare('SELECT outcome FROM work_runs WHERE id = ?').get<{ outcome: string }>(runId)
      ?.outcome;

  test('no refused or unapproved step reaches the adapter', () => {
    const docker = fakeDocker();
    const adapter = dockerAdapter(envDir, { run: docker.run });
    const attempts: AgentExecutionRequest[] = [
      DEPLOY,
      { ...DEPLOY, hmac_approval_token: 'prop-forged-123' },
      { ...DEPLOY, break_glass: true, break_glass_reason: '  ' },
      { ...DEPLOY, simulate: true },
    ];
    for (const attempt of attempts) {
      const result = executeThroughControlPlane(db, envDir, attempt, adapter);
      expect(['AMBIT_BLOCKED_UNAUTHORIZED', 'SIMULATED']).toContain(result.status_code);
      expect(result.trace.attributes['ambit.adapter']).toBe('docker');
      expect(result.state_unchanged).toBe(true);
    }

    // Approved, and then the prerequisite fails again.
    const token = approved(adapter);
    db.prepare("UPDATE capabilities SET lifecycle = 'broken' WHERE id = ?").run(
      'combo:staging-healthcheck'
    );
    const regressed = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token },
      adapter
    );
    expect(regressed.intercept_reason).toContain('Unmet hard prerequisite');

    // Approved, and then the expiry passes.
    verifyStaging();
    db.prepare("UPDATE proposals SET expires_at = '2020-01-01 00:00:00' WHERE id = ?").run(token);
    const expired = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token },
      adapter
    );
    expect(expired.intercept_reason).toContain('expired');

    // A signed approval for a different proposal.
    db.prepare(
      'INSERT INTO proposals (id, goal, status, steps, simulated, created_at)' +
        " VALUES ('prop-lint', 'Install a linter', 'draft', ?, '{}', datetime('now'))"
    ).run(JSON.stringify([{ id: 'combo:lint', name: 'Lint', inverse: { remove: [] } }]));
    approveProposal(db, 'prop-lint', 'human:security-lead');
    const unrelated = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: 'prop-lint' },
      adapter
    );
    expect(unrelated.intercept_reason).toContain('does not cover');

    // A forbidden grant: canExecute answers DENY.
    db.prepare(
      "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES ('combo:deploy-to-production', 'execute', 'forbidden', '', '', 'test')"
    ).run();
    const denied = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token },
      adapter
    );
    expect(denied.intercept_reason).toContain('Authority denied');

    // Docker was asked what exists, and never asked to run anything.
    expect(docker.acted()).toEqual([]);
    expect(docker.calls.length).toBeGreaterThan(0);
  });

  test('an approved step runs once, with the request command verbatim and no network', () => {
    const docker = fakeDocker({ step: ok(`${HOSTILE}\n`) });
    const adapter = dockerAdapter(envDir, { run: docker.run });
    const token = approved(adapter);
    const result = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token },
      adapter
    );

    expect(result.status_code).toBe('AMBIT_EXECUTION_AUTHORIZED');
    expect(result.trace.attributes['ambit.adapter']).toBe('docker');
    expect(result.trace.events.find(e => e.name === 'adapter_apply')?.attributes).toEqual({
      adapter: 'docker',
      network_granted: false,
    });
    expect(docker.runs()).toHaveLength(1);
    const argv = docker.runs()[0];
    expect(argv.slice(-2)).toEqual(['echo', HOSTILE]);
    expect(argv).toContain('--network=none');

    const post = result.post_state as DockerEnvironment;
    expect(post.adapter).toBe('docker');
    expect(post.production_version).toBe('v2.0.0');
    expect(post.last_run?.stdout).toBe(`${HOSTILE}\n`);
    expect(post.last_run?.removed).toBe(true);
    expect(post.active_containers).toEqual([]);
    // The container that ran is removed by name whatever --rm did.
    expect(docker.calls).toContainEqual(['rm', '--force', post.last_run!.container]);
  });

  test('a step gets a network only with a network grant and the person’s bridge', () => {
    const grant = (mode: string) => {
      db.prepare("DELETE FROM authority WHERE action = 'network'").run();
      db.prepare(
        "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES ('combo:deploy-to-production', 'network', ?, '', 'env:production', 'test')"
      ).run(mode);
    };
    const networkOf = (network: string) => {
      const docker = fakeDocker();
      const adapter = dockerAdapter(envDir, { run: docker.run, network });
      const token = approved(adapter);
      executeThroughControlPlane(db, envDir, { ...DEPLOY, hmac_approval_token: token }, adapter);
      return docker.runs()[0].find(a => a.startsWith('--network='));
    };

    expect(networkOf('bridge')).toBe('--network=none'); // no grant
    grant('confirm');
    expect(networkOf('bridge')).toBe('--network=none'); // a grant that asks is not an ALLOW
    grant('autonomous');
    expect(networkOf('none')).toBe('--network=none'); // granted, but the person gave none
    expect(networkOf('bridge')).toBe('--network=bridge');
  });

  test('break-glass runs nothing in a container: the agent cannot authorise its own command', () => {
    const docker = fakeDocker();
    const adapter = dockerAdapter(envDir, { run: docker.run, network: 'bridge' });
    verifyStaging();
    const result = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, break_glass: true, break_glass_reason: 'Sev-1' },
      adapter
    );
    expect(result.status_code).toBe('AMBIT_BLOCKED_UNAUTHORIZED');
    expect(result.intercept_reason).toMatch(/Break-glass is refused with the docker adapter/);
    expect(docker.runs()).toEqual([]);
  });

  test('an approval runs the command the person was shown, and no other', () => {
    const docker = fakeDocker();
    const adapter = dockerAdapter(envDir, { run: docker.run });
    const token = approved(adapter);
    const steps = JSON.parse(
      db.prepare('SELECT steps FROM proposals WHERE id = ?').get<{ steps: string }>(token)!.steps
    );
    expect(steps.find((s: { id: string }) => s.id === DEPLOY.capability_id).command).toEqual([
      'echo',
      HOSTILE,
    ]);

    const swapped = executeThroughControlPlane(
      db,
      envDir,
      {
        ...DEPLOY,
        hmac_approval_token: token,
        payload: { ...DEPLOY.payload, command: ['sh', '-c', 'cat /etc/passwd'] },
      },
      adapter
    );
    expect(swapped.status_code).toBe('AMBIT_BLOCKED_UNAUTHORIZED');
    expect(swapped.intercept_reason).toMatch(/was for a different command/);
    expect(docker.runs()).toEqual([]);

    const shown = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token },
      adapter
    );
    expect(shown.ok).toBe(true);
    expect(docker.runs()).toHaveLength(1);
  });

  test('a step that fails ends the run failed and leaves the deploy unrecorded', () => {
    const docker = fakeDocker({ step: { status: 3, stdout: '', stderr: 'boom\n' } });
    const adapter = dockerAdapter(envDir, { run: docker.run });
    const token = approved(adapter);
    const runId = 'run-docker-fails';
    const result = executeThroughControlPlane(
      db,
      envDir,
      { ...DEPLOY, hmac_approval_token: token, run_id: runId },
      adapter
    );

    expect(result.ok).toBe(false);
    expect(result.status_code).toBe('AMBIT_EXECUTION_FAILED');
    expect(result.exit_code).toBe(1);
    expect(result.execution_error).toBe('the step exited 3: boom');
    expect(result.trace.status.code).toBe('ERROR');
    expect(result.trace.attributes['ambit.adapter']).toBe('docker');
    expect(outcomeOf(runId)).toBe('failed');

    const post = result.post_state as DockerEnvironment;
    expect(post.production_version).toBe('v1.4.2');
    expect(post.last_run?.exit_code).toBe(3);
    expect(result.state_unchanged).toBe(false);
    expect(docker.calls.some(c => c[0] === 'rm')).toBe(true);
  });

  test('a step past its time, or one whose container lingers, fails and is removed', () => {
    const slow = fakeDocker({ step: { status: null, stdout: '', stderr: '', timedOut: true } });
    const timed = dockerAdapter(envDir, { run: slow.run, timeoutSeconds: 5 });
    const step = { capability_id: 'combo:x', tool: 't', command: ['sleep', '60'], network: false };
    expect(() => timed.apply({}, step)).toThrow(/ran past 5s and was stopped/);
    expect(slow.calls.some(c => c[0] === 'rm')).toBe(true);

    const stuck = fakeDocker({ after: 'abc123\n' });
    expect(() => dockerAdapter(envDir, { run: stuck.run }).apply({}, step)).toThrow(
      /still there after the step/
    );
  });

  test('output is kept up to the cap and marked when cut', () => {
    const loud = fakeDocker({ step: ok('x'.repeat(MAX_OUTPUT * 3)) });
    const adapter = dockerAdapter(envDir, { run: loud.run });
    const state = adapter.apply(
      {},
      { capability_id: 'combo:x', tool: 't', command: ['yes'], network: false }
    );
    expect(state.last_run?.stdout).toHaveLength(MAX_OUTPUT);
    expect(state.last_run?.truncated).toBe(true);
  });

  test('a step with no command fails at the adapter and runs nothing', () => {
    const docker = fakeDocker();
    const adapter = dockerAdapter(envDir, { run: docker.run });
    expect(() => adapter.apply({}, { capability_id: 'c', tool: 't', network: false })).toThrow(
      /carries none/
    );
    expect(docker.runs()).toEqual([]);
  });

  test('the simulator names itself in the spans too', () => {
    const blocked = executeThroughControlPlane(db, envDir, DEPLOY, simulatedAdapter(envDir));
    expect(blocked.trace.attributes['ambit.adapter']).toBe('simulated');
    expect(blocked.trace.events[0].attributes.adapter).toBe('simulated');
    const dry = executeThroughControlPlane(db, envDir, { ...DEPLOY, simulate: true });
    expect(dry.trace.attributes['ambit.adapter']).toBe('simulated');
  });
});

// ── The state hash ───────────────────────────────────────────────────────────

test('the state hash covers nested records and leaves the flat one as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-hash-'));
  try {
    // The value INCIDENT_TRACE_001 and the demo print for the initial state.
    expect(createInitialSimulatedEnvironment(dir).immutable_hash).toBe(
      '1933c954ad54995866e28d081840751c3c0e027875bd7b1addb4c8d273052076'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const a = computeStateHash({ last_run: { exit_code: 0, stdout: 'a' } });
  const b = computeStateHash({ last_run: { exit_code: 0, stdout: 'b' } });
  expect(a).not.toBe(b);
  expect(computeStateHash({ x: { b: 1, a: 2 } })).toBe(computeStateHash({ x: { a: 2, b: 1 } }));
});

// ── The entry point ──────────────────────────────────────────────────────────

describe('the control plane entry point', () => {
  const CLI = join(import.meta.dirname, 'cli.ts');
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ambit-cp-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const cli = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', CLI, ...args],
      { encoding: 'utf8', env: { ...env, AMBIT_APPROVAL_KEY: 'k'.repeat(32) }, timeout: 30_000 }
    );

  test('docker with no docker command refuses before opening the graph', () => {
    const db = join(dir, 'graph.db');
    const request = JSON.stringify({
      agent_id: 'agent:x',
      intent: 'i',
      tool: 't',
      capability_id: 'c',
    });
    // No docker on this PATH, whether or not the machine has one.
    const out = cli(['exec', join(dir, 'env'), db, request], {
      PATH: join(dir, 'empty-bin'),
      HOME: dir,
      AMBIT_ADAPTER: 'docker',
    });
    expect(out.status).toBe(1);
    const answer = JSON.parse(out.stdout);
    expect(answer.error).toMatch(/not installed.*Nothing ran.*simulated environment was not used/s);
    expect(answer.adapter).toBe('docker');
    expect(existsSync(db)).toBe(false);
    expect(existsSync(join(dir, 'env'))).toBe(false);
  });

  test('an unknown adapter is refused, and setup-env names the one it used', () => {
    const refused = cli(
      ['setup-env', join(dir, 'env'), join(dir, 'g.db'), '--adapter=kubernetes'],
      {
        PATH: process.env.PATH,
        HOME: dir,
      }
    );
    expect(refused.status).toBe(1);
    expect(JSON.parse(refused.stdout).error).toMatch(/not an adapter/);

    const setup = cli(['setup-env', join(dir, 'env'), join(dir, 'g.db')], {
      PATH: process.env.PATH,
      HOME: dir,
    });
    expect(setup.status).toBe(0);
    expect(JSON.parse(setup.stdout).adapter).toBe('simulated');
    expect(
      JSON.parse(readFileSync(join(dir, 'env', 'environment_state.json'), 'utf8'))
        .production_version
    ).toBe('v1.4.2');
  });
});
