import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The engine runs under Node (node:sqlite); these assertions run under Bun,
// which ships its own driver. Same file, different reader.
import { Database } from 'bun:sqlite';

const ENGINE = join(import.meta.dir, 'engine.ts');
let dir: string;

/** Seed a throwaway database from an inline config and return a handle. */
function seed(config: unknown): Database {
  const configPath = join(dir, 'config.json');
  const dbPath = join(dir, 'graph.db');
  writeFileSync(configPath, JSON.stringify(config));
  // Seeding also scans the machine's skill directories, which would let the
  // developer's own setup decide these assertions. Override the mapping with
  // the stock config keys and no skill dirs so each case is hermetic.
  const mapping = JSON.stringify({
    config_keys: {
      mcp: { type: 'mcp', domain_field: 'type', domain_map: { remote: 'backend', local: 'infra' }, desc_template: '{type} server' },
      agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
      provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' },
      command: { type: 'tool', domain: 'devops', desc_field: 'description' },
    },
    skill_dirs: [],
  });
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: { ...process.env, OPENCODE_CONFIG: configPath, TOOLCHAIN_DB: dbPath, CONFIG_MAPPING: mapping },
    stdio: 'ignore',
  });
  return new Database(dbPath);
}

const rows = (db: Database, sql: string) => db.prepare(sql).all() as any[];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'capgraph-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('seeding produces edges, not just nodes', () => {
  const db = seed({
    provider: { acme: { models: { 'fast-1': { name: 'Fast One' } } } },
    agent: { writer: { description: 'writes', model: 'acme/fast-1' } },
  });

  // The regression this guards: seeding used to insert zero dependencies, so
  // every structural analysis returned empty forever.
  const deps = rows(db, 'SELECT from_capability f, to_capability t FROM dependencies');
  expect(deps.length).toBeGreaterThan(0);

  const edge = (f: string, t: string) => deps.some(d => d.f === f && d.t === t);
  expect(edge('provider:acme', 'model:acme/fast-1')).toBe(true);
  expect(edge('model:acme/fast-1', 'agent:writer')).toBe(true);
});

test('an agent pinned to an undeclared model still depends on its provider', () => {
  const db = seed({
    provider: { acme: {} },
    agent: { writer: { description: 'writes', model: 'acme/not-in-config' } },
  });
  const deps = rows(db, 'SELECT from_capability f, to_capability t FROM dependencies');
  expect(deps.some(d => d.f === 'provider:acme' && d.t === 'agent:writer')).toBe(true);
});

test('every dependency endpoint resolves to a real capability', () => {
  const db = seed({
    provider: { acme: { models: { 'fast-1': {} } } },
    agent: { a: { model: 'ghost/missing' }, b: { model: 'acme/fast-1' } },
  });
  // Both columns are foreign keys; a dangling id would break every join.
  const dangling = rows(db, `
    SELECT d.from_capability f, d.to_capability t FROM dependencies d
    LEFT JOIN capabilities cf ON cf.id = d.from_capability
    LEFT JOIN capabilities ct ON ct.id = d.to_capability
    WHERE cf.id IS NULL OR ct.id IS NULL`);
  expect(dangling).toEqual([]);
});

test('combos are seeded from an explicit block, with hard and soft prerequisites', () => {
  const db = seed({
    provider: { acme: { models: { 'fast-1': {} } } },
    combos: {
      shipping: {
        name: 'Shipping',
        domain: 'devops',
        requires: ['provider:acme'],
        optional: ['model:acme/fast-1'],
      },
    },
  });

  const combo = db.prepare("SELECT * FROM capabilities WHERE id = 'combo:shipping'").get() as any;
  expect(combo?.category).toBe('combo');
  expect(combo?.state).toBe('locked');

  const deps = rows(db, "SELECT from_capability f, is_hard_requisite h FROM dependencies WHERE to_capability = 'combo:shipping'");
  expect(deps.find(d => d.f === 'provider:acme')?.h).toBe(1);
  expect(deps.find(d => d.f === 'model:acme/fast-1')?.h).toBe(0);
});

test('a combo whose prerequisites do not exist is skipped', () => {
  // Otherwise it would show up in unlock analyses as permanently unreachable.
  const db = seed({ provider: { acme: {} }, combos: { ghost: { requires: ['mcp:nope'] } } });
  const found = rows(db, "SELECT id FROM capabilities WHERE id = 'combo:ghost'");
  expect(found).toEqual([]);
});

test('seeding is idempotent — re-running adds no duplicate edges', () => {
  const config = {
    provider: { acme: { models: { 'fast-1': {} } } },
    agent: { writer: { model: 'acme/fast-1' } },
  };
  const first = seed(config);
  const before = (first.prepare('SELECT COUNT(*) n FROM dependencies').get() as any).n;
  first.close();

  const second = seed(config); // same dir, same db path
  const after = (second.prepare('SELECT COUNT(*) n FROM dependencies').get() as any).n;
  expect(after).toBe(before);
});

test('the curated tech tree places a minimal setup at the bottom of the tree', () => {
  const db = seed({ provider: { acme: { models: { 'fast-1': {} } } } });

  // Everyone gets the same tree; only placement differs.
  const nodes = rows(db, "SELECT id, state FROM capabilities WHERE category = 'combo'");
  expect(nodes.length).toBeGreaterThan(20);

  const state = (id: string) => nodes.find(n => n.id === `combo:${id}`)?.state;
  expect(state('shell-execution')).toBe('unlocked');   // seeded as a base tool
  expect(state('hosted-inference')).toBe('unlocked');  // a provider exists
  expect(state('local-runtime')).toBe('locked');       // nothing local configured
  expect(state('offline-capable')).toBe('locked');     // far up the tree
});

test('a local-first setup unlocks the local branch', () => {
  const db = seed({
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    mcp: { playwright: {} },
  });
  const state = (id: string) =>
    (rows(db, "SELECT id, state FROM capabilities WHERE category = 'combo'")
      .find(n => n.id === `combo:${id}`) || {}).state;

  expect(state('local-runtime')).toBe('unlocked');      // ollama detected
  expect(state('local-tool-calling')).toBe('unlocked'); // qwen is tool-capable
  expect(state('browser-automation')).toBe('unlocked'); // playwright
});

test('a node is never unlocked while its prerequisites are not', () => {
  // The tree must not contradict itself — this guards the era-ordered pass.
  const db = seed({ provider: { acme: {} }, agent: { x: { description: 'offline air-gap work' } } });
  const byId = new Map(
    rows(db, "SELECT id, state FROM capabilities WHERE category = 'combo'").map(n => [n.id, n.state])
  );
  const reqs = rows(db, `SELECT from_capability f, to_capability t FROM dependencies
                         WHERE description = 'Tech tree prerequisite'`);
  for (const { f, t } of reqs) {
    if (byId.get(t) === 'unlocked') expect(byId.get(f)).toBe('unlocked');
  }
});

test('detection does not match short tokens inside unrelated words', () => {
  // "ci" once matched agent:commercial-validation and agent:brief-decision,
  // unlocking Continuous Delivery for a setup with no CI at all.
  const db = seed({ agent: { 'commercial-decision-writer': { description: 'writes' } } });
  const cd = rows(db, "SELECT state FROM capabilities WHERE id = 'combo:continuous-delivery'");
  expect(cd[0]?.state).toBe('locked');
});
