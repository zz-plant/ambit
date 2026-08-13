import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
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


// ── Ledger ──────────────────────────────────────────────────────────────────

/** Run the CLI against the database this test's `seed` writes to. */
function cli(cmd: string, arg?: string): any {
  const out = execFileSync(
    'node',
    ['--experimental-sqlite', ENGINE, cmd, ...(arg ? [arg] : []), '--json'],
    { env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') }, encoding: 'utf8' }
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
