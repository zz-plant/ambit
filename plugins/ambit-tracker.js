/**
 * Records deliberate configuration changes — what you build, connect, keep and
 * remove — for the capability graph. Not frequency of invocation: a server you
 * use hourly but never reconfigure should look static, because the question is
 * "what have I stopped tending", not "what do I use least".
 *
 * One file for both major versions of OpenCode: the default export carries
 * `id` and `setup` for OpenCode 2 and `server` for OpenCode 1, and each version
 * reads only its own. OpenCode 2 announces a changed config and lists what it
 * loaded, so under V2 a change is what differs between two listings.
 *
 * Install:
 *   cp plugins/ambit-tracker.js ~/.config/opencode/plugins/
 * The next `ambit` command, or the MCP server when it opens the graph, reads
 * what it recorded. AMBIT_NO_LEDGER stops it writing.
 * OpenCode 2 loads the plugins directory on its own. OpenCode 1 also needs
 * "./plugins/ambit-tracker.js" in `plugin` in opencode.json.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where a change is left for the engine: one line per change in a spool that
 * whichever graph the engine opens next reads in (src/engine/tracker-spool.ts).
 *
 * This plugin used to open a graph itself, resolving it from where it was
 * loaded. Copied into ~/.config/opencode/plugins/, "the graph beside the
 * engine" was ~/.config/opencode/toolchain-viz.db, the old default, wherever
 * one survived, and a checkout's graph was never found at all, so the changes
 * went where nothing read them. A plugin loaded by another program cannot know
 * which graph is the right one; the engine can.
 *
 * A transcription of `trackerSpoolPath` in src/shared/db-path.ts (AGENTS.md
 * rule 15): this file is plain JavaScript in OpenCode's process and cannot
 * import the engine. Keep the two in step.
 */
function spoolPath() {
  if (process.env.AMBIT_TRACKER_SPOOL) return process.env.AMBIT_TRACKER_SPOOL;
  const base = process.env.XDG_STATE_HOME || join(process.env.HOME || '.', '.local', 'state');
  return join(base, 'ambit', 'opencode-config.jsonl');
}

/** One change, as one appended line. Never in the way of the session. */
function write(capabilityId, action, notes) {
  if (process.env.AMBIT_NO_LEDGER) return;
  try {
    const path = spoolPath();
    mkdirSync(dirname(path), { recursive: true });
    const line = { t: new Date().toISOString(), id: String(capabilityId), action, notes };
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    // Tracking is best-effort; never let it interrupt the session.
  }
}

/** Both shapes appear across OpenCode versions. */
const field = (event, key) => event?.properties?.[key] ?? event?.[key];

export const AmbitTracker = async ctx => {
  if (!ctx?.on) return { techTreeAvailable: false, spool: spoolPath() };

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

  return { techTreeAvailable: true, spool: spoolPath() };
};

export const TechTreeTracker = AmbitTracker;

// ─── OpenCode 2 ───────────────────────────────────────────────────────────────

/**
 * The MCP servers and agents OpenCode has loaded, as the ids the seed gives
 * them. An agent is listed under its config key, which is what the seed names
 * it by.
 */
async function loaded(ctx) {
  const ids = new Set();
  const [servers, agents] = await Promise.all([
    ctx.mcp.list().catch(() => null),
    ctx.agent.list().catch(() => null),
  ]);
  for (const s of servers?.data ?? []) if (s?.name) ids.add(`mcp:${s.name}`);
  for (const a of agents?.data ?? []) if (a?.id ?? a?.name) ids.add(`agent:${a.id ?? a.name}`);
  return ids;
}

async function setup(ctx) {
  // What was there when the plugin loaded is the baseline, not a change: the
  // built-in agents and every server already configured are not news.
  let before = await loaded(ctx);
  const controller = new AbortController();
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      if (event?.type !== 'config.updated') continue;
      const after = await loaded(ctx);
      for (const id of after) if (!before.has(id)) write(id, 'built', 'Added to configuration');
      for (const id of before)
        if (!after.has(id)) write(id, 'removed', 'Removed from configuration');
      before = after;
    }
  })().catch(() => {});
  return () => controller.abort();
}

export default { id: 'ambit-tracker', setup, server: AmbitTracker };
