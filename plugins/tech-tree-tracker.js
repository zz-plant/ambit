/**
 * Records deliberate configuration changes — what you build, connect, keep and
 * remove — into the capability graph. Not frequency of invocation: a server you
 * use hourly but never reconfigure should look static, because the question is
 * "what have I stopped tending", not "what do I use least".
 *
 * Install:
 *   cp plugins/tech-tree-tracker.js ~/.config/opencode/plugins/
 * then add "./plugins/tech-tree-tracker.js" to `plugin` in opencode.json.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Must match the engine's default (beside the engine, which is what
 * bootstrap.sh writes). An earlier copy of this plugin defaulted to
 * ~/.config/opencode/toolchain-viz.db and therefore wrote every event into a
 * database the engine never read — which is why session_learning stayed empty.
 */
const DB_PATH = process.env.TOOLCHAIN_DB || join(process.cwd(), 'toolchain-viz.db');

// Runs in a child process because node:sqlite needs --experimental-sqlite,
// which the host process will not necessarily have been started with.
const RECORD = `
  const { DatabaseSync } = require('node:sqlite');
  const [dbPath, capabilityId, action, notes] = process.argv.slice(1);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");

  // session_learning.capability_id is a foreign key, so recording a newly
  // added server failed outright — the capability does not exist in the graph
  // until the next seed. The previous version swallowed that error, which is
  // why the table stayed empty for everyone. Insert the row first.
  const [category, ...rest] = capabilityId.split(':');
  const name = rest.join(':') || capabilityId;
  db.prepare(
    "INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, state, maturity_score) VALUES (?, ?, 'meta', 'Discovered by the tracking plugin', ?, 'unlocked', 0.5)"
  ).run(capabilityId, name, category || 'tool');

  db.prepare("UPDATE capabilities SET updated_at = datetime('now') WHERE id = ?").run(capabilityId);
  db.prepare("INSERT INTO session_learning (session_id, capability_id, action, notes) VALUES ('config', ?, ?, ?)")
    .run(capabilityId, action, notes);
  db.close();
`;
function write(capabilityId, action, notes) {
  // Values are passed as argv, never interpolated into the script. The previous
  // version built this string with template literals, so a capability whose
  // name contained a quote or backtick could execute arbitrary code here.
  try {
    spawnSync(
      'node',
      ['--experimental-sqlite', '-e', RECORD, '--', DB_PATH, capabilityId, action, notes || ''],
      { timeout: 5000, stdio: 'ignore' }
    );
  } catch {
    // Tracking is best-effort; never let it interrupt the session.
  }
}

/** Both shapes appear across OpenCode versions. */
const field = (event, key) => event?.properties?.[key] ?? event?.[key];

export const TechTreeTracker = async ctx => {
  if (!ctx?.on) return { techTreeAvailable: false, dbPath: DB_PATH };

  const record = (action, notes) => event => {
    const name = field(event, 'name');
    const type = field(event, 'type');
    if (name && type) write(`${type}:${name}`, action, notes);
  };

  ctx.on('config:added', record('built', 'Added to configuration'));
  ctx.on('config:removed', record('removed', 'Removed from configuration'));
  ctx.on('combo:unlocked', event => {
    const name = field(event, 'combo');
    if (name) write(`combo:${name}`, 'unlocked', 'Combo prerequisites satisfied');
  });

  return { techTreeAvailable: true, dbPath: DB_PATH };
};
