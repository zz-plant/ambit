/**
 * generate-demo-tree.ts — writes src/client/utils/demoTechTree.json.
 *
 * The published demo has no backend, so `/api/tech-tree` 404s and the Tech
 * Tree tab had nothing to render. It did not say so: the click was swallowed
 * and "My Setup" stayed selected, which made the product's namesake view a
 * dead button on the first page the README sends anyone to.
 *
 * The fix is a snapshot shipped with the bundle, and the snapshot is generated
 * rather than authored — from a fixture config, through the real seeder, out
 * through `techTreeView`, the same function the API endpoint calls. A curated
 * tree that drifts from the engine is the failure this is meant to prevent, so
 * hand-editing the JSON is not a shortcut, it is the bug.
 *
 *   node --experimental-sqlite scripts/generate-demo-tree.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'client', 'utils', 'demoTechTree.json');

// Invented, and deliberately so: this ships to every visitor, so it must not
// be able to describe whoever generated it. Broad enough that every era column
// has something in it and the frontier has somewhere to go.
const FIXTURE = {
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
};

const work = mkdtempSync(join(tmpdir(), 'ambit-demotree-'));
try {
  // HOME is redirected wholesale. The seeder reads ~/.config/opencode, the
  // Claude and Codex config paths and the skill directories, and overriding
  // them one at a time is how a generated fixture ends up carrying somebody's
  // real MCP servers into a published bundle.
  const home = join(work, 'home');
  const cfgDir = join(home, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  const configPath = join(cfgDir, 'opencode.json');
  writeFileSync(configPath, JSON.stringify(FIXTURE, null, 2));

  const env = {
    ...process.env,
    HOME: home,
    AMBIT_DB: join(work, 'graph.db'),
    OPENCODE_CONFIG: configPath,
    INFRA_MANIFEST: join(cfgDir, 'nothing.json'),
  };
  // `node` on PATH may be a version-manager shim that needs the environment
  // this script has just replaced; the real binary does not.
  const NODE = process.execPath;
  execFileSync(NODE, ['--experimental-sqlite', join(ROOT, 'src', 'engine', 'engine.ts'), 'seed'], {
    env,
    stdio: 'ignore',
  });

  // Straight through the endpoint's own view function, so the snapshot and the
  // live response cannot describe the graph differently.
  const script = `
    import { getDb } from ${JSON.stringify(join(ROOT, 'src', 'engine', 'db.ts'))};
    import { techTreeView } from ${JSON.stringify(join(ROOT, 'src', 'engine', 'views.ts'))};
    const db = getDb(process.env.AMBIT_DB);
    process.stdout.write(JSON.stringify(techTreeView(db)));
  `;
  const evalFile = join(work, 'dump.ts');
  writeFileSync(evalFile, script);
  const raw = execFileSync(NODE, ['--experimental-sqlite', evalFile], { env, encoding: 'utf8' });

  const view = JSON.parse(raw);
  if (!Array.isArray(view.items) || view.items.length < 20)
    throw new Error(`fixture produced ${view.items?.length ?? 0} items — refusing to write`);

  // Proof rather than assumption: if a name from the generating machine got in,
  // the snapshot is not shippable.
  const serialised = JSON.stringify(view);
  const allowed = new Set([
    ...Object.keys(FIXTURE.mcp),
    ...Object.keys(FIXTURE.agent),
    ...Object.keys(FIXTURE.command),
  ]);
  const suspicious = (view.items as { id: string; name: string }[]).filter(i => {
    const slug = i.id.includes(':') ? i.id.slice(i.id.indexOf(':') + 1) : i.id;
    return i.id.startsWith('mcp:') && !allowed.has(slug);
  });
  if (suspicious.length)
    throw new Error(
      `snapshot carries MCP servers not in the fixture: ${suspicious.map(s => s.id).join(', ')}`
    );

  writeFileSync(OUT, `${JSON.stringify(view, null, 2)}\n`);
  console.log(
    `Wrote ${OUT} — ${view.items.length} items, ${view.connections.length} connections, ${Math.round(serialised.length / 1024)}KB`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
