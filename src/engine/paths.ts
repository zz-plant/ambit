import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';

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

/**
 * Scoped tech tree overlay file, allowing per-repository or per-project
 * capability extensions without modifying the core curated tree.
 * Roadmap §13.11 / Issue #51.
 */
export function overlayTechTreePath(): string | null {
  if (process.env.AMBIT_OVERLAY_TECHTREE) {
    return process.env.AMBIT_OVERLAY_TECHTREE;
  }
  const dotAmbit = join(process.cwd(), '.ambit', 'techtree.json');
  if (existsSync(dotAmbit)) return dotAmbit;
  const dotJson = join(process.cwd(), '.ambit.json');
  if (existsSync(dotJson)) return dotJson;
  return null;
}

/** Clears the tree cache. */
export function clearTreeCache(): void {
  treeCache.clear();
}

/** Merges an overlay tech tree definition on top of the base curated tree. */
function mergeTrees(base: any, overlay: any): any {
  if (!overlay || !Array.isArray(overlay.nodes)) return base;
  const mergedNodes = (base.nodes || []).map((n: any) => ({
    ...n,
    detect: n.detect ? { ...n.detect, any: [...(n.detect.any || [])] } : undefined,
    requires: n.requires ? [...n.requires] : undefined,
  }));
  const nodeMap = new Map<string, number>();
  mergedNodes.forEach((node: any, idx: number) => {
    nodeMap.set(node.id, idx);
  });

  for (const node of overlay.nodes) {
    if (!node?.id) continue;
    if (nodeMap.has(node.id)) {
      const idx = nodeMap.get(node.id)!;
      if (node.override) {
        mergedNodes[idx] = { ...node };
      } else {
        const existing = mergedNodes[idx];
        mergedNodes[idx] = {
          ...existing,
          ...node,
          detect: {
            ...existing.detect,
            ...node.detect,
            any: Array.from(
              new Set([...(existing.detect?.any || []), ...(node.detect?.any || [])])
            ),
          },
          requires: Array.from(new Set([...(existing.requires || []), ...(node.requires || [])])),
        };
      }
    } else {
      nodeMap.set(node.id, mergedNodes.length);
      mergedNodes.push({ ...node });
    }
  }

  return {
    ...base,
    ...overlay,
    nodes: mergedNodes,
  };
}

export function loadTechTree(): any {
  const basePath = techTreePath();
  const overlayPath = overlayTechTreePath();
  let mtimes = '';
  try {
    mtimes = `${statSync(basePath).mtimeMs}|${overlayPath && existsSync(overlayPath) ? statSync(overlayPath).mtimeMs : ''}`;
  } catch {}
  const cacheKey = `${basePath}|${overlayPath ?? ''}|${mtimes}`;
  const cached = treeCache.get(cacheKey);
  if (cached) return cached;

  let tree: any;
  try {
    tree = JSON.parse(readFileSync(basePath, 'utf8'));
  } catch {
    tree = { nodes: [] };
  }

  if (overlayPath) {
    try {
      const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      tree = mergeTrees(tree, overlay);
    } catch {
      // An invalid overlay file is skipped to avoid crashing the engine.
    }
  }

  treeCache.set(cacheKey, tree);
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

/**
 * Where the infrastructure manifest is: INFRA_MANIFEST, or the default beside
 * the agent config. A function for the reason `configDefault` is one; seeding
 * and `ambit graph capacity` both read it, and the server's copy of this
 * default is in src/server/config.ts.
 */
export function infraManifestPath(): string {
  return (
    process.env.INFRA_MANIFEST ||
    join(process.env.HOME || '/', '.config', 'opencode', 'infrastructure.json')
  );
}
