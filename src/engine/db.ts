import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveDbPath } from "../shared/db-path.ts";
import { ENGINE_DIR } from "./paths.ts";

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

function migrate(db: Db) {
  db.exec(readFileSync(join(ENGINE_DIR, "schema.sql"), "utf8"));
}

export type { Db };
export { getDb, migrate };
