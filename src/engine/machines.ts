import type { MachineModes } from '../shared/api.ts';
import { canExecute } from './assurance.ts';
import type { Db } from './db.ts';
import { RECOVERY_CAPABILITY } from './incident.ts';

/**
 * What an agent may do on each machine, asked of the gate.
 *
 * A machine is a target, not a column. Authority is per capability, and a grant
 * can be scoped to a machine (`device:nuc`), so "what may this machine's agents
 * do without asking" is `canExecute` with that machine as the target, resolved
 * as `apply` resolves it: a forbidden grant wins at any specificity, and among
 * the rest the most specific covering scope governs. It is not the narrowest of
 * the grants that cover it, which is what `ambit authority scope` reports as
 * `effective` and which would let a standing "confirm everywhere" beat a grant
 * that says "autonomous on staging", making that trade impossible to express.
 *
 * The actions are the ones the curated tree gives the capability that acts on a
 * machine, the one `ambit incidents` checks a recovery against, read from the
 * graph and not listed here. A graph that names none has nothing to ask, so the
 * answer is nothing and never a guess.
 *
 * Only this machine's own grants are consulted. Grants never travel (nothing
 * imported can widen what may run here), so a fleet can show these as counts
 * and never as another machine's rows. Read only: the gate writes nothing.
 */
function machineModes(db: Db, ids: string[]): MachineModes[] {
  const actions = db
    .prepare(
      `SELECT a.id, a.name FROM dependencies d JOIN capabilities a ON a.id = d.to_capability
       WHERE d.from_capability = ? AND d.kind = 'provides' AND a.kind = 'action'
       ORDER BY a.name`
    )
    .all<{ id: string; name: string }>(RECOVERY_CAPABILITY);
  if (!actions.length) return [];

  return ids.map(id => {
    // The graph names a machine `device:<id>`; the scan carries the manifest's
    // own id, except for the local engine, which already has the prefix.
    const target = id.startsWith('device:') ? id : `device:${id}`;
    return {
      id,
      target,
      actions: actions.map(a => {
        const answer = canExecute(db, { capability: a.id, action: 'execute', target });
        return {
          id: a.id,
          name: a.name,
          // The gate says one of three words; anything else reads as the
          // stricter one, never as a freer answer than the gate gave.
          decision:
            answer.decision === 'ALLOW' || answer.decision === 'CONFIRM' ? answer.decision : 'DENY',
          reason: answer.reason,
        };
      }),
    };
  });
}

export { machineModes };
