import type { Db } from './db.ts';
import type { AuditEvent, AuditOutcome, AuditResponse } from '../shared/api.ts';
import { canExecute } from './assurance.ts';
import { delegationRecords } from './delegation.ts';
import { ACT_OUTCOMES, AUDIT_OUTCOMES, RUN_FAILED, RUN_SUCCEEDED } from './vocabulary.ts';
import type {
  CapabilityRow,
  CapabilityUseRow,
  HumanInterventionRow,
  OutcomeRow,
  ProposalRow,
  ResourceConsumptionRow,
  SessionLearningRow,
  WorkEventRow,
  WorkRunRow,
} from './rows.ts';

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
  const run = db.prepare('SELECT * FROM work_runs WHERE id = ?').get<WorkRunRow>(runId);
  if (!run) return { error: `No run ${runId}.` };
  const events = db
    .prepare(
      'SELECT at, kind, actor, capability_id, action, detail FROM work_events WHERE run_id = ? ORDER BY at'
    )
    .all<Pick<WorkEventRow, 'at' | 'kind' | 'actor' | 'capability_id' | 'action' | 'detail'>>(
      runId
    );
  const interventions = db
    .prepare(
      'SELECT actor_id, kind, capability_id, active_seconds, waiting_seconds, action, outcome FROM human_intervention WHERE run_id = ? ORDER BY started_at'
    )
    .all<
      Pick<
        HumanInterventionRow,
        | 'actor_id'
        | 'kind'
        | 'capability_id'
        | 'active_seconds'
        | 'waiting_seconds'
        | 'action'
        | 'outcome'
      >
    >(runId);
  const uses = db
    .prepare(
      'SELECT capability_id, duration_seconds, source FROM capability_use WHERE run_id = ? ORDER BY used_at'
    )
    .all<Pick<CapabilityUseRow, 'capability_id' | 'duration_seconds' | 'source'>>(runId);
  const resources = db
    .prepare(
      'SELECT resource_id, kind, quantity, unit, cost_cents FROM resource_consumption WHERE run_id = ? ORDER BY recorded_at'
    )
    .all<Pick<ResourceConsumptionRow, 'resource_id' | 'kind' | 'quantity' | 'unit' | 'cost_cents'>>(
      runId
    );
  const outcome = db
    .prepare(
      'SELECT achieved, objective_metric, objective_name, value_cents FROM outcomes WHERE run_id = ? ORDER BY recorded_at DESC LIMIT 1'
    )
    .get<Pick<OutcomeRow, 'achieved' | 'objective_metric' | 'objective_name' | 'value_cents'>>(
      runId
    );

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
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get<ProposalRow>(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  const steps = JSON.parse(row.steps);
  const artifact = row.approval_artifact ? JSON.parse(row.approval_artifact) : undefined;
  const roi = row.observed_roi ? JSON.parse(row.observed_roi) : undefined;

  // The enforcement decision for each step, re-run — the audit's "was this
  // permitted" column, resolved the same way apply resolved it.
  const enforcement = steps.map((s: any) => {
    const d = canExecute(db, {
      actor: row.approved_by ?? undefined,
      capability: s.id,
      action: 'execute',
    });
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
  const person = db
    .prepare('SELECT name FROM capabilities WHERE id = ?')
    .get<Pick<CapabilityRow, 'name'>>(id);
  if (!person) return { error: `${id} is not in the graph.` };

  const approvals = db
    .prepare(
      'SELECT id, goal, status, approved_at FROM proposals WHERE approved_by = ? ORDER BY approved_at DESC'
    )
    .all<Pick<ProposalRow, 'id' | 'goal' | 'status' | 'approved_at'>>(id);
  const interventions = db
    .prepare(
      `SELECT kind, capability_id, COUNT(*) times, COALESCE(SUM(active_seconds),0) active
     FROM human_intervention WHERE actor_id = ? AND started_at >= datetime('now', '-30 days')
     GROUP BY kind, capability_id ORDER BY times DESC`
    )
    .all<{ kind: string; capability_id: string | null; times: number; active: number }>(id);
  const acts = db
    .prepare(
      `SELECT action, capability_id, notes, timestamp FROM session_learning
     WHERE session_id = 'approval' AND capability_id = ? ORDER BY timestamp DESC LIMIT 20`
    )
    .all<Pick<SessionLearningRow, 'action' | 'capability_id' | 'notes' | 'timestamp'>>(id);

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
    .all<
      Pick<SessionLearningRow, 'session_id' | 'action' | 'capability_id' | 'notes' | 'timestamp'>
    >(`-${days} days`);
  const proposals = db
    .prepare(
      `SELECT id, goal, status, approved_at, applied_at FROM proposals
     WHERE created_at >= datetime('now', ?) OR approved_at >= datetime('now', ?) OR applied_at >= datetime('now', ?)
     ORDER BY created_at DESC LIMIT 20`
    )
    .all<Pick<ProposalRow, 'id' | 'goal' | 'status' | 'approved_at' | 'applied_at'>>(
      `-${days} days`,
      `-${days} days`,
      `-${days} days`
    );
  const runs = db
    .prepare(
      `SELECT id, goal, run_type, outcome, started_at, ended_at FROM work_runs
     WHERE started_at >= datetime('now', ?) ORDER BY started_at DESC LIMIT 20`
    )
    .all<Pick<WorkRunRow, 'id' | 'goal' | 'run_type' | 'outcome' | 'started_at' | 'ended_at'>>(
      `-${days} days`
    );

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

// ─── The trail as one stream ─────────────────────────────────────────────────

/** How far back the stream reads unless asked otherwise, and how much it returns. */
const STREAM_DAYS = 30;
const STREAM_LIMIT = 200;
const STREAM_MAX = 1000;

/**
 * A stored time as ISO 8601 in UTC, or undefined when it will not parse.
 *
 * The ledger holds two forms. `datetime('now')` writes `2026-09-29 14:02:11`,
 * UTC with no zone, and a delegation record carries ISO with a `T`. Sorted as
 * text the two misorder, because a space sorts before a `T`, so the stream
 * compares instants and never strings.
 */
function isoTime(stamp: unknown): string | undefined {
  if (typeof stamp !== 'string' || !stamp.trim()) return undefined;
  let text = stamp.trim().replace(' ', 'T');
  // No zone is SQLite's own form, and SQLite's times are UTC.
  if (/T[\d:.]+$/.test(text)) text += 'Z';
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

const outcomeOf = (key: keyof typeof AUDIT_OUTCOMES): AuditOutcome => ({ ...AUDIT_OUTCOMES[key] });

/** A run's own word for how it ended, marked only where the vocabulary knows it. */
function runOutcome(word: string): AuditOutcome {
  const known = word.toLowerCase();
  const tone = RUN_SUCCEEDED.includes(known)
    ? 'good'
    : RUN_FAILED.includes(known)
      ? 'bad'
      : 'neutral';
  return { word, tone };
}

/**
 * The two acts a proposal row already states. Approving writes the row's
 * `approved_at` and an act, applying writes `applied_at` and an act, and
 * reading both would list one decision twice. The row is the one kept: it
 * carries the artifact that makes an approval signed.
 *
 * The row holds only the latest of each, though. A proposal applied and rolled
 * back can be approved again, which overwrites `approved_by` and
 * `approved_at`, so the act is dropped only where the row states that very
 * act: its proposal (the note leads with the id and a colon), its second, its
 * approver, and the newest act of its kind for that proposal, since a second
 * can hold two of them (rule 11). Every earlier approval and apply stays.
 */
const STATED_BY_THE_PROPOSAL = `NOT EXISTS (
  SELECT 1 FROM proposals p
  WHERE substr(s.notes, 1, length(p.id) + 1) = p.id || ':'
    AND ((s.session_id = 'approval' AND s.action = 'approved'
          AND s.capability_id = p.approved_by
          AND datetime(s.timestamp) = datetime(p.approved_at))
      OR (s.session_id = 'apply' AND s.action = 'applied'
          AND datetime(s.timestamp) = datetime(p.applied_at)))
    AND s.id = (SELECT MAX(o.id) FROM session_learning o
                WHERE o.session_id = s.session_id AND o.action = s.action
                  AND substr(o.notes, 1, length(p.id) + 1) = p.id || ':'))`;

/**
 * The sessions whose notes Ambit writes from its own records: a decision, an
 * apply, a grant. A check's notes hold the tail of what its command printed,
 * and a reported failure's hold what a runtime said. Neither is served here,
 * because how check output may leave the graph is still an open decision.
 */
const NOTED_SESSIONS = new Set(['approval', 'apply', 'authority']);

type ActRow = Pick<
  SessionLearningRow,
  'id' | 'session_id' | 'capability_id' | 'action' | 'notes' | 'timestamp'
> & { object: string | null };

function actEvents(db: Db, window: string, take: number): AuditEvent[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, capability_id, action, notes, object, timestamp FROM session_learning s
       WHERE datetime(timestamp) >= datetime('now', ?) AND ${STATED_BY_THE_PROPOSAL}
       ORDER BY datetime(timestamp) DESC, id DESC LIMIT ?`
    )
    .all<ActRow>(window, take);
  const events: AuditEvent[] = [];
  for (const a of rows) {
    const at = isoTime(a.timestamp);
    if (!at) continue;
    // A person in `capability_id` is who acted: an approval, a rejection, an
    // apply, a sandbox. The note then leads with the proposal it was about,
    // and a sandbox names its target in `object`.
    const person = a.capability_id.startsWith('human:');
    const note = NOTED_SESSIONS.has(a.session_id) ? a.notes?.trim() || undefined : undefined;
    const about = note?.match(/^(prop-[^\s:]+):?\s*([\s\S]*)$/);
    const outcome = ACT_OUTCOMES[a.action];
    events.push({
      id: `act:${a.id}`,
      at,
      actor: person ? a.capability_id : undefined,
      action: a.action,
      target: person ? (about?.[1] ?? a.object ?? undefined) : a.capability_id,
      summary: about ? about[2] || undefined : note,
      outcome: outcome ? outcomeOf(outcome) : undefined,
    });
  }
  return events;
}

/** A proposal is up to three events: proposed, approved, applied. */
function proposalEvents(db: Db, window: string, take: number): AuditEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT id, goal, 'proposed' AS verb, 0 AS step, created_at AS at,
                proposed_by AS actor, 0 AS signed
           FROM proposals WHERE datetime(created_at) >= datetime('now', ?)
         UNION ALL
         SELECT id, goal, 'approved', 1, approved_at, approved_by,
                approval_artifact IS NOT NULL
           FROM proposals WHERE datetime(approved_at) >= datetime('now', ?)
         UNION ALL
         SELECT id, goal, 'applied', 2, applied_at, NULL, 0
           FROM proposals WHERE datetime(applied_at) >= datetime('now', ?)
       ) ORDER BY datetime(at) DESC, step DESC LIMIT ?`
    )
    .all<{
      id: string;
      goal: string;
      verb: string;
      at: string;
      actor: string | null;
      signed: number;
    }>(window, window, window, take);
  const events: AuditEvent[] = [];
  for (const p of rows) {
    const at = isoTime(p.at);
    if (!at) continue;
    events.push({
      id: `${p.id}#${p.verb}`,
      at,
      actor: p.actor ?? undefined,
      action: p.verb,
      target: p.id,
      summary: p.goal || undefined,
      // An approval mints its artifact as it is recorded; one stored beside
      // it is the recorded fact that it was signed.
      outcome: p.signed ? outcomeOf('signed') : undefined,
    });
  }
  return events;
}

/** A run is two events: it started, and it ended with whatever word its producer wrote. */
function runEvents(db: Db, window: string, take: number): AuditEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT id, goal, goal_id, 'started' AS verb, 0 AS step, started_at AS at, NULL AS outcome
           FROM work_runs WHERE datetime(started_at) >= datetime('now', ?)
         UNION ALL
         SELECT id, goal, goal_id, 'ended', 1, ended_at, outcome
           FROM work_runs WHERE datetime(ended_at) >= datetime('now', ?)
       ) ORDER BY datetime(at) DESC, step DESC LIMIT ?`
    )
    .all<Pick<WorkRunRow, 'id' | 'goal' | 'goal_id' | 'outcome'> & { verb: string; at: string }>(
      window,
      window,
      take
    );
  const events: AuditEvent[] = [];
  for (const r of rows) {
    const at = isoTime(r.at);
    if (!at) continue;
    events.push({
      id: `${r.id}#${r.verb}`,
      at,
      action: r.verb,
      target: r.id,
      summary: r.goal || r.goal_id || undefined,
      outcome: r.outcome ? runOutcome(r.outcome) : undefined,
    });
  }
  return events;
}

