import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The graph beside the code — how a git checkout has always stored it. */
export const REPO_DB_PATH = join(__dirname, '..', '..', 'toolchain-viz.db');

/**
 * Where an installed copy keeps the graph: `~/.local/share/ambit/graph.db`,
 * or `$XDG_DATA_HOME/ambit/graph.db`.
 */
export function userDbPath(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || '.', '.local', 'share');
  return join(base, 'ambit', 'graph.db');
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
/**
 * Where the Claude Code hooks leave what a session did, for the engine to read
 * into whichever graph it opens next. Apart from the graph on purpose: the
 * hook runs from Claude Code's plugin cache and cannot know whether the graph
 * it should feed is an installed copy's or a checkout's. The hook scripts in
 * plugins/claude-code/ambit/scripts/spool.mjs and plugins/cursor/ambit-ledger.mjs
 * both transcribe this, and both write to this one file, which keeps the name
 * of the runtime that wrote to it first; a Cursor line says `src: "cursor"`.
 */
export function spoolPath(): string {
  if (process.env.AMBIT_SPOOL) return process.env.AMBIT_SPOOL;
  const base = process.env.XDG_STATE_HOME || join(process.env.HOME || '.', '.local', 'state');
  return join(base, 'ambit', 'claude-code.jsonl');
}

/**
 * Where the OpenCode tracker leaves the configuration changes it saw, for the
 * engine to read into whichever graph it opens next. Apart from the graph for
 * the reason the Claude Code spool is: the plugin runs from OpenCode's plugins
 * directory, and a graph it guessed from there was the wrong one for a
 * checkout, and for anyone with an old `~/.config/opencode/toolchain-viz.db`,
 * the old default it kept finding beside itself. plugins/ambit-tracker.js
 * transcribes this.
 */
export function trackerSpoolPath(): string {
  if (process.env.AMBIT_TRACKER_SPOOL) return process.env.AMBIT_TRACKER_SPOOL;
  const base = process.env.XDG_STATE_HOME || join(process.env.HOME || '.', '.local', 'state');
  return join(base, 'ambit', 'opencode-config.jsonl');
}

export function resolveDbPath(): string {
  const explicit = process.env.AMBIT_DB || process.env.TOOLCHAIN_DB;
  if (explicit) return explicit;
  if (existsSync(REPO_DB_PATH)) return REPO_DB_PATH;
  if (existsSync(join(__dirname, '..', '..', '.git'))) return REPO_DB_PATH;

  const userPath = userDbPath();
  mkdirSync(dirname(userPath), { recursive: true });
  return userPath;
}
