import type { Db } from './db.ts';
import { canExecute } from './assurance.ts';

/**
 * The audit trail: who approved what, what ran, against what target, under
 * which grant, and whether it worked.
 *
 * Every piece of the trail already lives in the ledger — runs, events,
 * interventions, approvals, signed artifacts, verification outcomes. This is
 * the report that assembles them, which is the question a governance buyer
 * asks first: not "what is configured" but "what happened, who authorised it,
 * and did it hold".
 *
 *   ambit audit <run-id>          one run, end to end
 *   ambit audit <proposal-id>     one proposal: steps, approval, grants, result
 *   ambit audit <human:name>      what that person approved and handled
 *   ambit audit [days]            the recent trail — what happened lately
 */

function auditRun(db: Db, runId: string) {
  const run = db.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId);
  if (!run) return { error: `No run ${runId}.` };
  const events = db
    .prepare(
      'SELECT at, kind, actor, capability_id, action, detail FROM work_events WHERE run_id = ? ORDER BY at'
    )
    .all(runId) as any[];
  const interventions = db
    .prepare(
      'SELECT actor_id, kind, capability_id, active_seconds, waiting_seconds, action, outcome FROM human_intervention WHERE run_id = ? ORDER BY started_at'
    )
    .all(runId) as any[];
  const uses = db
    .prepare(
      'SELECT capability_id, duration_seconds, source FROM capability_use WHERE run_id = ? ORDER BY used_at'
    )
    .all(runId) as any[];
  const resources = db
    .prepare(
      'SELECT resource_id, kind, quantity, unit, cost_cents FROM resource_consumption WHERE run_id = ? ORDER BY recorded_at'
    )
    .all(runId) as any[];
  const outcome = db
    .prepare(
      'SELECT achieved, objective_metric, objective_name, value_cents FROM outcomes WHERE run_id = ? ORDER BY recorded_at DESC LIMIT 1'
    )
    .get(runId);

  return {
    run: runId,
    goal: run.goal || run.goal_id,
    run_type: run.run_type,
    source: run.source,
    started_at: run.started_at,
    ended_at: run.ended_at,
    outcome: run.outcome,
    events,
    interventions,
    capabilities: uses,
    resources,
    achieved: outcome?.achieved,
    objective: outcome?.objective_name
      ? { metric: outcome.objective_metric, name: outcome.objective_name }
      : undefined,
    value_cents: outcome?.value_cents,
  };
}

function auditProposal(db: Db, proposalId: string) {
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  const steps = JSON.parse(row.steps);
  const artifact = row.approval_artifact ? JSON.parse(row.approval_artifact) : undefined;
  const roi = row.observed_roi ? JSON.parse(row.observed_roi) : undefined;

  // The enforcement decision for each step, re-run — the audit's "was this
  // permitted" column, resolved the same way apply resolved it.
  const enforcement = steps.map((s: any) => {
    const d = canExecute(db, { actor: row.approved_by, capability: s.id, action: 'execute' });
    return {
      step: s.name,
      capability: s.id,
      decision: d.decision,
      reason: d.reason,
    };
  });

  return {
    proposal: proposalId,
    goal: row.goal,
    status: row.status,
    created_at: row.created_at,
    steps: steps.map((s: any) => ({
      name: s.name,
      chosen: s.chosen,
      setup_seconds: s.setup_seconds,
      privacy: s.privacy,
      requires_person: s.requires_person,
      recurring: s.recurring_cost,
    })),
    approval: row.approved_by
      ? {
          by: row.approved_by,
          at: row.approved_at,
          artifact: artifact
            ? {
                proposal_hash: artifact.proposal_hash,
                actor: artifact.actor,
                budget_cents: artifact.budget_cents,
                scope_exclude: artifact.scope_exclude,
                expires_at: artifact.expires_at,
                signed: !!artifact.sig,
              }
            : undefined,
        }
      : undefined,
    enforcement,
    applied:
      row.status === 'applied'
        ? {
            at: row.applied_at,
            keys: row.status === 'applied' ? row.applied_at && undefined : undefined,
          }
        : undefined,
    roi,
    note: row.status === 'applied' ? undefined : `${row.status} — nothing executed.`,
  };
}

