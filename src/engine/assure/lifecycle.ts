/**
 * What a capability's lifecycle is, derived from the evidence rather than
 * declared.
 *
 * `usable` is the gate the rest of the engine reads: configured-but-failing is
 * not a capability you have, so a degraded or broken node counts toward
 * neither the frontier nor unblocking anything. Split out of assurance.ts,
 * which was 749 lines holding this, the verification runner and the whole
 * authority model.
 */
import type { Db } from '../db.ts';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * The lifecycle a capability is actually in, derived from what it has.
 *
 *   unknown     nothing supplies it
 *   detected    something supplies it, but it is not reachable yet
 *   configured  reachable, with no check run against it
 *   verified    its check passed, and has not been run often
 *   reliable    five runs or more, and the last five all passed
 *   degraded    the last run passed, and recent ones did not
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
 * Lifecycle values that mean the capability is not currently working.
 *
 * `state` answers what the system can reach; `lifecycle` answers how much its
 * evidence is worth. The gate is the second, applied where availability is
 * decided: a capability that is reachable but degraded or broken must not be
 * relied on, planned on top of, or reported as exercisable — configured is not
 * working, and a check failing is evidence that it is not.
 */
export const FAILING_LIFECYCLES = ['degraded', 'broken'] as const;

/** Whether a lifecycle value counts as usable. Unknown/detected imply unreached. */
export const usable = (lifecycle?: string): boolean =>
  !lifecycle || !FAILING_LIFECYCLES.includes(lifecycle as any);

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
 */
function deriveLifecycles(db: Db): number {
  const nodes = db
    .prepare(
      `SELECT id, state FROM capabilities
       WHERE kind IN ('capability', 'action')
          OR id IN (SELECT capability_id FROM declared_checks)`
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
         AND action IN ('verified','failed') ORDER BY timestamp DESC, id DESC LIMIT ?`
      )
      .all(node.id, RECENT_RUNS * 2) as { action: string }[];
    update.run(lifecycleFrom(node.state !== 'locked', provided.has(node.id), history), node.id);
    count++;
  }
  return count;
}

export { RECENT_RUNS, lifecycleFrom, deriveLifecycles };
