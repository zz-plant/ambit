/**
 * The projections the visualiser reads.
 *
 * These used to live inside the API server as hand-written SQL — a second
 * implementation of the model, in a different SQLite driver, drifting from the
 * engine's own. The server is a reader of the graph like any other, so what it
 * reads belongs beside everything else that reads it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { ENGINE_DIR } from './paths.ts';
import { FAILING_SQL, graphCounts, REACHED_SQL } from './vocabulary.ts';
import { humanDigest } from './attention.ts';
import { opportunitiesFor } from './opportunities.ts';
import { roiSummary } from './roi.ts';
import { singlePointsOfFailure } from './inference.ts';
import { deficits } from './planning.ts';
import {
  NODE_TYPES,
  PROPOSAL_STATUSES,
  type LoopResponse,
  type NodeType,
  type ProposalRow,
  type ProposalStatus,
  type TechTreeResponse,
  type TreeConnection,
  type TreeItem,
} from '../shared/api.ts';

/** A category the client can draw, or 'config' — never a value it has no case for. */
function nodeType(category: string): NodeType {
  const mapped =
    category === 'combo' ? 'possibility' : category === 'mcp' ? 'mcp-server' : category;
  return (NODE_TYPES as readonly string[]).includes(mapped) ? (mapped as NodeType) : 'config';
}

/**
 * The capability graph in the shape the visualiser renders.
 *
 * Actions conferred by a capability are excluded deliberately. A capability
 * confers several, so including them would multiply the node count without
 * changing what the picture says — the era columns and the three states are a
 * designed visual grammar, and legibility is the product. The finer vocabulary
 * is answered by `ambit graph actions`, which asks for one capability's actions
 * rather than all of them at once.
 *
 * Actions a *person* supplies stay: there are few of them, and they are the
 * only thing connecting a human node to the rest of the graph.
 */
export function techTreeView(db: Db): TechTreeResponse {
  const caps = db
    .prepare(
      `SELECT id, name, domain, description, category, state, unlock_cost_setup, lifecycle
     FROM capabilities c WHERE c.kind != 'action' OR NOT EXISTS (
       SELECT 1 FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
       WHERE d.to_capability = c.id AND d.kind = 'provides' AND p.kind = 'capability'
     )`
    )
    .all();

  const visible = new Set(caps.map(c => c.id));
  const deps = db
    .prepare('SELECT from_capability, to_capability, is_hard_requisite FROM dependencies')
    .all()
    .filter(d => visible.has(d.from_capability) && visible.has(d.to_capability));

  // Era and the "researchable now" state are what make this read as a tech tree
  // rather than a list: Civ's whole grammar is reached / can be researched next
  // / still locked, laid out left to right by era.
  let tree: { nodes?: { id: string; era: number }[]; eras?: Record<string, string> } = {};
  try {
    tree = JSON.parse(readFileSync(join(ENGINE_DIR, 'techtree.json'), 'utf8'));
  } catch {
    /* the curated tree is optional */
  }
  const eraById = new Map((tree.nodes || []).map(n => [`combo:${n.id}`, n.era]));

  // When each capability's check last ran, and how it went — the map draws the
  // difference between proven and merely configured, so it needs the evidence
  // beside the structure.
  const lastEvidence = new Map<string, { at: string; passed: boolean }>(
    db
      .prepare(
        `SELECT capability_id, action, MAX(timestamp) AS at FROM session_learning
       WHERE action IN ('verified','failed') GROUP BY capability_id`
      )
      .all()
      .map(r => [r.capability_id, { at: r.at, passed: r.action === 'verified' }])
  );

  const stateById = new Map<string, string>(caps.map(c => [c.id, c.state]));
  const hardPrereqs = new Map<string, string[]>();
  for (const d of deps) {
    if (!d.is_hard_requisite) continue;
    if (!hardPrereqs.has(d.to_capability)) hardPrereqs.set(d.to_capability, []);
    hardPrereqs.get(d.to_capability)!.push(d.from_capability);
  }

  /** Locked, but everything it requires is already reached. */
  const isNext = (id: string, state: string) =>
    state === 'locked' && (hardPrereqs.get(id) || []).every(p => stateById.get(p) !== 'locked');

  const items: TreeItem[] = caps.map(c => ({
    id: c.id,
    name: c.name,
    type: nodeType(c.category),
    // Locked tech-tree nodes render as the 'specified' (wireframe) state, which
    // is how the visualiser already draws something not yet built.
    status: c.state === 'locked' ? 'specified' : 'built',
    description: c.description,
    position: { x: 0, y: 0, z: 0 },
    meta: {
      domain: c.domain,
      state: c.state,
      setupSeconds: c.unlock_cost_setup,
      era: eraById.get(c.id),
      eraName: eraById.has(c.id) ? tree.eras?.[String(eraById.get(c.id))] : undefined,
      next: isNext(c.id, c.state),
      lifecycle: c.lifecycle,
      lastChecked: lastEvidence.get(c.id)?.at,
    },
  }));

  const connections: TreeConnection[] = deps.map(d => ({
    from: d.from_capability,
    to: d.to_capability,
    type: d.is_hard_requisite ? 'hard-dep' : 'soft-dep',
  }));

  return { items, connections };
}

