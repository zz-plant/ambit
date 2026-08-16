import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The engine runs under Node (node:sqlite); these assertions run under Bun,
// which ships its own driver. Same file, different reader.
import { Database } from 'bun:sqlite';
// The visualizer API runs under Bun and migrates the graph itself, so the
// migration has to work through this driver as well as the engine's.
import { migrate } from './migrate.ts';
import { beginRun, endRun, addEvent, recordUse, recordIntervention, recordResource, recordOutcome, workReport, usageReport } from './telemetry.ts';

const ENGINE = join(import.meta.dir, 'engine.ts');
let dir: string;

/** Seed a throwaway database from an inline config and return a handle. */
function seed(config: unknown, opts: { name?: string } = {}): Database {
  const configPath = join(dir, (opts.name || 'config') + '.json');
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


// ── Ontology ────────────────────────────────────────────────────────────────

test('every node carries the kind of thing it is', () => {
  const db = seed({
    mcp: { git: { type: 'local' } },
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    actors: { kanav: { name: 'Kanav', provides: ['physical-access'] } },
  });
  const kind = (id: string) =>
    (rows(db, `SELECT kind FROM capabilities WHERE id = '${id}'`)[0] || {}).kind;

  expect(kind('combo:version-control')).toBe('capability');
  expect(kind('mcp:git')).toBe('provider');
  expect(kind('model:ollama/qwen3-coder')).toBe('resource');
  expect(kind('provider:ollama')).toBe('resource'); // an endpoint serving models
  expect(kind('human:kanav')).toBe('actor');
  expect(kind('runtime:opencode')).toBe('runtime');
  expect(kind('act:physical-access')).toBe('action');

  // Nothing is left at the column default by accident.
  const unknown = rows(db, `SELECT id FROM capabilities WHERE kind NOT IN
    ('capability','action','provider','resource','actor','runtime')`);
  expect(unknown).toEqual([]);
});

test('every edge carries what it means, not just how much it matters', () => {
  const db = seed({
    mcp: { git: { type: 'local' } },
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    actors: { kanav: { name: 'Kanav', authorizes: ['combo:version-control'] } },
  });
  const edges = rows(db, 'SELECT from_capability f, to_capability t, kind FROM dependencies');
  const kindOfEdge = (f: string, t: string) => edges.find(e => e.f === f && e.t === t)?.kind;

  expect(kindOfEdge('mcp:git', 'combo:version-control')).toBe('provides');
  expect(kindOfEdge('runtime:opencode', 'mcp:git')).toBe('contributes');
  expect(kindOfEdge('provider:ollama', 'model:ollama/qwen3-coder')).toBe('runs_on');
  expect(kindOfEdge('human:kanav', 'combo:version-control')).toBe('authorizes');
  expect(kindOfEdge('combo:shell-execution', 'combo:version-control')).toBe('requires');
});

test('redundancy is counted by kind, not by matching a sentence', () => {
  const db = seed({ mcp: { git: { type: 'local' } } });

  // The prose match this replaces was silent when it failed. Rewriting the
  // description of a provision edge used to remove it from the redundancy
  // count; now only the kind decides, so the analysis survives rewording.
  db.prepare(
    "UPDATE dependencies SET description = 'Supplies this' WHERE from_capability = 'mcp:git'"
  ).run();
  db.close();

  const spof = cli('status').spofs;
  const listed = Array.isArray(spof) ? spof : [];
  expect(listed.some((s: any) => s.provider_id === 'mcp:git')).toBe(true);
});

test('a reader that is not the CLI can migrate the graph itself', () => {
  const db = seed({ mcp: { git: { type: 'local' } } });
  const before = rows(db, 'SELECT COUNT(*) n FROM frontier_snapshots')[0].n;

  // Put the database back the way an older Ambit left it.
  db.prepare('ALTER TABLE capabilities DROP COLUMN kind').run();
  db.prepare('ALTER TABLE capabilities DROP COLUMN lifecycle').run();
  db.prepare('ALTER TABLE dependencies DROP COLUMN kind').run();
  db.prepare('DROP TABLE schema_meta').run();

  // The visualizer API opens the graph under Bun without going through the
  // engine's Node handle. When migration could only be reached that way,
  // starting the server against a pre-upgrade database returned 500 from
  // /api/tech-tree with `no such column: c.kind` until some other command
  // happened to migrate for it.
  migrate(db as unknown as Parameters<typeof migrate>[0]);

  expect(rows(db, "SELECT kind FROM capabilities WHERE id = 'mcp:git'")[0].kind).toBe('provider');
  expect(rows(db, `SELECT kind FROM dependencies
    WHERE from_capability = 'mcp:git' AND to_capability = 'combo:version-control'`)[0].kind)
    .toBe('provides');
  expect(rows(db, 'SELECT COUNT(*) n FROM frontier_snapshots')[0].n).toBe(before);
  db.close();
});

test('a graph seeded before kinds existed gets them without losing its history', () => {
  const db = seed({ mcp: { git: { type: 'local' } } });
  const before = rows(db, 'SELECT COUNT(*) n FROM frontier_snapshots')[0].n;

  // Put the database back the way an older Ambit left it: no kind columns, no
  // record that the backfill ran. Losing this graph would lose the ledger, and
  // a ledger cannot be re-derived.
  db.prepare('ALTER TABLE capabilities DROP COLUMN kind').run();
  db.prepare('ALTER TABLE dependencies DROP COLUMN kind').run();
  db.prepare('DROP TABLE schema_meta').run();
  db.close();

  const where = cli('where');
  expect(where.seeded).toBe(true);

  const reopened = new Database(join(dir, 'graph.db'));
  expect(rows(reopened, 'SELECT COUNT(*) n FROM frontier_snapshots')[0].n).toBe(before);
  expect(rows(reopened, "SELECT kind FROM capabilities WHERE id = 'mcp:git'")[0].kind).toBe('provider');
  expect(rows(reopened, `SELECT kind FROM dependencies
    WHERE from_capability = 'mcp:git' AND to_capability = 'combo:version-control'`)[0].kind).toBe('provides');
});

// ── Ledger ──────────────────────────────────────────────────────────────────

/** Run the CLI against the database this test's `seed` writes to. */
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
// Same setup plus an embedding model — one addition.
const PLUS_EMBEDDINGS = {
  provider: { ollama: { models: { 'qwen3-coder': {}, 'nomic-embed-text': {} } } },
  agent: { 'offline-resilience-engineer': { description: 'keeps things working air-gapped' } },
};

test('seeding records the frontier, and an unchanged re-seed does not', () => {
  seed(LOCAL_ONLY).close();
  expect(cli('history').length).toBe(1);
  seed(LOCAL_ONLY).close(); // identical config
  expect(cli('history').length).toBe(1);
});

test('re-seeding updates derived state', () => {
  // The tech-tree insert is OR IGNORE, so without an explicit update every node
  // stayed frozen at whatever the first seed computed and the tree never moved.
  const first = seed(LOCAL_ONLY);
  const before = (first.prepare("SELECT state FROM capabilities WHERE id = 'combo:embeddings'").get() as any).state;
  first.close();

  const second = seed(PLUS_EMBEDDINGS);
  const after = (second.prepare("SELECT state FROM capabilities WHERE id = 'combo:embeddings'").get() as any).state;
  expect(before).toBe('locked');
  expect(after).toBe('unlocked');
});

test('the ledger separates what was acquired from what emerged', () => {
  seed(LOCAL_ONLY).close();
  seed(PLUS_EMBEDDINGS).close();

  const since = cli('history', 'since');
  expect(since.frontier_now).toBeGreaterThan(since.frontier_then);

  const gained = since.gained.map((g: any) => g.id);
  const emergent = since.emergent.map((e: any) => e.id);

  // Embeddings arrived because a model providing it was added.
  expect(gained).toContain('combo:embeddings');

  // Offline Capable was already provided by an agent that did not change; it
  // became reachable only because its prerequisites were satisfied elsewhere.
  // This is the entry a per-component changelog cannot produce.
  expect(emergent).toContain('combo:offline-capable');
  expect(gained).not.toContain('combo:offline-capable');
});

test('an expanding vocabulary is not an expanding frontier', () => {
  const db = seed(LOCAL_ONLY);

  // Stand in for the observation an older Ambit wrote: one taken before action
  // nodes were modelled at all. Everything that confers them was already there,
  // so nothing about this machine changed between the two observations.
  const snapshot = rows(db, 'SELECT id, states FROM frontier_snapshots ORDER BY id DESC LIMIT 1')[0];
  const states = JSON.parse(snapshot.states);
  const withoutActions = Object.fromEntries(
    Object.entries(states).filter(([id]) => !id.startsWith('act:'))
  );
  db.prepare('UPDATE frontier_snapshots SET states = ?, kinds = NULL WHERE id = ?')
    .run(JSON.stringify(withoutActions), snapshot.id);
  db.close();

  const since = cli('history', 'since');
  const vocabulary = since.vocabulary.map((v: any) => v.id);
  expect(vocabulary).toContain('act:shell-execution/run_command');

  // The point of the class: they are described, not counted. Reporting them as
  // gains would say the machine could suddenly do a dozen more things.
  expect(since.gained.map((g: any) => g.id)).not.toContain('act:shell-execution/run_command');
  expect(since.frontier_now).toBe(since.frontier_then);
  expect(since.nodes_now).toBeGreaterThan(since.frontier_now);
});

test('a real acquisition is still a gain, not vocabulary', () => {
  seed(LOCAL_ONLY).close();
  seed(PLUS_EMBEDDINGS).close();
  const since = cli('history', 'since');
  // Its provider is new, so this is the system changing rather than the model.
  expect(since.gained.map((g: any) => g.id)).toContain('combo:embeddings');
  expect(since.vocabulary.map((v: any) => v.id)).not.toContain('combo:embeddings');
});

test('a frontier query before any history explains itself', () => {
  const db = seed(LOCAL_ONLY);
  db.close();
  // One observation exists, so `since` compares against it rather than erroring.
  const since = cli('history', 'since');
  expect(since.since).toBeDefined();
  expect(since.emergent).toEqual([]);
});

// ── Runtimes ────────────────────────────────────────────────────────────────

test('capabilities are attributed to the runtime that contributed them', () => {
  const db = seed({ mcp: { git: {} }, provider: { acme: {} } });
  const runtimes = rows(db, "SELECT id FROM capabilities WHERE category = 'runtime'");
  expect(runtimes.map(r => r.id)).toContain('runtime:opencode');

  const edges = rows(db, `SELECT to_capability t FROM dependencies
                          WHERE from_capability = 'runtime:opencode'`);
  expect(edges.map(e => e.t)).toContain('mcp:git');
});

test('two runtimes providing the same capability share one node', () => {
  // Ids deliberately collide: a git MCP under either runtime is one capability
  // with two providers, and the runtime edges are what keep that legible.
  seed({ mcp: { git: {}, exa: {} } }).close();
  const dbPath = join(dir, 'graph.db');
  writeFileSync(join(dir, 'second.json'), JSON.stringify({ mcp: { git: {}, fetch: {} } }));
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: { ...process.env, OPENCODE_CONFIG: join(dir, 'second.json'), TOOLCHAIN_DB: dbPath,
           AMBIT_RUNTIME: 'hermes',
           CONFIG_MAPPING: JSON.stringify({ config_keys: { mcp: { type: 'mcp' } }, skill_dirs: [] }) },
    stdio: 'ignore',
  });
  const db = new Database(dbPath);

  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'mcp:git'").length).toBe(1);
  const providers = rows(db, `SELECT from_capability f FROM dependencies
                              WHERE to_capability = 'mcp:git' AND description = 'Contributed by runtime'`);
  expect(providers.map(p => p.f).sort()).toEqual(['runtime:hermes', 'runtime:opencode']);
});

