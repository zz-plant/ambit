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

let cachedTree: any = null;
export function loadTechTree(): any {
  if (!cachedTree) {
    try {
      cachedTree = JSON.parse(readFileSync(join(ENGINE_DIR, 'techtree.json'), 'utf8'));
    } catch {
      cachedTree = { nodes: [] };
    }
  }
  return cachedTree;
}

// OPENCODE_CONFIG is the documented way to point the engine at another config
// (README, "Using other configs"); it was accepted by bootstrap.sh but never
// read here, so seeding always used the default path regardless.
export const CONFIG_DEFAULT =
  process.env.OPENCODE_CONFIG ||
  join(process.env.HOME || '/', '.config', 'opencode', 'opencode.json');
