import type { Migratable } from "./migrate.ts";
import { attentionValueCentsPerHour } from "./economics.ts";

/**
 * Realized ROI: what an applied proposal actually changed, measured from the
 * work ledger before and after it ran.
 *
 * This is the feedback loop that makes the opportunity engine an engine rather
 * than speculation. A proposal carries a prediction (its economic case); once
 * it is applied, this module opens a before window and an after window on the
 * same capability and compares intervention count, human hours, attention
 * dollars, and reliability. The observed figure is written back onto the
 * proposal, so the next prediction has evidence to learn from.
 *
 * The windows are honest about what they can measure: interventions and their
 * time are ledger facts. The attention rate is the declared model. And the
 * verdict is a range, not a precision — near forecast, above, below, or "too
 * early to say" when the after window has not accumulated anything yet.
 */

const WINDOW_DAYS = 60;

/** SQLite's datetime('now') shape: space, not T, no zone. */
function sqliteDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function parseDatetime(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}

interface WindowStats {
  interventions: number;
  active_seconds: number;
  waiting_seconds: number;
  human_hours: number;
  attention_dollars: number;
  failures: number;
}

function windowStats(db: Migratable, capabilityId: string, start: string, end: string, rate: number, endInclusive = false, startExclusive = false): WindowStats {
  const startOp = startExclusive ? '>' : '>=';
  const endOp = endInclusive ? '<=' : '<';
  const row = db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(active_seconds),0) active, COALESCE(SUM(waiting_seconds),0) waiting
     FROM human_intervention WHERE capability_id = ? AND started_at ${startOp} ? AND started_at ${endOp} ?`
  ).get(capabilityId, start, end) as any;
  const failures = (db.prepare(
    `SELECT COUNT(*) n FROM session_learning WHERE capability_id = ? AND action = 'failed' AND timestamp ${startOp} ? AND timestamp ${endOp} ?`
  ).get(capabilityId, start, end) as any)?.n || 0;
  const hours = ((row?.active || 0) + (row?.waiting || 0)) / 3600;
  return {
    interventions: row?.n || 0,
    active_seconds: row?.active || 0,
    waiting_seconds: row?.waiting || 0,
    human_hours: Math.round(hours * 10) / 10,
    attention_dollars: Math.round(hours * rate) / 100,
    failures,
  };
}

/**
 * The before/after report for an applied proposal.
 *
 *   ambit roi prop-492
 */
function roiFor(db: Migratable, proposalId?: string) {
  if (!proposalId) return { error: 'Usage: ambit roi <proposal-id>' };
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status !== 'applied' || !row.applied_at) {
    return { error: `${proposalId} is ${row.status}; ROI needs an apply to measure against.` };
  }

  const steps = JSON.parse(row.steps);
  const capId = steps[steps.length - 1]?.id || row.goal_id || null;
  const capName = capId
    ? (db.prepare("SELECT name FROM capabilities WHERE id = ?").get(capId) as any)?.name || capId
    : row.goal;

  const actor = row.approved_by || 'human:kanav';
  const rate = attentionValueCentsPerHour(db, actor);
  const applied = row.applied_at;

  // Windows computed in JS so the SQL stays a clean range comparison.
  // The split is deliberately conservative: work recorded in the same SQLite
  // second as the apply counts as *before*, never as post-apply savings — an
  // ambiguous second must not inflate the measured result.
  const appliedDate = parseDatetime(applied);
  const beforeStart = sqliteDatetime(new Date(appliedDate.getTime() - WINDOW_DAYS * 864e5));
  const before = capId ? windowStats(db, capId, beforeStart, applied, rate, true) : null;
  const after = capId ? windowStats(db, capId, applied, sqliteDatetime(new Date()), rate, true, true) : null;

  const prediction = row.economic_case ? (() => {
    try { return JSON.parse(row.economic_case); } catch { return null; }
  })() : null;

  // Observed, annualized from the after window's monthly rate.
  const observedReduction = (before && after) ? before.human_hours - after.human_hours : 0;
  const projectedHoursSavedYear = Math.round(observedReduction * 12 * 10) / 10;
  const projectedDollarsYear = Math.round(observedReduction * rate * 12) / 100;

  // Reliability: did the capability keep working after it was acquired?
  const reliability = {
    before_failures: before?.failures || 0,
    after_failures: after?.failures || 0,
  };

  // Verdict against the prediction, when there was one.
  const predictedHours = prediction?.predicted?.human_hours_saved_per_year;
  let verdict: string;
  if (!predictedHours) verdict = 'no forecast to compare — the proposal carried no economic case';
  else if (!after || after.interventions === 0 && observedReduction === 0) verdict = 'too early to say — no after-window activity yet';
  else {
    const ratio = projectedHoursSavedYear / predictedHours;
    verdict = ratio >= 1.3 ? 'outperforming forecast'
      : ratio >= 0.7 ? 'performing near forecast'
      : 'below forecast';
  }

  const observed = {
    before_window_days: WINDOW_DAYS,
    after_window_days: 0,
    before,
    after,
    projected_hours_saved_per_year: projectedHoursSavedYear,
    projected_attention_dollars_per_year: projectedDollarsYear,
    reliability,
    verdict,
  };

  // Write the observation back so the next prediction has evidence.
  db.prepare("UPDATE proposals SET observed_roi = ? WHERE id = ?")
    .run(JSON.stringify(observed), proposalId);

  return {
    proposal: proposalId,
    goal: row.goal,
    capability: capName,
    applied_at: row.applied_at,
    predicted: prediction?.predicted || null,
    observed,
    note: 'windows are 60 days before and everything since the apply; attention dollars use the declared rate; the verdict is a range, not a precision.',
  };
}

/**
 * The cumulative headline: what every applied proposal has saved, and whether
 * the predictions held.
 *
 *   ambit roi            → this environment, year to date
 *
 * This is the sales artifact — the number you show a buyer in the first
 * meeting — and the feedback number the opportunity engine's next predictions
 * are checked against.
 */
function roiSummary(db: Migratable) {
  const applied = db.prepare(
    "SELECT id, goal, applied_at, economic_case, observed_roi FROM proposals WHERE status = 'applied' ORDER BY applied_at"
  ).all() as any[];

  const measured: any[] = [];
  let pending = 0;
  for (const p of applied) {
    const obs = p.observed_roi ? (() => { try { return JSON.parse(p.observed_roi); } catch { return null; } })() : null;
    if (!obs) { pending++; continue; }
    const prediction = p.economic_case ? (() => { try { return JSON.parse(p.economic_case); } catch { return null; } })() : null;
    measured.push({
      id: p.id,
      goal: p.goal,
      applied_at: p.applied_at,
      predicted_hours_per_year: prediction?.predicted?.human_hours_saved_per_year ?? null,
      observed_hours_per_year: obs.projected_hours_saved_per_year ?? 0,
      observed_dollars_per_year: obs.projected_attention_dollars_per_year ?? 0,
      verdict: obs.verdict,
    });
  }

  const hours = measured.reduce((s, m) => s + (m.observed_hours_per_year || 0), 0);
  const dollars = measured.reduce((s, m) => s + (m.observed_dollars_per_year || 0), 0);

  // Prediction accuracy: the ratio of observed to predicted, per proposal,
  // with a verdict that is a range. Averages across measured proposals only.
  const withPrediction = measured.filter((m) => m.predicted_hours_per_year != null && m.predicted_hours_per_year > 0);
  const ratios = withPrediction.map((m) => m.observed_hours_per_year / m.predicted_hours_per_year);
  const near = ratios.filter((r) => r >= 0.7 && r <= 1.3).length;
  const accuracy = ratios.length
    ? Math.round(ratios.reduce((s, r) => s + Math.min(r, 2), 0) / ratios.length * 100) / 100
    : null;

  return {
    proposals_applied: applied.length,
    measurements: measured.length,
    pending_measurements: pending,
    observed_hours_saved_per_year: Math.round(hours * 10) / 10,
    observed_dollars_saved_per_year: Math.round(dollars),
    prediction: accuracy != null
      ? {
          average_ratio: accuracy,
          near_forecast: near,
          of: ratios.length,
          note: 'ratio = observed ÷ predicted; 1.0 means the forecast held, 0.7–1.3 is near forecast.',
        }
      : undefined,
    per_proposal: measured,
    note: applied.length === 0
      ? 'Nothing applied yet — roi has nothing to measure until a proposal is approved and applied. Try `ambit opportunities` for what to propose first.'
      : 'observed figures come from before/after windows in the work ledger — measured, not estimated.',
  };
}

export { roiFor, roiSummary };