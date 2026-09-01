/**
 * The graph has four writers by design — the CLI, the MCP server, the API
 * server's telemetry route, and the agent-runtime plugin — so contention is
 * normal operation, not an edge case.
 *
 * SQLite's default is to fail immediately when the write lock is held. Eight
 * concurrent `ambit record` calls used to abort about six times in a hundred
 * with an unhandled `SQLITE_BUSY`: a stack trace in the user's terminal and a
 * silently lost observation.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { getDb } from './db.ts';

const ENGINE = join(import.meta.dirname, 'engine.ts');
const WRITERS = 12;

test('a busy timeout is in force before anything that takes a lock', () => {
  // Ordering is the whole fix: `PRAGMA journal_mode = WAL` takes a lock
  // itself, so setting the timeout after it leaves opening the graph racing.
  const dir = mkdtempSync(join(tmpdir(), 'ambit-busy-'));
  try {
    const db = getDb(join(dir, 'graph.db'));
    expect(db.prepare('PRAGMA busy_timeout').get()!.timeout).toBeGreaterThan(0);
    expect(db.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('wal');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent writers all land, and none of them crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-busy-'));
  const dbPath = join(dir, 'graph.db');
  const env = { ...process.env, AMBIT_DB: dbPath, TOOLCHAIN_DB: dbPath, NODE_NO_WARNINGS: '1' };
  try {
    execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], { env, stdio: 'ignore' });

    const failures: string[] = [];
    await Promise.all(
      Array.from(
        { length: WRITERS },
        () =>
          new Promise<void>(resolve => {
            try {
              execFileSync('node', ['--experimental-sqlite', ENGINE, 'record', 'vector-store'], {
                env,
                stdio: 'ignore',
              });
            } catch (e) {
              failures.push(e instanceof Error ? e.message : String(e));
            }
            resolve();
          })
      )
    );

    expect(failures).toEqual([]);

    // Not just "did not crash": every observation has to be on record, because
    // a deficit that silently fails to count is worse than one that errors.
    const db = getDb(dbPath);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM session_learning').get()!.n;
    db.close();
    expect(rows).toBe(WRITERS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
