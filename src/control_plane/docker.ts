/**
 * An EnvironmentAdapter that runs an approved step in a throwaway Docker
 * container on this machine (roadmap §15).
 *
 * The gate above it is unchanged: prerequisites, lifecycle, `canExecute` and
 * the signed artifact decide whether a step runs, and this file only decides
 * where. It is never the default. A person chooses it at the control plane's
 * entry point (`AMBIT_ADAPTER=docker` or `--adapter=docker`), and when Docker
 * cannot run the step it refuses before anything happens, never handing the
 * step to the simulator in its place.
 *
 * How the three methods map:
 * - `read` is the control plane's record (what was authorized, by whom, when,
 *   and the last step's run) kept in the same state file the simulator uses,
 *   plus two facts asked of Docker: the image's id, and the containers this
 *   adapter labelled that still exist. Between steps that list is empty.
 * - `apply` runs one container per step from an image the person chose,
 *   never one the request names, with the step's command as its argument
 *   vector. The container is removed afterwards, and its output is kept,
 *   capped, in the record.
 * - `hashOf` hashes all of it, so a blocked call can prove that no container
 *   ran and the record did not move.
 *
 * Isolation by default: no network, no pull, a read-only root with a small
 * scratch `/tmp`, every capability dropped, no privilege escalation, an
 * unprivileged user, and limits on memory, CPU and processes. Nothing from the
 * host is mounted unless the person names a working directory, which is then
 * mounted read-only, and never the home directory, anything in one of its
 * dot-directories (keys, cloud credentials, the approval key) or a directory
 * holding the Docker socket. No environment variable reaches the container.
 *
 * Every value from a request is untrusted (rule 7): docker's argv is built as
 * an array and spawned with no shell, no request value reaches a docker
 * option, and the command sits after the image, where docker hands it to the
 * container as arguments and never reads it as flags.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  computeStateHash,
  readSimulatedEnvironment,
  simulatedAdapter,
  writeSimulatedEnvironment,
  type EnvironmentAdapter,
  type ExecutionStep,
  type SimulatedEnvironment,
} from './proxy.ts';

/** The adapters the entry point accepts; the first is the default. */
export const ADAPTERS = ['simulated', 'docker'] as const;

/**
 * The image a step runs in unless the person names another. A tag, so the
 * person can pull it by name; the adapter never pulls it for them.
 */
export const DEFAULT_DOCKER_IMAGE = 'alpine:3.20';

/** What a container is given. `bridge` only with a grant; `host` never. */
export type DockerNetwork = 'none' | 'bridge';

/** Every container this adapter starts carries this label. */
export const STEP_LABEL = 'ambit.control-plane';

/** Where a named working directory appears inside the container. */
export const WORK_MOUNT = '/work';

/** The limits every step runs under. */
export const STEP_LIMITS = { memory: '512m', cpus: '1', pids: 256, tmpfs: '64m' } as const;

/** Characters of each stream kept in the record. */
export const MAX_OUTPUT = 8 * 1024;

/** What docker may print before the step is cut off as runaway. */
const MAX_BUFFER = 1024 * 1024;

const DEFAULT_TIMEOUT_SECONDS = 120;
const QUERY_TIMEOUT_MS = 15_000;
const MAX_ARGS = 256;
const MAX_ARGV_CHARS = 32 * 1024;
const UNPRIVILEGED = '65534:65534';

/** One docker invocation's result, whatever ran it. */
export interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  /** The docker command itself is not installed. */
  missing?: boolean;
  timedOut?: boolean;
  /** Docker printed more than the buffer holds, and was stopped. */
  overflow?: boolean;
}

/** Runs `docker <args>`. Tests pass a fake; nothing else needs to. */
export type DockerRunner = (args: string[], timeoutMs: number) => DockerResult;

/** One step as it ran, kept in the record so `read` can say what happened. */
export interface DockerStepRun {
  container: string;
  image: string;
  command: string[];
  network: DockerNetwork;
  /** The host directory mounted read-only at /work, or null for none. */
  workdir: string | null;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  started_at: string;
  seconds: number;
  /** Docker no longer lists the container. */
  removed: boolean;
}

/** The record the simulator keeps, and what Docker says alongside it. */
export interface DockerEnvironment extends SimulatedEnvironment {
  adapter: 'docker';
  image: string;
  image_id: string | null;
  last_run: DockerStepRun | null;
}

type DockerRecord = SimulatedEnvironment & { last_run?: DockerStepRun | null };

export interface DockerOptions {
  /** Defaults to DEFAULT_DOCKER_IMAGE. */
  image?: string;
  /** What a step with a network grant is given. Defaults to `none`. */
  network?: string;
  /** A host directory to mount read-only at /work. None by default. */
  workdir?: string;
  timeoutSeconds?: number;
  run?: DockerRunner;
  /** The home directory the mount rule protects; the real one by default. */
  home?: string;
}

