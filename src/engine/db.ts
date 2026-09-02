import { DatabaseSync } from 'node:sqlite';
import { resolveDbPath } from '../shared/db-path.ts';
import { type Migratable, migrate } from './migrate.ts';

/**
 * node:sqlite is experimental and types every row as `unknown`. This narrows
 * the handle to the surface the engine actually uses; a query names its row
 * type at the call (`.all<Pick<CapabilityRow, 'id' | 'name'>>()`) from the
 * shapes in rows.ts, and one that names nothing gets the loose record the
 * engine always had.
 */
interface Db extends Migratable {
  close(): void;
}

/**
 * How long a writer waits for the lock before giving up.
 *
 * The graph has four writers by design — the CLI, the MCP server, the API
 * server's telemetry route, and the agent-runtime plugin — and SQLite's default
 * is to fail *immediately* on contention. Under eight concurrent `ambit record`
 * calls that surfaced as an unhandled `SQLITE_BUSY` about six times in a
 * hundred: a stack trace, and a lost observation.
 *
 * Five seconds is far longer than any write here takes (they are single
 * statements against a local file) and short enough that a genuinely stuck
 * lock still fails rather than hanging a person's terminal.
 */
const BUSY_TIMEOUT_MS = 5000;

function getDb(dbPath?: string): Db {
  const path = dbPath || resolveDbPath();
  const db = new DatabaseSync(path);
  // Order matters: journal_mode itself takes a lock, so the timeout has to be
  // in force before it runs, or opening the graph is its own race.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db as unknown as Db;
}

// The migration itself lives in migrate.ts, which imports no driver: the
// visualizer API runs under Bun and opens the graph itself, so it has to be
// able to migrate without going through this Node-only handle.
export type { Db };
export { getDb, migrate };
