import { readFileSync } from "fs";
import { join } from "path";
import { ENGINE_DIR } from "./paths.ts";
import { kindOf, edgeKindOf } from "./ontology.ts";

/**
 * Bringing a database up to the current schema, with no opinion about which
 * driver opened it.
 *
 * Deliberately free of any `node:sqlite` or `bun:sqlite` import. The engine and
 * MCP server run under Node and the visualizer API under Bun, and the visualizer
 * opens the graph itself — so if migration could only be reached through the
 * Node handle, an existing installation that started the server before running
 * any CLI command would query columns its database does not have. It did:
 * `/api/tech-tree` returned 500 with `no such column: c.kind` until some other
 * command happened to migrate for it.
 *
 * Both drivers expose `exec` and a `prepare` returning `all`/`get`/`run`, which
 * is the whole surface used here.
 */
export interface Migratable {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, any>[];
    get(...params: unknown[]): Record<string, any> | undefined;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
}

/**
 * Columns added to tables that already exist.
 *
 * schema.sql is entirely `CREATE TABLE IF NOT EXISTS`, which is a no-op against
 * a database created by an earlier version — so a column added there reaches
 * new installs and never reaches anyone who has been using Ambit, which is
 * exactly backwards. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the presence
 * check is explicit.
 *
 * Every entry must be nullable or defaulted. An existing row has to remain
 * valid, because the alternative is dropping a graph someone has been
 * accumulating, and the frontier ledger cannot be re-derived once it is gone.
 */
const ADDED_COLUMNS: Array<[table: string, column: string, definition: string]> = [
  ["capabilities", "kind", "TEXT NOT NULL DEFAULT 'provider'"],
  ["capabilities", "lifecycle", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["dependencies", "kind", "TEXT NOT NULL DEFAULT 'requires'"],
  ["frontier_snapshots", "kinds", "TEXT"],
  ["frontier_snapshots", "verified", "INTEGER NOT NULL DEFAULT 0"],
  ["frontier_snapshots", "lifecycles", "TEXT"],
];

function addMissingColumns(db: Migratable) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    let present: Record<string, any>[];
    try { present = db.prepare(`PRAGMA table_info(${table})`).all(); }
    catch { continue; } // table not created yet; schema.sql just made it with the column
    if (!present.length || present.some(c => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Whether a one-time step has run against this database, recording it if not. */
function once(db: Migratable, key: string): boolean {
  if (db.prepare("SELECT 1 AS ok FROM schema_meta WHERE key = ?").get(key)) return false;
  db.prepare("INSERT INTO schema_meta (key, value) VALUES (?, 'done')").run(key);
  return true;
}

/**
 * Gives rows written before kinds existed the kind they always implicitly had.
 *
 * Runs once and is recorded, rather than on every migrate, because a row whose
 * kind was written deliberately must not be recomputed from a description that
 * a newer writer no longer sets.
 */
function backfillKinds(db: Migratable) {
  if (!once(db, 'backfill-kinds')) return;
  for (const row of db.prepare("SELECT id, category FROM capabilities").all()) {
    db.prepare("UPDATE capabilities SET kind = ? WHERE id = ?").run(kindOf(row.id, row.category), row.id);
  }
  for (const row of db.prepare("SELECT id, description, is_hard_requisite FROM dependencies").all()) {
    db.prepare("UPDATE dependencies SET kind = ? WHERE id = ?")
      .run(edgeKindOf(row.description, row.is_hard_requisite), row.id);
  }
}

export function migrate(db: Migratable) {
  db.exec(readFileSync(join(ENGINE_DIR, "schema.sql"), "utf8"));
  addMissingColumns(db);
  backfillKinds(db);
}