test('skills symlinked into a runtime directory are discovered', () => {
  // Dirent.isDirectory() is false for a symlink, which silently skipped every
  // shared skill — the ones two runtimes have in common.
  const shared = join(dir, 'shared-skills');
  const runtime = join(dir, 'runtime-skills');
  mkdirSync(join(shared, 'deploying'), { recursive: true });
  writeFileSync(join(shared, 'deploying', 'SKILL.md'), '# deploying');
  mkdirSync(runtime, { recursive: true });
  symlinkSync(join(shared, 'deploying'), join(runtime, 'deploying'));

  const configPath = join(dir, 'config.json');
  const dbPath = join(dir, 'symlink.db');
  writeFileSync(configPath, JSON.stringify({}));
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: { ...process.env, OPENCODE_CONFIG: configPath, TOOLCHAIN_DB: dbPath,
           CONFIG_MAPPING: JSON.stringify({ config_keys: {}, skill_dirs: [runtime] }) },
    stdio: 'ignore',
  });
  const db = new Database(dbPath);
  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'skill:deploying'").length).toBe(1);
});

// ── Verification, authority, planning ───────────────────────────────────────

test('verification records evidence rather than trusting configuration', () => {
  seed(LOCAL_ONLY).close();
  // shell-execution's declared check is `echo`, so this is deterministic.
  const first = cli('verify', 'shell-execution');
  expect(first.results[0].status).toBe('verified');
  expect(first.results[0].reliability).toBe('1/1');

  // Evidence accumulates: one success is a weaker claim than several.
  cli('verify', 'shell-execution');
  const evidence = cli('verify', 'shell-execution', '--history');
  expect(evidence.length).toBe(2);
  expect(evidence.every((e: any) => e.action === 'verified')).toBe(true);
});

test('a capability with no declared check is not reported as verified', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('verify', 'retrieval');
  expect(r.results[0].status).toBe('unverifiable');
  // And it leaves no evidence, so nothing later mistakes it for a passing run.
  expect(cli('verify', 'retrieval', '--history').length).toBe(0);
});

test('authority is tracked apart from whether a capability is reached', () => {
  seed(LOCAL_ONLY).close();
  const a = cli('authority');
  // Reached and permitted are different claims: shell execution is available
  // on any machine and still should not run unattended.
  expect(a.needs_approval).toContain('Shell Execution');
  expect(a.forbidden).toContain('Secret Management');
  expect(a.autonomous).not.toContain('Shell Execution');
});

test('a runtime that tightens its permissions is not still reported as loose', () => {
  const runtime = (mode: string, note: string) => ({
    mcp: { git: { type: 'local' } },
    authority: { runtime: { execute: mode, note } },
  });
  seed(runtime('autonomous', 'first')).close();
  seed(runtime('forbidden', 'second')).close();

  // `mode` is not part of the authority row's uniqueness key, so an insert that
  // ignores conflicts kept the old one — and the stale direction was the
  // permissive one, which is what this code is meant to rule out by
  // construction: never describe a system as freer to act than the runtime in
  // front of it permits.
  const db = new Database(join(dir, 'graph.db'));
  const grants = rows(db, "SELECT mode, note FROM authority WHERE source LIKE 'runtime:%'");
  expect(grants).toEqual([{ mode: 'forbidden', note: 'second' }]);

  // And a grant the runtime has stopped making disappears rather than lingering.
  db.close();
  seed({ mcp: { git: { type: 'local' } } }).close();
  const after = new Database(join(dir, 'graph.db'));
  expect(rows(after, "SELECT mode FROM authority WHERE source LIKE 'runtime:%'")).toEqual([]);
  // The curated model's grants survive; only the source that re-ran is replaced.
  expect(rows(after, "SELECT COUNT(*) n FROM authority WHERE source = 'techtree'")[0].n)
    .toBeGreaterThan(0);
});

