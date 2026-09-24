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
import { PROVISION_EDGES } from './ontology.ts';
import { FAILING_SQL, graphCounts, REACHED_SQL } from './vocabulary.ts';
import { authorityReport, narrower, suggestPromotions } from './assurance.ts';
import { humanDigest } from './attention.ts';
import { ledgerSince } from './ledger.ts';
import { unmappedUse } from './telemetry.ts';
import { nextSteps } from './next.ts';
import { observedPreferences, preferredOption, traitsOf } from './observed.ts';
import { opportunitiesFor } from './opportunities.ts';
import { roiSummary } from './roi.ts';
import { affordanceDomains, singlePointsOfFailure } from './inference.ts';
import { deficits } from './planning.ts';
import {
  AUTHORITY_MODES,
  NODE_TYPES,
  PROPOSAL_STATUSES,
  type AuthorityMode,
  type ConferredAction,
  type FailureCount,
  type LoopAuthority,
  type LoopDemand,
  type LoopNext,
  type LoopResponse,
  type LoopSince,
  type NodeType,
  type ProposalDecision,
  type ProposalRow,
  type ProposalStatus,
  type TechTreeResponse,
  type TreeConnection,
  type TreeItem,
  type UnmappedResponse,
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
      `SELECT id, name, domain, description, category, state, unlock_cost_setup, lifecycle, kind,
              updated_at
     FROM capabilities c WHERE c.kind != 'action' OR NOT EXISTS (
       SELECT 1 FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
       WHERE d.to_capability = c.id AND d.kind = 'provides' AND p.kind = 'capability'
     )`
    )
    .all();

  const visible = new Set(caps.map(c => c.id));
  const deps = db
    .prepare('SELECT from_capability, to_capability, is_hard_requisite, kind FROM dependencies')
    .all()
    .filter(d => visible.has(d.from_capability) && visible.has(d.to_capability));

  // Who supplies what, and what presents which credential. The map's outage
  // simulation needs the first to tell "stops" from "loses a provider", and
  // the panel names the second.
  const credentialIds = new Set(caps.filter(c => c.kind === 'credential').map(c => c.id));
  const providersOf = new Map<string, string[]>();
  const credentialsOf = new Map<string, string[]>();
  for (const d of deps) {
    if ((PROVISION_EDGES as string[]).includes(d.kind)) {
      if (!providersOf.has(d.to_capability)) providersOf.set(d.to_capability, []);
      providersOf.get(d.to_capability)!.push(d.from_capability);
    }
    if (d.kind === 'uses' && credentialIds.has(d.to_capability)) {
      if (!credentialsOf.has(d.from_capability)) credentialsOf.set(d.from_capability, []);
      credentialsOf.get(d.from_capability)!.push(d.to_capability);
    }
  }

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

  // How many runs passed, of how many: one success is a weaker claim than
  // forty-seven of fifty, and the panel used to say only "passed".
  const reliability = new Map<string, { passed: number; total: number }>();
  try {
    for (const r of db
      .prepare(
        `SELECT capability_id, SUM(CASE WHEN action = 'verified' THEN 1 ELSE 0 END) AS passed,
                COUNT(*) AS total
         FROM session_learning WHERE action IN ('verified', 'failed') GROUP BY capability_id`
      )
      .all<{ capability_id: string; passed: number; total: number }>()) {
      reliability.set(r.capability_id, { passed: r.passed, total: r.total });
    }
  } catch {
    /* a graph with no ledger yet */
  }

  const authority = effectiveAuthority(db);
  const failures = recentFailures(db);
  const granted = grantedIds(db);
  const actions = conferredActions(db, authority, granted);
  // A reached capability or action no execute grant names is refused by the
  // gate ("No grant covers ..."), so the map says so. That is the engine's
  // answer, not a missing one; a locked node has nothing to act with, and
  // says nothing.
  const authorityOf = (id: string, state: string, kind: string) =>
    authority.get(id) ??
    (state !== 'locked' && (kind === 'capability' || kind === 'action') && !granted.has(id)
      ? { execute: 'forbidden' as const, ungranted: true as const }
      : undefined);

  // What each capability needs beyond the agent: a person who approves or
  // supplies it, a device it runs on, a recurring cost. Derived by the engine
  // from structure; the map marks the joint ones and the panel names who.
  const nameById = new Map<string, string>(caps.map(c => [c.id, c.name]));
  const joint = new Map<string, { structure: string[]; people?: string[]; devices?: string[] }>();
  try {
    for (const r of affordanceDomains(db).capabilities as any[]) {
      if (!r.structure?.length) continue;
      const named = (ids?: string[]) => ids?.map(id => nameById.get(id) ?? id);
      joint.set(r.id, {
        structure: r.structure,
        people: named(r.people),
        devices: named(r.devices),
      });
    }
  } catch {
    /* no curated tree: nothing is derived, and nothing is marked */
  }

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
      providers: providersOf.get(c.id),
      credentials: credentialsOf.get(c.id),
      reliability: reliability.get(c.id),
      authority: authorityOf(c.id, c.state, c.kind),
      failures: failures.get(c.id),
      actions: actions.get(c.id),
      daysSinceChange: c.state === 'locked' ? undefined : daysSince(c.updated_at),
      structure: joint.get(c.id)?.structure,
      people: joint.get(c.id)?.people,
      devices: joint.get(c.id)?.devices,
    },
  }));

  const connections: TreeConnection[] = deps.map(d => ({
    from: d.from_capability,
    to: d.to_capability,
    type: d.is_hard_requisite ? 'hard-dep' : 'soft-dep',
    kind: d.kind || undefined,
  }));

  // How the range moved this week, so the map can lead with it. Null before
  // a second observation, which the map explains instead of printing +0.
  return { items, connections, since: loopSince(db) };
}

