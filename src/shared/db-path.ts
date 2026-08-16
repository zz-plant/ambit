import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The graph beside the code — how a git checkout has always stored it. */
export const REPO_DB_PATH = join(__dirname, "..", "..", "toolchain-viz.db");

/**
 * Where an installed copy keeps the graph: `~/.local/share/ambit/graph.db`,
 * or `$XDG_DATA_HOME/ambit/graph.db`.
 */
export function userDbPath(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "ambit", "graph.db");
}

/**
 * The graph database, written by `bootstrap.sh` and `engine.ts seed`.
 *
 * The engine, the MCP server and the visualizer API each used to carry their
 * own default — package root, `~/.config/opencode/`, and the process's cwd
 * respectively. A correctly seeded install queried over MCP therefore reported
 * an empty environment, which is the exact failure this project exists to
 * prevent. One resolver, imported by all three.
 *
 * Resolution order, and why:
 *
 *   1. AMBIT_DB or TOOLCHAIN_DB — an explicit choice always wins.
 *   2. A graph that already exists next to the code, so no one's history moves
 *      out from under them on upgrade.
 *   3. A git checkout keeps its graph in the checkout, where contributors and
 *      `bootstrap.sh` have always found it.
 *   4. Otherwise `~/.local/share/ambit/graph.db`. An installed copy must not
 *      store data inside its own install directory: under Homebrew that is the
 *      Cellar, which `brew upgrade` deletes — and the ledger, the verification
 *      evidence and the recorded deficits take months to accumulate and cannot
 *      be rebuilt by re-seeding.
 */
export function resolveDbPath(): string {
  const explicit = process.env.AMBIT_DB || process.env.TOOLCHAIN_DB;
  if (explicit) return explicit;
  if (existsSync(REPO_DB_PATH)) return REPO_DB_PATH;
  if (existsSync(join(__dirname, "..", "..", ".git"))) return REPO_DB_PATH;

  const userPath = userDbPath();
  mkdirSync(dirname(userPath), { recursive: true });
  return userPath;
}
