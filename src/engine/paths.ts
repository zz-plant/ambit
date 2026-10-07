import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { shellQuote } from '../shared/shell.ts';

/**
 * Where the engine's authored data lives — schema.sql, techtree.json,
 * ../shared/concepts.json. Every module that reads one of those resolves it
 * from here rather than from its own `__dirname`, so moving a module between
 * directories cannot silently change which tree it reads.
 */
export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The command that installs the OpenCode telemetry bridge from this copy.
 *
 * The notes that suggest the bridge used to name `plugins/ambit-telemetry.js`,
 * a path that exists only in a checkout. An npm or Homebrew install carries
 * the file too, two levels above the engine in either layout (`src/engine` or
 * `dist-cli/engine`), so the note can name where it actually is.
 */
/**
 * How a runtime should start this copy of Ambit. A copy npx unpacked into its
 * cache has no `ambit` on the PATH, so a config written with `ambit mcp` named
 * a command the runtime could not find; that copy is started through npx, and
 * an installed or checked-out one by name.
 */
export function ambitCommand(engineDir = ENGINE_DIR): string[] {
  return /[\\/]_npx[\\/]/.test(engineDir) ? ['npx', '-y', 'ambit-cli'] : ['ambit'];
}

export function telemetryBridgeInstall(): string {
  const file = join(ENGINE_DIR, '..', '..', 'plugins', 'ambit-telemetry.js');
  return `cp ${shellQuote(file)} ~/.config/opencode/plugins/`;
}

/**
 * Where this copy's Cursor ledger hook is. It ships beside the OpenCode bridge,
 * two levels above the engine in a checkout and an install alike, so
 * `ambit connect cursor --ledger` can name it in hooks.json by its absolute path.
 */
export function cursorLedgerScript(engineDir = ENGINE_DIR): string {
  return join(engineDir, '..', '..', 'plugins', 'cursor', 'ambit-ledger.mjs');
}

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

/**
 * How far a mode lets an agent go without a person, narrowest last. An overlay
 * is a file in whatever directory `ambit` runs from, so a cloned repository
 * that ships `.ambit.json` is a file that travelled, and a file that travelled
 * may narrow what the curated tree permits and never widen it (AGENTS.md rule 7).
 */
const MODE_RANK: Record<string, number> = { autonomous: 0, confirm: 1, forbidden: 2 };

/** The narrower of a curated mode and an overlay's; an unknown overlay word changes nothing. */
function narrower(base: unknown, overlay: unknown): unknown {
  if (typeof overlay !== 'string' || !(overlay in MODE_RANK)) return base;
  // A key the curated tree never stated has no mode to narrow, and the overlay
  // alone may not grant autonomy: the most it can state is that a person confirms.
  if (typeof base !== 'string' || !(base in MODE_RANK)) {
    return overlay === 'autonomous' ? 'confirm' : overlay;
  }
  return MODE_RANK[overlay] > MODE_RANK[base] ? overlay : base;
}

/** One level of an authority block: every curated key kept, each overlay key narrowed against it. */
function narrowModes(base: any, overlay: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, mode] of Object.entries<unknown>(base || {})) {
    if (typeof mode === 'string') out[key] = mode;
  }
  for (const [key, mode] of Object.entries<unknown>(overlay || {})) {
    if (typeof mode === 'string') out[key] = narrower(out[key], mode);
  }
  return out;
}

/**
 * The authority a node carries once an overlay is applied. Every curated mode
 * survives, even under `override: true`: a curated `forbidden` that disappeared
 * would leave a runtime's own `autonomous` grant governing in its place.
 */
function mergeAuthority(base: any, overlay: any): any {
  const b = base && typeof base === 'object' ? base : {};
  const o = overlay && typeof overlay === 'object' ? overlay : {};
  const merged: any = narrowModes(b, o);
  const actions = narrowModes(b.actions, o.actions);
  if (Object.keys(actions).length) merged.actions = actions;
  return Object.keys(merged).length ? merged : undefined;
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
      const existing = mergedNodes[idx];
      const authority = mergeAuthority(existing.authority, node.authority);
      if (node.override) {
        mergedNodes[idx] = { ...node, authority };
      } else {
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
          authority,
        };
      }
    } else {
      nodeMap.set(node.id, mergedNodes.length);
      mergedNodes.push({ ...node, authority: mergeAuthority(undefined, node.authority) });
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
  if (process.env.OPENCODE_CONFIG) return process.env.OPENCODE_CONFIG;
  return opencodeConfigIn(join(process.env.HOME || '/', '.config', 'opencode'));
}

/**
 * The config file in an OpenCode config directory. Both major versions read
 * `opencode.json` or `opencode.jsonc`; the plain name is the default and is
 * what a new file is written as, and the commented one is read when it is the
 * only one there.
 */
export function opencodeConfigIn(dir: string): string {
  const json = join(dir, 'opencode.json');
  const jsonc = join(dir, 'opencode.jsonc');
  return !existsSync(json) && existsSync(jsonc) ? jsonc : json;
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
