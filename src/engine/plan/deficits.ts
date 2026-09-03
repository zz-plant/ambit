/**
 * What keeps stopping work, and whether it is structural.
 *
 * A deficit recorded once is friction; the same one recorded repeatedly is
 * infrastructure that should exist. The classification is the point — a
 * capability blocked four times for four different reasons is a different
 * finding from one blocked four times for the same reason.
 */
import type { Db } from '../db.ts';
import { usable } from '../assurance.ts';

/**
 * Why a task was blocked, as distinct from *what* was missing.
 *
 * §6's unbuilt half. A block recorded against a capability says "the
 * capability was missing", which is the easy case. The useful claim is the
 * classification: was it a missing tool, a missing permission, missing
 * knowledge, weak infrastructure, an unreliable capability, or plain
 * reasoning? The same capability can be blocked by different causes on
 * different days, and "structural" should mean the cause recurs, not that the
 * capability name does.
 */
const BLOCK_CLASSES = [
  'reasoning',
  'knowledge',
  'tool',
  'permission',
  'infrastructure',
  'reliability',
] as const;
type BlockClass = (typeof BLOCK_CLASSES)[number];

const BLOCK_PREFIX = 'blocked:';

/**
 * The stored action for a classified block. `blocked` remains valid for rows
 * recorded before classification existed; the prefix is what new rows carry.
 */
function blockedAction(classifier?: string): string {
  return classifier ? `${BLOCK_PREFIX}${classifier}` : 'blocked';
}

/**
 * Records a task failure against the capability that was missing, and why.
 *
 * The point is not the individual failure, it is the pattern. A deficit hit
 * once is bad luck; the same one hit four times is infrastructure that should
 * exist. `tt deficits` reports the recurring ones, which is the signal for
 * turning friction into a capability rather than working around it again.
 *
 *   tt failed vector-store tool "semantic search over notes"
 *   tt failed vector-store reasoning
 *
 * The classification is one of: reasoning, knowledge, tool, permission,
 * infrastructure, reliability. Omitting it records an unclassified block,
 * which is exactly what the CLI did before classification existed.
 */
function recordFailure(db: Db, capId?: string, classifier?: string, note?: string) {
  if (!capId)
    return {
      error:
        'Usage: ambit record <capability> [reasoning|knowledge|tool|permission|infrastructure|reliability] ["what you were trying to do"]',
    };
  const id = capId.startsWith('combo:') || capId.includes(':') ? capId : `combo:${capId}`;
  if (!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id)) {
    return {
      error: `No capability ${id}. Use an id from ambit graph combos, so deficits aggregate against something real.`,
    };
  }
  // The second positional may be a classification or — for a call that predates
  // classification — the note itself. Only a known class is taken as one.
  const cls =
    classifier && BLOCK_CLASSES.includes(classifier as BlockClass) ? classifier : undefined;
  const storedNote = cls ? note || null : classifier || null;
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('task', ?, ?, 0, ?)"
  ).run(id, blockedAction(cls), storedNote);
  const count = db
    .prepare(
      "SELECT COUNT(*) AS n FROM session_learning WHERE capability_id = ? AND (action = 'blocked' OR action LIKE 'blocked:%')"
    )
    .get(id);
  const clsCount = cls
    ? db
        .prepare(
          'SELECT COUNT(*) AS n FROM session_learning WHERE capability_id = ? AND action = ?'
        )
        .get(id, blockedAction(cls))
    : undefined;
  return {
    recorded: id,
    classification: cls || 'unclassified',
    times_blocked: count?.n ?? 1,
    times_as_this_class: clsCount?.n ?? undefined,
    note:
      (count?.n ?? 1) >= 3
        ? 'This has blocked work repeatedly. It is a structural deficit, not a one-off — see ambit goal ' +
          id.replace('combo:', '')
        : undefined,
  };
}

/**
 * Capability deficits that keep recurring, worst first.
 *
 * Distinguishes incidental friction from the structural kind: whether the same
 * missing capability keeps stopping different work — and, since §6, *why* it
 * keeps stopping it. A capability blocked four times as a missing tool and
 * once as a missing permission is one structural deficit about the tool and an
 * incident about the permission; collapsing them would lose the distinction.
 */
function deficits(db: Db) {
  const rows = db
    .prepare(
      `SELECT s.capability_id id, COUNT(*) AS times, MAX(s.timestamp) AS last_seen, c.name, c.state, c.lifecycle
       FROM session_learning s JOIN capabilities c ON c.id = s.capability_id
       WHERE s.action = 'blocked' OR s.action LIKE 'blocked:%'
       GROUP BY s.capability_id ORDER BY times DESC, last_seen DESC`
    )
    .all();
  if (rows.length === 0) {
    return {
      note: 'Nothing recorded. Use ambit record <capability> when a task is blocked by a missing one.',
    };
  }

  const byClass = db
    .prepare(
      `SELECT s.capability_id id, replace(s.action, 'blocked:', '') AS class, COUNT(*) AS times
       FROM session_learning s
       WHERE s.action LIKE 'blocked:%'
       GROUP BY s.capability_id, s.action ORDER BY times DESC`
    )
    .all<{ id: string; class: string; times: number }>();
  const classOf = new Map<string, string[]>();
  for (const r of byClass) {
    if (!classOf.has(r.id)) classOf.set(r.id, []);
    classOf.get(r.id)!.push(`${r.class} ×${r.times}`);
  }

  // The cause that recurs most for each capability, which is what decides
  // whether a deficit is an acquisition, a repair, or a permission somebody
  // has to grant. Before failures were captured from the runtime (§12.2) a
  // permission-class deficit was rare enough not to need its own verdict; now
  // it is the common case, and "was structural; now reached" is the wrong
  // thing to say about a server that answers 403 three times a week.
  const dominant = new Map<string, string>();
  for (const r of byClass) if (!dominant.has(r.id)) dominant.set(r.id, r.class);

  return rows.map((r: any) => ({
    name: r.name,
    id: r.id,
    times_blocked: r.times,
    last_seen: r.last_seen,
    still_missing: r.state === 'locked' || !usable(r.lifecycle),
    // The classification distribution, not just the count: a deficit that
    // recurs as the same cause is structural; one that recurs as several
    // causes is a capability that keeps failing for different reasons, which
    // is a different signal.
    causes: classOf.get(r.id),
    verdict:
      r.times >= 3 && r.state === 'locked'
        ? 'structural — build it'
        : r.times >= 3 && !usable(r.lifecycle)
          ? 'structural — configured but failing verification'
          : r.times >= 3 && dominant.get(r.id) === 'permission'
            ? 'structural — reached, and refused. This is a grant, not an acquisition'
            : r.times >= 3 && dominant.get(r.id) === 'infrastructure'
              ? 'structural — reached, and unreachable. This is a repair, not an acquisition'
              : r.times >= 3
                ? 'was structural; now reached'
                : 'incidental so far',
    recommendation:
      r.times >= 3 && r.state === 'locked'
        ? `ambit propose ${r.id.replace('combo:', '')}`
        : r.times >= 3 && !usable(r.lifecycle)
          ? `ambit verify ${r.id.replace('combo:', '')}`
          : r.times >= 3 && dominant.get(r.id) === 'permission'
            ? `ambit authority ${r.id.replace('combo:', '')}`
            : undefined,
  }));
}

export { BLOCK_CLASSES, BLOCK_PREFIX, blockedAction, recordFailure, deficits };