/**
 * Raised before anything runs: the adapter was asked for and cannot be used.
 * The caller reports it and stops; it never falls back to the simulator.
 */
export class AdapterRefusal extends Error {
  constructor(why: string) {
    super(`${why} Nothing ran, and the simulated environment was not used in its place.`);
    this.name = 'AdapterRefusal';
  }
}

/**
 * The docker CLI's own environment: what it needs to find the daemon and its
 * contexts, and nothing else, so a secret in this process (the approval key
 * among them) never even reaches the client.
 */
function dockerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = /^(PATH|HOME|USER|LOGNAME|TMPDIR|XDG_RUNTIME_DIR|SystemRoot|DOCKER_[A-Z_]+)$/;
  return Object.fromEntries(Object.entries(env).filter(([k]) => keep.test(k)));
}

/** The real runner: docker on PATH, an argument array, no shell. */
export const dockerCli: DockerRunner = (args, timeoutMs) => {
  const out = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    env: dockerEnv(),
  });
  const code = (out.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: out.status,
    stdout: out.stdout ?? '',
    stderr: out.stderr ?? '',
    error: out.error?.message,
    missing: code === 'ENOENT',
    timedOut: code === 'ETIMEDOUT',
    overflow: code === 'ENOBUFS',
  };
};

const firstLine = (s: string | undefined) =>
  (s || '').trim().split('\n')[0]?.slice(0, 200) || 'no reason given';

/**
 * A Docker image reference: an optional registry, a lowercase path, an
 * optional tag and an optional sha256 digest. It cannot start with `-`, so
 * it is never read as a flag.
 */
const IMAGE_REF =
  /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::\d{1,5})?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

/** Why an image reference is refused, or null when it is one. */
export function imageProblem(image: string): string | null {
  if (!image || image.length > 255 || !IMAGE_REF.test(image))
    return `${JSON.stringify(image)} is not an image reference such as ${DEFAULT_DOCKER_IMAGE}.`;
  return null;
}

/** Why a network choice is refused, or null for `none` and `bridge`. */
export function networkProblem(network: string): string | null {
  if (network === 'none' || network === 'bridge') return null;
  return `${JSON.stringify(network)} is not a network the adapter gives a step: none (the default) or bridge. host is refused because it puts the container on this machine's loopback, where the API and every local service listen.`;
}

/**
 * Why a step's command is refused, or null. A command is an argument vector:
 * strings, the first naming the program, with no NUL bytes and a bounded
 * size. Nothing in it is parsed, so this is the whole check.
 */
export function commandProblem(command: unknown): string | null {
  if (!Array.isArray(command) || command.length === 0)
    return 'A Docker step runs the argument vector in payload.command, such as ["echo", "hello"], and this request carries none.';
  if (command.length > MAX_ARGS) return `payload.command has more than ${MAX_ARGS} arguments.`;
  if (!command.every(a => typeof a === 'string'))
    return 'Every element of payload.command must be a string.';
  if (command[0] === '') return 'The first element of payload.command names the program.';
  if (command.some(a => a.includes('\0')))
    return 'An argument in payload.command holds a NUL byte.';
  if (command.reduce((n, a) => n + a.length, 0) > MAX_ARGV_CHARS)
    return `payload.command is longer than ${MAX_ARGV_CHARS} characters.`;
  return null;
}

/**
 * A path with every link resolved. For one that does not exist, its nearest
 * existing ancestor is resolved, so `/var/...` on macOS still compares as the
 * `/private/var/...` a resolved working directory reads as.
 */
const real = (p: string): string => {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(real(parent), basename(abs));
  }
};

/** A socket's own place, and where it leads when it is a link. */
const socketPlaces = (s: string) => [join(real(dirname(s)), basename(s)), real(s)];

/** True when `inner` is `outer` or inside it. */
const within = (outer: string, inner: string) => {
  const r = relative(outer, inner);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/** Where a Docker socket may sit, the same places the infrastructure scan looks. */
export function dockerSockets(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    '/var/run/docker.sock',
    '/run/docker.sock',
    join(home, '.docker', 'run', 'docker.sock'),
    join(home, '.orbstack', 'run', 'docker.sock'),
    join(home, '.colima', 'default', 'docker.sock'),
    join(home, '.rd', 'docker.sock'),
    env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'docker.sock') : '',
    env.DOCKER_HOST?.startsWith('unix://') ? env.DOCKER_HOST.slice('unix://'.length) : '',
  ].filter(Boolean);
}

/**
 * The working directory to mount, resolved through any link, or the reason it
 * is refused. Refused: the home directory or anything above it, anything in
 * one of its dot-directories, any directory holding a Docker socket, and a
 * path docker's `--mount` syntax could misread.
 */
