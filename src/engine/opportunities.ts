import type { Migratable } from "./migrate.ts";
import { planFor, simulateFrontier, deficits } from "./planning.ts";
import { attentionValueCentsPerHour, goalValue } from "./economics.ts";

/**
 * The opportunity engine: where recurring friction becomes a proposed
 * capability investment, ranked by what it is worth.
 *
 * The loop is the whole point of the economic half: the work ledger records
 * where time and attention went, this module prices the recurring part of it,
 * and the ranked result is "what should we build next" — a projection of
 * observed burden, not a guess. A middleware intervention (clerical, exception,
 * physical, authority-as-repeated-gate) that recurs is the raw material;
 * judgment and knowledge are never opportunities, however often they recur.
 *
 * Nothing here executes or drafts. It reports a ranked shortlist with an
 * honest confidence level, so a person decides against evidence.
 */

const WINDOW_DAYS = 30;
/** An automation's assumed removal of middleware intervention time. An
 *  estimate, stated as such; the ROI loop replaces it with observation. */
const REDUCTION = 0.9;
/** Estimate for "automate a capability that is already reached", in hours.
 *  Acquisition of a locked capability uses the plan's own setup figure. */
const ESTIMATED_AUTOMATION_HOURS = 2;
const HOURS = 3600;

interface BurdenCluster {
  capability_id: string;
  name: string;
  kind: string;
  times: number;
  active_seconds: number;
  waiting_seconds: number;
  runs_affected: number;
  reached: boolean;
  lifecycle: string;
  deficit_blocks: number;
  uses: number;
  resource_cents: number;
}

const MIDDLEWARE = new Set(['clerical', 'exception', 'physical', 'authority', 'approval', 'application', 'permission block']);
const KEEPERS = new Set(['judgment', 'knowledge']);

/** The burden observed in the window, clustered per (capability, kind). */
function clusters(db: Migratable, windowDays = WINDOW_DAYS): BurdenCluster[] {
  const cap = new Map<string, { id: string; name: string; reached: boolean; lifecycle: string }>();
  for (const c of db.prepare("SELECT id, name, state, lifecycle FROM capabilities").all() as any[]) {
    cap.set(c.id, { id: c.id, name: c.name, reached: c.state !== 'locked', lifecycle: c.lifecycle });
  }
  const nameOf = (id: string) => (cap.get(id)?.name) || id;

  const out = new Map<string, BurdenCluster>();
  const ensure = (capId: string, kind: string): BurdenCluster => {
    const key = `${capId}|${kind}`;
    if (!out.has(key)) {
      out.set(key, {
        capability_id: capId, name: nameOf(capId), kind,
        times: 0, active_seconds: 0, waiting_seconds: 0, runs_affected: 0,
        reached: cap.get(capId)?.reached ?? true,
        lifecycle: cap.get(capId)?.lifecycle ?? 'unknown',
        deficit_blocks: 0, uses: 0, resource_cents: 0,
      });
    }
    return out.get(key)!;
  };

  // The work ledger: interventions with time, per capability and kind.
  for (const i of db.prepare(
    "SELECT capability_id, kind, active_seconds, waiting_seconds, run_id FROM human_intervention WHERE started_at >= datetime('now', ?)"
  ).all(`-${windowDays} days`) as any[]) {
    const c = ensure(i.capability_id || 'unattributed', i.kind);
    c.times++;
    c.active_seconds += i.active_seconds || 0;
    c.waiting_seconds += i.waiting_seconds || 0;
    if (i.run_id) c.runs_affected++;
  }

  // The governance path records approvals etc. in session_learning; fold them
  // in as middleware on the same capability.
  for (const a of db.prepare(
    `SELECT capability_id, action FROM session_learning
     WHERE action IN ('approved', 'applied', 'blocked:permission')
       AND timestamp >= datetime('now', ?)`
  ).all(`-${windowDays} days`) as any[]) {
    const kind = a.action === 'approved' ? 'approval' : a.action === 'applied' ? 'application' : 'permission block';
    ensure(a.capability_id, kind).times++;
  }

  // Capability use attaches exercise frequency to the capability.
  for (const u of db.prepare(
    "SELECT capability_id, COUNT(*) n FROM capability_use WHERE used_at >= datetime('now', ?) GROUP BY capability_id"
  ).all(`-${windowDays} days`) as any[]) {
    for (const c of out.values()) if (c.capability_id === u.capability_id) c.uses += u.n;
  }

  // Recurring deficits are the "missing tool" half of the burden.
  const deficit = deficits(db as any);
  if (Array.isArray(deficit)) {
    for (const d of deficit) {
      const c = ensure(d.id, 'deficit');
      c.deficit_blocks += d.times_blocked;
    }
  }

  return [...out.values()];
}