const isMode = (m: unknown): m is AuthorityMode =>
  (AUTHORITY_MODES as readonly string[]).includes(String(m));

/** Whole days since a stored timestamp, or nothing when the clocks disagree. */
function daysSince(stamp: unknown): number | undefined {
  if (typeof stamp !== 'string' || !stamp) return undefined;
  const ms =
    Date.now() - new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 86_400_000) : undefined;
}

/**
 * The actions each capability confers, with the mode each resolves to. The
 * panel used to say only the capability's own mode, which is the narrowest of
 * these; what an agent may actually do is per action, and reading a
 * repository is a different permission from merging to its default branch.
 */
function conferredActions(
  db: Db,
  authority: Map<string, { execute: AuthorityMode }>,
  granted: Set<string>
): Map<string, ConferredAction[]> {
  const out = new Map<string, ConferredAction[]>();
  try {
    for (const r of db
      .prepare(
        `SELECT d.from_capability capability, a.id, a.name FROM dependencies d
         JOIN capabilities a ON a.id = d.to_capability
         JOIN capabilities c ON c.id = d.from_capability
         WHERE d.kind = 'provides' AND a.kind = 'action' AND c.kind = 'capability'
         ORDER BY c.name, a.name`
      )
      .all<{ capability: string; id: string; name: string }>()) {
      if (!out.has(r.capability)) out.set(r.capability, []);
      // No grant at all is a refusal at the gate, which `canExecute` answers
      // with "No grant covers ...". This used to read as autonomous, so the
      // panel offered as unattended what the gate would refuse. A node with
      // only scoped grants keeps the old reading; `ambit scope` answers it.
      const mode = authority.get(r.id)?.execute;
      out
        .get(r.capability)!
        .push(
          mode || granted.has(r.id)
            ? { id: r.id, name: r.name, mode: mode ?? 'autonomous' }
            : { id: r.id, name: r.name, mode: 'forbidden', ungranted: true }
        );
    }
  } catch {
    /* a graph with no contract actions */
  }
  return out;
}

/** Every node some execute grant names, at any scope. */
function grantedIds(db: Db): Set<string> {
  try {
    return new Set(
      db
        .prepare(`SELECT DISTINCT capability_id FROM authority WHERE action != 'observe'`)
        .all<{ capability_id: string }>()
        .map(r => r.capability_id)
    );
  } catch {
    return new Set();
  }
}

/**
 * Each capability's effective, unscoped modes, from the same report `ambit
 * authority` prints so the panel and the terminal cannot disagree. Execute is
 * the narrowest of the grants that are not observe, which is how the report
 * itself groups them.
 */
function effectiveAuthority(
  db: Db
): Map<string, { execute: AuthorityMode; observe?: AuthorityMode }> {
  const out = new Map<string, { execute: AuthorityMode; observe?: AuthorityMode }>();
  let detail: any[] = [];
  try {
    detail = (authorityReport(db) as any).detail || [];
  } catch {
    return out;
  }
  const execute = new Map<string, AuthorityMode>();
  const observe = new Map<string, AuthorityMode>();
  for (const row of detail) {
    if (row.scope || !isMode(row.mode)) continue;
    if (row.action === 'observe') {
      observe.set(row.id, row.mode);
      continue;
    }
    const current = execute.get(row.id);
    execute.set(row.id, current ? (narrower(current, row.mode) as AuthorityMode) : row.mode);
  }
  for (const [id, mode] of execute) out.set(id, { execute: mode, observe: observe.get(id) });
  return out;
}

