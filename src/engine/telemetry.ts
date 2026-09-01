import type { Migratable } from './migrate.ts';

/**
 * The work ledger: one row per run of actual effort, the events inside it, the
 * capabilities it exercised, the times a human had to intervene, and the
 * resources it consumed.
 *
 * This is the observation the economic loop runs on. `session_learning` records
 * what the configuration did; these tables record what the *work* was — and a
 * recurring intervention, a long elapsed time, or a resource bill per goal is
 * exactly what an opportunity is a projection of. Nothing here moves
 * `capabilities.state`; the frontier stays structural.
 *
 * Most runs are recorded by an adapter or the AG-UI ingestion path (WP-2), not
 * by a person. The recorder exists so every surface speaks one vocabulary and
 * so a run can be entered by hand when no adapter saw it.
 *
 * Like migrate.ts, the recorder is deliberately free of any `node:sqlite` or
 * driver import: the engine records through the CLI, the visualiser API
 * records under Bun, and both can, because the whole surface used here is
 * `prepare(...).run/get/all`.
 */

/** SQLite's datetime('now') shape, which is not ISO: space, not T, no zone. */
function toEpoch(value?: string | null): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : undefined;
}

function durationSeconds(started?: string | null, ended?: string | null): number | undefined {
  const s = toEpoch(started);
  const e = ended ? toEpoch(ended) : Date.now();
  if (s === undefined || e === undefined) return undefined;
  return Math.max(0, Math.round((e - s) / 1000));
}

export interface BeginRunInput {
  id?: string;
  goal?: string;
  goalId?: string;
  runType?: string;
  source?: string;
}

// Date.now() has millisecond resolution, and runs begun in the same
// millisecond would collide on the primary key. The counter is process-local
// and enough: two run ids from one process cannot collide.
let runCounter = 0;

function beginRun(db: Migratable, input: BeginRunInput = {}) {
  const id = input.id || `run-${Date.now().toString(36)}-${runCounter++}`;
  db.prepare(
    'INSERT INTO work_runs (id, goal, goal_id, run_type, source) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    input.goal || null,
    input.goalId || null,
    input.runType || 'task',
    input.source || 'manual'
  );
  return {
    run: id,
    started_at: (db.prepare('SELECT started_at FROM work_runs WHERE id = ?').get(id) as any)
      ?.started_at,
  };
}

function endRun(db: Migratable, runId: string, outcome: string, outcomeValueCents?: number) {
  const row = db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId);
  if (!row) return { error: `No run ${runId}. Begin one first.` };
  db.prepare(
    "UPDATE work_runs SET ended_at = datetime('now'), outcome = ?, outcome_value_cents = ? WHERE id = ?"
  ).run(outcome, outcomeValueCents ?? null, runId);
  return {
    run: runId,
    outcome,
    ended_at: (db.prepare('SELECT ended_at FROM work_runs WHERE id = ?').get(runId) as any)
      ?.ended_at,
  };
}

export interface EventInput {
  kind: string;
  actor?: string;
  capabilityId?: string;
  action?: string;
  detail?: string;
}

function addEvent(db: Migratable, runId: string, event: EventInput) {
  const row = db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId);
  if (!row) return { error: `No run ${runId}. Begin one first.` };
  db.prepare(
    'INSERT INTO work_events (run_id, kind, actor, capability_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    runId,
    event.kind,
    event.actor || null,
    event.capabilityId || null,
    event.action || null,
    event.detail || null
  );
  return {
    run: runId,
    kind: event.kind,
    at: (db.prepare('SELECT at FROM work_events WHERE id = last_insert_rowid()').get() as any)?.at,
  };
}

function recordUse(
  db: Migratable,
  runId: string,
  capabilityId: string,
  input: { durationSeconds?: number; source?: string } = {}
) {
  if (!db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId)) {
    return { error: `No run ${runId}. Begin one first.` };
  }
  db.prepare(
    'INSERT INTO capability_use (run_id, capability_id, duration_seconds, source) VALUES (?, ?, ?, ?)'
  ).run(runId, capabilityId, input.durationSeconds ?? null, input.source || 'event');
  return { run: runId, capability: capabilityId };
}

export interface InterventionInput {
  kind: string;
  startedAt?: string;
  endedAt?: string;
  activeSeconds?: number;
  waitingSeconds?: number;
  capabilityId?: string;
  action?: string;
  outcome?: string;
}

