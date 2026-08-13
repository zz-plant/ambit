import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The graph database, written by `bootstrap.sh` and `engine.ts seed`.
 *
 * The engine, the MCP server and the visualizer API each used to carry their
 * own default — package root, `~/.config/opencode/`, and the process's cwd
 * respectively. A correctly seeded install queried over MCP therefore reported
 * an empty environment, which is the exact failure this project exists to
 * prevent. One resolver, imported by all three.
 */
export const DB_PATH_DEFAULT = join(__dirname, "..", "..", "toolchain-viz.db");

export function resolveDbPath(): string {
  return process.env.TOOLCHAIN_DB || DB_PATH_DEFAULT;
}
