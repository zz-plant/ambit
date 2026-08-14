import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The engine runs under Node (node:sqlite); these assertions run under Bun,
// which ships its own driver. Same file, different reader.
import { Database } from 'bun:sqlite';

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

  const spof = cli('spof');
  const listed = Array.isArray(spof) ? spof : [];
  expect(listed.some((s: any) => s.provider_id === 'mcp:git')).toBe(true);
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
  expect(cli('ledger').length).toBe(1);
  seed(LOCAL_ONLY).close(); // identical config
  expect(cli('ledger').length).toBe(1);
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

  const since = cli('since');
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

test('a frontier query before any history explains itself', () => {
  const db = seed(LOCAL_ONLY);
  db.close();
  // One observation exists, so `since` compares against it rather than erroring.
  const since = cli('since');
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
  const evidence = cli('evidence', 'shell-execution');
  expect(evidence.length).toBe(2);
  expect(evidence.every((e: any) => e.action === 'verified')).toBe(true);
});

test('a capability with no declared check is not reported as verified', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('verify', 'retrieval');
  expect(r.results[0].status).toBe('unverifiable');
  // And it leaves no evidence, so nothing later mistakes it for a passing run.
  expect(cli('evidence', 'retrieval').length).toBe(0);
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

test('planning orders the prerequisites of an unreached capability', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('plan', 'offline-capable');
  expect(p.steps).toBeGreaterThan(0);
  const order = p.order.map((o: any) => o.id);
  // Embeddings gates Local Embeddings, so it has to come first.
  expect(order.indexOf('combo:embeddings')).toBeLessThan(order.indexOf('combo:local-embeddings'));
  expect(p.estimated_setup).toMatch(/\d+(m|\.\dh)/);
});

test('planning a capability already reached says so instead of inventing steps', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('plan', 'shell-execution');
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
  const plan = cli('plan', 'continuous-delivery');
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
  const plan = cli('plan', 'offline-capable');
  const embeddings = plan.order.find((o: any) => o.id === 'combo:embeddings');
  expect(embeddings?.options?.length).toBeGreaterThan(1);
  // The trade-off is rarely setup time alone; a faster hosted option costs
  // money and moves data, and the plan has to say so.
  const hosted = embeddings.options.find((o: any) => o.privacy === 'hosted');
  const local = embeddings.options.find((o: any) => o.privacy === 'local');
  expect(hosted.setup_seconds).toBeLessThan(local.setup_seconds);
  expect(hosted.recurring_cost).not.toBe('none');
});

// ── Deficits ────────────────────────────────────────────────────────────────

test('a repeated deficit is distinguished from incidental friction', () => {
  seed(LOCAL_ONLY).close();
  const once = cli('failed', 'vector-store');
  expect(once.times_blocked).toBe(1);
  expect(once.note).toBeUndefined(); // one failure is bad luck

  cli('failed', 'vector-store');
  const third = cli('failed', 'vector-store');
  expect(third.times_blocked).toBe(3);
  expect(third.note).toContain('structural');

  const report = cli('deficits');
  expect(report[0].id).toBe('combo:vector-store');
  expect(report[0].verdict).toContain('structural');
  expect(report[0].still_missing).toBe(true);
});

test('a deficit against an unknown capability is refused, not silently kept', () => {
  // Otherwise deficits accumulate against ids nothing can act on.
  seed(LOCAL_ONLY).close();
  const r = cli('failed', 'not-a-capability');
  expect(r.error).toContain('No capability');
  expect(cli('deficits').note).toContain('Nothing recorded');
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
  const spof = cli('spof');
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
  const sim = cli('simulate', 'embeddings');
  expect(sim.frontier_after).toBeGreaterThan(sim.frontier_before);
  expect(sim.acquired.map((a: any) => a.id)).toContain('combo:embeddings');
});

test('simulation does not conjure capabilities nothing provides', () => {
  seed(LOCAL_ONLY).close();
  const sim = cli('simulate', 'embeddings');
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
  const done = cli('plan', 'shell-execution');
  const todo = cli('plan', 'offline-capable');
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
  const plan = cli('plan', 'web-research');
  expect(plan.steps).toBe(1);
  expect(plan.order[0].id).toBe('combo:web-research');
});

test('the goal comes last, after what it depends on', () => {
  seed(LOCAL_ONLY).close();
  const plan = cli('plan', 'offline-capable');
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
  const evidence = cli('evidence', 'human:kanav');
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
