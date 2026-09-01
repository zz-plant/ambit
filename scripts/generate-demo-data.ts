/**
 * generate-demo-data.ts — builds src/client/utils/demo-data.json.
 *
 * The published demo used to carry two unrelated datasets. `seedDemo` held 25
 * hand-written config entries; demoTechTree.json held 56 tree nodes produced at
 * some earlier point from something else. They shared five ids. Toggling
 * between "My Setup" and "Tech Tree" therefore showed two different imaginary
 * machines — in a product whose entire claim is that those are two views of one
 * environment.
 *
 * Both views now come from one fixture config, through the same code that
 * serves a real user: `importConfig` for the setup view, the engine's own seed
 * and `techTreeView` for the tree. Nothing is written by hand, so the demo
 * cannot describe a system the engine would not produce.
 *
 *   npm run demo:generate    rebuild it
 *   npm run demo:check       fail if the committed file has drifted
 *
 * Not included: the LOOP view's snapshot (demoSnapshot.ts). That one is
 * narrative — a work ledger with priced interventions and realised ROI — and
 * generating it would mean fabricating months of telemetry rather than reading
 * a config. It stays hand-authored, and says so.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importConfig } from '../src/client/utils/configImporter.ts';
import { getDb } from '../src/engine/db.ts';
import { techTreeView } from '../src/engine/views.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'client', 'utils', 'demo-data.json');

/**
 * The setup the demo depicts.
 *
 * Entirely invented, and deliberately so: the demo is served from GitHub Pages
 * to anyone, and a fixture captured from a real machine would publish that
 * person's servers, agents and hostnames. It is broad enough to light every era
 * column and to leave the frontier one step short in places, because a graph
 * with nothing left to reach demonstrates nothing.
 */
const FIXTURE = {
  provider: { anthropic: { name: 'Anthropic' }, ollama: { name: 'Ollama' } },
  agent: {
    reviewer: { description: 'Reviews diffs before merge' },
    researcher: { description: 'Reads docs and summarises' },
    steward: { description: 'Keeps repositories consistent' },
  },
  mcp: {
    git: { type: 'local', enabled: true },
    github: { type: 'remote', enabled: true },
    filesystem: { type: 'local', enabled: true },
    playwright: { type: 'local', enabled: true },
    sqlite: { type: 'local', enabled: true },
    fetch: { type: 'remote', enabled: true },
    memory: { type: 'local', enabled: true },
    docker: { type: 'local', enabled: true },
    postgres: { type: 'local', enabled: true },
    slack: { type: 'remote', enabled: true },
    sentry: { type: 'remote', enabled: true },
    kubernetes: { type: 'local', enabled: true },
    grafana: { type: 'remote', enabled: true },
    '1password': { type: 'local', enabled: true },
  },
  command: {
    deploy: { description: 'Ship to staging' },
    migrate: { description: 'Run database migrations' },
    bench: { description: 'Run the benchmark suite' },
  },
};

/** The mapping the engine reads the fixture through — the stock config keys. */
const MAPPING = JSON.stringify({
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
  // No skill directories: whatever the person running this happens to have
  // installed must not end up in a file served to the public.
  skill_dirs: [],
});

export function buildDemoData(): {
  fixture: typeof FIXTURE;
  config: ReturnType<typeof importConfig>;
  tree: ReturnType<typeof techTreeView>;
} {
  const work = mkdtempSync(join(tmpdir(), 'ambit-demo-'));
  try {
    // HOME is redirected wholesale, not variable by variable: the engine
    // derives the Claude Code, Codex and skill paths from it, and overriding
    // them one at a time is how a fixture ends up carrying somebody's real
    // toolchain.
    const home = join(work, 'home');
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    const configPath = join(home, '.config', 'opencode', 'opencode.json');
    writeFileSync(configPath, JSON.stringify(FIXTURE, null, 2));
    const dbPath = join(work, 'graph.db');

    execFileSync(
      'node',
      ['--experimental-sqlite', join(ROOT, 'src', 'engine', 'engine.ts'), 'seed'],
      {
        env: {
          ...process.env,
          HOME: home,
          OPENCODE_CONFIG: configPath,
          TOOLCHAIN_DB: dbPath,
          AMBIT_DB: dbPath,
          CONFIG_MAPPING: MAPPING,
          NODE_NO_WARNINGS: '1',
        },
        stdio: ['ignore', 'ignore', 'inherit'],
      }
    );

    const db = getDb(dbPath);
    const tree = techTreeView(db);
    db.close();

    return { fixture: FIXTURE, config: importConfig(FIXTURE as never), tree };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Stable on disk, so a regeneration that changed nothing is an empty diff. */
export function serialise(data: ReturnType<typeof buildDemoData>): string {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const byEdge = <T extends { from: string; to: string }>(rows: T[]) =>
    [...rows].sort((a, b) => `${a.from} ${a.to}`.localeCompare(`${b.from} ${b.to}`));

  return `${JSON.stringify(
    {
      generatedBy: 'npm run demo:generate',
      fixture: data.fixture,
      config: { items: byId(data.config.items), connections: byEdge(data.config.connections) },
      tree: { items: byId(data.tree.items), connections: byEdge(data.tree.connections) },
    },
    null,
    2
  )}\n`;
}

if (process.argv[1]?.endsWith('generate-demo-data.ts')) {
  const text = serialise(buildDemoData());
  writeFileSync(OUT, text);
  const parsed = JSON.parse(text);
  console.log(
    `Wrote ${OUT}\n  setup view: ${parsed.config.items.length} items` +
      `\n  tree view : ${parsed.tree.items.length} items`
  );
}
