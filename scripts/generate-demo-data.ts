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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importConfig } from '../src/client/utils/configImporter.ts';
import { deriveLifecycles, verifyCheck } from '../src/engine/assurance.ts';
import { getDb } from '../src/engine/db.ts';
import { recordFrontier } from '../src/engine/ledger.ts';
import { frontierHistoryView, techTreeView } from '../src/engine/views.ts';
import type { FrontierHistoryResponse } from '../src/shared/api.ts';

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
    researcher: { description: 'Reads docs and summarizes' },
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
    jev: { type: 'remote', enabled: true },
  },
  command: {
    deploy: { description: 'Ship to staging' },
    migrate: { description: 'Run database migrations' },
    bench: { description: 'Run the benchmark suite' },
  },
  // A person is part of the setup: shipping to production waits on their
  // yes, so the demo shows a capability the agents cannot reach alone.
  actors: {
    you: { name: 'You', authorizes: ['continuous-delivery'] },
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

/**
 * The model folders a seed lists, inside the throwaway HOME. Redirecting HOME
 * does not reach them when the shell running this sets either variable, and
 * that machine's models would ship in the public demo.
 */
const NO_LOCAL_MODELS = (home: string) => ({
  OLLAMA_MODELS: join(home, '.ollama', 'models'),
  AMBIT_LMSTUDIO_MODELS: join(home, '.lmstudio', 'models'),
});

/**
 * What the demo's checks said, by capability: `true` passed, `false` failed.
 *
 * A seed verifies nothing, so the tree used to arrive with every reached node
 * "configured, never checked", while the Time & cost page beside it reported
 * checks passing and one failing. Two views of one invented machine disagreed
 * about whether anything had been proved. The results are run through the
 * engine's own check runner, with `true` and `false` standing in for the real
 * commands exactly as the fixture stands in for a real config, so the tree's
 * lifecycles are the ones the engine would derive from this evidence.
 *
 * Two reached nodes are left unchecked on purpose: "configured is not working"
 * is the distinction the map exists to draw, and a demo with nothing in that
 * state could not show it.
 */
export const DEMO_EVIDENCE: Record<string, boolean> = {
  'combo:automated-tests': true,
  'combo:browser-automation': false,
  'combo:continuous-delivery': true,
  'combo:data-access': true,
  'combo:file-editing': true,
  'combo:hosted-inference': true,
  'combo:local-runtime': true,
  'combo:observability': true,
  'combo:persistent-memory': true,
  'combo:secret-management': true,
  'combo:shell-execution': true,
  'combo:tool-protocol': true,
  'combo:version-control': true,
  'combo:web-research': true,
};

/** Some of the fixture's entries of one kind, by name. */
const only = <T extends Record<string, unknown>>(entries: T, names: (keyof T & string)[]) =>
  Object.fromEntries(names.map(name => [name, entries[name]]));

/** The demo's checks that pass, and the one that fails, as two stages of its history. */
const checksThat = (passes: boolean) =>
  Object.fromEntries(Object.entries(DEMO_EVIDENCE).filter(([, passed]) => passed === passes));

/**
 * The demo machine's history: one observation per stage, each on a fixed
 * date, so the timeline under the map shows the same series on every build.
 *
 * The stages are the fixture's own parts in the order a person might have
 * added them. The last two change no config, only evidence: the checks that
 * pass, then the one that fails. So the series ends where the demo's map is,
 * with a check gone failing on the way, and nothing in it describes a machine
 * the engine would not build from this fixture.
 */
const HISTORY: { at: string; config?: object; checks?: Record<string, boolean> }[] = [
  {
    at: '2026-08-03 09:00:00',
    config: {
      provider: only(FIXTURE.provider, ['anthropic']),
      agent: only(FIXTURE.agent, ['reviewer']),
      mcp: only(FIXTURE.mcp, ['git', 'github', 'filesystem', 'fetch']),
    },
  },
  {
    at: '2026-08-17 09:00:00',
    config: {
      provider: only(FIXTURE.provider, ['anthropic']),
      agent: only(FIXTURE.agent, ['reviewer', 'researcher']),
      mcp: only(FIXTURE.mcp, [
        'git',
        'github',
        'filesystem',
        'fetch',
        'memory',
        'sqlite',
        'postgres',
        'playwright',
      ]),
      command: only(FIXTURE.command, ['migrate']),
    },
  },
  { at: '2026-08-31 09:00:00', config: FIXTURE },
  { at: '2026-09-14 09:00:00', checks: checksThat(true) },
  { at: '2026-09-26 09:00:00', checks: checksThat(false) },
];

/**
 * `ambit seed` for one stage of the history, without the observation it would
 * record at the wall clock: each stage is dated by hand, and an observation
 * stamped by whoever regenerated the file would put their clock in it. It
 * runs in its own process with HOME redirected, as the demo's seed does.
 */
function seedUnrecorded(config: object, home: string, dbPath: string): void {
  const configPath = join(dirname(dbPath), 'stage.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const engine = (file: string) =>
    JSON.stringify(pathToFileURL(join(ROOT, 'src', 'engine', file)).href);
  const program = `
    const { getDb } = await import(${engine('db.ts')});
    const { migrate } = await import(${engine('migrate.ts')});
    const { seedFromConfig } = await import(${engine('discovery.ts')});
    const db = getDb(process.env.AMBIT_DB);
    migrate(db);
    seedFromConfig(db, process.env.OPENCODE_CONFIG, process.env.CONFIG_MAPPING, false);
    db.close();
  `;
  execFileSync('node', ['--experimental-sqlite', '--input-type=module', '-e', program], {
    env: {
      ...process.env,
      HOME: home,
      ...NO_LOCAL_MODELS(home),
      OPENCODE_CONFIG: configPath,
      TOOLCHAIN_DB: dbPath,
      AMBIT_DB: dbPath,
      CONFIG_MAPPING: MAPPING,
      // What `ambit seed` sets while it reads an OpenCode config.
      AMBIT_RUNTIME: process.env.AMBIT_RUNTIME || 'opencode',
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * The history, recorded stage by stage and served the way /api/frontier
 * serves it, kept to the nodes the demo's map can draw: the file ships in
 * the bundle, and an id the map has no node for is weight with no picture.
 */
function buildDemoHistory(
  work: string,
  home: string,
  tree: ReturnType<typeof techTreeView>
): FrontierHistoryResponse {
  const dbPath = join(work, 'history.db');
  for (const stage of HISTORY) {
    if (stage.config) seedUnrecorded(stage.config, home, dbPath);
    const db = getDb(dbPath);
    for (const [id, passes] of Object.entries(stage.checks ?? {})) {
      verifyCheck(db, id, id, { command: [passes ? 'true' : 'false'] });
    }
    deriveLifecycles(db);
    recordFrontier(db, stage.at);
    db.close();
  }
  const db = getDb(dbPath);
  const history = frontierHistoryView(db);
  db.close();

  // The history ends where the map is, or scrubbing to its last tick would
  // show a different machine from the one the demo opens on.
  const last = history.ticks[history.ticks.length - 1];
  const apart = tree.items.filter(
    i => last.states[i.id] !== i.meta.state || last.lifecycles?.[i.id] !== i.meta.lifecycle
  );
  if (apart.length || history.movedSinceLast) {
    throw new Error(
      `The demo's history does not end where its map is: ${apart.map(i => i.id).join(', ')}`
    );
  }

  const drawn = new Set(tree.items.map(i => i.id));
  const keep = (map: Record<string, string> | null) =>
    map && Object.fromEntries(Object.entries(map).filter(([id]) => drawn.has(id)));
  return {
    ticks: history.ticks.map(t => ({
      ...t,
      states: keep(t.states) ?? {},
      kinds: keep(t.kinds),
      lifecycles: keep(t.lifecycles),
    })),
    movedSinceLast: null,
  };
}

export function buildDemoData(): {
  fixture: typeof FIXTURE;
  config: ReturnType<typeof importConfig>;
  tree: ReturnType<typeof techTreeView>;
  history: FrontierHistoryResponse;
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
          ...NO_LOCAL_MODELS(home),
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
    for (const [id, passes] of Object.entries(DEMO_EVIDENCE)) {
      verifyCheck(db, id, id, { command: [passes ? 'true' : 'false'] });
    }
    deriveLifecycles(db);
    const tree = techTreeView(db);
    db.close();

    return {
      fixture: FIXTURE,
      config: importConfig(FIXTURE as never),
      tree,
      history: buildDemoHistory(work, home, tree),
    };
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
      tree: {
        // When a check ran is the clock of whoever regenerated the file, so it
        // is left out: the committed demo would otherwise age a day every day
        // and differ on every run. An absent timestamp is a state the panel
        // already renders.
        items: byId(data.tree.items).map(({ meta, ...item }) => {
          const { lastChecked: _, ...rest } = (meta ?? {}) as Record<string, unknown>;
          return { ...item, meta: rest };
        }),
        connections: byEdge(data.tree.connections),
      },
      history: data.history,
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