/** What the runtime reported failing here lately, by class and signal. */
function recentFailures(db: Db, days = 30): Map<string, FailureCount[]> {
  const out = new Map<string, FailureCount[]>();
  try {
    for (const r of db
      .prepare(
        `SELECT capability_id, class, signal, COUNT(*) AS times, MAX(timestamp) AS last
         FROM failure_signals
         WHERE capability_id IS NOT NULL AND timestamp >= datetime('now', ?)
         GROUP BY capability_id, class, signal ORDER BY times DESC`
      )
      .all<{ capability_id: string; class: string; signal: string; times: number; last: string }>(
        `-${days} days`
      )) {
      if (!out.has(r.capability_id)) out.set(r.capability_id, []);
      out
        .get(r.capability_id)!
        .push({ class: r.class, signal: r.signal, times: r.times, last: r.last });
    }
  } catch {
    /* a database predating failure signals */
  }
  return out;
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

/** Proposals for the approval UI: the full rows, newest first, each with its decision context. */
export function recentProposals(db: Db, limit = 50): ProposalRow[] {
  let rows: Record<string, any>[];
  try {
    rows = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
  let learned: ReturnType<typeof observedPreferences> = [];
  try {
    learned = observedPreferences(db);
  } catch {
    /* a database predating rejections */
  }
  return rows.map(r => ({
    ...r,
    status: (PROPOSAL_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as ProposalStatus)
      : 'draft',
    decision: decisionFor(r, learned),
  })) as ProposalRow[];
}

/**
 * What a person needs to decide on a proposal, read off what the draft stored.
 *
 * The card showed the goal and the steps. Deciding needs the benefit, which
 * the economic case carries; the cost, which the steps carry; whether it can
 * be undone, which every step's inverse says; what it unlocks, which the
 * simulation says; and how this person has decided on things like it, which
 * the record of approvals and rejections says. All five were stored and none
 * was shown.
 */
function decisionFor(
  row: Record<string, any>,
  learned: ReturnType<typeof observedPreferences>
): ProposalDecision | undefined {
  let steps: any[];
  try {
    steps = JSON.parse(row.steps);
  } catch {
    return undefined;
  }
  if (!Array.isArray(steps)) return undefined;
  const parse = (text: unknown) => {
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const economic = parse(row.economic_case);
  const simulated = parse(row.simulated);
  const traits = new Set<string>();
  for (const s of steps) {
    const t = traitsOf(s);
    if (t.privacy) traits.add(`privacy:${t.privacy}`);
    traits.add(t.recurring ? 'cost:recurring' : 'cost:one-off');
  }
  const recurring = steps
    .map(s => s.recurring_cost)
    .find((r: unknown) => typeof r === 'string' && r && r !== 'none');
  return {
    setup_hours:
      Math.round((steps.reduce((t, s) => t + (Number(s.setup_seconds) || 0), 0) / 3600) * 10) / 10,
    // Every step reversible is the only shape `ambit apply` will run; the
    // demo's hand-written steps carry no inverse and stay a document, honestly.
    reversible: steps.length > 0 && steps.every(s => Boolean(s.inverse)),
    requires_person: steps.some(s => Boolean(s.requires_person)),
    recurring: recurring || undefined,
    privacy: steps.map(s => s.privacy).find((p: unknown) => typeof p === 'string') || undefined,
    forecast: economic?.predicted
      ? {
          hours_month_now: Number(economic.observed?.human_hours_month) || 0,
          hours_month_after: Number(economic.predicted.human_hours_month_after) || 0,
          savings_dollars_month: Number(economic.predicted.savings_dollars_month) || 0,
          confidence: String(economic.confidence || 'low'),
        }
      : null,
    unlocks: [...(simulated?.acquired || []), ...(simulated?.unblocked || [])]
      .map((u: any) => String(u?.name || u?.id || ''))
      .filter(Boolean),
    precedent: learned.filter(l => traits.has(l.trait)),
  };
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
    acquisition_options: favour(db, o.acquisition_options),
  })) as LoopResponse['opportunities'];

  const interventions = digest.interventions ?? 0;
  return {
    source: 'ledger',
    authority: loopAuthority(db),
    next: loopNext(db),
    since: loopSince(db),
    demand: loopDemand(db),
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

/**
 * What runs without a person, what could, and what is spent. Read from the
 * same reports `ambit authority` and `ambit authority promote` print. The
 * page had nothing of this: the governance half of the product, and the most
 * decision-shaped data it holds, was terminal-only.
 */
function loopAuthority(db: Db): LoopAuthority {
  const empty: LoopAuthority = {
    autonomous: 0,
    confirm: 0,
    forbidden: 0,
    promotable: [],
    budgets: [],
    sandboxes: [],
  };
  let report: any;
  try {
    report = authorityReport(db);
  } catch {
    return empty;
  }
  const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  let promotable: LoopAuthority['promotable'] = [];
  try {
    promotable = (suggestPromotions(db) as any[]).map(p => ({
      capability: String(p.capability),
      id: String(p.id),
      action: String(p.action),
      asked: Number(p.asked_by_hand) || 0,
      evidence: String(p.evidence || ''),
      command: String(p.set_it || ''),
    }));
  } catch {
    /* a ledger with no interventions */
  }
  let budgets: LoopAuthority['budgets'] = [];
  try {
    budgets = db
      .prepare(
        `SELECT b.capability_id, b.action, b.budget_cents, b.spent_cents, b.period, c.name
         FROM budgets b LEFT JOIN capabilities c ON c.id = b.capability_id
         WHERE b.budget_cents > 0 ORDER BY b.capability_id`
      )
      .all<any>()
      .map(b => ({
        capability: String(b.name || b.capability_id),
        action: String(b.action),
        ceiling_dollars: Math.round(b.budget_cents) / 100,
        spent_dollars: Math.round(b.spent_cents) / 100,
        period: String(b.period || 'month'),
      }));
  } catch {
    /* a database predating budgets */
  }
  let sandboxes: string[] = [];
  try {
    sandboxes = db
      .prepare('SELECT target FROM sandboxes ORDER BY target')
      .all<{ target: string }>()
      .map(s => s.target);
  } catch {
    /* a database predating sandboxes */
  }
  return {
    autonomous: count(report.autonomous),
    confirm: count(report.needs_approval),
    forbidden: count(report.forbidden),
    promotable,
    budgets,
    sandboxes,
  };
}

/**
 * The alternative the record of this person's decisions favours, marked.
 *
 * The same choice `ambit propose` makes when it drafts, made visible where the
 * options are compared, and only where the record leans: with nothing learned
 * the options are listed as the catalog orders them, and nothing is marked.
 */
function favour(
  db: Db,
  options: unknown
): LoopResponse['opportunities'][number]['acquisition_options'] {
  if (!Array.isArray(options) || options.length < 2) return options as never;
  try {
    const preferred = preferredOption(db, options);
    if (!preferred.because) return options as never;
    return options.map((o, i) => (i === preferred.index ? { ...o, favoured: true } : o));
  } catch {
    return options as never;
  }
}

/**
 * What work has asked for and never had, worst first. Read off the deficit
 * report, which used to reach the page only as a fragility footnote; a
 * capability blocked four times this week is the head of the queue of what
 * to reach, not a risk.
 */
function loopDemand(db: Db): LoopDemand[] {
  const report = deficits(db);
  if (!Array.isArray(report)) return [];
  return (report as any[])
    .filter(d => d.still_missing)
    .slice(0, 5)
    .map(d => ({
      id: String(d.id),
      name: String(d.name),
      times: Number(d.times_blocked) || 0,
      structural: String(d.verdict || '').startsWith('structural'),
      failing: String(d.verdict || '').includes('failing'),
    }));
}

/** The three the terminal prints for `ambit next`, with the basis named. */
function loopNext(db: Db): LoopNext[] {
  try {
    const report = nextSteps(db) as any;
    const basis = String(report.basis || '').startsWith('observed') ? 'observed' : 'structural';
    return (report.next || []).map((n: any) => ({
      id: String(n.id),
      capability: String(n.capability),
      why: String(n.why || ''),
      cost: String(n.cost || ''),
      basis,
      missing: Array.isArray(n.missing) ? n.missing.map(String) : undefined,
    }));
  } catch {
    return [];
  }
}

/** How the frontier moved in the last week, or null before a second observation. */
function loopSince(db: Db): LoopSince | null {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  let report: any;
  try {
    report = ledgerSince(db, weekAgo);
  } catch {
    return null;
  }
  if (!report || report.error) return null;
  const names = (list: unknown) =>
    Array.isArray(list) ? list.map((e: any) => String(e?.name || e?.id || e)).filter(Boolean) : [];
  return {
    from: String(report.since),
    gained: names(report.gained),
    emergent: names(report.emergent),
    lost: names(report.lost),
    diminished: names(report.diminished),
  };
}

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

/** What the agents used that the map has no node for; the engine's report, as served. */
export function unmappedView(db: Db, days = 30): UnmappedResponse {
  return unmappedUse(db, days);
}