/**
 * The delegation records, which no list of the trail used to carry. A revision
 * that took a grant down to asking says so; the answer to an objection says
 * which way it went.
 */
function delegationEvents(db: Db, days: number, take: number): AuditEvent[] {
  const since = Date.now() - days * 86_400_000;
  const events: AuditEvent[] = [];
  for (const record of delegationRecords(db, take).reverse()) {
    const at = isoTime(record.time?.recorded_at);
    if (!at || Date.parse(at) < since) continue;
    const content = record.content ?? {};
    const narrowed =
      record.kind === 'revision' &&
      typeof content.mode_now === 'string' &&
      content.mode_now !== content.mode_declared;
    const answered =
      content.disposition === 'upheld' || content.disposition === 'refused'
        ? outcomeOf(content.disposition)
        : undefined;
    events.push({
      id: record.record_id,
      at,
      actor: record.actor?.id || undefined,
      action: record.kind,
      target: record.subject || undefined,
      summary: record.summary || undefined,
      outcome: narrowed ? outcomeOf('narrowed') : answered,
    });
  }
  return events;
}

/** A source this database predates reads as no events, not as a failed trail. */
function guarded(read: () => AuditEvent[]): AuditEvent[] {
  try {
    return read();
  } catch {
    return [];
  }
}