export function checkWorkdir(
  path: string,
  home: string,
  sockets: string[] = dockerSockets(home)
): { path: string } | { problem: string } {
  if (/[,"\n\r\0]/.test(path))
    return {
      problem: `The working directory ${JSON.stringify(path)} holds a character docker's mount syntax would misread.`,
    };
  const dir = real(resolve(path));
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir)
    return { problem: `The working directory ${dir} is not a directory on this machine.` };
  if (/[,"\n\r\0]/.test(dir))
    return {
      problem: `The working directory ${dir} holds a character docker's mount syntax would misread.`,
    };
  const realHome = real(home);
  if (within(dir, realHome))
    return {
      problem: `${dir} is the home directory or holds it, and the adapter never mounts a home directory.`,
    };
  if (within(realHome, dir) && relative(realHome, dir).split(sep)[0].startsWith('.'))
    return {
      problem: `${dir} is inside a dot-directory of ${realHome}, where keys and credentials live, and the adapter never mounts one.`,
    };
  const socket = sockets.flatMap(socketPlaces).find(s => within(dir, s));
  if (socket)
    return {
      problem: `${dir} holds the Docker socket ${socket}, and a container with the socket controls the daemon.`,
    };
  return { path: dir };
}

/**
 * The argument vector for one step's `docker run`. Pure, so a test can read
 * every flag. Only the name, image and working directory (all checked, none
 * from the request) appear in an option; the command comes last.
 */
export function dockerRunArgv(spec: {
  name: string;
  image: string;
  command: string[];
  network: DockerNetwork;
  workdir: string | null;
}): string[] {
  if (!/^ambit-step-[a-f0-9]+$/.test(spec.name))
    throw new Error('a step container name is generated, never given');
  const wrong =
    imageProblem(spec.image) || networkProblem(spec.network) || commandProblem(spec.command);
  if (wrong) throw new Error(wrong);
  return [
    'run',
    '--rm',
    `--name=${spec.name}`,
    `--label=${STEP_LABEL}=step`,
    `--label=ambit.step=${spec.name}`,
    '--pull=never',
    `--network=${spec.network}`,
    '--read-only',
    `--tmpfs=/tmp:rw,noexec,nosuid,size=${STEP_LIMITS.tmpfs}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--user=${UNPRIVILEGED}`,
    `--memory=${STEP_LIMITS.memory}`,
    `--memory-swap=${STEP_LIMITS.memory}`,
    `--cpus=${STEP_LIMITS.cpus}`,
    `--pids-limit=${STEP_LIMITS.pids}`,
    ...(spec.workdir
      ? [
          `--mount=type=bind,source=${spec.workdir},target=${WORK_MOUNT},readonly`,
          `--workdir=${WORK_MOUNT}`,
        ]
      : ['--workdir=/tmp']),
    // An image's own entrypoint could be a shell that re-parses the command.
    // Cleared, the command's first element is the program that runs.
    '--entrypoint=',
    spec.image,
    ...spec.command,
  ];
}

/**
 * The Docker adapter. Constructing it checks everything that can be checked
 * before a step: the image reference, the network choice, the working
 * directory, that the daemon answers and that the image is already on this
 * machine. Any failure is an AdapterRefusal.
 */
export function dockerAdapter(
  envDir: string,
  options: DockerOptions = {}
): EnvironmentAdapter<DockerEnvironment> {
  const run = options.run ?? dockerCli;
  const image = options.image || DEFAULT_DOCKER_IMAGE;
  const network = options.network || 'none';
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  const wrong = imageProblem(image) || networkProblem(network);
  if (wrong) throw new AdapterRefusal(wrong);
  let workdir: string | null = null;
  if (options.workdir) {
    const checked = checkWorkdir(options.workdir, options.home || homedir());
    if ('problem' in checked) throw new AdapterRefusal(checked.problem);
    workdir = checked.path;
  }

  const daemon = run(['version', '--format', '{{.Server.Version}}'], QUERY_TIMEOUT_MS);
  if (daemon.missing)
    throw new AdapterRefusal(
      'The docker command is not installed, so the Docker adapter cannot run a step.'
    );
  if (daemon.status !== 0)
    throw new AdapterRefusal(
      `Docker did not answer (${firstLine(daemon.stderr || daemon.error)}). Start the daemon and try again.`
    );

  const imageId = (): string | null => {
    const r = run(['image', 'inspect', '--format', '{{.Id}}', image], QUERY_TIMEOUT_MS);
    return r.status === 0 ? r.stdout.trim() || null : null;
  };
  if (!imageId())
    throw new AdapterRefusal(
      `The image ${image} is not on this machine. The adapter never pulls, so no registry is reached unless you type \`docker pull ${image}\` yourself.`
    );

  const labelled = (): string[] => {
    const r = run(
      ['ps', '--all', '--filter', `label=${STEP_LABEL}`, '--format', '{{.Names}}'],
      QUERY_TIMEOUT_MS
    );
    if (r.status !== 0)
      throw new Error(`docker ps did not answer: ${firstLine(r.stderr || r.error)}`);
    return r.stdout
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .sort();
  };

  const withoutHash = ({ immutable_hash: _hash, ...rest }: DockerEnvironment) => rest;

  const read = (): DockerEnvironment => {
    const {
      immutable_hash: _stored,
      last_run,
      ...record
    } = readSimulatedEnvironment(envDir) as DockerRecord;
    const state = {
      ...record,
      adapter: 'docker' as const,
      image,
      image_id: imageId(),
      active_containers: labelled(),
      last_run: last_run ?? null,
    };
    return { ...state, immutable_hash: computeStateHash(state) };
  };

  return {
    name: 'docker',
    read,
    apply(change, step?: ExecutionStep) {
      const bad = commandProblem(step?.command);
      if (bad) throw new Error(bad);
      const command = step!.command as string[];
      const net: DockerNetwork = step!.network && network === 'bridge' ? 'bridge' : 'none';
      const name = `ambit-step-${randomBytes(6).toString('hex')}`;
      const started = Date.now();
      const out = run(
        dockerRunArgv({ name, image, command, network: net, workdir }),
        timeoutSeconds * 1000
      );
      const seconds = (Date.now() - started) / 1000;

      // --rm removes a container that exited. One the timeout or the output
      // cap cut off is still running, since only the client was stopped, so
      // it is removed by name, and Docker is then asked whether it is gone.
      run(['rm', '--force', name], QUERY_TIMEOUT_MS);
      const left = run(
        ['ps', '--all', '--quiet', '--filter', `label=ambit.step=${name}`],
        QUERY_TIMEOUT_MS
      );
      const removed = left.status === 0 && left.stdout.trim() === '';

      const lastRun: DockerStepRun = {
        container: name,
        image,
        command,
        network: net,
        workdir,
        exit_code: out.status,
        timed_out: Boolean(out.timedOut),
        stdout: out.stdout.slice(0, MAX_OUTPUT),
        stderr: out.stderr.slice(0, MAX_OUTPUT),
        truncated:
          Boolean(out.overflow) || out.stdout.length > MAX_OUTPUT || out.stderr.length > MAX_OUTPUT,
        started_at: new Date(started).toISOString(),
        seconds,
        removed,
      };

      const failure = out.missing
        ? 'the docker command is no longer there'
        : out.timedOut
          ? `the step ran past ${timeoutSeconds}s and was stopped`
          : out.overflow
            ? 'the step printed more than 1 MiB and was stopped'
            : out.status !== 0
              ? `the step exited ${out.status ?? 'without a status'}: ${firstLine(out.stderr || out.error)}`
              : !removed
                ? `container ${name} is still there after the step; \`docker rm --force ${name}\` removes it`
                : null;

      // The deploy is recorded only when the step completed; a failed one
      // leaves the record as it was, beside the run that says why.
      const { active_containers: _live, ...deploy } = change;
      const record = readSimulatedEnvironment(envDir);
      const next: DockerRecord = failure
        ? { ...record, last_run: lastRun }
        : { ...record, ...deploy, last_run: lastRun };
      writeSimulatedEnvironment(envDir, next);
      if (failure) throw new Error(failure);
      return read();
    },
    hashOf: state => computeStateHash(withoutHash(state)),
  };
}

/**
 * The adapter the entry point was asked for: `--adapter` first, then
 * `AMBIT_ADAPTER`, then the simulator. Docker's settings come from
 * `AMBIT_DOCKER_IMAGE`, `AMBIT_DOCKER_NETWORK` and `AMBIT_DOCKER_WORKDIR`. A
 * name it does not know, or a Docker it cannot use, is an AdapterRefusal.
 */
export function selectAdapter(
  envDir: string,
  choice: { adapter?: string; env?: NodeJS.ProcessEnv; run?: DockerRunner } = {}
): EnvironmentAdapter<SimulatedEnvironment> {
  const env = choice.env ?? process.env;
  const name = (choice.adapter ?? env.AMBIT_ADAPTER ?? '').trim().toLowerCase() || ADAPTERS[0];
  if (name === 'simulated') return simulatedAdapter(envDir);
  if (name !== 'docker')
    throw new AdapterRefusal(
      `${JSON.stringify(name)} is not an adapter the control plane has: ${ADAPTERS.join(' (the default), ')}.`
    );
  return dockerAdapter(envDir, {
    image: env.AMBIT_DOCKER_IMAGE,
    network: env.AMBIT_DOCKER_NETWORK,
    workdir: env.AMBIT_DOCKER_WORKDIR,
    run: choice.run,
  });
}
