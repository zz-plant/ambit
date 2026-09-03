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
 * How specific a scope claim is. An empty scope claims everything and is the
 * least specific thing a grant can say.
 */
function specificity(scope?: string): number {
  if (!scope) return 0;
  return scope.split(/[:/]/).filter(Boolean).length;
}

/**
 * Which grants decide, when several cover the same action.
 *
 * Narrowest-wins was the whole rule, and it made the useful negotiation
 * inexpressible. What a person actually says is rarely yes or no; it is *yes,
 * on staging* — and under narrowest-wins a grant saying "autonomous on
 * staging" could never beat the standing "confirm everywhere", so the trade of
 * a smaller blast radius for unattended operation bought nothing.
 *
 * The rule is therefore two rules, in this order:
 *
 *   1. A forbidden grant wins outright, at any specificity. What was refused
 *      is refused, and a narrower scope must never be a way to reach it.
 *   2. Among what is left, the most specific covering scope decides, because a
 *      grant written about this exact target is a later and better-informed
 *      statement than one written about everything. Ties go to the narrower
 *      mode, which is the old rule doing the job it was right for.
 */
function governingMode(covering: Array<{ mode: string; scope?: string }>): string {
  if (!covering.length) return 'forbidden';
  if (covering.some(g => g.mode === 'forbidden')) return 'forbidden';
  const mostSpecific = Math.max(...covering.map(g => specificity(g.scope)));
  return covering
    .filter(g => specificity(g.scope) === mostSpecific)
    .map(g => g.mode)
    .reduce(narrower);
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

  const governing = governingMode(covering as any);
  const grant = covering.find((g: any) => g.mode === governing);

  // A declared practice environment: somewhere the person has said acting does
  // not matter. It relaxes a confirmation, never a refusal — rehearsing a
  // forbidden action in a sandbox would be a way round the refusal rather than
  // a way to earn past it.
  const sandbox =
    input.target && governing !== 'forbidden' ? sandboxCovering(db, input.target) : null;
  const scope =
    covering
      .filter(g => g.scope)
      .map(g => g.scope)
      .join(', ') || undefined;

  // Budget: declared, spent, remaining. No budget declared is no limit, and
  // the report says so rather than inventing one.
  //
  // An elapsed period is treated as spent-nothing without writing the reset.
  // "Twenty dollars a month" has to mean per month even when the first call
  // after the month turns over is a read, and a decision API that wrote to the
  // database to answer a question would be a surprising thing to put in front
  // of every action.
  const budget = db
    .prepare(
      `SELECT budget_cents, spent_cents, period, period_start
       FROM budgets WHERE capability_id = ? AND action = ? AND scope = ? LIMIT 1`
    )
    .get(capability, action, scope || '');
  const spent = budget ? (periodElapsed(db, budget) ? 0 : budget.spent_cents) : 0;
  const remaining = budget ? budget.budget_cents - spent : null;
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

  const unattended = governing === 'autonomous' || Boolean(sandbox);
  return {
    decision: unattended ? 'ALLOW' : 'CONFIRM',
    verdict: unattended ? ('yes' as const) : ('ask' as const),
    reason: sandbox
      ? `${input.target} is a sandbox ${sandbox.declared_by} declared, so ${cap.name} runs unattended there. It stays at confirm elsewhere.`
      : governing === 'autonomous'
        ? `${cap.name} may run unattended for ${action}.`
        : `${cap.name} is permitted for ${action}, with a person in the loop. Ask before running it.`,
    capability,
    action,
    governing_grant: grant,
    scope,
    sandbox: sandbox?.target,
    // What this action has actually been proved to do to this object, as
    // opposed to what it has been proved to do in general. Reading repository A
    // is a different fact from reading repository B, and an answer about a
    // target should say which one it has.
    evidence_here: input.target ? objectEvidence(db, capability, action, input.target) : undefined,
    remaining_budget_cents: remaining,
  };
}

