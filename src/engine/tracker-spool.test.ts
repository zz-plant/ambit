/**
 * OpenCode's configuration changes, read from the tracker's spool into
 * whichever graph is open. The tracker used to guess a graph from where it was
 * loaded and found the wrong one; these hold that the plugin only appends, and
 * that the engine records each change as the plugin used to write it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeGraph } from './testing/graph.ts';
import { ingestTrackerSpool } from './tracker-spool.ts';

let dir: string;
let spool: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-tracker-'));
  spool = join(dir, 'opencode-config.jsonl');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.AMBIT_TRACKER_SPOOL;
  delete process.env.AMBIT_NO_LEDGER;
});

const rows = (db: ReturnType<typeof makeGraph>) =>
  db
    .prepare(
      "SELECT capability_id AS id, action, notes, timestamp FROM session_learning WHERE session_id = 'config' ORDER BY id"
    )
    .all() as Array<{ id: string; action: string; notes: string; timestamp: string }>;

test('each change becomes a node of its kind and a config row, at the time it was seen', () => {
  writeFileSync(
    spool,
    [
      { t: '2026-10-06T09:00:00.000Z', id: 'mcp:playwright', action: 'built', notes: 'Added' },
      { t: '2026-10-06T09:05:00.000Z', id: 'combo:retrieval', action: 'unlocked' },
    ]
      .map(l => JSON.stringify(l))
      .join('\n')
  );
  const db = makeGraph({ capabilities: [] });
  expect(ingestTrackerSpool(db, spool)).toEqual({ recorded: 2, skipped: 0 });
  expect(existsSync(spool)).toBe(false);
  expect(rows(db)).toEqual([
    { id: 'combo:retrieval', action: 'unlocked', notes: null, timestamp: '2026-10-06 09:05:00' },
    { id: 'mcp:playwright', action: 'built', notes: 'Added', timestamp: '2026-10-06 09:00:00' },
  ]);
  const kinds = db
    .prepare(
      "SELECT id, kind FROM capabilities WHERE id IN ('mcp:playwright', 'combo:retrieval') ORDER BY id"
    )
    .all();
  expect(kinds).toEqual([
    { id: 'combo:retrieval', kind: 'capability' },
    { id: 'mcp:playwright', kind: 'provider' },
  ]);
  db.close();
});

test('a line that does not parse, names no node or no known action is skipped', () => {
  writeFileSync(
    spool,
    [
      'not json',
      JSON.stringify({ action: 'built' }),
      JSON.stringify({ id: 'mcp:git', action: 'used' }),
      JSON.stringify({ id: 'mcp:git', action: 'removed' }),
    ].join('\n')
  );
  const db = makeGraph({ capabilities: [] });
  expect(ingestTrackerSpool(db, spool)).toEqual({ recorded: 1, skipped: 3 });
  expect(rows(db).map(r => [r.id, r.action])).toEqual([['mcp:git', 'removed']]);
  db.close();
});

test('the plugin appends to the spool and opens no graph of its own', async () => {
  process.env.AMBIT_TRACKER_SPOOL = spool;
  const plugin = await import(
    `${pathToFileURL(join(import.meta.dirname, '..', '..', 'plugins', 'ambit-tracker.js')).href}?t=${Date.now()}`
  );
  const handlers: Record<string, (e: unknown) => void> = {};
  await plugin.AmbitTracker({
    on: (name: string, fn: (e: unknown) => void) => (handlers[name] = fn),
  });
  handlers['config:added']({ properties: { name: 'git', type: 'mcp' } });
  const line = JSON.parse(readFileSync(spool, 'utf8').trim());
  expect(line).toMatchObject({ id: 'mcp:git', action: 'built' });
  expect(Object.keys(line).sort()).toEqual(['action', 'id', 'notes', 't']);

  process.env.AMBIT_NO_LEDGER = '1';
  handlers['config:removed']({ properties: { name: 'git', type: 'mcp' } });
  expect(readFileSync(spool, 'utf8').trim().split('\n')).toHaveLength(1);
});
