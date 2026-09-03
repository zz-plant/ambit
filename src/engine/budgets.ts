/**
 * Standing authority with a ceiling. The follow-up to §12.6.
 *
 * A grant answers *may you*, and a budget answers *how much*. Ambit has had
 * budgets since the decision API needed one, and no way to set one: they could
 * only be written by the code that records spend, so the ceiling existed and
 * the delegation did not.
 *
 * This is the difference between an agent that asks before every paid action
 * and one that has twenty dollars a month. Both are bounded; only the second
 * stops costing a person their attention. A budget is the shape of delegation
 * that fails safe — when it is spent, the answer goes back to asking, without
 * anyone having to notice or intervene.
 */
import type { Db } from './db.ts';

/** How long a period lasts, for the reset. */
const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };

/** `$20`, `20`, `2000c` — dollars declare, cents store. */
function parseAmount(input?: string | number): number | undefined {
  if (input == null || input === '') return undefined;
  const raw = String(input).trim().replace(/^\$/, '');
  const cents = /c$/i.test(raw);
  const n = Number(raw.replace(/c$/i, ''));
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Dollars declare, cents store — the convention the economics module set.
  return cents ? Math.round(n) : Math.round(n * 100);
}

/**
 * Grants a budget against a capability's action, optionally within a scope.
 *
 * Refuses a person who is not in the graph, as approval and promotion do:
 * money is authority, and an amount nobody is accountable for is not a
 * delegation, it is a leak.
 */
function setBudget(
  db: Db,
  input: {
    capability?: string;
    action?: string;
    amount?: string | number;
    period?: string;
    scope?: string;
    person?: string;
  }
) {
  const usage =
    'Usage: ambit budget set <capability> [action] --amount=$20 [--period=month] [--scope=<target>] --by=<person>';
  if (!input.capability) return { error: usage };
  const capability = input.capability.includes(':')
    ? input.capability
    : `combo:${input.capability}`;
  const action = input.action || 'execute';
  const cents = parseAmount(input.amount);
  if (cents === undefined) return { error: `${usage}\nAn amount is required, e.g. --amount=$20.` };
  const period = (input.period || 'month').toLowerCase();
  if (!PERIOD_DAYS[period]) {
    return { error: `${usage}\nPeriod is one of: ${Object.keys(PERIOD_DAYS).join(', ')}.` };
  }
  const humanId = input.person
    ? input.person.startsWith('human:')
      ? input.person
      : `human:${input.person}`
    : null;
  if (!humanId) return { error: `${usage}\nName the person granting it: --by=<person>` };
  if (
    !db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ? AND category = 'human'").get(humanId)
  ) {
    return {
      error: `${humanId} is not a person in the graph. A standing budget is money delegated in advance — it has to come from someone accountable.`,
    };
  }
  if (!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(capability)) {
    return { error: `No capability ${capability}.` };
  }

  db.prepare(
    `INSERT INTO budgets (capability_id, action, scope, budget_cents, period, spent_cents, period_start, granted_by)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'), ?)
     ON CONFLICT(capability_id, action, scope) DO UPDATE SET
       budget_cents = excluded.budget_cents,
       period = excluded.period,
       granted_by = excluded.granted_by`
  ).run(capability, action, input.scope || '', cents, period, humanId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, object) VALUES ('authority', ?, 'budget-set', 1, ?, ?)"
  ).run(
    capability,
    `${action}: ${(cents / 100).toFixed(2)} per ${period}, granted by ${humanId}`,
    input.scope || null
  );

  return {
    capability,
    action,
    scope: input.scope,
    budget: `$${(cents / 100).toFixed(2)} per ${period}`,
    granted_by: humanId,
    note: 'Spending within this no longer needs a person. When it is spent the answer goes back to asking, which is what makes a ceiling safer than a one-off approval.',
  };
}

/**
 * Rolls a budget's period over when it has elapsed.
 *
 * Called wherever a budget is read, so "per month" means per month rather than
 * "until it is gone". A budget written before periods were recorded gets its
 * clock started now rather than being treated as long expired.
 */
function rollPeriods(db: Db) {
  let rows: any[];
  try {
    rows = db.prepare('SELECT id, period, period_start FROM budgets').all();
  } catch {
    return 0;
  }
  let rolled = 0;
  for (const b of rows) {
    const days = PERIOD_DAYS[b.period] ?? 30;
    if (!b.period_start) {
      db.prepare("UPDATE budgets SET period_start = datetime('now') WHERE id = ?").run(b.id);
      continue;
    }
    const elapsed = db
      .prepare("SELECT (julianday('now') - julianday(?)) AS days")
      .get(b.period_start)?.days;
    if (typeof elapsed === 'number' && elapsed >= days) {
      db.prepare(
        "UPDATE budgets SET spent_cents = 0, period_start = datetime('now') WHERE id = ?"
      ).run(b.id);
      rolled++;
    }
  }
  return rolled;
}

/** Every standing budget, what it has left, and who granted it. */
function budgetReport(db: Db) {
  rollPeriods(db);
  const rows = db
    .prepare(
      `SELECT b.capability_id, b.action, b.scope, b.budget_cents, b.spent_cents, b.period,
              b.period_start, b.granted_by, c.name
       FROM budgets b LEFT JOIN capabilities c ON c.id = b.capability_id
       WHERE b.budget_cents > 0 ORDER BY b.capability_id, b.action`
    )
    .all<any>();
  if (!rows.length) {
    return {
      note: 'No standing budgets. `ambit budget set <cap> --amount=$20 --by=<person>` delegates spending in advance, so a paid action inside the ceiling stops needing a person.',
      budgets: [],
    };
  }
  return {
    budgets: rows.map(r => ({
      capability: r.name || r.capability_id,
      id: r.capability_id,
      action: r.action,
      scope: r.scope || undefined,
      budget: `$${(r.budget_cents / 100).toFixed(2)} per ${r.period}`,
      spent: `$${(r.spent_cents / 100).toFixed(2)}`,
      remaining: `$${((r.budget_cents - r.spent_cents) / 100).toFixed(2)}`,
      exhausted: r.spent_cents >= r.budget_cents ? true : undefined,
      period_started: r.period_start,
      granted_by: r.granted_by,
    })),
    note: 'A spent budget refuses rather than overspends, and the period resets on its own. That is what makes a ceiling safer than approving each purchase.',
  };
}

/** Withdraws a budget. The action goes back to asking. */
function clearBudget(db: Db, capability?: string, action?: string, scope?: string) {
  if (!capability) return { error: 'Usage: ambit budget clear <capability> [action] [--scope=X]' };
  const id = capability.includes(':') ? capability : `combo:${capability}`;
  const result = db
    .prepare('DELETE FROM budgets WHERE capability_id = ? AND action = ? AND scope = ?')
    .run(id, action || 'execute', scope || '');
  return (result as any)?.changes
    ? { cleared: id, action: action || 'execute', note: 'Spending needs a person again.' }
    : { error: `No budget for ${id} / ${action || 'execute'}.` };
}

export { setBudget, budgetReport, clearBudget, rollPeriods, parseAmount, PERIOD_DAYS };
