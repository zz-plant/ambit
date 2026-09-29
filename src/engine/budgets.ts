/**
 * Standing authority with a ceiling. The follow-up to §12.6.
 *
 * A grant answers *may you*, and a budget answers *how much*. Ambit has had
 * budgets since the decision API needed one, and no way to set one: they could
 * only be written by the code that records spend, so the ceiling existed and a
 * person had no way to set it.
 *
 * A budget is the shape of limit that fails safe: a spend past the ceiling is
 * refused until the period turns over, without anyone having to notice or
 * intervene. Paired with an autonomous grant it is the difference between an
 * agent that asks before every paid action and one that has twenty dollars a
 * month, and only that pair stops costing a person their attention.
 *
 * It bounds a grant and does not widen one. Within the ceiling the grant's own
 * mode still decides, so the attention it saves is the autonomous grant's, kept
 * from running away; a `confirm` action still asks. `canExecute` reads the
 * ceiling only when the call states a spend.
 */
import type { Db } from './db.ts';

/** How long a period lasts, for the reset. */
const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };

const DAY_MS = 86_400_000;

/** A period nobody named is a month, which is how the reset has always read it. */
function periodLength(period?: string | null): number {
  return PERIOD_DAYS[period || 'month'] ?? 30;
}

/**
 * Days since a budget's period began, on the database's own clock, or nothing
 * when it has no start or the stamp will not read. Reads only.
 */
function daysIntoPeriod(db: Db, budget: { period_start?: string | null }): number | null {
  if (!budget.period_start) return null;
  const elapsed = db
    .prepare("SELECT (julianday('now') - julianday(?)) AS days")
    .get(budget.period_start)?.days;
  return typeof elapsed === 'number' ? elapsed : null;
}

/** The rule itself, on days already measured: a period is over once it has run its length. */
const periodRanOut = (days: number | null, period?: string | null): boolean =>
  days != null && days >= periodLength(period);

/**
 * Whether a budget's period has run out since it was last reset.
 *
 * The one rule for it. The reset below writes when it holds; the gate and the
 * loop page read an elapsed period as spent-nothing and write nothing, so a
 * figure for what is spent means the same on all three.
 */
function periodElapsed(
  db: Db,
  budget: { period?: string | null; period_start?: string | null }
): boolean {
  return periodRanOut(daysIntoPeriod(db, budget), budget.period);
}

/** A pace measured over less than this share of a period is a few hours, not a pace. */
const MIN_PACE_SHARE = 0.05;

/** A stored timestamp, in the space form SQLite writes or as ISO, read as UTC. */
function stampMs(stamp: string): number {
  return new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`).getTime();
}

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Where a period lands at the pace so far, and the day that pace reaches the
 * ceiling. Linear: what is spent, divided by the share of the period that has
 * run. Nothing when nothing is spent, or when too little of the period has run
 * for a pace to mean anything: a projection from an hour of data is a number
 * with no claim behind it.
 *
 * `hitsCeilingOn` is present only while the ceiling is still ahead. Once it is
 * reached the question is moot, and a date in the past would answer it wrongly.
 */
function forecastSpend(input: {
  spentCents: number;
  budgetCents: number;
  period?: string | null;
  periodStart: string;
  elapsedDays: number;
}): { landsCents: number; hitsCeilingOn?: string } | null {
  const share = input.elapsedDays / periodLength(input.period);
  if (!(input.spentCents > 0) || !(share >= MIN_PACE_SHARE)) return null;
  const lands = input.spentCents / share;
  const landsCents = Math.round(lands);
  if (input.spentCents >= input.budgetCents || lands <= input.budgetCents) return { landsCents };
  const start = stampMs(input.periodStart);
  if (!Number.isFinite(start)) return { landsCents };
  // The pace is spent per day, so the ceiling is that many days in.
  const hit = start + (input.budgetCents / input.spentCents) * input.elapsedDays * DAY_MS;
  return { landsCents, hitsCeilingOn: dateOf(hit) };
}

/**
 * What one budget row means right now, read and never written: the spend of
 * the period it is in, when that period turns over, and the pace so far.
 *
 * A period that has run out reads as spent-nothing and as having no start,
 * exactly as the gate reads it, because the reset that would start the next one
 * writes, and a page that drew a stored figure the gate ignores would disagree
 * with it. `rollPeriods` stays with `budgetReport`, which `ambit budget` and the
 * MCP budgets tool call; nothing that serves a page does.
 */
function budgetStanding(
  db: Db,
  row: {
    budget_cents: number;
    spent_cents: number;
    period?: string | null;
    period_start?: string | null;
  }
) {
  const elapsedDays = daysIntoPeriod(db, row);
  const ranOut = periodRanOut(elapsedDays, row.period);
  // A start the clock cannot read is no start: nothing is drawn from it.
  const start = row.period_start ? stampMs(row.period_start) : Number.NaN;
  const periodStart = ranOut || !Number.isFinite(start) ? null : (row.period_start ?? null);
  return {
    spentCents: ranOut ? 0 : row.spent_cents,
    periodStart,
    periodEndsOn: periodStart ? dateOf(start + periodLength(row.period) * DAY_MS) : null,
    forecast:
      periodStart && elapsedDays != null
        ? forecastSpend({
            spentCents: row.spent_cents,
            budgetCents: row.budget_cents,
            period: row.period,
            periodStart,
            elapsedDays,
          })
        : null,
  };
}

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
      error: `${humanId} is not a person in the graph. A standing budget is a ceiling a person sets in advance — it has to come from someone accountable.`,
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
    note: "A spend past this ceiling is refused until the period turns over, for any caller that states its spend, which is what makes a ceiling safer than a one-off approval. Within it the grant's own mode still decides: a budget bounds an autonomous grant and does not create one.",
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
    if (!b.period_start) {
      db.prepare("UPDATE budgets SET period_start = datetime('now') WHERE id = ?").run(b.id);
      continue;
    }
    if (periodElapsed(db, b)) {
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
      note: "No standing budgets. `ambit budget set <cap> --amount=$20 --by=<person>` sets a ceiling on what may be spent in a period. A spend past it is refused until the period turns over; within it the grant's own mode still decides.",
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

/** Withdraws a budget. Nothing bounds a spend on the action after that, and its grant's own mode decides. */
function clearBudget(db: Db, capability?: string, action?: string, scope?: string) {
  if (!capability) return { error: 'Usage: ambit budget clear <capability> [action] [--scope=X]' };
  const id = capability.includes(':') ? capability : `combo:${capability}`;
  const result = db
    .prepare('DELETE FROM budgets WHERE capability_id = ? AND action = ? AND scope = ?')
    .run(id, action || 'execute', scope || '');
  return (result as any)?.changes
    ? { cleared: id, action: action || 'execute', note: "Nothing bounds a spend on it now, and its grant's own mode decides." }
    : { error: `No budget for ${id} / ${action || 'execute'}.` };
}

export {
  setBudget,
  budgetReport,
  budgetStanding,
  clearBudget,
  forecastSpend,
  parseAmount,
  periodElapsed,
  periodLength,
  rollPeriods,
  PERIOD_DAYS,
};
