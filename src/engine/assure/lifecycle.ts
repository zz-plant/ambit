/**
 * What a capability's lifecycle is, derived from the evidence rather than
 * declared.
 *
 * `usable` is the gate the rest of the engine reads: configured-but-failing is
 * not a capability you have, so a node whose last check failed counts toward
 * neither the frontier nor unblocking anything. Split out of assurance.ts,
 * which was 749 lines holding this, the verification runner and the whole
 * authority model.
 */
import type { Db } from '../db.ts';
import { CHECK_RUN, CHECK_RUN_SQL, FAILING, REACHED_SQL, RECOVERING_SQL } from '../vocabulary.ts';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * The lifecycle a capability is actually in, derived from what it has.
 *
 *   unknown     nothing supplies it
 *   detected    something supplies it, but it is not reachable yet
 *   configured  reachable, with no check run against it
 *   verified    its check passed, and has not been run often
 *   reliable    five runs or more, and the last five all passed
 *   degraded    the last run passed, and recent ones did not: recovering
 *   broken      the last run failed
 *
 * `state` is left alone. It is what every stored frontier snapshot records, and
 * repurposing it would break the ledger to say something the ledger does not
 * ask; lifecycle sits beside it and answers the different question — not
 * whether the system can reach the capability, but how much its evidence is
 * worth. This is the distinction the whole project turns on: installed is not
 * callable is not working is not reliable.
 */
const RECENT_RUNS = 5;

/**
 * Whether a lifecycle value counts as usable. Unknown/detected imply unreached.
 *
 * `state` answers what the system can reach; `lifecycle` answers how much its
 * evidence is worth. The gate is the second, applied where availability is
 * decided: a capability whose last check failed must not be relied on,
 * planned on top of, or reported as exercisable. The latest check decides, so
 * a recovering one, whose last run passed after a failure, is usable and
 * unproven. The list is `FAILING` in vocabulary.ts.
 */
export const usable = (lifecycle?: string): boolean =>
  !lifecycle || !(FAILING as readonly string[]).includes(lifecycle);

function lifecycleFrom(
  reached: boolean,
  hasProvider: boolean,
  history: { action: string }[]
): string {
  if (!reached) return hasProvider ? 'detected' : 'unknown';
  if (history.length === 0) return 'configured';
  // evidenceFor returns newest first.
  if (history[0].action !== 'verified') return 'broken';
  const recent = history.slice(0, RECENT_RUNS);
  const allRecentPassed = recent.every(h => h.action === 'verified');
  if (!allRecentPassed) return 'degraded';
  return history.length >= RECENT_RUNS ? 'reliable' : 'verified';
}

/**
 * Recomputes lifecycle for every capability, action, and anything else carrying
 * a check.
 *
 * Runs on seed and after verification, which are the two moments the inputs can
 * change. Nothing else writes the column, so it cannot drift from the evidence
 * it is derived from.
 *
 * The third group is the agent's own registrations (§12.5). A node is included
 * because it declares a check, not because of what kind it is: a skill an agent
 * wrote and proved should degrade on a failing check exactly as a curated
 * capability does, and a lifecycle that never moved would leave it reading as
 * configured for ever however much evidence accumulated.
 *
 * The fourth is anything else a check has run against. A device or service
 * the infrastructure manifest names declares no command here: its check is
 * `ambit incidents` probing the URL the manifest gives it, and the run is
 * recorded as any other. A probe that goes unanswered leaves it broken, and
 * the next answered one brings it back, by the same rule as every check.
 */
function deriveLifecycles(db: Db): number {
  const nodes = db
    .prepare(
      `SELECT id, state FROM capabilities
       WHERE kind IN ('capability', 'action')
          OR id IN (SELECT capability_id FROM declared_checks)
          OR id IN (SELECT capability_id FROM session_learning WHERE ${CHECK_RUN_SQL})`
    )
    .all();
  const provided = new Set(
    db
      .prepare(
        "SELECT DISTINCT to_capability t FROM dependencies WHERE kind IN ('provides', 'contributes')"
      )
      .all()
      .map((r: any) => r.t)
  );
  const update = db.prepare('UPDATE capabilities SET lifecycle = ? WHERE id = ?');
  let count = 0;
  for (const node of nodes) {
    const history = db
      .prepare(
        `SELECT action FROM session_learning WHERE capability_id = ?
         AND ${CHECK_RUN_SQL} ORDER BY timestamp DESC, id DESC LIMIT ?`
      )
      .all(node.id, RECENT_RUNS * 2) as { action: string }[];
    update.run(lifecycleFrom(node.state !== 'locked', provided.has(node.id), history), node.id);
    count++;
  }
  return count;
}

/**
 * How a recovering capability's recent runs went, as a person reads them:
 * "2 of the last 5 passed". The window is the one the lifecycle reads, so the
 * phrase and the lifecycle cannot disagree about which runs count.
 */
function recentRuns(db: Db, id: string): string {
  const runs = db
    .prepare(
      `SELECT action FROM session_learning WHERE capability_id = ?
       AND ${CHECK_RUN_SQL} ORDER BY timestamp DESC, id DESC LIMIT ?`
    )
    .all<{ action: string }>(id, RECENT_RUNS);
  const passed = runs.filter(r => r.action === CHECK_RUN.passed).length;
  return `${passed} of the last ${runs.length} passed`;
}

/**
 * Every reached node that is recovering, with how its recent runs went.
 *
 * A recovering capability counts as available and is counted with the
 * unproven, and a reader who saw it there would take it for one never
 * checked. This is what a report names it with instead. Actions are left out,
 * as the summary counts leave them out.
 */
function recovering(db: Db): { id: string; name: string; recent: string }[] {
  try {
    return db
      .prepare(
        `SELECT id, name FROM capabilities
         WHERE ${REACHED_SQL} AND ${RECOVERING_SQL} AND kind != 'action' ORDER BY id`
      )
      .all<{ id: string; name: string }>()
      .map(r => ({ id: r.id, name: r.name, recent: recentRuns(db, r.id) }));
  } catch {
    return [];
  }
}

export { RECENT_RUNS, lifecycleFrom, deriveLifecycles, recentRuns, recovering };