function recordIntervention(
  db: Migratable,
  runId: string | null,
  actorId: string,
  input: InterventionInput
) {
  const ended = input.endedAt;
  const active =
    input.activeSeconds ?? (input.startedAt ? durationSeconds(input.startedAt, ended) : undefined);
  const waiting = input.waitingSeconds;
  db.prepare(
    `INSERT INTO human_intervention (run_id, actor_id, kind, started_at, ended_at, active_seconds, waiting_seconds, capability_id, action, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    actorId,
    input.kind,
    input.startedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
    ended || null,
    active ?? null,
    waiting ?? null,
    input.capabilityId || null,
    input.action || null,
    input.outcome || null
  );
  return { actor: actorId, kind: input.kind, active_seconds: active };
}

function recordResource(
  db: Migratable,
  runId: string | null,
  resourceId: string,
  kind: string,
  input: { quantity?: number; unit?: string; costCents?: number } = {}
) {
  db.prepare(
    'INSERT INTO resource_consumption (run_id, resource_id, kind, quantity, unit, cost_cents) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(runId, resourceId, kind, input.quantity ?? 0, input.unit || null, input.costCents ?? null);
  return { resource: resourceId, kind };
}

function recordOutcome(
  db: Migratable,
  runId: string,
  achieved: string,
  input: { objectiveMetric?: number; objectiveName?: string; valueCents?: number } = {}
) {
  if (!db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId)) {
    return { error: `No run ${runId}. Begin one first.` };
  }
  db.prepare(
    'INSERT INTO outcomes (run_id, achieved, objective_metric, objective_name, value_cents) VALUES (?, ?, ?, ?, ?)'
  ).run(
    runId,
    achieved,
    input.objectiveMetric ?? null,
    input.objectiveName || null,
    input.valueCents ?? null
  );
  return { run: runId, achieved };
}

// ─── Reports ──────────────────────────────────────────────────────────────────

/**
 * The runs themselves, each with what it cost.
 *
 *   ambit work
 *   ambit work 10
 *
 * Elapsed time is measured from the run's own timestamps. Everything else is
 * counted from the run's events, interventions, uses and consumption — so the
 * report is an aggregation of the ledger, not a second copy of it.
 */
function workReport(db: Migratable, limit = 20): any {
  const runs = db
    .prepare(
      'SELECT id, goal, goal_id, run_type, source, started_at, ended_at, outcome, outcome_value_cents FROM work_runs ORDER BY started_at DESC LIMIT ?'
    )
    .all(limit) as any[];
  if (runs.length === 0)
    return { note: 'No runs recorded. Begin one with a runtime adapter, or ambit record work.' };

  const nameOf = new Map(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all()
      .map((c: any) => [c.id, c.name])
  );

  return runs.map(r => {
    const elapsed = durationSeconds(r.started_at, r.ended_at);
    const events = (
      db.prepare('SELECT COUNT(*) n FROM work_events WHERE run_id = ?').get(r.id) as any
    ).n;
    const uses = db
      .prepare(
        'SELECT capability_id, SUM(duration_seconds) total FROM capability_use WHERE run_id = ? GROUP BY capability_id'
      )
      .all(r.id) as any[];
    const interventions = db
      .prepare(
        'SELECT kind, COUNT(*) n, SUM(active_seconds) active FROM human_intervention WHERE run_id = ? GROUP BY kind'
      )
      .all(r.id) as any[];
    const resources = db
      .prepare(
        'SELECT kind, SUM(cost_cents) cost, COUNT(*) n FROM resource_consumption WHERE run_id = ? GROUP BY kind'
      )
      .all(r.id) as any[];
    const outcome = db
      .prepare('SELECT * FROM outcomes WHERE run_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get(r.id);
    return {
      run: r.id,
      goal: r.goal || (r.goal_id ? nameOf.get(r.goal_id) || r.goal_id : undefined),
      type: r.run_type,
      started: r.started_at,
      elapsed_seconds: elapsed,
      outcome: r.outcome ?? undefined,
      outcome_value_cents: r.outcome_value_cents ?? undefined,
      events,
      capabilities: uses.map(u => ({
        capability: nameOf.get(u.capability_id) || u.capability_id,
        duration_seconds: u.total,
      })),
      interventions: interventions.map(i => ({
        kind: i.kind,
        times: i.n,
        active_seconds: i.active,
      })),
      resources: resources.map(r2 => ({ kind: r2.kind, cost_cents: r2.cost, items: r2.n })),
      achieved: outcome ? outcome.achieved : undefined,
      objective_metric: outcome ? outcome.objective_metric : undefined,
      objective_name: outcome ? outcome.objective_name : undefined,
      value_cents: outcome ? outcome.value_cents : undefined,
    };
  });
}

/**
 * Where capability effort actually went, over a window.
 *
 *   ambit usage
 *   ambit usage 30
 *
 * The raw material of the opportunity engine: a capability that is exercised
 * often, for long, or by an intervention-heavy pattern of runs is a candidate
 * for "make this cheaper". Counts and seconds only — economic value is WP-4.
 */
function usageReport(db: Migratable, days = 30): any {
  const rows = db
    .prepare(
      `SELECT u.capability_id, COUNT(*) times, SUM(u.duration_seconds) duration_seconds
     FROM capability_use u
     WHERE u.used_at >= datetime('now', ?)
     GROUP BY u.capability_id ORDER BY times DESC`
    )
    .all(`-${days} days`) as any[];
  if (rows.length === 0) return { note: `No capability use recorded in the last ${days} days.` };

  const nameOf = new Map(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all()
      .map((c: any) => [c.id, c.name])
  );
  const byRun = new Map<string, number>();
  const byIntervention = new Map<string, number>();
  for (const r of db
    .prepare(
      "SELECT capability_id, COUNT(*) n FROM human_intervention WHERE started_at >= datetime('now', ?) GROUP BY capability_id"
    )
    .all(`-${days} days`) as any[]) {
    byIntervention.set(r.capability_id, r.n);
  }
  for (const r of db
    .prepare(
      "SELECT run_id, COUNT(*) n FROM work_events WHERE at >= datetime('now', ?) GROUP BY run_id"
    )
    .all(`-${days} days`) as any[]) {
    byRun.set(r.run_id, r.n);
  }

  return rows.map(r => ({
    capability: nameOf.get(r.capability_id) || r.capability_id,
    id: r.capability_id,
    times: r.times,
    duration_seconds: r.duration_seconds,
    interventions: byIntervention.get(r.capability_id) || 0,
  }));
}

export {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
  workReport,
  usageReport,
};