function auditActor(db: Db, actorId: string) {
  const id = actorId.startsWith('human:') ? actorId : `human:${actorId}`;
  const person = db.prepare('SELECT name FROM capabilities WHERE id = ?').get(id);
  if (!person) return { error: `${id} is not in the graph.` };

  const approvals = db
    .prepare(
      'SELECT id, goal, status, approved_at FROM proposals WHERE approved_by = ? ORDER BY approved_at DESC'
    )
    .all(id) as any[];
  const interventions = db
    .prepare(
      `SELECT kind, capability_id, COUNT(*) times, COALESCE(SUM(active_seconds),0) active
     FROM human_intervention WHERE actor_id = ? AND started_at >= datetime('now', '-30 days')
     GROUP BY kind, capability_id ORDER BY times DESC`
    )
    .all(id) as any[];
  const acts = db
    .prepare(
      `SELECT action, capability_id, notes, timestamp FROM session_learning
     WHERE session_id = 'approval' AND capability_id = ? ORDER BY timestamp DESC LIMIT 20`
    )
    .all(id) as any[];

  return {
    person: person.name,
    approvals: approvals.length
      ? approvals.map(a => ({
          proposal: a.id,
          goal: a.goal,
          status: a.status,
          approved_at: a.approved_at,
        }))
      : undefined,
    interventions_last_30_days: interventions.map(i => ({
      kind: i.kind,
      capability: i.capability_id,
      times: i.times,
      active_seconds: i.active,
    })),
    recent_approval_acts: acts.map(a => ({ action: a.action, at: a.timestamp, note: a.notes })),
  };
}

function auditRecent(db: Db, days: number) {
  const acts = db
    .prepare(
      `SELECT session_id, action, capability_id, notes, timestamp FROM session_learning
     WHERE timestamp >= datetime('now', ?) ORDER BY timestamp DESC LIMIT 40`
    )
    .all(`-${days} days`) as any[];
  const proposals = db
    .prepare(
      `SELECT id, goal, status, approved_at, applied_at FROM proposals
     WHERE created_at >= datetime('now', ?) OR approved_at >= datetime('now', ?) OR applied_at >= datetime('now', ?)
     ORDER BY created_at DESC LIMIT 20`
    )
    .all(`-${days} days`, `-${days} days`, `-${days} days`) as any[];
  const runs = db
    .prepare(
      `SELECT id, goal, run_type, outcome, started_at, ended_at FROM work_runs
     WHERE started_at >= datetime('now', ?) ORDER BY started_at DESC LIMIT 20`
    )
    .all(`-${days} days`) as any[];

  return {
    window_days: days,
    acts: acts.map(a => ({
      session: a.session_id,
      action: a.action,
      target: a.capability_id,
      at: a.timestamp,
      note: a.notes,
    })),
    proposals: proposals.map(p => ({
      id: p.id,
      goal: p.goal,
      status: p.status,
      approved_at: p.approved_at,
      applied_at: p.applied_at,
    })),
    runs: runs.map(r => ({
      id: r.id,
      goal: r.goal,
      type: r.run_type,
      outcome: r.outcome,
      started: r.started_at,
      ended: r.ended_at,
    })),
    note: 'the audit trail is a ledger view — nothing here is derived or guessed.',
  };
}

function auditFor(db: Db, target?: string) {
  if (!target) return auditRecent(db, 7);
  if (/^run-/.test(target)) return auditRun(db, target);
  if (/^prop-/.test(target)) return auditProposal(db, target);
  if (/^human:/.test(target) || /^[a-z-]+$/.test(target)) return auditActor(db, target);
  if (/^\d+$/.test(target)) return auditRecent(db, Number(target));
  return { error: 'Usage: ambit audit <run-…|prop-…|human:name|days>' };
}

export { auditFor, auditRun, auditProposal, auditActor, auditRecent };
