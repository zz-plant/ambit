/**
 * The configuration changes the OpenCode tracker saw, read into the graph.
 *
 * The tracker used to open a graph itself, from OpenCode's plugins directory,
 * with a transcribed resolver that took any `toolchain-viz.db` beside it for
 * the engine's. Copied into `~/.config/opencode/plugins/`, that was the old
 * default `~/.config/opencode/toolchain-viz.db` wherever one survived, and an
 * installed copy's graph for a checkout, so the changes landed in a graph
 * nothing read. It now appends one line per change to `trackerSpoolPath()`,
 * and whichever graph the engine opens next takes them in, as the Claude Code
 * spool works. What each line becomes is unchanged: a node the graph has
 * never seen, stamped with its kind, and a `config` row in session_learning
 * saying built, removed or unlocked (AGENTS.md rule 4).
 */
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { trackerSpoolPath } from '../shared/db-path.ts';
import type { Db } from './db.ts';
import { kindOf } from './ontology.ts';

/** One line of the tracker's spool, as plugins/ambit-tracker.js writes it. */
interface TrackerLine {
  /** When the change was seen, ISO 8601. */
  t?: string;
  /** The node the change is about, as the seed names it (`mcp:git`, `combo:x`). */
  id?: string;
  /** built, removed or unlocked. */
  action?: string;
  notes?: string;
}

const ACTIONS = new Set(['built', 'removed', 'unlocked']);

/** SQLite's `datetime('now')` shape, so a spooled time sorts with the rest. */
function sqlTime(iso?: string): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Read the tracker's spool into the graph and remove it. The file is renamed
 * before it is read, so a change the tracker appends meanwhile starts a new
 * file and nothing is read twice or lost. A line that does not parse, or names
 * no node or no known action, is skipped and counted.
 */
function ingestTrackerSpool(
  db: Db,
  path = trackerSpoolPath()
): { recorded: number; skipped: number } {
  if (!existsSync(path)) return { recorded: 0, skipped: 0 };
  const taken = `${path}.${process.pid}.reading`;
  try {
    renameSync(path, taken);
  } catch {
    return { recorded: 0, skipped: 0 };
  }
  let recorded = 0;
  let skipped = 0;
  const node = db.prepare(
    "INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, kind, state, maturity_score) VALUES (?, ?, 'meta', 'Discovered by the tracking plugin', ?, ?, 'unlocked', 0.5)"
  );
  const touched = db.prepare("UPDATE capabilities SET updated_at = datetime('now') WHERE id = ?");
  const learned = db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, notes, timestamp) VALUES ('config', ?, ?, ?, COALESCE(?, datetime('now')))"
  );
  try {
    db.exec('BEGIN');
    try {
      for (const raw of readFileSync(taken, 'utf8').split('\n').filter(Boolean)) {
        let line: TrackerLine;
        try {
          line = JSON.parse(raw);
        } catch {
          skipped++;
          continue;
        }
        const id = typeof line?.id === 'string' ? line.id : '';
        if (!id || !ACTIONS.has(String(line.action))) {
          skipped++;
          continue;
        }
        const [category, ...rest] = id.split(':');
        node.run(id, rest.join(':') || id, category || 'tool', kindOf(id, category));
        touched.run(id);
        learned.run(id, line.action as string, line.notes ?? null, sqlTime(line.t));
        recorded++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // Nothing was written; the lines are kept beside the spool.
      renameSync(taken, `${path}.${process.pid}.failed`);
      throw err;
    }
    rmSync(taken, { force: true });
  } catch {
    return { recorded: 0, skipped };
  }
  return { recorded, skipped };
}

export { ingestTrackerSpool };
