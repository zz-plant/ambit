import type { Db } from "./db.ts";
import { usable } from "./assurance.ts";

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
 */

interface Intervention {
  kind: string;
  capability: string;
  capability_id: string;
  times: number;
  last_seen: string;
}

/** The human actions session_learning records, mapped to what they are. */
const HUMAN_ACTIONS: Record<string, string> = {
  approved: 'approval',
  applied: 'application',
  'blocked:permission': 'permission block',
};

/**
 * How often the human intervened, and which interventions are likely reducible.
 *
 *   tt digest          → the last week
 *   tt digest 30       → the last 30 days
 *
 * Reducible is the interesting column: an approval the human gave three times
 * for the same capability is infrastructure shaped like a person — the fix is
 * an authority grant, not another reminder. A permission block that recurred
 * is the same. A verification that keeps failing is a broken capability to
 * repair, which is a different fix and is reported as such.
 */
function humanDigest(db: Db, days?: string | number) {
  const window = days && Number(days) > 0 ? Number(days) : 7;

  const actions = db
    .prepare(
      `SELECT capability_id, action, timestamp FROM session_learning
       WHERE action IN ('approved', 'applied', 'blocked:permission', 'failed')
         AND timestamp >= datetime('now', ?)
       ORDER BY timestamp DESC`
    )
    .all(`-${window} days`) as any[];

  if (actions.length === 0) {
    return {
      window_days: window,
      interventions: 0,
      note: `No human interventions recorded in the last ${window} days.`,
    };
  }

  const nameOf = new Map(
    db.prepare("SELECT id, name FROM capabilities").all().map((c: any) => [c.id, c.name])
  );

  // Count per (capability, kind), so a capability approved three times is one
  // recurring intervention, not three accidents.
  const counts = new Map<string, Intervention>();
  for (const a of actions) {
    const kind = HUMAN_ACTIONS[a.action] || a.action;
    const key = `${a.capability_id}|${kind}`;
    if (!counts.has(key)) {
      counts.set(key, {
        kind,
        capability: nameOf.get(a.capability_id) || a.capability_id,
        capability_id: a.capability_id,
        times: 0,
        last_seen: a.timestamp,
      });
    }
    counts.get(key)!.times++;
  }

  const all = [...counts.values()].sort((a, b) => b.times - a.times);

  // Reducible: an approval or permission block that recurred — the same human
  // act demanded repeatedly. A verification failure is not reducible by a
  // grant; it is a broken capability, reported separately.
  const reducible = all.filter(
    i => i.times >= 2 && (i.kind === 'approval' || i.kind === 'permission block')
  );

  const failing = all.filter(i => i.kind === 'failed' && i.times >= 2);

  const total = all.reduce((s, i) => s + i.times, 0);

  return {
    window_days: window,
    interventions: total,
    top: all.slice(0, 8),
    reducible: reducible.length
      ? reducible.map(i => ({
          ...i,
          suggested_fix: i.kind === 'approval'
            ? `grant bounded authority for ${i.capability} rather than approving each time`
            : `grant the missing permission for ${i.capability} once`,
        }))
      : undefined,
    broken: failing.length ? failing : undefined,
    note: reducible.length
      ? 'reducible: the same human act demanded repeatedly — infrastructure shaped like a person. Grant the authority once instead of asking again.'
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
function digestMessage(db: Db, days?: string | number): string {
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
 *   tt notify <topic>          push to ntfy.sh/<topic>
 *   NTFY_SERVER=... tt notify  push to a self-hosted ntfy
 */
async function notify(db: Db, topic?: string, days?: string | number): Promise<any> {
  if (!topic) return { error: 'Usage: tt notify <topic> — the ntfy topic to push to. Nothing is sent without one.' };
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  const message = digestMessage(db, days);
  try {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: message,
      // Title is an HTTP header; ntfy reads headers as Latin-1, so the non-ASCII
      // middle dot stays in the body (UTF-8 text/plain) and the header stays
      // plain ASCII.
      headers: { 'Content-Type': 'text/plain', Title: 'Ambit: human interventions' },
    });
    if (!res.ok) return { error: `ntfy refused: ${res.status} ${res.statusText}` };
    return { pushed: topic, bytes: message.length, note: 'Sent. Only the digest text above left the machine.' };
  } catch (e: any) {
    return { error: `Could not reach ${server}: ${e?.message || e}` };
  }
}

export { humanDigest, digestMessage, notify };