import type { Migratable } from "./migrate.ts";

/**
 * Where the human is in the graph — and how much of the work still runs
 * through them.
 *
 * §6 generalised the rule "repeated friction should become infrastructure".
 * This is the report that turns that rule into a number: the human is a node
 * that supplies approvals, applications, and permission decisions, and every
 * one of those is an intervention the graph records. Counted over a window and
 * classified, the recurring ones are the parts of the environment that should
 * learn to do without the human — not the judgement worth keeping, but the
 * undocumented infrastructure that happens to be shaped like a person.
 *
 * The classification is the point. The work ledger records *what* the human
 * contributed — judgment, authority, knowledge, physical action, clerical
 * work, exception handling. Only the middleware kinds (clerical, exception,
 * physical, and authority-as-repeated-gate) are ever flagged reducible.
 * Judgment and knowledge are the reason the human is there; Ambit must not
 * recommend removing the thing it cannot supply.
 *
 * Like the recorder, this reads through the driver-agnostic surface so both
 * the Node engine and the Bun visualizer API can answer it.
 */

interface Intervention {
  kind: string;
  capability: string;
  capability_id: string;
  times: number;
  last_seen: string;
  active_seconds?: number;
  waiting_seconds?: number;
  runs_affected?: number;
}

/** The human actions session_learning records, mapped to what they are. */
const HUMAN_ACTIONS: Record<string, string> = {
  approved: 'approval',
  applied: 'application',
  'blocked:permission': 'permission block',
};

/** Human agency worth keeping. Never reducible, however often it recurs. */
const KEEPER_KINDS = new Set(['judgment', 'knowledge']);
/** Middleware kinds: the human is the duct, and recurring use is a fixable gap. */
const MIDDLEWARE_KINDS = new Set(['clerical', 'exception', 'physical', 'authority', 'approval', 'application', 'permission block']);

const FIX_FOR: Record<string, string> = {
  approval: 'grant bounded authority for %s rather than approving each time',
  authority: 'grant bounded authority for %s rather than asking again',
  'permission block': 'grant the missing permission for %s once',
  clerical: 'the transfer is mechanical — a capability that does it end to end removes the human',
  exception: 'the case recurs — encode the handling as a capability',
  physical: 'the act recurs — automate or delegate it',
};

/**
 * How often the human intervened, and which interventions are likely reducible.
 *
 *   ambit attention          → the last week
 *   ambit attention 30       → the last 30 days
 *
 * Two sources feed the count. `session_learning` contributes approvals,
 * applications and permission blocks recorded by the governance path. The work
 * ledger contributes human_intervention rows recorded by a runtime adapter,
 * with active and waiting time. Both are counted per (capability, kind), so a
 * capability that demanded the same act three times is one recurring
 * intervention, not three accidents.
 */
