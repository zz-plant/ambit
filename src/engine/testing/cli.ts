/**
 * The harness the engine's end-to-end tests share: a throwaway graph, seeded
 * from a config fixture, driven through the CLI's own dispatch.
 *
 * Every one of these used to spawn `node --experimental-sqlite engine.ts <cmd>
 * --json` and parse stdout — once per assertion, 137 times — because the test
 * runner could not load the engine at all. It can now, so `cli()` calls
 * `capture()` in the same process: the same argv, the same command grouping
 * and flag parsing, the same switch, the same `emit`. What is gone is the
 * process, not the coverage.
 *
 * A handful of genuinely end-to-end cases still spawn, in cli.test.ts, because
 * argv handling, exit codes and the human formatter are only real across a
 * process boundary. For a test that calls an engine function directly, use
 * ./graph.ts.
 */
import { beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, type Db } from '../db.ts';
import { migrate } from '../migrate.ts';
import { capture, captureAsync, runCommand } from '../cli.ts';

/**
 * The engine as a program, for the few tests that need one.
 *
 * Argv handling, exit codes and the human formatter only exist across a
 * process boundary, so those keep spawning. Everything else goes through
 * `cli()` in-process.
 */
const ENGINE = join(import.meta.dirname, '..', 'engine.ts');
import {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
  workReport,
  usageReport,
} from '../telemetry.ts';

let dir: string;

function seed(config: unknown, opts: { name?: string } = {}): Db {
  const configPath = join(dir, (opts.name || 'config') + '.json');
  const dbPath = join(dir, 'graph.db');
  writeFileSync(configPath, JSON.stringify(config));
  // Seeding also scans the machine's skill directories, which would let the
  // developer's own setup decide these assertions. Override the mapping with
  // the stock config keys and no skill dirs so each case is hermetic.
  const mapping = JSON.stringify({
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
  // The engine reads these from the environment, so they are set for the call
  // and restored after it: a seed that picked up the developer's own config
  // would let their machine decide these assertions.
  return withEnv(
    {
      OPENCODE_CONFIG: configPath,
      TOOLCHAIN_DB: dbPath,
      AMBIT_DB: dbPath,
      CONFIG_MAPPING: mapping,
    },
    () => {
      const db = getDb(dbPath);
      migrate(db);
      // `capture` refuses a command that reports nothing, and seed reports
      // through console rather than emit, so the switch is reached directly.
      runCommand(db, 'seed', [], new Set(['--json']), mapping);
      db.close();
      return getDb(dbPath);
    }
  );
}

const rows = (db: Db, sql: string) => db.prepare(sql).all() as any[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'capgraph-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs `argv` for its environment variables and restores them afterwards.
 *
 * The engine reads its database path, its config path and its approval key
 * from the environment. In a subprocess those were per-call; in-process they
 * are global, so they are set and unset around each call. Vitest runs each
 * file in its own fork and each test in order, so nothing races.
 */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Asks the engine what a person typing `cmd` would be told, and returns it.
 *
 * `--json` is appended because that is the shape the assertions are written
 * against; it changes nothing about which code runs, since `capture` takes the
 * result before the formatter sees it.
 */
function cli(cmd: string, ...args: string[]): any {
  const dbPath = join(dir, 'graph.db');
  return withEnv(
    {
      TOOLCHAIN_DB: dbPath,
      AMBIT_DB: dbPath,
      // Pinned to this test's temp file. Without it, a command that writes
      // configuration would target the developer's real one.
      OPENCODE_CONFIG: join(dir, 'config.json'),
      // A fixed key so tests never read or create the real one on this
      // machine, and so a forged artifact is provably forged.
      AMBIT_APPROVAL_KEY: 'test-approval-key',
    },
    () => {
      const db = getDb(dbPath);
      migrate(db);
      try {
        return capture(db, [cmd, ...args, '--json']);
      } finally {
        db.close();
      }
    }
  );
}

/**
 * Seeds a graph under an arbitrary environment.
 *
 * For the cases that vary something the environment decides — which runtime is
 * contributing, which skill directories exist, where HOME points, where the
 * infrastructure manifest is. An `undefined` value unsets the variable, which
 * is how the auto-discovery case asks to be given no config at all.
 */
function seedWith(vars: Record<string, string | undefined>, mapping?: string): void {
  withEnv(vars, () => {
    const dbPath = process.env.TOOLCHAIN_DB;
    if (!dbPath) throw new Error('seedWith needs TOOLCHAIN_DB');
    const db = getDb(dbPath);
    migrate(db);
    runCommand(db, 'seed', [], new Set(['--json']), mapping ?? process.env.CONFIG_MAPPING);
    db.close();
  });
}

/** `cli` for the three commands that reach the network. */
async function cliAsync(cmd: string, ...args: string[]): Promise<any> {
  const dbPath = join(dir, 'graph.db');
  return withEnv(
    {
      TOOLCHAIN_DB: dbPath,
      AMBIT_DB: dbPath,
      OPENCODE_CONFIG: join(dir, 'config.json'),
      AMBIT_APPROVAL_KEY: 'test-approval-key',
    },
    async () => {
      const db = getDb(dbPath);
      migrate(db);
      try {
        return await captureAsync(db, [cmd, ...args, '--json']);
      } finally {
        db.close();
      }
    }
  );
}

const LOCAL_ONLY = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  agent: { 'offline-resilience-engineer': { description: 'keeps things working air-gapped' } },
};

const PLUS_EMBEDDINGS = {
  provider: { ollama: { models: { 'qwen3-coder': {}, 'nomic-embed-text': {} } } },
  agent: { 'offline-resilience-engineer': { description: 'keeps things working air-gapped' } },
};

function recordVerification(id: string, outcome: 'verified' | 'failed') {
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, 'recorded by test')"
  ).run(id, outcome, outcome === 'verified' ? 1 : 0);
  db.close();
}

