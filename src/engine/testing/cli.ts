/**
 * The harness the engine's end-to-end tests share: a throwaway graph seeded by
 * running the real CLI, plus the config fixtures those runs are seeded from.
 *
 * Driving the engine the way a person does — a config file in, a database and
 * printed output back — is worth keeping. It was just never the only thing
 * worth doing, and for a long time it was: all 137 of these lived in one
 * 2,300-line file because the runner could not load the engine in-process.
 * They are split by subject now, and this is what they share. For a test that
 * calls an engine function directly, use ./graph.ts instead.
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

const ENGINE = join(import.meta.dirname, '..', 'engine.ts');

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
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: configPath,
      TOOLCHAIN_DB: dbPath,
      CONFIG_MAPPING: mapping,
    },
    stdio: 'ignore',
  });
  return getDb(dbPath);
}

const rows = (db: Db, sql: string) => db.prepare(sql).all() as any[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'capgraph-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cli(cmd: string, ...args: string[]): any {
  const out = execFileSync(
    'node',
    ['--experimental-sqlite', ENGINE, cmd, ...args, '--json'],
    // OPENCODE_CONFIG is pinned to this test's temp file. Without it a command
    // that writes configuration would target the developer's real one.
    {
      env: {
        ...process.env,
        TOOLCHAIN_DB: join(dir, 'graph.db'),
        OPENCODE_CONFIG: join(dir, 'config.json'),
        // A fixed key so tests never read or create the real one on this
        // machine, and so a forged artifact is provably forged.
        AMBIT_APPROVAL_KEY: 'test-approval-key',
      },
      encoding: 'utf8',
    }
  );
  return JSON.parse(out);
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
  dir,
  endRun,
  execFileSync,
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
