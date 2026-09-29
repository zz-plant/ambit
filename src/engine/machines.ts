import type { MachineModes } from '../shared/api.ts';
import { canExecute } from './assurance.ts';
import type { Db } from './db.ts';
import { RECOVERY_CAPABILITY } from './incident.ts';

/** The gate's three words, strictest first. */
const STRICTNESS = ['DENY', 'CONFIRM', 'ALLOW'] as const;

/**
 * The gate says one of three words; anything else reads as the strictest,
 * never as a freer answer than the gate gave.
 */
const word = (decision: string): (typeof STRICTNESS)[number] =>
  decision === 'ALLOW' || decision === 'CONFIRM' ? decision : 'DENY';

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
 *
 * The gate never applies a capability's grants to the actions it confers, so
 * each machine is also asked about the capability itself, the question
 * `ambit incidents` asks, and each action shows the stricter of the two
 * answers wherever the capability's answer speaks to this machine: a grant
 * refused it (rule 9: a refusal wins at any specificity), or a grant scoped to
 * cover the machine took part. Where it speaks, the table never shows more
 * than either question would allow. Where it does not, the action's own
 * answer stands: the tree grants the capability `confirm` beside
 * `read_output: autonomous`, a statement about that action at the same
 * breadth, and a capability no grant covers is refused for want of one, which
 * is no statement about this machine at all.
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
    const whole = canExecute(db, { capability: RECOVERY_CAPABILITY, action: 'execute', target });
    // The gate lists what is `missing` when it refuses for want of something:
    // no grant, or a failing check. A refusal by a grant lists nothing.
    const decidedByGrant = (whole as { missing?: unknown }).missing === undefined;
    const speaks = decidedByGrant && (whole.decision === 'DENY' || Boolean(whole.scope));
    return {
      id,
      target,
      actions: actions.map(a => {
        const own = canExecute(db, { capability: a.id, action: 'execute', target });
        const capabilityStricter =
          speaks &&
          STRICTNESS.indexOf(word(whole.decision)) < STRICTNESS.indexOf(word(own.decision));
        const answer = capabilityStricter ? whole : own;
        return {
          id: a.id,
          name: a.name,
          decision: word(answer.decision),
          reason: answer.reason,
        };
      }),
    };
  });
}

export { machineModes };
