/**
 * Records deliberate configuration changes — what you build, connect, keep and
 * remove — into the capability graph. Not frequency of invocation: a server you
 * use hourly but never reconfigure should look static, because the question is
 * "what have I stopped tending", not "what do I use least".
 *
 * Install:
 *   cp plugins/ambit-tracker.js ~/.config/opencode/plugins/
 * then add "./plugins/ambit-tracker.js" to `plugin` in opencode.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where the graph is, resolved the way every other component resolves it.
 *
 * This is a transcription of `resolveDbPath` in src/shared/db-path.ts, not a
 * second opinion: the plugin is plain JavaScript loaded by another program and
 * cannot import the engine's TypeScript, so the order has to be repeated here
 * and has to match. It previously honoured only TOOLCHAIN_DB and then fell back
 * to the *session's* working directory — so a plugin running from anywhere but
 * the checkout wrote into a database nothing read, which is the same class of
 * bug the comment below it was written to describe.
 *
 * Order: an explicit AMBIT_DB or TOOLCHAIN_DB, a graph already beside the
 * engine, a checkout, then ~/.local/share/ambit/graph.db.
 */
function resolveDbPath(baseDir) {
  const explicit = process.env.AMBIT_DB || process.env.TOOLCHAIN_DB;
  if (explicit) return explicit;
  const repoDb = join(baseDir, '..', 'toolchain-viz.db');
  if (existsSync(repoDb)) return repoDb;
  if (existsSync(join(baseDir, '..', '.git'))) return repoDb;
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || '.', '.local', 'share');
  const userPath = join(base, 'ambit', 'graph.db');
  try {
    mkdirSync(dirname(userPath), { recursive: true });
  } catch {}
  return userPath;
}

const DB_PATH = resolveDbPath(dirname(new URL(import.meta.url).pathname));

// Runs in a child process because node:sqlite needs --experimental-sqlite,
// which the host process will not necessarily have been started with.
const RECORD = `
  const { DatabaseSync } = require('node:sqlite');
  const [dbPath, capabilityId, action, notes] = process.argv.slice(1);
  const db = new DatabaseSync(dbPath);
  // The same two pragmas getDb() sets, in the same order: journal_mode itself
  // takes a lock, so the busy timeout has to be in force before it runs or
  // opening the graph is its own race. Four processes write this database by
  // design and SQLite's default is to fail immediately on contention.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // A capability the graph has never seen has no row, and session_learning
  // holds a foreign key to one — which is why this table stayed empty for
  // everyone before the insert below existed.
  //
  // \`kind\` is set rather than left to the schema default. The engine's own
  // writer stamps it from the id prefix, and omitting it here made every node
  // this plugin created a 'provider' — including the combo: ids below, which
  // are capabilities, and which the visualiser and the seed report both filter
  // on. A node in the wrong kind is invisible to half the product.
  const [category, ...rest] = capabilityId.split(':');
  const name = rest.join(':') || capabilityId;
  // Mirrors kindOf() in src/engine/ontology.ts: category first, then the id
  // prefix, then provider. Keep the two in step — a node written under the
  // wrong kind is invisible to whichever half of the product filters on it.
  const CATEGORY_KIND = {
    combo: 'capability', 'human-action': 'action', human: 'actor', runtime: 'runtime',
    provider: 'resource', model: 'resource', device: 'resource', service: 'resource',
    credential: 'credential',
  };
  const PREFIX_KIND = {
    combo: 'capability', act: 'action', human: 'actor', runtime: 'runtime',
    provider: 'resource', model: 'resource', device: 'resource', cred: 'credential',
  };
  const kind = CATEGORY_KIND[category] || PREFIX_KIND[category] || 'provider';
  db.prepare(
    "INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, kind, state, maturity_score) VALUES (?, ?, 'meta', 'Discovered by the tracking plugin', ?, ?, 'unlocked', 0.5)"
  ).run(capabilityId, name, category || 'tool', kind)

  db.prepare("UPDATE capabilities SET updated_at = datetime('now') WHERE id = ?").run(capabilityId);
  db.prepare("INSERT INTO session_learning (session_id, capability_id, action, notes) VALUES ('config', ?, ?, ?)")
    .run(capabilityId, action, notes);
  db.close();
`;
function write(capabilityId, action, notes) {
  // Values are passed as argv, never interpolated into the script. An earlier
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

export const AmbitTracker = async ctx => {
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

export const TechTreeTracker = AmbitTracker;