test('a runtime narrows what the model says an action is like in general', () => {
  // File editing is autonomous in the curated model. A runtime that requires
  // approval for everything it executes overrides that, because the runtime is
  // the thing that would actually perform the step.
  seed({
    ...LOCAL_ONLY,
    authority: {
      runtime: { execute: 'confirm', note: 'approvals: manual' },
      scoped: { execute: { mode: 'forbidden', scope: 'scheduled', note: 'cron_mode: deny' } },
    },
  }).close();

  const a = cli('authority');
  const entry = a.detail.find((d: any) => d.id === 'combo:local-runtime' && d.action === 'execute' && !d.scope);
  expect(entry.mode).toBe('confirm');
  expect(entry.sources).toContain('runtime:opencode');
  expect(a.forbidden.some((f: string) => f.endsWith('· scheduled'))).toBe(true);
});

test('the narrower of two disagreeing sources wins', () => {
  seed({
    ...LOCAL_ONLY,
    authority: { capabilities: { 'combo:file-editing': { execute: 'forbidden' } } },
  }).close();

  const a = cli('authority');
  const entry = a.detail.find((d: any) => d.id === 'combo:file-editing' && d.action === 'execute');
  expect(entry.mode).toBe('forbidden');           // not the model's 'autonomous'
  expect(entry.sources).toContain('techtree');
  expect(entry.narrowed_by).toBe('runtime:opencode');
});

test('a capability confers actions, and authority is per action', () => {
  seed({ mcp: { git: { type: 'local' } } }).close();

  const a = cli('authority', 'version-control');
  expect(a.actions).toBe(4);
  // The distinction the coarse node cannot make: reading a repository is not
  // merging to its default branch, and both belong to one reached capability.
  expect(a.exercisable).toContain('act:version-control/read_repository');
  expect(a.needs_approval).toContain('act:version-control/merge_to_default');
  expect(a.exercisable).not.toContain('act:version-control/merge_to_default');
});

test('an action is forbidden even when the capability conferring it is reached', () => {
  const db = seed({ mcp: { postgres: { type: 'local' } } });
  expect(rows(db, "SELECT state FROM capabilities WHERE id = 'combo:data-access'")[0].state)
    .not.toBe('locked');
  db.close();

  const a = cli('authority', 'data-access');
  expect(a.exercisable).toContain('act:data-access/query');
  expect(a.forbidden).toContain('act:data-access/drop_table');
});

test('an action can be planned for, and resolves to the capability conferring it', () => {
  seed({ provider: { acme: { models: { 'fast-1': {} } } } }).close();

  const plan = cli('goal', 'act:data-access/query');
  expect(plan.error).toBeUndefined();
  expect(plan.order.map((o: any) => o.id)).toContain('combo:data-access');
  expect(plan.reachable).toBe(true);

  // Simulating the action moves the frontier by the capability, not by the
  // action — an action is conferred, never separately acquired.
  const sim = cli('goal', 'act:data-access/query', '--simulate');
  expect(sim.acquired.map((c: any) => c.id)).toEqual(['combo:data-access']);
});

test('scope is checked, not just recorded', () => {
  seed({
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    authority: {
      capabilities: {
        'combo:version-control': { execute: { mode: 'confirm', scope: 'repo:owner/name' } },
      },
      scoped: { execute: { mode: 'forbidden', scope: 'repo:other/thing' } },
    },
  }).close();

  // The grant scoped to repo:owner/name covers that repo...
  const covered = cli('authority', 'scope', 'repo:owner/name');
  const vc = covered.grants.find((g: any) => g.name === 'Version Control' && g.scope === 'repo:owner/name');
  expect(vc.covers).toBe(true);

  // ...and the grant scoped elsewhere does not cover a different target.
  const other = cli('authority', 'scope', 'repo:someone/else');
  const scoped = other.grants.find((g: any) => g.scope === 'repo:other/thing');
  expect(scoped.covers).toBe(false);
  expect(other.excluded).toBeGreaterThan(0);

  // Scope is a prefix claim: a branch under the repo is covered by it.
  const branch = cli('authority', 'scope', 'repo:owner/name/feature');
  const vcBranch = branch.grants.find((g: any) => g.name === 'Version Control' && g.scope === 'repo:owner/name');
  expect(vcBranch.covers).toBe(true);
});

test('actions do not inflate leverage or fragility', () => {
  seed({ mcp: { git: { type: 'local' } } }).close();

  // An action has exactly one provider by definition. Reporting each as a
  // single point of failure would bury the ones that are.
  const spof = cli('status').spofs;
  expect(spof.some((s: any) => s.id.startsWith('act:version-control/'))).toBe(false);

  // And a capability must not climb the bottleneck ranking because someone
  // wrote more verbs into its contract.
  const bottlenecks = cli('status').bottlenecks;
  const versionControl = bottlenecks.find((b: any) => b.capability_id === 'combo:version-control');
  if (versionControl) expect(versionControl.unlocks_count).toBeLessThan(4);
});

test('the tree does not detect itself on a re-seed', () => {
  // Contract actions are created by the tree from its own nodes, so leaving
  // them in the pool detection matches against makes a node its own evidence:
  // `act:web-research/search` matches web-research's `search` pattern, and a
  // capability nothing supplies would come up reached on the second run.
  const config = { provider: { acme: { models: { 'fast-1': {} } } } };
  seed(config).close();
  const db = seed(config);

  const selfProved = rows(db, `
    SELECT d.from_capability f, d.to_capability t FROM dependencies d
    JOIN capabilities c ON c.id = d.from_capability
    WHERE c.kind = 'action' AND d.to_capability LIKE 'combo:%'`);
  expect(selfProved).toEqual([]);
  expect(rows(db, "SELECT state FROM capabilities WHERE id = 'combo:web-research'")[0].state)
    .toBe('locked');
});

test('an action a person supplies is still a single point of failure', () => {
  // One provider is definitional for a conferred action and a real finding for
  // a supplied one: only that person can do it.
  seed({
    mcp: { git: { type: 'local' } },
    actors: { kanav: { name: 'Kanav', provides: ['physical-access'] } },
  }).close();

  const spof = cli('status').spofs;
  expect(spof.some((s: any) => s.id === 'act:physical-access')).toBe(true);
});

test('lifecycle separates configured from verified from reliable', () => {
  seed(LOCAL_ONLY).close();
  const lifecycle = (id: string) => {
    const db = new Database(join(dir, 'graph.db'));
    const row = rows(db, `SELECT lifecycle FROM capabilities WHERE id = 'combo:${id}'`)[0];
    db.close();
    return row?.lifecycle;
  };

  // Reached, with nothing run against it. Configured is not working.
  expect(lifecycle('shell-execution')).toBe('configured');

  cli('verify', 'shell-execution');
  expect(lifecycle('shell-execution')).toBe('verified');

  // Five passing runs is a different claim from one.
  for (let i = 0; i < 4; i++) cli('verify', 'shell-execution');
  expect(lifecycle('shell-execution')).toBe('reliable');

  // Nothing supplies it and it is not reachable — not the same as untested.
  expect(lifecycle('secret-management')).toBe('unknown');
});

