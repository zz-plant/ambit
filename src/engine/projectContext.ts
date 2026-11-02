/**
 * What kind of project this directory is, as a set of capability ids worth
 * boosting in `ambit next`.
 *
 * Ambit is not a package manager and does not install anything. It reads the
 * files a project already carries — `package.json`, `Cargo.toml`, `pyproject.toml`,
 * `go.mod` — and nudges the ranking toward the capabilities that project is
 * most likely to need next. The boost is a tiebreak, never an override: a
 * capability that has actually blocked work still leads.
 *
 * Detection is deliberately shallow: file existence and dependency names only.
 * No network, no parsing of lockfiles, no execution.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEYWORDS: Record<string, string[]> = {
  // Web / frontend
  next: ['browser-automation', 'hosting', 'continuous-delivery'],
  react: ['browser-automation', 'automated-tests'],
  vue: ['browser-automation', 'automated-tests'],
  svelte: ['browser-automation', 'automated-tests'],
  // Data
  supabase: ['data-access', 'production-database'],
  prisma: ['data-access', 'production-database'],
  drizzle: ['data-access', 'production-database'],
  mongoose: ['data-access', 'production-database'],
  sequelize: ['data-access', 'production-database'],
  // Testing
  playwright: ['browser-automation', 'automated-tests'],
  vitest: ['automated-tests'],
  jest: ['automated-tests'],
  pytest: ['automated-tests'],
  // Infra / deploy
  wrangler: ['hosting', 'continuous-delivery', 'error-tracking'],
  docker: ['self-hosted-stack', 'continuous-delivery'],
  terraform: ['self-hosted-stack'],
  // AI / ML
  openai: ['hosted-inference', 'embeddings'],
  anthropic: ['hosted-inference'],
  langchain: ['embeddings', 'retrieval', 'persistent-memory'],
  // Mobile
  expo: ['hosting', 'continuous-delivery'],
};

function readDeps(path: string): string[] {
  try {
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.json')) {
      const j = JSON.parse(text);
      return Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) });
    }
    // Cargo.toml / pyproject.toml / go.mod: dependency names are the words
    // before '=' or a version, on lines that look like deps. Keep it simple:
    // collect lowercased tokens.
    return text
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function projectContextBoosts(cwd: string = process.cwd()): Set<string> {
  const boosted = new Set<string>();
  const manifests: { file: string; parser: 'json' | 'text' }[] = [
    { file: 'package.json', parser: 'json' },
    { file: 'Cargo.toml', parser: 'text' },
    { file: 'pyproject.toml', parser: 'text' },
    { file: 'go.mod', parser: 'text' },
    { file: 'requirements.txt', parser: 'text' },
  ];
  const deps = new Set<string>();
  for (const m of manifests) {
    const p = join(cwd, m.file);
    if (!existsSync(p)) continue;
    for (const d of readDeps(p)) deps.add(d.toLowerCase());
  }
  // Also treat the presence of well-known files as signals.
  if (existsSync(join(cwd, 'Dockerfile'))) for (const c of KEYWORDS.docker) boosted.add(c);
  if (existsSync(join(cwd, 'wrangler.toml')) || existsSync(join(cwd, 'wrangler.jsonc')))
    for (const c of KEYWORDS.wrangler) boosted.add(c);

  for (const dep of deps) {
    for (const [kw, caps] of Object.entries(KEYWORDS)) {
      if (dep === kw || dep.includes(kw)) for (const c of caps) boosted.add(c);
    }
  }
  return new Set([...boosted].map(c => `combo:${c}`));
}
