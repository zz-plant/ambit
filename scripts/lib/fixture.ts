/**
 * The fixture environment the generated artefacts are built from.
 *
 * Three things now render the product for an audience — the hero recording,
 * the demo tech tree that ships in the bundle, and the console examples in the
 * README. All three have the same two requirements, and both are easy to get
 * wrong once per script:
 *
 *   1. The graph must be invented. The seeder reads ~/.config/opencode, the
 *      Claude and Codex config paths and the skill directories, so anything
 *      generated against a real HOME publishes that person's MCP servers,
 *      agents and hostnames. An early hero recording did exactly that. HOME is
 *      therefore redirected wholesale rather than variable by variable.
 *
 *   2. The graph must be the same one every time, or the README, the demo and
 *      the recording describe three different products.
 *
 * Keeping the fixture in one place is what makes both true by construction.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Broad enough that every era column has something in it and the frontier has
 * somewhere to go; entirely invented, so nothing here describes the machine
 * that runs it.
 */
export const FIXTURE = {
  provider: { anthropic: { name: 'Anthropic' }, ollama: { name: 'Ollama' } },
  agent: {
    reviewer: { description: 'Reviews diffs before merge' },
    researcher: { description: 'Reads docs and summarises' },
  },
  mcp: {
    git: { type: 'local', command: ['git-mcp'], enabled: true },
    github: { type: 'remote', command: ['github-mcp'], enabled: true },
    filesystem: { type: 'local', command: ['fs-mcp'], enabled: true },
    playwright: { type: 'local', command: ['playwright-mcp'], enabled: true },
    sqlite: { type: 'local', command: ['sqlite-mcp'], enabled: true },
    fetch: { type: 'remote', command: ['fetch-mcp'], enabled: true },
    memory: { type: 'local', command: ['memory-mcp'], enabled: true },
    docker: { type: 'local', command: ['docker-mcp'], enabled: true },
    postgres: { type: 'local', command: ['postgres-mcp'], enabled: true },
    slack: { type: 'remote', command: ['slack-mcp'], enabled: true },
    sentry: { type: 'remote', command: ['sentry-mcp'], enabled: true },
    kubernetes: { type: 'local', command: ['k8s-mcp'], enabled: true },
  },
  command: {
    deploy: { description: 'Ship to staging' },
    migrate: { description: 'Run database migrations' },
  },
} as const;

/** Every MCP id the fixture is allowed to produce, for the leak check. */
export const FIXTURE_MCP = Object.keys(FIXTURE.mcp);

export interface Sandbox {
  work: string;
  home: string;
  dbPath: string;
  env: NodeJS.ProcessEnv;
  /** Run the engine CLI inside the sandbox and return its stdout. */
  engine: (args: string[]) => string;
  cleanup: () => void;
}

/**
 * A throwaway HOME with the fixture config in it, and a seeded graph.
 *
 * `node` on PATH may be a version-manager shim that reads the environment this
 * replaces — mise prints four lines of error and exits — so the engine is
 * always invoked through `process.execPath`.
 */
export function seedFixtureGraph(label = 'ambit-fixture'): Sandbox {
  const work = mkdtempSync(join(tmpdir(), `${label}-`));
  const home = join(work, 'home');
  const cfgDir = join(home, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  const configPath = join(cfgDir, 'opencode.json');
  writeFileSync(configPath, JSON.stringify(FIXTURE, null, 2));
  const dbPath = join(work, 'graph.db');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    AMBIT_DB: dbPath,
    OPENCODE_CONFIG: configPath,
    // Pointed at a file that does not exist on purpose: the scan must not probe
    // whatever infrastructure the generating machine happens to have.
    INFRA_MANIFEST: join(cfgDir, 'no-infrastructure.json'),
    AMBIT_APPROVAL_KEY: 'fixture-key',
  };

  const engine = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        '--experimental-sqlite',
        '--disable-warning=ExperimentalWarning',
        join(ROOT, 'src', 'engine', 'engine.ts'),
        ...args,
      ],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

  engine(['seed']);

  return {
    work,
    home,
    dbPath,
    env,
    engine,
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}

/**
 * Refuse to publish anything carrying an MCP server the fixture did not
 * declare. Proof beats intent here: the check is cheap and the failure it
 * catches is somebody's real toolchain in a public artefact.
 */
export function assertNoRealData(serialised: string, extraAllowed: string[] = []): void {
  const allowed = new Set([...FIXTURE_MCP, ...extraAllowed]);
  const found = [...serialised.matchAll(/"mcp:([a-z0-9._-]+)"/gi)].map(m => m[1]);
  const foreign = [...new Set(found)].filter(id => !allowed.has(id));
  if (foreign.length)
    throw new Error(
      `refusing to write: carries MCP servers that are not in the fixture — ${foreign.join(', ')}`
    );
}