function humanDigest(db: Migratable, days?: number | string) {
  const window = days && Number(days) > 0 ? Number(days) : 7;

  const actions = db
    .prepare(
      `SELECT capability_id, action, timestamp FROM session_learning
       WHERE action IN ('approved', 'applied', 'blocked:permission', 'failed')
         AND timestamp >= datetime('now', ?)
       ORDER BY timestamp DESC`
    )
    .all(`-${window} days`) as any[];

  const interventions = db
    .prepare(
      `SELECT actor_id, kind, capability_id, started_at, active_seconds, waiting_seconds, run_id
       FROM human_intervention
       WHERE started_at >= datetime('now', ?)
       ORDER BY started_at DESC`
    )
    .all(`-${window} days`) as any[];

  if (actions.length === 0 && interventions.length === 0) {
    return {
      window_days: window,
      interventions: 0,
      note: `No human interventions recorded in the last ${window} days.`,
    };
  }

  const nameOf = new Map(
    db.prepare("SELECT id, name FROM capabilities").all().map((c: any) => [c.id, c.name])
  );

  // Count per (capability, kind), summing the ledger's time columns.
  const counts = new Map<string, Intervention>();
  const runsFor = new Map<string, Set<string>>();
  const bump = (capId: string | null, kind: string, at: string) => {
    const key = `${capId || 'human'}|${kind}`;
    if (!counts.has(key)) {
      counts.set(key, {
        kind,
        capability: capId ? nameOf.get(capId) || capId : 'the human',
        capability_id: capId || '',
        times: 0,
        last_seen: at,
      });
    }
    const c = counts.get(key)!;
    c.times++;
    if (at > c.last_seen) c.last_seen = at;
  };
  for (const a of actions) bump(a.capability_id, HUMAN_ACTIONS[a.action] || a.action, a.timestamp);
  for (const i of interventions) {
    const capId = i.capability_id || null;
    bump(capId, i.kind, i.started_at);
    const c = counts.get(`${capId || 'human'}|${i.kind}`)!;
    c.active_seconds = (c.active_seconds || 0) + (i.active_seconds || 0);
    c.waiting_seconds = (c.waiting_seconds || 0) + (i.waiting_seconds || 0);
    if (i.run_id && capId) {
      if (!runsFor.has(capId)) runsFor.set(capId, new Set());
      runsFor.get(capId)!.add(i.run_id);
    }
  }

  const all = [...counts.values()].sort((a, b) => b.times - a.times);
  for (const c of all) {
    if (c.capability_id && runsFor.has(c.capability_id)) c.runs_affected = runsFor.get(c.capability_id)!.size;
  }

  // Reducible: a middleware kind that recurred — the same human act demanded
  // repeatedly. Judgment and knowledge are keepers no matter the count.
  const reducible = all.filter(
    i => i.times >= 2 && MIDDLEWARE_KINDS.has(i.kind) && !KEEPER_KINDS.has(i.kind)
  ).map(i => ({
    ...i,
    suggested_fix: FIX_FOR[i.kind] ? FIX_FOR[i.kind].replace('%s', i.capability) : 'automate the recurring act',
  }));

  const keepers = all.filter(i => KEEPER_KINDS.has(i.kind));

  // A verification that keeps failing is a broken capability, not a grant.
  const failing = all.filter(i => i.kind === 'failed' && i.times >= 2);

  const total = all.reduce((s, i) => s + i.times, 0);
  const active = all.reduce((s, i) => s + (i.active_seconds || 0), 0);
  const waiting = all.reduce((s, i) => s + (i.waiting_seconds || 0), 0);

  return {
    window_days: window,
    interventions: total,
    active_seconds: active || undefined,
    waiting_seconds: waiting || undefined,
    top: all.slice(0, 8),
    reducible: reducible.length ? reducible : undefined,
    keepers: keepers.length ? keepers : undefined,
    broken: failing.length ? failing : undefined,
    note: reducible.length
      ? 'reducible: the same middleware act demanded repeatedly — infrastructure shaped like a person. Grant or automate once instead of asking again. Judgment and knowledge are never flagged.'
      : keepers.length
        ? 'keepers: judgment and knowledge supplied by the human — not reducible, however often they recur.'
        : undefined,
  };
}

/**
 * Builds the notification text for an ntfy push, but does not send it.
 *
 * Notifications are opt-in and local-first: nothing leaves the machine unless a
 * topic is configured and `notify` is asked to push. This function only shapes
 * the message, so it can be tested without a network and the push itself stays
 * a single, auditable step.
 */
function digestMessage(db: Migratable, days?: number | string): string {
  const d = humanDigest(db, days) as any;
  if (d.interventions === 0) return `Ambit: no human interventions in the last ${d.window_days} days.`;

  const lines = [`Ambit · human interventions, last ${d.window_days} days`, `Total: ${d.interventions}`];
  for (const i of d.top || []) {
    lines.push(`  ${i.times}× ${i.kind}: ${i.capability}`);
  }
  if (d.reducible?.length) {
    lines.push('Reducible:');
    for (const i of d.reducible) {
      lines.push(`  ${i.capability} — ${i.suggested_fix}`);
    }
  }
  return lines.join('\n');
}

/**
 * Pushes the digest to ntfy, when — and only when — a topic is configured.
 *
 * ntfy is an HTTP POST away; a topic name is the only credential. This is the
 * "summon the human" half of the attention loop: the digest is computed
 * locally, and the push happens only when someone asks for it with a topic.
 *
 *   ambit notify <topic>          push to ntfy.sh/<topic>
 *   NTFY_SERVER=... ambit notify  push to a self-hosted ntfy
 */
async function notify(db: Migratable, topic?: string, days?: number | string): Promise<any> {
  if (!topic) return { error: 'Usage: ambit notify <topic> — the ntfy topic to push to. Nothing is sent without one.' };
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  const message = digestMessage(db, days);
  try {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: message,
      headers: { 'Content-Type': 'text/plain', Title: 'Ambit · human interventions' },
    });
    if (!res.ok) return { error: `ntfy refused: ${res.status} ${res.statusText}` };
    return { pushed: topic, bytes: message.length, note: 'Sent. Only the digest text above left the machine.' };
  } catch (e: any) {
    return { error: `Could not reach ${server}: ${e?.message || e}` };
  }
}

export { humanDigest, digestMessage, notify };