const bounded = (value: number | undefined, fallback: number, max: number) =>
  Number.isFinite(value) && (value as number) >= 1
    ? Math.min(Math.floor(value as number), max)
    : fallback;

/**
 * The trail as one stream: who approved what, what ran, and what came of it,
 * newest first, from four sources read here directly.
 *
 * `auditRecent` answers the same window as three lists, capped at 40, 20 and
 * 20 on their own, so a busy week lost its older events before anything was
 * merged, and a delegation revision appeared in none of them. Here each
 * source reads one more than the limit, the merge sorts on the instant, and
 * the limit is applied once, afterwards, so `truncated` is exact. With no
 * graph at all it is an empty trail over the same window.
 */
function auditStream(db: Db | null, opts: { days?: number; limit?: number } = {}): AuditResponse {
  const days = bounded(opts.days, STREAM_DAYS, 3650);
  const limit = bounded(opts.limit, STREAM_LIMIT, STREAM_MAX);
  const window = `-${days} days`;
  const take = limit + 1;
  const merged = db
    ? [
        ...guarded(() => actEvents(db, window, take)),
        ...guarded(() => proposalEvents(db, window, take)),
        ...guarded(() => runEvents(db, window, take)),
        ...guarded(() => delegationEvents(db, days, take)),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];
  return { days, limit, events: merged.slice(0, limit), truncated: merged.length > limit };
}

function auditFor(db: Db, target?: string) {
  if (!target) return auditRecent(db, 7);
  if (/^run-/.test(target)) return auditRun(db, target);
  if (/^prop-/.test(target)) return auditProposal(db, target);
  if (/^human:/.test(target) || /^[a-z-]+$/.test(target)) return auditActor(db, target);
  if (/^\d+$/.test(target)) return auditRecent(db, Number(target));
  return { error: 'Usage: ambit audit <run-…|prop-…|human:name|days>' };
}

export { auditFor, auditRun, auditProposal, auditActor, auditRecent, auditStream };