test('a failing check breaks the capability rather than being reported alongside it', () => {
  seed(LOCAL_ONLY).close();
  cli('verify', 'shell-execution');

  // Stand in for a check that has started failing.
  const db = new Database(join(dir, 'graph.db'));
  db.prepare(`INSERT INTO session_learning (session_id, capability_id, action, outcome_score)
              VALUES ('verify', 'combo:shell-execution', 'failed', 0)`).run();
  db.close();

  // Verifying something else recomputes every lifecycle without adding a run
  // to this one — retrieval declares no check, so it records nothing.
  cli('verify', 'retrieval');
  const after = new Database(join(dir, 'graph.db'));
  expect(rows(after, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle)
    .toBe('broken');
  // And the frontier still has it: reachable and broken are different columns.
  expect(rows(after, "SELECT state FROM capabilities WHERE id = 'combo:shell-execution'")[0].state)
    .not.toBe('locked');
});

// ── The lifecycle gates availability ─────────────────────────────────────────

/** Record a verification outcome the way tt verify would, without running it. */
function recordVerification(id: string, outcome: 'verified' | 'failed') {
  const db = new Database(join(dir, 'graph.db'));
  db.prepare("INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, 'recorded by test')")
    .run(id, outcome, outcome === 'verified' ? 1 : 0);
  db.close();
}

test('a broken capability stops reading as available', () => {
  seed(LOCAL_ONLY).close();
  // Shell Execution was reachable. Its check now fails, and the lifecycle gate
  // must stop every decision surface from relying on it — configured is not
  // working, and this is the case the model previously misrepresented.
  recordVerification('combo:shell-execution', 'failed');
  seed(LOCAL_ONLY).close(); // same config; the gate reads the recorded evidence

  const db = new Database(join(dir, 'graph.db'));
  expect(rows(db, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle)
    .toBe('broken');
  db.close();

  // A plan refuses to treat it as an acquisition.
  const p = cli('goal', 'shell-execution');
  expect(p.degraded).toBe(true);
  expect(p.reachable).toBe(false);
  expect(p.note).toContain('re-verify');

  // Authority: it is not in the available half of the report whatever its
  // permission says — permission and a broken implementation are two different
  // reasons it cannot run.
  const a = cli('authority');
  expect(a.detail.find((r: any) => r.name === 'Shell Execution')?.reached).toBe(false);
  expect(a.needs_approval).not.toContain('Shell Execution');

  // A simulation of something built on it says why it will not cascade.
  const sim = cli('goal', 'version-control', '--simulate');
  expect(sim.blocked_by_degraded.map((b: any) => b.id)).toContain('combo:version-control');
});

test('a re-passing verification releases the gate', () => {
  seed(LOCAL_ONLY).close();
  recordVerification('combo:shell-execution', 'failed');
  recordVerification('combo:shell-execution', 'verified');
  seed(LOCAL_ONLY).close();

  // One pass after a failure is a weaker claim than a clean record: the
  // lifecycle moves broken → degraded, and the gate stays closed.
  const db = new Database(join(dir, 'graph.db'));
  expect(rows(db, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle)
    .toBe('degraded');
  db.close();
  expect(cli('goal', 'shell-execution').reachable).toBe(false);

  // Five consecutive passes are a different claim, and the gate opens.
  for (let i = 0; i < 4; i++) recordVerification('combo:shell-execution', 'verified');
  seed(LOCAL_ONLY).close();

  const after = new Database(join(dir, 'graph.db'));
  expect(rows(after, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle)
    .toBe('reliable');
  after.close();
  const p = cli('goal', 'shell-execution');
  expect(p.reachable).toBe(true);
  expect(p.degraded).toBeUndefined();
});

test('a plan names a degraded prerequisite as broken, not missing', () => {
  seed(LOCAL_ONLY).close();
  // Local Embeddings is still locked (Embeddings is missing) and requires
  // Local Runtime, which declares a check. Break the prerequisite: the plan
  // must say "re-verify this", not "add this".
  recordVerification('combo:local-runtime', 'failed');
  seed(LOCAL_ONLY).close();

  const p = cli('goal', 'local-embeddings');
  expect(p.degraded.map((d: any) => d.name)).toContain('Local Runtime');
  expect(p.order.map((o: any) => o.id)).not.toContain('combo:local-runtime'); // not something to acquire
  expect(p.note).toContain('failing verification');
});

test('the ledger records demonstrated reliability beside reach', () => {
  seed(LOCAL_ONLY).close();
  // One passing run makes shell-execution verified — a different claim from
  // merely reachable, and the ledger has to be able to show that over time.
  cli('verify', 'shell-execution');
  seed(PLUS_EMBEDDINGS).close(); // a state change forces the next observation

  const ledger = cli('history');
  expect(ledger.length).toBe(2);
  expect(ledger[0].verified).toBe(0); // before anything had passed a check
  expect(ledger[1].verified).toBe(1); // shell-execution is now demonstrated
});

test('since reports a capability that stopped working', () => {
  seed(LOCAL_ONLY).close();
  recordVerification('combo:shell-execution', 'failed');
  seed(LOCAL_ONLY).close();

  const since = cli('history', 'since');
  // Structural reach did not move — nothing was removed — but the capability
  // stopped being usable, and the ledger has to say so.
  expect(since.frontier_now).toBe(since.frontier_then);
  expect(since.diminished.map((d: any) => d.id)).toContain('combo:shell-execution');
  expect(since.diminished.find((d: any) => d.id === 'combo:shell-execution').reason).toContain('verification');
  expect(since.verified_now).toBe(0);
});

test('planning orders the prerequisites of an unreached capability', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('goal', 'offline-capable');
  expect(p.steps).toBeGreaterThan(0);
  const order = p.order.map((o: any) => o.id);
  // Embeddings gates Local Embeddings, so it has to come first.
  expect(order.indexOf('combo:embeddings')).toBeLessThan(order.indexOf('combo:local-embeddings'));
  expect(p.estimated_setup).toMatch(/\d+(m|\.\dh)/);
});

test('planning a capability already reached says so instead of inventing steps', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('goal', 'shell-execution');
  expect(p.reachable).toBe(true);
  expect(p.missing).toEqual([]);
});

test('a flag is not mistaken for a command argument', () => {
  // `tt verify --json` looked for a capability named "--json"; every command
  // taking both an argument and a flag inherited that.
  seed(LOCAL_ONLY).close();
  const all = cli('verify');
  expect(all.checked).toBeGreaterThan(1);
  expect(all.error).toBeUndefined();
});

// ── Per-action verification (§3) ─────────────────────────────────────────────

test('a contract action can declare a check of its own', () => {
  seed(LOCAL_ONLY).close();
  // commit_changes declares a check in the curated model. Verifying it runs
  // that check against the action node, not the capability's — a different
  // claim at a different granularity. (This test runs in a non-repo temp dir,
  // so the check fails honestly; what is being asserted is that it ran.)
  const r = cli('verify', 'act:version-control/commit_changes');
  expect(r.checked).toBe(1);
  expect(r.results[0].id).toBe('act:version-control/commit_changes');
  expect(r.results[0].status).toMatch(/verified|failed/);

  // Evidence landed against the action, reachable by its own id.
  const evidence = cli('verify', 'act:version-control/commit_changes', '--history');
  expect(evidence.length).toBe(1);
  expect(evidence[0].action).toMatch(/verified|failed/);
});

// ── People ──────────────────────────────────────────────────────────────────

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

test('people are nodes, and what they supply becomes a capability', () => {
  const db = seed(WITH_PEOPLE);
  const person = rows(db, "SELECT id, category, state FROM capabilities WHERE id = 'human:kanav'");
  expect(person[0]?.category).toBe('human');

  const supplied = rows(db, "SELECT id FROM capabilities WHERE category = 'human-action'").map(r => r.id);
  expect(supplied).toContain('act:physical-access');

  const edges = rows(db, `SELECT to_capability t FROM dependencies
                          WHERE from_capability = 'human:kanav' AND description = 'Supplied by a person'`);
  expect(edges.map(e => e.t)).toContain('act:physical-access');
});

test('approval is a dependency, not a policy note', () => {
  const db = seed(WITH_PEOPLE);
  const gated = rows(db, `SELECT from_capability f FROM dependencies
                          WHERE to_capability = 'combo:continuous-delivery'
                          AND description = 'Requires approval from a person'`);
  expect(gated.map(g => g.f)).toContain('human:kanav');
});

test('a plan names the person a step depends on', () => {
  seed(WITH_PEOPLE).close();
  const plan = cli('goal', 'continuous-delivery');
  // A plan that hides the human step reads as autonomous when it is not.
  expect(plan.requires_person).toContain('Kanav');
});

test('authorizing a capability that does not exist leaves no dangling edge', () => {
  const db = seed({
    provider: { acme: {} },
    actors: { sam: { name: 'Sam', authorizes: ['combo:nonexistent'] } },
  });
  const dangling = rows(db, `SELECT d.to_capability t FROM dependencies d
                             LEFT JOIN capabilities c ON c.id = d.to_capability
                             WHERE c.id IS NULL`);
  expect(dangling).toEqual([]);
});

test('a plan step offers alternatives with their trade-offs', () => {
  seed(LOCAL_ONLY).close();
  const plan = cli('goal', 'offline-capable');
  const embeddings = plan.order.find((o: any) => o.id === 'combo:embeddings');
  expect(embeddings?.options?.length).toBeGreaterThan(1);
  // The trade-off is rarely setup time alone; a faster hosted option costs
  // money and moves data, and the plan has to say so.
  const hosted = embeddings.options.find((o: any) => o.privacy === 'hosted');
  const local = embeddings.options.find((o: any) => o.privacy === 'local');
  expect(hosted.setup_seconds).toBeLessThan(local.setup_seconds);
  expect(hosted.recurring_cost).not.toBe('none');
});

// ── Preferences and machines (§2) ────────────────────────────────────────────

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

test('a person can declare how they prefer things done', () => {
  const db = seed(WITH_PREFS);
  const prefs = rows(db, `SELECT preference FROM preferences WHERE actor_id = 'human:kanav'`).map(r => r.preference);
  expect(prefs.sort()).toEqual(['local-when-practical', 'minimize-recurring-cost']);

  db.close();
  const report = cli('goal', '--prefs', 'kanav');
  expect(report.name).toBe('Kanav');
  expect(report.preferences).toContain('local-when-practical');
});

test('a plan names where a step fights a person\'s stated preferences', () => {
  // Continuous Delivery needs Kanav's approval, and its default acquisition
  // alternative is hosted and recurring. A plan that asks the person without
  // noting the conflict reads as if the choice is theirs when the default is
  // already the thing they said they'd avoid.
  seed(WITH_PREFS).close();
  const plan = cli('goal', 'continuous-delivery');
  expect(plan.requires_person).toContain('Kanav');
  const conflicting = (plan.order || []).find((s: any) => s.preference_conflicts?.length);
  expect(conflicting).toBeDefined();
  expect(conflicting.preference_conflicts.join(' ')).toMatch(/hosted/);
});

test('infrastructure manifest devices seed as capability-bearing resources', () => {
  const dirPath = dir;
  writeFileSync(join(dirPath, 'infra.json'), JSON.stringify({
    devices: [{ id: 'nuc', name: 'NUC', description: 'homelab host' }],
    services: [{ key: 'ollama', label: 'Ollama', host: 'nuc' }],
  }));
  // Re-seed the same graph with the manifest on the INFRA_MANIFEST path.
  const dbPath = join(dirPath, 'graph.db');
  const configPath = join(dirPath, 'config.json');
  writeFileSync(configPath, JSON.stringify(WITH_PREFS));
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: { ...process.env, OPENCODE_CONFIG: configPath, TOOLCHAIN_DB: dbPath,
           INFRA_MANIFEST: join(dirPath, 'infra.json'),
           CONFIG_MAPPING: JSON.stringify({ config_keys: { mcp: { type: 'mcp', domain_field: 'type', domain_map: { remote: 'backend', local: 'infra' }, desc_template: '{type} server' }, agent: { type: 'agent', domain: 'meta', desc_field: 'description' }, provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' }, command: { type: 'tool', domain: 'devops', desc_field: 'description' } }, skill_dirs: [] }) },
    stdio: 'ignore',
  });
  const db = new Database(dbPath);
  const device = rows(db, "SELECT id, kind FROM capabilities WHERE id = 'device:nuc'");
  expect(device[0]?.kind).toBe('resource');

  // The device runs the service, so losing it takes the service down.
  const runs = rows(db, `SELECT from_capability f FROM dependencies WHERE to_capability = 'svc:ollama' AND kind = 'runs_on'`);
  expect(runs.map(r => r.f)).toContain('device:nuc');
});

// ── Affordance domains (§7b) ─────────────────────────────────────────────────

test('institutional and economic domains are derived from structure, not pasted on', () => {
  // Kanav authorises Continuous Delivery, so it needs an authority holder to be
  // acquirable — institutional. Its acquisition has a recurring option, so it
  // implies a budget and a counterparty — economic. One capability, two
  // structural domains, both named.
  seed(WITH_PREFS).close();
  const report = cli('graph', 'affordances');
  const cd = report.capabilities.find((c: any) => c.name === 'Continuous Delivery');
  expect(cd).toBeDefined();
  expect(cd.domain).toBe('institutional');
  expect(cd.structure).toContain('institutional');
  expect(cd.structure).toContain('economic');

  // A capability with no authority holder and only a one-off acquisition stays
  // in its declared domain — no structure, no reclassification.
  const shell = report.capabilities.find((c: any) => c.name === 'Shell Execution');
  expect(shell).toBeUndefined();
});

// ── Capability surface (§8) ──────────────────────────────────────────────────

test('tt surface emits the vocabulary a runtime would own', () => {
  seed(WITH_PREFS).close();
  const out = execFileSync('node', ['--experimental-sqlite', ENGINE, 'graph', 'surface'], {
    env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db'), OPENCODE_CONFIG: join(dir, 'config.json') },
    encoding: 'utf8',
  });
  const surface = JSON.parse(out);
  expect(surface.schema_version).toBe(1);
  expect(surface.runtime).toBe('opencode');

  // The surface is vocabulary, not state: every node by kind, every edge by
  // meaning, every authority grant — nothing about reached or locked.
  const kinds = new Set(surface.capabilities.map((c: any) => c.kind));
  expect(kinds.has('capability')).toBe(true);
  expect(kinds.has('provider')).toBe(true);
  expect(kinds.has('actor')).toBe(true);
  expect(surface.edges.length).toBeGreaterThan(0);
  expect(surface.authority.length).toBeGreaterThan(0);
  // No state column leaks into the export.
  expect(JSON.stringify(surface)).not.toMatch(/"state"/);
});

// ── Human attention digest (ntfy / §loop) ────────────────────────────────────

/** Record a human act the way the engine would. */
function recordHumanAct(session: string, capId: string, action: string) {
  const db = new Database(join(dir, 'graph.db'));
  db.prepare("INSERT INTO session_learning (session_id, capability_id, action, outcome_score) VALUES (?, ?, ?, 1)")
    .run(session, capId, action);
  db.close();
}

test('the digest counts human interventions and names the reducible ones', () => {
  seed(WITH_PREFS).close();
  // The same approval twice is a recurring human demand — infrastructure shaped
  // like a person, which is the whole point of counting interventions.
  recordHumanAct('approval', 'human:kanav', 'approved');
  recordHumanAct('approval', 'human:kanav', 'approved');

  const d = cli('attention');
  expect(d.interventions).toBe(2);
  expect(d.reducible.length).toBe(1);
  expect(d.reducible[0].kind).toBe('approval');
  expect(d.reducible[0].suggested_fix).toMatch(/grant bounded authority/);
});

test('a one-off intervention is recorded but not called reducible', () => {
  seed(WITH_PREFS).close();
  recordHumanAct('approval', 'human:kanav', 'approved');

  const d = cli('attention');
  expect(d.interventions).toBe(1);
  expect(d.reducible).toBeUndefined();
});

test('the digest reports a broken capability separately from reducible friction', () => {
  seed(WITH_PREFS).close();
  // Two failed verifications on the same capability are a repair problem, not
  // an authority problem — the fix is fixing the capability, not granting
  // permission.
  recordHumanAct('verify', 'combo:shell-execution', 'failed');
  recordHumanAct('verify', 'combo:shell-execution', 'failed');

  const d = cli('attention');
  expect(d.broken.length).toBe(1);
  expect(d.broken[0].capability).toBe('Shell Execution');
  expect(d.reducible).toBeUndefined();
});

test('ntfy is opt-in — nothing is pushed without a topic', async () => {
  seed(WITH_PREFS).close();
  const r = cli('notify');
  expect(r.error).toContain('Usage');
});

// ── Deficits ────────────────────────────────────────────────────────────────

test('a repeated deficit is distinguished from incidental friction', () => {
  seed(LOCAL_ONLY).close();
  const once = cli('record', 'vector-store');
  expect(once.times_blocked).toBe(1);
  expect(once.note).toBeUndefined(); // one failure is bad luck

  cli('record', 'vector-store');
  const third = cli('record', 'vector-store');
  expect(third.times_blocked).toBe(3);
  expect(third.note).toContain('structural');

  const report = cli('status').deficits;
  expect(report[0].id).toBe('combo:vector-store');
  expect(report[0].verdict).toContain('structural');
  expect(report[0].still_missing).toBe(true);
});

test('a deficit records why it was blocked, and the cause recurs separately', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'vector-store', 'tool', 'semantic search over notes');
  expect(r.classification).toBe('tool');
  expect(r.times_as_this_class).toBe(1);

  // The same capability blocked for a different reason is a different signal:
  // the capability recurs, but not as one structural cause.
  cli('record', 'vector-store', 'permission');
  const report = cli('status').deficits;
  expect(report[0].id).toBe('combo:vector-store');
  expect(report[0].causes).toContain('tool ×1');
  expect(report[0].causes).toContain('permission ×1');
});

test('an unknown classification is treated as a note, not a class', () => {
  // `tt failed <cap> "what you were doing"` predates classification; the second
  // positional that is not a known class must remain the note.
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'vector-store', 'just keep hitting the same wall');
  expect(r.classification).toBe('unclassified');
  expect(r.times_blocked).toBe(1);
});

test('a deficit against an unknown capability is refused, not silently kept', () => {
  // Otherwise deficits accumulate against ids nothing can act on.
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'not-a-capability');
  expect(r.error).toContain('No capability');
  expect(cli('status').deficits.note).toContain('Nothing recorded');
});

