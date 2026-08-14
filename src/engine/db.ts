import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveDbPath } from "../shared/db-path.ts";
import { ENGINE_DIR } from "./paths.ts";
import { kindOf, edgeKindOf } from "./ontology.ts";

/**
 * node:sqlite is experimental and types every row as `unknown`, which would
 * require a hand-written row type at each of the ~40 query sites. This narrows
 * the handle to the surface the engine actually uses, with rows as loose
 * records — the same guarantee the code had before, now stated explicitly.
 */
interface Db {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, any>[];
    get(...params: unknown[]): Record<string, any> | undefined;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
}

function getDb(dbPath?: string): Db {
  const path = dbPath || resolveDbPath();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as Db;
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
];

function addMissingColumns(db: Db) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    let present: Record<string, any>[];
    try { present = db.prepare(`PRAGMA table_info(${table})`).all(); }
    catch { continue; } // table not created yet; schema.sql just made it with the column
    if (!present.length || present.some(c => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Whether a one-time step has run against this database, recording it if not. */
function once(db: Db, key: string): boolean {
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
function backfillKinds(db: Db) {
  if (!once(db, 'backfill-kinds')) return;
  for (const row of db.prepare("SELECT id, category FROM capabilities").all()) {
    db.prepare("UPDATE capabilities SET kind = ? WHERE id = ?").run(kindOf(row.id, row.category), row.id);
  }
  for (const row of db.prepare("SELECT id, description, is_hard_requisite FROM dependencies").all()) {
    db.prepare("UPDATE dependencies SET kind = ? WHERE id = ?")
      .run(edgeKindOf(row.description, row.is_hard_requisite), row.id);
  }
}

function migrate(db: Db) {
  db.exec(readFileSync(join(ENGINE_DIR, "schema.sql"), "utf8"));
  addMissingColumns(db);
  backfillKinds(db);
}

export type { Db };
export { getDb, migrate };
