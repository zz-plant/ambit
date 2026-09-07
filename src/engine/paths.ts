import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Where the engine's authored data lives — schema.sql, techtree.json,
 * ../shared/concepts.json. Every module that reads one of those resolves it
 * from here rather than from its own `__dirname`, so moving a module between
 * directories cannot silently change which tree it reads.
 */
export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Which capability model to read.
 *
 * `AMBIT_TECHTREE` points the engine at another tree, the same way
 * `OPENCODE_CONFIG` points it at another agent config. It exists for tests: a
 * check in the shipped tree runs a real command, and one of them curls
 * example.com, so eight end-to-end tests of propose/approve/apply were deciding
 * whether they passed by whether the machine had internet. They passed in CI
 * and failed on any boxed runner, which reads as flakiness and is not — the
 * suite was answering a question about the network.
 *
 * Resolved per call rather than at import, and cached against the path it came
 * from, for the reason the config note below gives: a constant is only correct
 * for a process that reads the environment once and exits, and this module is
 * also imported by the API server and by tests that set the environment per
 * call.
 */
const treeCache = new Map<string, any>();

export function techTreePath(): string {
  return process.env.AMBIT_TECHTREE || join(ENGINE_DIR, 'techtree.json');
}

export function loadTechTree(): any {
  const path = techTreePath();
  const cached = treeCache.get(path);
  if (cached) return cached;
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    tree = { nodes: [] };
  }
  treeCache.set(path, tree);
  return tree;
}

/**
 * The agent config to read, resolved when it is asked for.
 *
 * OPENCODE_CONFIG is the documented way to point the engine at another config
 * (README, "Using other configs"); it was accepted by bootstrap.sh but never
 * read here, so seeding always used the default path regardless.
 *
 * A function rather than a constant, because a constant is only correct for a
 * process that reads the environment once at startup and then exits. The CLI
 * does exactly that, which is why this was invisible — but the engine is also
 * imported by the API server and by tests, where the environment is set per
 * call. Evaluated at import, `CONFIG_DEFAULT` froze whatever HOME happened to
 * be when the module first loaded, so a caller that set OPENCODE_CONFIG
 * afterwards was silently seeding from the developer's own machine. This is
 * the same rule `resolveDbPath` already follows.
 */
export function configDefault(): string {
  return (
    process.env.OPENCODE_CONFIG ||
    join(process.env.HOME || '/', '.config', 'opencode', 'opencode.json')
  );
}