/**
 * The three counts the live stream reports. Each is guarded on its own: a
 * database predating frontier_snapshots used to throw on the second query and
 * zero the counts from the first, reporting an empty graph for a full one.
 */
export function graphSummary(db: Db): { reached: number; total: number; observations: number } {
  let reached = 0,
    total = 0,
    observations = 0;
  try {
    const counts = db
      // Counted the same way every other surface counts it. This said
      // `state != 'locked'`, which agrees with the rest only because a third
      // state has never been added — and would have diverged silently the day
      // one was.
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) AS reached
         FROM capabilities`
      )
      .get();
    total = counts?.total ?? 0;
    reached = counts?.reached ?? 0;
  } catch {
    /* no capabilities table yet */
  }
  try {
    observations = db.prepare('SELECT COUNT(*) AS n FROM frontier_snapshots').get()?.n ?? 0;
  } catch {
    /* ledger predates this database */
  }
  return { reached, total, observations };
}

/** Proposals for the approval UI: the full rows, newest first. */
export function recentProposals(db: Db, limit = 50): ProposalRow[] {
  let rows: Record<string, any>[];
  try {
    rows = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
  return rows.map(r => ({
    ...r,
    status: (PROPOSAL_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as ProposalStatus)
      : 'draft',
  })) as ProposalRow[];
}

/** How often a person had to step in, per capability — the heatmap's input. */
export function interventionHeatmap(db: Db): Record<string, any>[] {
  try {
    return db
      .prepare(
        `SELECT capability_id, COUNT(*) as count, MAX(timestamp) as last_seen
       FROM session_learning
       WHERE action IN ('intervene', 'confirm', 'failed', 'blocked', 'approved')
       GROUP BY capability_id`
      )
      .all();
  } catch {
    return [];
  }
}

/**
 * The economic loop in one payload: what the graph can prove, where a person's
 * time went, what to buy next, and whether the last purchase paid.
 *
 * Everything here is a projection of reports that already exist —
 * `ambit status`, `ambit attention`, `ambit opportunities`, `ambit roi` — so
 * the page and the terminal cannot tell two stories about one ledger. The only
 * query written here is the month-by-month series, which no report returns
 * because no report draws a line.
 */
export function loopView(db: Db): LoopResponse {
  const counts = graphCounts(db);
  const digest = humanDigest(db, LOOP_WINDOW_DAYS) as {
    interventions?: number;
    reducible?: Intervention[];
    keepers?: Intervention[];
  };
  const ranked = opportunitiesFor(db) as { opportunities?: Record<string, any>[] };
  const roi = roiSummary(db) as {
    measurements: number;
    observed_hours_saved_per_year: number;
    observed_dollars_saved_per_year: number;
    prediction?: { average_ratio: number; near_forecast: number; of: number };
    per_proposal: { predicted_hours_per_year: number | null; observed_hours_per_year: number }[];
  };

  const pending = recentProposals(db)
    .filter(p => p.status === 'draft' || p.status === 'approved')
    .map(p => ({ id: p.id, goal: p.goal }));

  const monthly = monthlyHours(db);
  const opportunities = (ranked.opportunities || []).map(o => ({
    id: o.id,
    title: o.title,
    capability: o.capability,
    capability_id: o.capability_id,
    kind: o.kind,
    burden: {
      interventions_month: o.burden.interventions_month,
      human_hours_month: o.burden.human_hours_month,
      attention_dollars_month: o.burden.attention_dollars_month,
    },
    proposal: { action: o.proposal.action, setup_hours: o.proposal.setup_hours },
    expected: {
      human_hours_month_after: o.expected.human_hours_month_after,
      savings_dollars_month: o.expected.savings_dollars_month,
    },
    payback_months: o.payback_months ?? null,
    confidence: o.confidence,
    acquisition_options: o.acquisition_options,
  })) as LoopResponse['opportunities'];

  const interventions = digest.interventions ?? 0;
  return {
    source: 'ledger',
    // The ledger is what fills this page. With nothing in it the figures would
    // all be zero, which reads as "you waste no time" rather than "nothing has
    // been recorded" — so the page says which it is instead of drawing it.
    empty: interventions === 0 && opportunities.length === 0 && monthly.length === 0,
    status: {
      reached: counts.reached,
      total: counts.total,
      verified: counts.proven,
      failing: counts.failing,
      degraded: namesOfDegraded(db),
      spofs: namesOf(singlePointsOfFailure(db), 'capability'),
      deficits: namesOf(deficits(db), 'name'),
      pending,
    },
    attention: {
      interventions,
      reducible: (digest.reducible || []).map(toBurdenRow),
      keepers: (digest.keepers || []).map(toBurdenRow),
    },
    opportunities,
    roi: {
      hours_per_year: roi.observed_hours_saved_per_year,
      dollars_per_year: roi.observed_dollars_saved_per_year,
      accuracy: roi.prediction?.average_ratio ?? null,
      verdict: roiVerdict(roi),
      monthly_hours: monthly,
      forecast: forecastPair(roi.per_proposal),
    },
  };
}

/** The window every figure on the loop page is drawn over. */
const LOOP_WINDOW_DAYS = 30;

/** What `humanDigest` returns per (capability, kind), as much of it as is drawn. */
interface Intervention {
  kind: string;
  capability: string;
  capability_id?: string;
  times: number;
  active_seconds?: number;
  waiting_seconds?: number;
  suggested_fix?: string;
}

const HOURS = 3600;

function toBurdenRow(i: Intervention) {
  return {
    kind: i.kind,
    capability: i.capability,
    capability_id: i.capability_id || undefined,
    times: i.times,
    hours: Math.round((((i.active_seconds || 0) + (i.waiting_seconds || 0)) / HOURS) * 10) / 10,
    suggested_fix: i.suggested_fix || 'automate the recurring act',
  };
}

/** A report that returns rows when it has any and `{ note }` when it does not. */
function namesOf(report: unknown, field: string): string[] {
  return Array.isArray(report)
    ? report.map(r => String((r as Record<string, unknown>)[field] ?? '')).filter(Boolean)
    : [];
}

/** Reached, and its check is failing: configured but not working. */
function namesOfDegraded(db: Db): string[] {
  try {
    return db
      .prepare(
        `SELECT name FROM capabilities WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
      )
      .all<{ name: string }>()
      .map(r => r.name);
  } catch {
    return [];
  }
}

