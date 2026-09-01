/**
 * Seeding a graph from an agent config, and the ontology it produces.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import {
  cli,
  dir,
  getDb,
  join,
  migrate,
  mkdirSync,
  rows,
  seed,
  seedWith,
  symlinkSync,
  writeFileSync,
} from './testing/cli.ts';

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
  const dangling = rows(
    db,
    `
    SELECT d.from_capability f, d.to_capability t FROM dependencies d
    LEFT JOIN capabilities cf ON cf.id = d.from_capability
    LEFT JOIN capabilities ct ON ct.id = d.to_capability
    WHERE cf.id IS NULL OR ct.id IS NULL`
  );
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

  const deps = rows(
    db,
    "SELECT from_capability f, is_hard_requisite h FROM dependencies WHERE to_capability = 'combo:shipping'"
  );
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
  expect(state('shell-execution')).toBe('unlocked'); // seeded as a base tool
  expect(state('hosted-inference')).toBe('unlocked'); // a provider exists
  expect(state('local-runtime')).toBe('locked'); // nothing local configured
  expect(state('offline-capable')).toBe('locked'); // far up the tree
});

test('a local-first setup unlocks the local branch', () => {
  const db = seed({
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    mcp: { playwright: {} },
  });
  const state = (id: string) =>
    rows(db, "SELECT id, state FROM capabilities WHERE category = 'combo'").find(
      n => n.id === `combo:${id}`
    )?.state;

  expect(state('local-runtime')).toBe('unlocked'); // ollama detected
  expect(state('local-tool-calling')).toBe('unlocked'); // qwen is tool-capable
  expect(state('browser-automation')).toBe('unlocked'); // playwright
});

test('a node is never unlocked while its prerequisites are not', () => {
  // The tree must not contradict itself — this guards the era-ordered pass.
  const db = seed({
    provider: { acme: {} },
    agent: { x: { description: 'offline air-gap work' } },
  });
  const byId = new Map(
    rows(db, "SELECT id, state FROM capabilities WHERE category = 'combo'").map(n => [
      n.id,
      n.state,
    ])
  );
  const reqs = rows(
    db,
    `SELECT from_capability f, to_capability t FROM dependencies
                         WHERE description = 'Tech tree prerequisite'`
  );
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
    rows(db, `SELECT kind FROM capabilities WHERE id = '${id}'`)[0]?.kind;

  expect(kind('combo:version-control')).toBe('capability');
  expect(kind('mcp:git')).toBe('provider');
  expect(kind('model:ollama/qwen3-coder')).toBe('resource');
  expect(kind('provider:ollama')).toBe('resource'); // an endpoint serving models
  expect(kind('human:kanav')).toBe('actor');
  expect(kind('runtime:opencode')).toBe('runtime');
  expect(kind('act:physical-access')).toBe('action');

  // Nothing is left at the column default by accident.
  const unknown = rows(
    db,
    `SELECT id FROM capabilities WHERE kind NOT IN
    ('capability','action','provider','resource','actor','runtime')`
  );
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
  expect(
    rows(
      db,
      `SELECT kind FROM dependencies
    WHERE from_capability = 'mcp:git' AND to_capability = 'combo:version-control'`
    )[0].kind
  ).toBe('provides');
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

  const reopened = getDb(join(dir, 'graph.db'));
  expect(rows(reopened, 'SELECT COUNT(*) n FROM frontier_snapshots')[0].n).toBe(before);
  expect(rows(reopened, "SELECT kind FROM capabilities WHERE id = 'mcp:git'")[0].kind).toBe(
    'provider'
  );
  expect(
    rows(
      reopened,
      `SELECT kind FROM dependencies
    WHERE from_capability = 'mcp:git' AND to_capability = 'combo:version-control'`
    )[0].kind
  ).toBe('provides');
});

// ── Runtimes ────────────────────────────────────────────────────────────────
test('capabilities are attributed to the runtime that contributed them', () => {
  const db = seed({ mcp: { git: {} }, provider: { acme: {} } });
  const runtimes = rows(db, "SELECT id FROM capabilities WHERE category = 'runtime'");
  expect(runtimes.map(r => r.id)).toContain('runtime:opencode');

  const edges = rows(
    db,
    `SELECT to_capability t FROM dependencies
                          WHERE from_capability = 'runtime:opencode'`
  );
  expect(edges.map(e => e.t)).toContain('mcp:git');
});

test('two runtimes providing the same capability share one node', () => {
  // Ids deliberately collide: a git MCP under either runtime is one capability
  // with two providers, and the runtime edges are what keep that legible.
  seed({ mcp: { git: {}, exa: {} } }).close();
  const dbPath = join(dir, 'graph.db');
  writeFileSync(join(dir, 'second.json'), JSON.stringify({ mcp: { git: {}, fetch: {} } }));
  seedWith({
    OPENCODE_CONFIG: join(dir, 'second.json'),
    TOOLCHAIN_DB: dbPath,
    AMBIT_RUNTIME: 'hermes',
    CONFIG_MAPPING: JSON.stringify({ config_keys: { mcp: { type: 'mcp' } }, skill_dirs: [] }),
  });
  const db = getDb(dbPath);

  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'mcp:git'").length).toBe(1);
  const providers = rows(
    db,
    `SELECT from_capability f FROM dependencies
                              WHERE to_capability = 'mcp:git' AND description = 'Contributed by runtime'`
  );
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
  seedWith({
    OPENCODE_CONFIG: configPath,
    TOOLCHAIN_DB: dbPath,
    CONFIG_MAPPING: JSON.stringify({ config_keys: {}, skill_dirs: [runtime] }),
  });
  const db = getDb(dbPath);
  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'skill:deploying'").length).toBe(1);
});

test('seed combines OpenCode, Claude Code, and every MCP client it knows', () => {
  const home = join(dir, 'home');
  const openCodeConfig = join(home, '.config', 'opencode', 'opencode.json');
  const claudeConfig = join(home, '.claude.json');
  const cursorConfig = join(home, '.cursor', 'mcp.json');
  const windsurfConfig = join(home, '.codeium', 'windsurf', 'mcp_config.json');
  const geminiConfig = join(home, '.gemini', 'settings.json');
  const desktopConfig = join(home, '.config', 'Claude', 'claude_desktop_config.json');
  const codexConfig = join(home, '.codex', 'config.toml');
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
  mkdirSync(join(home, '.gemini'), { recursive: true });
  mkdirSync(join(home, '.config', 'Claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(
    openCodeConfig,
    JSON.stringify({
      mcp: { filesystem: { type: 'local', command: ['filesystem-mcp'] } },
    })
  );
  writeFileSync(
    claudeConfig,
    JSON.stringify({
      mcpServers: { browser: { command: 'browser-mcp' } },
    })
  );
  writeFileSync(
    cursorConfig,
    JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    })
  );
  writeFileSync(
    windsurfConfig,
    JSON.stringify({
      mcpServers: {
        linear: { serverUrl: 'https://mcp.linear.app/sse' },
      },
    })
  );
  // Gemini CLI keeps mcpServers inside its general settings file.
  writeFileSync(
    geminiConfig,
    JSON.stringify({
      theme: 'dark',
      mcpServers: { maps: { command: 'maps-mcp' } },
    })
  );
  writeFileSync(
    desktopConfig,
    JSON.stringify({
      mcpServers: { sqlite: { command: 'uvx', args: ['mcp-server-sqlite'] } },
    })
  );
  // Codex is the one TOML config; the reader handles tables, strings, arrays.
  writeFileSync(
    codexConfig,
    [
      'model = "o4"',
      '',
      '[mcp_servers.docs]',
      'command = "npx"',
      'args = ["-y", "docs-mcp"]',
      '',
      '[other_section]',
      'ignored = true',
    ].join('\n')
  );

  const dbPath = join(dir, 'auto-discovery.db');
  // No config and no mapping: the engine has to find the runtimes under HOME
  // by itself, which is the whole point of this case.
  seedWith({
    OPENCODE_CONFIG: undefined,
    CONFIG_MAPPING: undefined,
    AMBIT_RUNTIME: undefined,
    HOME: home,
    TOOLCHAIN_DB: dbPath,
  });

  const db = getDb(dbPath);
  const capabilities = rows(
    db,
    "SELECT id FROM capabilities WHERE id IN ('mcp:filesystem', 'mcp:browser', 'mcp:github', 'mcp:linear', 'mcp:maps', 'mcp:sqlite', 'mcp:docs', 'runtime:opencode', 'runtime:claude-code', 'runtime:cursor', 'runtime:windsurf', 'runtime:gemini-cli', 'runtime:claude-desktop', 'runtime:codex')"
  );
  expect(capabilities.map(row => row.id).sort()).toEqual([
    'mcp:browser',
    'mcp:docs',
    'mcp:filesystem',
    'mcp:github',
    'mcp:linear',
    'mcp:maps',
    'mcp:sqlite',
    'runtime:claude-code',
    'runtime:claude-desktop',
    'runtime:codex',
    'runtime:cursor',
    'runtime:gemini-cli',
    'runtime:opencode',
    'runtime:windsurf',
  ]);
  const contributions = rows(
    db,
    `
    SELECT from_capability f, to_capability t
    FROM dependencies
    WHERE from_capability LIKE 'runtime:%'
  `
  );
  expect(contributions).toContainEqual({ f: 'runtime:opencode', t: 'mcp:filesystem' });
  expect(contributions).toContainEqual({ f: 'runtime:claude-code', t: 'mcp:browser' });
  expect(contributions).toContainEqual({ f: 'runtime:cursor', t: 'mcp:github' });
  expect(contributions).toContainEqual({ f: 'runtime:windsurf', t: 'mcp:linear' });
  expect(contributions).toContainEqual({ f: 'runtime:gemini-cli', t: 'mcp:maps' });
  expect(contributions).toContainEqual({ f: 'runtime:claude-desktop', t: 'mcp:sqlite' });
  expect(contributions).toContainEqual({ f: 'runtime:codex', t: 'mcp:docs' });
  db.close();
});