interface OpportunityCase {
  id: string;
  title: string;
  kind: string;
  capability: string;
  capability_id: string;
  burden: { interventions_month: number; human_hours_month: number; attention_dollars_month: number; resource_dollars_month: number; runs_affected: number };
  proposal: { action: string; setup_hours: number; setup_estimate: boolean; recurring: boolean; frontier_gain: number };
  expected: { human_hours_month_after: number; savings_dollars_month: number };
  payback_months: number | null;
  roi_annual: number;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

/** Prices one cluster into an opportunity case. */
function priceCluster(db: Migratable, c: BurdenCluster, actor: string, idx: number): OpportunityCase {
  const hours = (c.active_seconds + c.waiting_seconds) / HOURS;
  const rate = attentionValueCentsPerHour(db, actor);
  const attentionCents = hours * rate;
  const resourceCents = c.resource_cents;
  const interventionsMonth = c.times;
  const savingsCentsMonth = Math.round(attentionCents * REDUCTION);

  // Acquisition: a locked capability has a plan; a reached one is automation.
  const plan = c.reached ? null : (planFor(db as any, c.capability_id) as any);
  let setupHours = ESTIMATED_AUTOMATION_HOURS;
  let setupEstimate = true;
  let recurring = false;
  if (plan && !plan.error && Array.isArray(plan.order)) {
    const setupSeconds = plan.order.reduce((s: number, o: any) => s + (o.setup_seconds || 0), 0);
    if (setupSeconds > 0) { setupHours = setupSeconds / HOURS; setupEstimate = false; }
    recurring = plan.order.some((o: any) => o.options?.some((op: any) => op.recurring_cost && op.recurring_cost !== 'none'));
  }

  const sim = simulateFrontier(db as any, [c.capability_id]);
  const frontierGain = (sim as any)?.frontier_after != null ? (sim as any).frontier_after - (sim as any).frontier_before : 0;

  // Setup cost in attention terms: the hours it takes are hours you are not
  // doing the thing the opportunity replaces.
  const setupCents = Math.round(setupHours * rate);
  const payback = savingsCentsMonth > 0 ? setupCents / savingsCentsMonth : Infinity;

  const confidence: OpportunityCase['confidence'] =
    interventionsMonth >= 5 ? 'high' : interventionsMonth >= 2 ? 'medium' : c.deficit_blocks >= 3 ? 'medium' : 'low';

  const middleware = MIDDLEWARE.has(c.kind);
  const keeper = KEEPERS.has(c.kind);
  const title = middleware
    ? `Automate ${c.name}`
    : c.kind === 'deficit'
      ? `Acquire ${c.name}`
      : keeper
        ? `The human's ${c.kind} on ${c.name} is not an automation target`
        : `Investigate ${c.name}`;

  return {
    id: `opp-${idx + 1}`,
    title,
    kind: c.kind,
    capability: c.name,
    capability_id: c.capability_id,
    burden: {
      interventions_month: interventionsMonth,
      human_hours_month: Math.round(hours * 10) / 10,
      attention_dollars_month: Math.round(attentionCents) / 100,
      resource_dollars_month: Math.round(resourceCents) / 100,
      runs_affected: c.runs_affected,
    },
    proposal: {
      action: c.reached ? 'automate (already reached)' : `acquire ${c.capability_id}`,
      setup_hours: setupHours,
      setup_estimate: setupEstimate,
      recurring,
      frontier_gain: frontierGain,
    },
    expected: {
      // hours − hours×REDUCTION, not hours×(1−REDUCTION): 1−0.9 is
      // 0.09999999999999998 in float, and the difference rounds down.
      human_hours_month_after: Math.round((hours - hours * REDUCTION) * 10) / 10,
      savings_dollars_month: Math.round(savingsCentsMonth) / 100,
    },
    payback_months: Number.isFinite(payback) ? Math.round(payback * 10) / 10 : null,
    roi_annual: Math.round((savingsCentsMonth * 12 / Math.max(1, setupCents)) * 10) / 10,
    confidence,
    note: keeper
      ? 'judgment/knowledge is the reason the human is there — not reducible, however often it recurs'
      : middleware
        ? 'middleware: the human is the duct — automation removes most of the recurring act'
        : undefined,
  };
}

export type OpportunityObjective = 'attention' | 'cash' | 'roi' | 'reliability' | 'frontier';

/**
 * The ranked shortlist.
 *
 *   ambit opportunities              → ranked by attention saved
 *   ambit opportunities --by cash    → attention + resource dollars
 *   ambit opportunities --by roi     → annualized return on setup cost
 *   ambit opportunities --by reliability  → burden on failing capabilities
 *   ambit opportunities --by frontier    → what acquiring would unlock
 */
function opportunitiesFor(db: Migratable, by: OpportunityObjective = 'attention') {
  const actor = 'human:kanav';
  const cs = clusters(db);
  const middleware = cs.filter(c => MIDDLEWARE.has(c.kind) || c.kind === 'deficit');
  const keepers = cs.filter(c => KEEPERS.has(c.kind));

  const priced = middleware.map((c, i) => priceCluster(db, c, actor, i));
  const sortKey = (o: OpportunityCase): number => {
    switch (by) {
      case 'cash': return o.burden.attention_dollars_month + o.burden.resource_dollars_month;
      case 'roi': return o.roi_annual;
      case 'reliability': return o.kind === 'deficit' ? 1e9 : o.burden.interventions_month;
      case 'frontier': return o.proposal.frontier_gain;
      default: return o.burden.attention_dollars_month;
    }
  };
  const ranked = priced.sort((a, b) => sortKey(b) - sortKey(a));

  if (ranked.length === 0 && keepers.length === 0) {
    return { note: `No recurring middleware burden recorded in the last ${WINDOW_DAYS} days. Record work, or seed a deficit with ambit record.`, by, opportunities: [] };
  }

  return {
    by,
    window_days: WINDOW_DAYS,
    opportunities: ranked,
    keepers: keepers.length ? keepers.map((k) => ({ capability: k.name, kind: k.kind, times: k.times })) : undefined,
    note: `ranked by ${by}. confidence: high = observed ≥5 times, medium = ≥2, low = deficits only. judgment/knowledge are never opportunities.`,
  };
}

/** One opportunity in full, for `ambit opportunity <id>`. */
function opportunityFor(db: Migratable, id?: string) {
  if (!id) return { error: 'Usage: ambit opportunity <id> — an id from ambit opportunities' };
  const match = /^opp-(\d+)$/.exec(id);
  if (!match) return { error: `${id} is not an opportunity id. See ambit opportunities.` };
  const idx = Number(match[1]) - 1;
  const cs = clusters(db).filter(c => MIDDLEWARE.has(c.kind) || c.kind === 'deficit');
  const o = priceCluster(db, cs[idx], 'human:kanav', idx);
  if (!o) return { error: `${id} not found. Run ambit opportunities to see the list.` };
  return o;
}

export { opportunitiesFor, opportunityFor, clusters, priceCluster };