// ── Substitutability ────────────────────────────────────────────────────────

const TWO_PROVIDERS = {
  mcp: { git: {}, github: {} },          // both provide Version Control
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
};

test('losing one of several providers is not a critical loss', () => {
  const db = seed(TWO_PROVIDERS);
  const providers = rows(db, `SELECT from_capability f FROM dependencies
                              WHERE to_capability = 'combo:version-control'
                              AND description = 'Provides this capability'`);
  expect(providers.length).toBeGreaterThan(1);
  db.close();

  const impact = cli('impact', 'mcp:github');
  const vc = impact.combos_at_risk.find((c: any) => c.name === 'Version Control');
  // Previously reported critical — every provider was treated as the only one.
  expect(vc.severity).not.toBe('critical');
  expect(vc.also_provided_by).toBeGreaterThan(0);
});

test('a capability is reported once, not once per edge', () => {
  seed(TWO_PROVIDERS).close();
  const impact = cli('impact', 'mcp:github');
  const names = impact.combos_at_risk.map((c: any) => c.name);
  expect(new Set(names).size).toBe(names.length);
});

test('losing the only provider is critical', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const impact = cli('impact', 'mcp:git');
  const vc = impact.combos_at_risk.find((c: any) => c.name === 'Version Control');
  expect(vc.severity).toBe('critical');
  expect(vc.also_provided_by).toBeUndefined();
});

