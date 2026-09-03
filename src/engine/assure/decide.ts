/**
 * The decision: may this actor take this action, on this target, for this
 * amount?
 *
 * `canExecute` is what the control plane consults before anything runs, and
 * the whole reason the rest of the assurance code exists. Kept apart from the
 * reports that read the same tables so that the gate is short enough to hold
 * in your head — it decides what an agent is allowed to do.
 *
 * Narrowest wins wherever two grants disagree. Two sources disagreeing about
 * permission is not a tie to break arbitrarily.
 */
import type { Db } from '../db.ts';
import { usable } from './lifecycle.ts';
import type { AuthorityRow, CapabilityRow } from '../rows.ts';

/**
 * The three words an agent acts on. Roadmap §12.3.
 *
 * `decision` has said ALLOW / CONFIRM / DENY since the control plane needed it,
 * and it is the right vocabulary for a gate. It is the wrong vocabulary for the
 * question an agent asks fifty times a session, which is closer to *may I, or
 * do I have to ask?* — so the same answer also carries a `verdict`, and a
 * `missing` list on the branch where the answer is no because something is not
 * there. Nothing is probed and nothing is executed: the answer is three indexed
 * reads, which is what makes calling it before every unfamiliar tool cheap
 * enough to be a habit rather than a decision.
 */
/**
 * The hard prerequisites this capability does not have, by name.
 *
 * Read straight off the dependency edges rather than through `planFor`: the
 * planner imports the assurance gate, so calling it from inside the gate would
 * close a cycle, and the ordered plan is a different question from *what is not
 * here*. `ambit goal <cap>` is where the order belongs.
 */
function missingPrerequisites(db: Db, capability: string): string[] {
  return db
    .prepare(
      `SELECT c.name FROM dependencies d JOIN capabilities c ON c.id = d.from_capability
       WHERE d.to_capability = ? AND d.is_hard_requisite = 1
         AND (c.state = 'locked' OR c.lifecycle IN ('degraded','broken'))
       ORDER BY c.name`
    )
    .all<Pick<CapabilityRow, 'name'>>(capability)
    .map(r => r.name);
}

/** Narrowest wins. Two sources disagreeing is not a tie to break arbitrarily. */
const MODE_RANK: Record<string, number> = { autonomous: 0, confirm: 1, forbidden: 2 };

function narrower(a: string, b: string): string {
  return (MODE_RANK[b] ?? 0) > (MODE_RANK[a] ?? 0) ? b : a;
}

/**
 * Whether a scope covers a target.
 *
 * Scope is a prefix claim: `repo:owner/name` covers `repo:owner/name` and
 * anything under it (`repo:owner/name/branch`); `device:nuc` covers that device
 * and the services on it. An empty scope is the un-scoped case — a grant that
 * was never narrowed. This is the "checked" half of the roadmap's scope
 * remainder: an authority row can carry a scope, and this answers whether that
 * scope is the one an action would actually touch.
 */
function scopeCovers(scope: string, target: string): boolean {
  if (!scope) return true; // un-scoped grants are global
  if (target === scope) return true;
  return target.startsWith(scope + '/') || target.startsWith(scope + ':');
}

/**
 * The decision API: may this actor perform this action on this target, within
 * this spend?
 *
 *   canExecute({ actor, capability, action, target, spendCents })
 *     → ALLOW | CONFIRM | DENY + reason + governing grant + scope + budget
 *
 * The answer is resolved the same way `tt authority` and `ambit authority
 * scope` resolve theirs, so the enforcement surface cannot disagree with the
 * reports: the narrowest covering grant wins, a grant that does not cover the
 * target is excluded, no covering grant means forbidden, and a capability whose
 * check is failing is refused whatever its permission says. A budget, when one
 * is declared, must have room for the spend.
 *
 * CONFIRM is not a refusal — it is "permitted, with a person in the loop". The
 * caller decides what satisfies it (an approval artifact, in apply's case).
 */
