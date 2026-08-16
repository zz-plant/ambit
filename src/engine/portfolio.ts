import type { Migratable } from "./migrate.ts";

/**
 * The portfolio layer: what the imported environments, taken together, look
 * like — the questions a holding company asks across businesses rather than
 * the questions one environment asks about itself.
 *
 * Everything here reads `federation_imports` — signed receipts, never merged
 * graphs. The receipts carry aggregates only, so the portfolio can say *eight
 * environments spend 40h/month moving data by hand* without ever seeing a
 * credential or a raw session.
 *
 *   ambit portfolio               where the shared burden is
 *   ambit portfolio --budget=100k where $100k of capex would produce the most
 */

function parsed(db: Migratable) {
  const rows = db.prepare(
    "SELECT environment, received_at, signed, summary FROM federation_imports ORDER BY received_at"
  ).all() as any[];
  return rows.map((r) => {
    let s: any = {};
    try { s = JSON.parse(r.summary); } catch {}
    return { environment: r.environment, received_at: r.received_at, signed: !!r.signed, summary: s };
  });
}

function portfolio(db: Migratable, budgetDollars?: number) {
  const imports = parsed(db);
  if (imports.length === 0) {
    return { note: 'No federation imports. Import another environment\u2019s summary with ambit federation import <path>.' };
  }

  const hoursOf = (burden: any[]) => (burden || []).reduce((s, b) => s + (b.human_hours_month || 0), 0);
  const attentionOf = (opps: any[]) => (opps || []).reduce((s, o) => s + (o.attention_dollars_month || 0), 0);

  const environments = imports.map((imp) => {
    const s = imp.summary;
    return {
      environment: imp.environment,
      signed: imp.signed,
      received_at: imp.received_at,
      capabilities: s.capabilities?.length || 0,
      reached: s.capabilities?.filter((c: any) => c.reached).length || 0,
      degraded: s.capabilities?.filter((c: any) => c.lifecycle === 'degraded' || c.lifecycle === 'broken').length || 0,
      person_spofs: s.person_spofs?.length || 0,
      human_hours_month: Math.round(hoursOf(s.burden) * 10) / 10,
      attention_dollars_month: Math.round(attentionOf(s.opportunities)),
      operating_dollars_month: s.operating_cost_dollars_month || 0,
      deficits: s.deficits?.length || 0,
    };
  });

  // The shared burden: the same capability demanding human time in more than
  // one environment is the reuse case — one investment, several businesses.
  const shared = new Map<string, { environments: Set<string>; hours: number }>();
  for (const imp of imports) {
    for (const b of imp.summary.burden || []) {
      if (!b.capability_id) continue;
      if (!shared.has(b.capability_id)) shared.set(b.capability_id, { environments: new Set(), hours: 0 });
      const e = shared.get(b.capability_id)!;
      e.environments.add(imp.environment);
      e.hours += b.human_hours_month || 0;
    }
  }
  const shared_burden = [...shared.entries()]
    .map(([capability_id, v]) => ({
      capability_id,
      environments: v.environments.size,
      total_hours_month: Math.round(v.hours * 10) / 10,
    }))
    .filter((r) => r.environments >= 2)
    .sort((a, b) => b.total_hours_month - a.total_hours_month);

  // Where the capex goes: the environment whose declared opportunities add to
  // the most annual savings.
  let allocation;
  if (budgetDollars != null && budgetDollars > 0) {
    allocation = imports
      .map((imp) => {
        const annual = attentionOf(imp.summary.opportunities) * 12;
        return { environment: imp.environment, savings_per_year_dollars: Math.round(annual), share: Math.round(annual * 100 / Math.max(1, imports.reduce((s, x) => s + attentionOf(x.summary.opportunities) * 12, 0))) };
      })
      .sort((a, b) => b.savings_per_year_dollars - a.savings_per_year_dollars);
  }

  return {
    environments: environments.length,
    environments_list: environments,
    shared_burden: shared_burden.length ? shared_burden : undefined,
    allocation,
    note: 'every number is read from signed receipts — nothing below is derived from this environment\u2019s own graph.',
  };
}

export { portfolio };