test('single points of failure are distinguished from high-leverage capabilities', () => {
  seed(TWO_PROVIDERS).close();
  const spof = cli('status').spofs;
  const ids = Array.isArray(spof) ? spof.map((s: any) => s.id) : [];
  // Version Control has two providers, so it is not a single point of failure
  // however much depends on it — which is what bottlenecks measures instead.
  expect(ids).not.toContain('combo:version-control');
});

// ── Proposals and simulation ────────────────────────────────────────────────

test('simulation reports what comes with an acquisition, not just the acquisition', () => {
  seed(LOCAL_ONLY).close();
  // A capability already provided but held back by a prerequisite should
  // appear once that prerequisite is satisfied — that cascade is the reason
  // to read a preview before approving.
  const sim = cli('goal', 'embeddings', '--simulate');
  expect(sim.frontier_after).toBeGreaterThan(sim.frontier_before);
  expect(sim.acquired.map((a: any) => a.id)).toContain('combo:embeddings');
});

test('simulation does not conjure capabilities nothing provides', () => {
  seed(LOCAL_ONLY).close();
  const sim = cli('goal', 'embeddings', '--simulate');
  // Satisfying prerequisites is not enough; something must supply it.
  const unblockedIds = sim.unblocked.map((u: any) => u.id);
  for (const id of unblockedIds) {
    expect(id).not.toBe('combo:self-hosted-stack');
  }
});

test('a proposal records the chosen alternative and its trade-off', () => {
  seed(LOCAL_ONLY).close();
  const local = cli('propose', 'retrieval');
  const embeddings = local.steps.find((s: any) => s.id === 'combo:embeddings');
  expect(embeddings.chosen).toContain('local');
  expect(embeddings.privacy).toBe('local');
});

test('a proposal cannot execute, and says why', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('propose', 'retrieval');
  expect(p.executable).toBe(false);
  // The inverse is the gate: no step runs without one, so an unpopulated
  // inverse is what makes a future apply refuse this proposal.
  for (const step of p.steps) expect(step.inverse).toBeNull();
});

test('proposals persist and are retrievable', () => {
  seed(LOCAL_ONLY).close();
  const created = cli('propose', 'retrieval');
  const listed = cli('proposals');
  expect(listed.map((r: any) => r.id)).toContain(created.proposal);

  const fetched = cli('proposal', created.proposal);
  expect(fetched.goal).toBe('Retrieval');
  expect(fetched.status).toBe('draft');
  expect(fetched.simulated.frontier_after).toBeGreaterThan(0);
});