/** Whether a budget's period has rolled over since it was last reset. */
function periodElapsed(db: Db, budget: { period?: string; period_start?: string | null }): boolean {
  if (!budget.period_start) return false;
  const days: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
  const span = days[budget.period || 'month'] ?? 30;
  const elapsed = db
    .prepare("SELECT (julianday('now') - julianday(?)) AS days")
    .get(budget.period_start)?.days;
  return typeof elapsed === 'number' && elapsed >= span;
}

/** The declared sandbox covering a target, if one does. */
function sandboxCovering(db: Db, target: string) {
  try {
    return (
      db
        .prepare('SELECT target, declared_by FROM sandboxes')
        .all<{ target: string; declared_by: string }>()
        .find(s => scopeCovers(s.target, target)) || null
    );
  } catch {
    return null; // database predates the table
  }
}

/**
 * Passing and failing checks recorded against this action *on this object*.
 *
 * Evidence has always been per capability, which is the grain the curated model
 * has. It is not the grain anyone acts at: an agent that has committed to one
 * repository forty times has proved nothing about the next one. Recording the
 * object is the first half of the roadmap's remaining architectural move, and
 * this is where it is read.
 */
function objectEvidence(db: Db, capability: string, action: string, object: string) {
  try {
    const row = db
      .prepare(
        `SELECT SUM(CASE WHEN action = 'verified' THEN 1 ELSE 0 END) AS passes,
                SUM(CASE WHEN action = 'failed' THEN 1 ELSE 0 END) AS failures,
                MAX(timestamp) AS last_seen
         FROM session_learning
         WHERE capability_id IN (?, ?) AND object = ? AND action IN ('verified','failed')`
      )
      .get(capability, `act:${capability.replace('combo:', '')}/${action}`, object);
    if (!row?.passes && !row?.failures) return undefined;
    return { passes: row.passes ?? 0, failures: row.failures ?? 0, last_seen: row.last_seen };
  } catch {
    return undefined;
  }
}

/**
 * Records spend against a budget, so the next canExecute sees it.
 *
 * Only ever against a budget that exists. The previous version inserted one
 * with a ceiling of zero when none was declared, which made recording a single
 * cent of spend against an unbudgeted capability refuse every later spend
 * for ever — remaining came out negative, and `ambit budget` hid the row that
 * was doing it, because a report of standing budgets reasonably skips the ones
 * with no ceiling. Spending where nothing was delegated is not a budget with no
 * room; it is an absence of a budget, and the answer says so.
 */
function recordSpend(db: Db, capability: string, action: string, scope: string, cents: number) {
  const existing = db
    .prepare(
      'SELECT id, budget_cents, spent_cents FROM budgets WHERE capability_id = ? AND action = ? AND scope = ?'
    )
    .get<{ id: number; budget_cents: number; spent_cents: number }>(capability, action, scope);
  if (!existing) {
    return {
      capability,
      action,
      spent_cents: cents,
      recorded: false,
      note: `No budget covers ${capability} / ${action}. The spend is not tracked against a ceiling — ambit budget set ${capability.replace('combo:', '')} --amount=$N --by=<person> declares one.`,
    };
  }
  db.prepare('UPDATE budgets SET spent_cents = spent_cents + ? WHERE id = ?').run(
    cents,
    existing.id
  );
  const remaining = existing.budget_cents - (existing.spent_cents + cents);
  return {
    capability,
    action,
    spent_cents: cents,
    recorded: true,
    remaining_cents: remaining,
    note:
      remaining <= 0
        ? 'The budget is spent. This action asks a person again until the period turns over.'
        : undefined,
  };
}
export {
  MODE_RANK,
  narrower,
  specificity,
  governingMode,
  scopeCovers,
  sandboxCovering,
  objectEvidence,
  missingPrerequisites,
  canExecute,
  recordSpend,
};