function canExecute(
  db: Db,
  input: {
    actor?: string;
    capability: string;
    action?: string;
    target?: string;
    spendCents?: number;
  }
) {
  const capability =
    input.capability.startsWith('combo:') || input.capability.includes(':')
      ? input.capability
      : `combo:${input.capability}`;
  const action = input.action || 'execute';

  const cap = db
    .prepare('SELECT id, name, state, lifecycle FROM capabilities WHERE id = ?')
    .get<Pick<CapabilityRow, 'id' | 'name' | 'state' | 'lifecycle'>>(capability);
  if (!cap) {
    return {
      decision: 'DENY',
      verdict: 'no' as const,
      reason: `Nothing in the graph supplies ${capability}. Record it as a deficit rather than working around it again.`,
      missing: [capability.replace('combo:', '')],
      capability,
      action,
    };
  }

  const grants = db
    .prepare(
      `SELECT capability_id, action, mode, holder, scope, source, note
     FROM authority WHERE capability_id = ? AND action = ?`
    )
    .all<Omit<AuthorityRow, 'id'>>(capability, action);

  const covering = grants.filter((g: any) => {
    if (g.holder && input.actor && g.holder !== input.actor) return false;
    if (g.scope && input.target && !scopeCovers(g.scope, input.target)) return false;
    return true;
  });

  const governing = covering.length
    ? covering.map((g: any) => g.mode).reduce(narrower)
    : 'forbidden';
  const grant = covering.find((g: any) => g.mode === governing);
  const scope =
    covering
      .filter(g => g.scope)
      .map(g => g.scope)
      .join(', ') || undefined;

  // Budget: declared, spent, remaining. No budget declared is no limit, and
  // the report says so rather than inventing one.
  const budget = db
    .prepare(
      'SELECT budget_cents, spent_cents FROM budgets WHERE capability_id = ? AND action = ? AND scope = ? LIMIT 1'
    )
    .get(capability, action, scope || '');
  const remaining = budget ? budget.budget_cents - budget.spent_cents : null;
  const overBudget = input.spendCents != null && remaining != null && input.spendCents > remaining;

  // The lifecycle gate: configured but failing is not working, and permission
  // does not repair a broken implementation.
  if (cap.state !== 'locked' && !usable(cap.lifecycle)) {
    return {
      decision: 'DENY',
      verdict: 'no' as const,
      reason: `${cap.name} is ${cap.lifecycle} — configured but failing verification. Re-verify before acting.`,
      missing: [cap.name],
      capability,
      action,
      governing_grant: grant,
      scope,
      remaining_budget_cents: remaining,
    };
  }
  if (governing === 'forbidden') {
    return {
      decision: 'DENY',
      verdict: 'no' as const,
      reason: covering.length
        ? `${cap.name} is forbidden for ${action}. This is not a slow yes — do not retry it under another name.`
        : `No grant covers ${cap.name} / ${action}${input.target ? ` on ${input.target}` : ''}. Ask the person for one rather than retrying.`,
      missing: covering.length ? undefined : missingPrerequisites(db, capability),
      capability,
      action,
      governing_grant: undefined,
      scope,
      remaining_budget_cents: remaining,
    };
  }
  if (overBudget) {
    return {
      decision: 'DENY',
      verdict: 'no' as const,
      reason: `Spending ${input.spendCents} cents exceeds the ${remaining} left in the budget for ${cap.name}.`,
      capability,
      action,
      governing_grant: grant,
      scope,
      remaining_budget_cents: remaining,
    };
  }

  return {
    decision: governing === 'autonomous' ? 'ALLOW' : 'CONFIRM',
    verdict: governing === 'autonomous' ? ('yes' as const) : ('ask' as const),
    reason:
      governing === 'autonomous'
        ? `${cap.name} may run unattended for ${action}.`
        : `${cap.name} is permitted for ${action}, with a person in the loop. Ask before running it.`,
    capability,
    action,
    governing_grant: grant,
    scope,
    remaining_budget_cents: remaining,
  };
}

/** Records spend against a budget, so the next canExecute sees it. */
function recordSpend(db: Db, capability: string, action: string, scope: string, cents: number) {
  db.prepare(
    `INSERT INTO budgets (capability_id, action, scope, budget_cents, spent_cents, period) VALUES (?, ?, ?, 0, ?, 'manual')
     ON CONFLICT(capability_id, action, scope) DO UPDATE SET spent_cents = spent_cents + excluded.spent_cents`
  ).run(capability, action, scope, cents);
  return { capability, action, spent_cents: cents };
}
export { MODE_RANK, narrower, scopeCovers, missingPrerequisites, canExecute, recordSpend };