test('proposing something already reached says so instead of inventing steps', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('propose', 'shell-execution');
  expect(p.note).toContain('Already reached');
});

test('plan returns the same shape whether or not there is work to do', () => {
  // A caller should not have to special-case the already-reached branch; a
  // guard on `steps === 0` failed silently when the field was simply absent.
  seed(LOCAL_ONLY).close();
  const done = cli('goal', 'shell-execution');
  const todo = cli('goal', 'offline-capable');
  for (const key of ['goal', 'reachable', 'steps', 'order']) {
    expect(done).toHaveProperty(key);
    expect(todo).toHaveProperty(key);
  }
});

// ── Inverses and approval ───────────────────────────────────────────────────

test('a plan includes the goal itself', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  // Excluding it meant a capability whose prerequisites were already met
  // produced an empty plan — nothing to do, for the case where the one thing
  // to do is acquire it.
  const plan = cli('goal', 'web-research');
  expect(plan.steps).toBe(1);
  expect(plan.order[0].id).toBe('combo:web-research');
});

test('the goal comes last, after what it depends on', () => {
  seed(LOCAL_ONLY).close();
  const plan = cli('goal', 'offline-capable');
  expect(plan.order[plan.order.length - 1].id).toBe('combo:offline-capable');
});

test('a declarative acquisition gets an inverse; others are refused one', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const declarative = cli('propose', 'web-research');
  expect(declarative.steps[0].inverse).not.toBeNull();
  expect(declarative.applicable).toBe(true);

  // Nothing is applicable when a step cannot be undone.
  const withInstaller = cli('propose', 'offline-capable');
  expect(withInstaller.applicable).toBe(false);
  expect(withInstaller.steps.some((s: any) => s.inverse === null)).toBe(true);
});

test('applicable and executable are different claims', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const p = cli('propose', 'web-research');
  // Safe to apply if apply existed; apply does not exist.
  expect(p.applicable).toBe(true);
  expect(p.executable).toBe(false);
});

test('approval must name someone accountable in the graph', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  const ghost = cli('approve', p.proposal, 'nobody');
  expect(ghost.error).toContain('not a person in the graph');
});

test('approval is recorded as evidence, not a flag', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  const ok = cli('approve', p.proposal, 'kanav');
  expect(ok.approved_by).toBe('Kanav');

  // Recorded against the person, so the ledger can later answer who
  // authorised a given expansion of the frontier.
  const evidence = cli('verify', 'human:kanav', '--history');
  expect(evidence.length).toBe(0); // evidence() filters to verification actions
  const stored = cli('proposal', p.proposal);
  expect(stored.status).toBe('approved');
  expect(stored.approved_by).toBe('human:kanav');
});

test('a proposal cannot be approved twice', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const again = cli('approve', p.proposal, 'kanav');
  expect(again.error).toContain('already approved');
});

// ── Apply ───────────────────────────────────────────────────────────────────

const APPLIABLE = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { git: {} },
  actors: { kanav: { name: 'Kanav' } },
};

/** The config this test's engine reads and writes. */
const readConfig = () => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));

test('apply refuses a proposal no person has approved', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const refused = cli('apply', p.proposal);
  expect(refused.error).toContain('approve');
  // And nothing was written.
  expect(Object.keys(readConfig().mcp)).toEqual(['git']);
});

test('apply refuses anything that cannot be undone', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'offline-capable'); // steps need installers, not config
  cli('approve', p.proposal, 'kanav');
  const refused = cli('apply', p.proposal);
  expect(refused.error).toContain('inverse');
});

test('an approved config change is applied, and backed up first', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const result = cli('apply', p.proposal);

  expect(result.applied).toBe(true);
  expect(readConfig().mcp).toHaveProperty('fetch');
  expect(existsSync(result.backup)).toBe(true);
});

test('an apply re-seeds, so the graph reflects the change immediately', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  // Before the apply, the graph has not seen the fetch MCP server.
  const db = new Database(join(dir, 'graph.db'));
  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'mcp:fetch'")).toEqual([]);
  db.close();

  cli('apply', p.proposal);

  // After the apply, no manual re-seed needed: the graph knows it now.
  const after = new Database(join(dir, 'graph.db'));
  expect(rows(after, "SELECT id FROM capabilities WHERE id = 'mcp:fetch'").length).toBe(1);
});

test('rollback reverses exactly what was applied', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);
  const before = Object.keys(readConfig().mcp);
  expect(before).toContain('fetch');

  const undo = cli('rollback', p.proposal);
  expect(undo.rolled_back).toBe(true);
  // git survives: the inverse describes only what this proposal changed, so a
  // rollback cannot discard edits made since.
  expect(Object.keys(readConfig().mcp)).toEqual(['git']);
});

test('applying twice is refused', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);
  expect(cli('apply', p.proposal).error).toContain('already applied');
});

test('every act is recorded against the person who authorised it', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);

  const db = new Database(join(dir, 'graph.db'));
  const acts = rows(db, `SELECT action, capability_id FROM session_learning
                         WHERE session_id IN ('approval','apply') ORDER BY id`);
  expect(acts.map(a => a.action)).toEqual(['approved', 'applied']);
  expect(acts.every(a => a.capability_id === 'human:kanav')).toBe(true);
});

// ── Free-form goals (§5) ─────────────────────────────────────────────────────

test('a free-form goal routes to the capabilities whose words cover it', () => {
  seed(LOCAL_ONLY).close();
  // The roadmap's example sentence. The vocabulary has to catch "homelab",
  // "unattended" and "maintain" and rank by how much of the goal is covered.
  const g = cli('goal', 'maintain the homelab unattended');
  expect(g.error).toBeUndefined();
  const ids = g.candidates.map((c: any) => c.id);
  expect(ids).toContain('combo:self-hosted-stack');
  expect(ids).toContain('combo:scheduled-work');
  expect(ids).toContain('combo:observability');
  // Each candidate carries its plan delta, so the shortlist is also a plan.
  const selfHosted = g.candidates.find((c: any) => c.id === 'combo:self-hosted-stack');
  expect(selfHosted.matched_phrases).toContain('homelab');
  expect(selfHosted.steps).toBeDefined();
});

test('a goal that is already a capability plans directly', () => {
  seed(LOCAL_ONLY).close();
  const g = cli('goal', 'shell-execution');
  expect(g.exact).toBe(true);
  expect(g.reachable).toBe(true);
});

test('an unrecognised goal says so instead of inventing a plan', () => {
  seed(LOCAL_ONLY).close();
  const g = cli('goal', 'teleport myself to mars');
  expect(g.candidates).toEqual([]);
  expect(g.note).toContain('No capability');
});

test('paths compares alternatives by risk and lock-in', () => {
  seed(APPLIABLE).close();
  // Web Research's only declared acquisition is a config change, so the path
  // to it is reversible — §10 could undo it — and local with no bill.
  const paths = cli('goal', 'web-research', '--paths');
  expect(paths.goal).toBe('Web Research');
  expect(paths.paths).toBeGreaterThan(0);
  const p = paths.options[0];
  expect(p.privacy).toBe('local');
  expect(p.lock_in).toContain('reversible');
  expect(p.risk).toBe('low');
});

test('paths does not claim an already-reached capability needs closing', () => {
  seed(APPLIABLE).close();
  const paths = cli('goal', 'shell-execution', '--paths');
  expect(paths.note).toContain('already reached');
});

// ── Work ledger (the operating half) ─────────────────────────────────────────