const WITH_PEOPLE = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  actors: {
    kanav: {
      name: 'Kanav',
      provides: ['physical-access', 'approve-purchases'],
      authorizes: ['combo:continuous-delivery'],
    },
  },
};

const WITH_PREFS = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { git: {} },
  actors: {
    kanav: {
      name: 'Kanav',
      prefers: ['local-when-practical', 'minimize-recurring-cost'],
      authorizes: ['combo:continuous-delivery'],
    },
  },
};

function recordHumanAct(session: string, capId: string, action: string) {
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    'INSERT INTO session_learning (session_id, capability_id, action, outcome_score) VALUES (?, ?, ?, 1)'
  ).run(session, capId, action);
  db.close();
}

const TWO_PROVIDERS = {
  mcp: { git: {}, github: {} }, // both provide Version Control
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
};

const SHARED_CREDENTIAL = {
  ...TWO_PROVIDERS,
  credentials: {
    'github/user-token': { name: 'GitHub user token', used_by: ['mcp:git', 'mcp:github'] },
  },
};

const APPLIABLE = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { git: {} },
  actors: { kanav: { name: 'Kanav' } },
};

const readConfig = () => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));

const WITH_ECONOMICS = {
  mcp: { git: {} },
  actors: { kanav: { name: 'Kanav' } },
  economics: {
    actors: { 'human:kanav': { attention_value_per_hour: 250 } },
    providers: { 'mcp:git': { recurring_cost_per_month: 30 } },
  },
  goals: {
    'recover-production': {
      name: 'Recover production service',
      occurrence_rate_per_month: 2,
      success_value: 40,
      failure_cost: 500,
    },
  },
};

function writeAndReturn(path: string, data: unknown): string {
  writeFileSync(path, JSON.stringify(data));
  return path;
}

export type { Db };
export {
  APPLIABLE,
  ENGINE,
  execFileSync,
  LOCAL_ONLY,
  PLUS_EMBEDDINGS,
  SHARED_CREDENTIAL,
  TWO_PROVIDERS,
  WITH_ECONOMICS,
  WITH_PEOPLE,
  WITH_PREFS,
  addEvent,
  beginRun,
  cli,
  cliAsync,
  dir,
  seedWith,
  withEnv,
  endRun,
  existsSync,
  getDb,
  join,
  migrate,
  mkdirSync,
  mkdtempSync,
  readConfig,
  readFileSync,
  recordHumanAct,
  recordIntervention,
  recordOutcome,
  recordResource,
  recordUse,
  recordVerification,
  rmSync,
  rows,
  seed,
  symlinkSync,
  tmpdir,
  usageReport,
  workReport,
  writeAndReturn,
  writeFileSync,
};