function roiVerdict(roi: {
  measurements: number;
  prediction?: { near_forecast: number; of: number };
}): string {
  if (roi.measurements === 0) return 'nothing applied has been measured yet';
  if (!roi.prediction) return `${roi.measurements} measured, none forecast to compare against`;
  return `${roi.prediction.near_forecast} of ${roi.prediction.of} near forecast`;
}

/** Predicted against observed, summed over the proposals that carried both. */
function forecastPair(
  perProposal: { predicted_hours_per_year: number | null; observed_hours_per_year: number }[]
): { predicted_hours: number; observed_hours: number } | null {
  const withPrediction = perProposal.filter(p => p.predicted_hours_per_year != null);
  if (!withPrediction.length) return null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    predicted_hours: round(
      withPrediction.reduce((s, p) => s + (p.predicted_hours_per_year || 0), 0)
    ),
    observed_hours: round(withPrediction.reduce((s, p) => s + p.observed_hours_per_year, 0)),
  };
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Hours in the loop per month, oldest first, with the month a capability
 * landed annotated.
 *
 * Months between the first record and now are filled with zero rather than
 * skipped: a gap the line jumps over would read as a month that never
 * happened. Before the first record there is nothing to say, so the series
 * starts there rather than padding twelve months of invented calm.
 */
function monthlyHours(db: Db): { month: string; hours: number; acquired?: string }[] {
  let rows: { ym: string; seconds: number }[] = [];
  try {
    rows = db
      .prepare(
        `SELECT strftime('%Y-%m', started_at) AS ym,
                SUM(COALESCE(active_seconds, 0) + COALESCE(waiting_seconds, 0)) AS seconds
         FROM human_intervention
         WHERE started_at >= datetime('now', '-12 months')
         GROUP BY ym ORDER BY ym`
      )
      .all<{ ym: string; seconds: number }>();
  } catch {
    return [];
  }
  if (!rows.length) return [];

  let applied: { ym: string; goal: string }[] = [];
  try {
    applied = db
      .prepare(
        `SELECT strftime('%Y-%m', applied_at) AS ym, goal FROM proposals
         WHERE status = 'applied' AND applied_at IS NOT NULL ORDER BY applied_at`
      )
      .all<{ ym: string; goal: string }>();
  } catch {
    /* a database predating applied_at has nothing to annotate */
  }
  const acquiredIn = new Map(applied.map(a => [a.ym, a.goal] as const));

  const hoursIn = new Map(
    rows.map(r => [r.ym, Math.round((r.seconds / HOURS) * 10) / 10] as const)
  );
  const [firstYear, firstMonth] = rows[0].ym.split('-').map(Number);
  const now = new Date();
  const out: { month: string; hours: number; acquired?: string }[] = [];
  for (
    let d = new Date(Date.UTC(firstYear, firstMonth - 1, 1));
    d <= now;
    d.setUTCMonth(d.getUTCMonth() + 1)
  ) {
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      month: MONTH_NAMES[d.getUTCMonth()],
      hours: hoursIn.get(ym) ?? 0,
      acquired: acquiredIn.get(ym),
    });
  }
  return out;
}