test('a run records events, interventions, usage and an outcome', () => {
  seed(LOCAL_ONLY).close();
  // The recorder is driver-agnostic (migrate.ts's surface); bun:sqlite's
  // `all()` returns (Record | undefined)[] where the interface says Record[],
  // so the handle is cast the same way the migration tests cast theirs.
  const db = new Database(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];

  const b = beginRun(db, { goal: 'recover production service', runType: 'incident' });
  addEvent(db, b.run, { kind: 'detected', actor: 'monitoring', detail: 'service down' });
  addEvent(db, b.run, { kind: 'diagnosed', actor: 'agent', capabilityId: 'combo:observability', action: 'diagnose' });
  recordUse(db, b.run, 'combo:observability', { durationSeconds: 120 });
  recordIntervention(db, b.run, 'human:kanav', {
    kind: 'authority', capabilityId: 'combo:shell-execution', action: 'restart',
    startedAt: new Date(Date.now() - 90 * 1000).toISOString(), endedAt: new Date().toISOString(),
    waitingSeconds: 60,
  });
  recordResource(db, b.run, 'provider:acme', 'api', { quantity: 42, unit: 'tokens', costCents: 12 });
  recordOutcome(db, b.run, 'service restored', { objectiveMetric: 240, objectiveName: 'mttr_seconds' });
  endRun(db, b.run, 'success', 5000);

  const work = workReport(db, 5);
  expect(work.length).toBe(1);
  const r = work[0];
  expect(r.goal).toBe('recover production service');
  expect(r.outcome).toBe('success');
  expect(r.events).toBe(2);
  expect(r.capabilities).toHaveLength(1);
  expect(r.capabilities[0].capability).toBe('Observability');
  expect(r.interventions[0].kind).toBe('authority');
  expect(r.interventions[0].times).toBe(1);
  expect(r.resources[0].cost_cents).toBe(12);
  expect(r.achieved).toBe('service restored');
  expect(r.objective_name).toBe('mttr_seconds');
  expect(r.elapsed_seconds).toBeGreaterThanOrEqual(0);

  const usage = usageReport(db, 30);
  const obs = usage.find((u: any) => u.capability === 'Observability');
  expect(obs.times).toBe(1);
  expect(obs.duration_seconds).toBe(120);
  (db as any).close();
});

test('a run without an end is open and reports no outcome', () => {
  seed(LOCAL_ONLY).close();
  const db = new Database(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];
  const b = beginRun(db, { goal: 'long task', runType: 'task' });
  const work = workReport(db, 5);
  expect(work[0].goal).toBe('long task');
  expect(work[0].outcome).toBeUndefined();
  expect(endRun(db, 'nope', 'success').error).toContain('No run');
  (db as any).close();
});

test('a run records no capability state — the ledger observes, it does not reach', () => {
  seed(LOCAL_ONLY).close();
  const db = new Database(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];
  const b = beginRun(db, { goal: 'observe only' });
  recordUse(db, b.run, 'combo:shell-execution', { durationSeconds: 5 });
  endRun(db, b.run, 'success');
  (db as any).close();

  const reopened = new Database(join(dir, 'graph.db'));
  const state = rows(reopened, "SELECT state FROM capabilities WHERE id = 'combo:shell-execution'")[0].state;
  expect(state).toBe('unlocked'); // seed made it reachable; the run changed nothing
  reopened.close();
});

// ── Human-agency accounting (WP-3) ───────────────────────────────────────────

test('attention classifies agency: judgment is kept, clerical is reducible', () => {
  seed(LOCAL_ONLY).close();
  const db = new Database(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];

  // Judgment, twice — the human's reason for being there. Never reducible.
  const r1 = beginRun(db, { goal: 'architect the migration' });
  recordIntervention(db, r1.run, 'human:kanav', { kind: 'judgment', capabilityId: 'combo:web-research', activeSeconds: 600 });
  recordIntervention(db, r1.run, 'human:kanav', { kind: 'judgment', capabilityId: 'combo:web-research', activeSeconds: 300 });

  // Clerical, three times across two runs — the human is the duct.
  const r2 = beginRun(db, { goal: 'move data between systems' });
  recordIntervention(db, r1.run, 'human:kanav', { kind: 'clerical', capabilityId: 'combo:data-access', activeSeconds: 120, waitingSeconds: 900 });
  recordIntervention(db, r2.run, 'human:kanav', { kind: 'clerical', capabilityId: 'combo:data-access', activeSeconds: 90, waitingSeconds: 300 });
  recordIntervention(db, r2.run, 'human:kanav', { kind: 'clerical', capabilityId: 'combo:data-access', activeSeconds: 60, waitingSeconds: 600 });
  (db as any).close();

  const d = cli('attention');
  const judgment = d.keepers.find((k: any) => k.kind === 'judgment');
  expect(judgment.times).toBe(2);
  // Reducible never contains judgment, however often it recurs.
  expect(d.reducible?.some((r: any) => r.kind === 'judgment')).toBeFalsy();

  const clerical = d.reducible.find((r: any) => r.kind === 'clerical');
  expect(clerical.times).toBe(3);
  expect(clerical.active_seconds).toBe(270);
  expect(clerical.waiting_seconds).toBe(1800);
  expect(clerical.runs_affected).toBe(2); // two distinct runs hit the same duct
  expect(clerical.suggested_fix).toMatch(/mechanical/);
});

test('attention reports aggregate active and waiting time', () => {
  seed(LOCAL_ONLY).close();
  const db = new Database(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'restart service' });
  recordIntervention(db, r.run, 'human:kanav', { kind: 'authority', capabilityId: 'combo:shell-execution', activeSeconds: 30, waitingSeconds: 120 });
  recordIntervention(db, r.run, 'human:kanav', { kind: 'authority', capabilityId: 'combo:shell-execution', activeSeconds: 20, waitingSeconds: 60 });
  (db as any).close();

  const d = cli('attention');
  expect(d.active_seconds).toBe(50);
  expect(d.waiting_seconds).toBe(180);
});

// ── Economic model (WP-4) ────────────────────────────────────────────────────

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

test('economics and goals seed from the config, stored as cents', () => {
  seed(WITH_ECONOMICS).close();
  const db = new Database(join(dir, 'graph.db'));
  const attention = rows(db, `SELECT value_cents, period FROM economics WHERE entity_id = 'human:kanav' AND metric = 'attention_value_per_hour'`);
  expect(attention[0].value_cents).toBe(25000);
  expect(attention[0].period).toBe('per_hour');

  const recurring = rows(db, `SELECT value_cents FROM economics WHERE entity_id = 'mcp:git' AND metric = 'recurring_cost_per_month'`);
  expect(recurring[0].value_cents).toBe(3000);

  const goal = rows(db, `SELECT occurrence_rate_per_month, success_value_cents, failure_cost_cents FROM goals WHERE id = 'recover-production'`);
  expect(goal[0].occurrence_rate_per_month).toBe(2);
  expect(goal[0].success_value_cents).toBe(4000);
  expect(goal[0].failure_cost_cents).toBe(50000);
  db.close();
});

test('economics reports declared values in dollars and names their source', () => {
  seed(WITH_ECONOMICS).close();
  const report = cli('economics');
  const attention = report.economics.find((e: any) => e.entity === 'actor:human:kanav');
  expect(attention.value_dollars).toBe(250);
  expect(attention.period).toBe('per_hour');
  expect(attention.source).toBe('declared');

  const g = report.goals.find((x: any) => x.id === 'recover-production');
  expect(g.success_value_dollars).toBe(40);
  expect(g.failure_cost_dollars).toBe(500);
  expect(report.note).toContain('$250/hr');
});
