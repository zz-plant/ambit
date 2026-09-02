import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Migratable } from './migrate.ts';
import { opportunitiesFor } from './opportunities.ts';
import type { CapabilityRow, ProposalRow } from './rows.ts';

/**
 * Federation: what one environment's Ambit is willing to say about itself to
 * another.
 *
 * The single-environment loop works; this is the skeleton for the portfolio
 * case. A summary is derived aggregates only — capability availability, human
 * burden, operating costs, deficits, proposals, realized ROI — with no
 * credentials, no config, no commands, no raw sessions. What is not in the
 * query cannot leak. The summary is signed with the machine's approval key so
 * a portfolio layer can tell a real environment from an imposter; verification
 * is the importer's choice, and the signature's absence is reported, not
 * silently accepted.
 *
 * Import stores the receipt and nothing else: a portfolio Ambit reads other
 * environments' summaries, it does not merge their graphs.
 */

const SCHEMA_VERSION = 1;

/** Signs a summary with the machine key. Absent key → unsigned, and said so. */
function signSummary(summary: unknown): string | undefined {
  const key = process.env.AMBIT_APPROVAL_KEY;
  if (!key) return undefined;
  return createHmac('sha256', key).update(JSON.stringify(summary)).digest('hex');
}

/**
 * The export another environment can read.
 *
 *   ambit federation export [path]
 *
 * Everything is a count or a declared number — nothing a credential lives in.
 */
function exportSummary(db: Migratable) {
  const capabilities = db
    .prepare(
      `SELECT id, name, kind, domain, state, lifecycle FROM capabilities
     WHERE kind != 'action' ORDER BY id`
    )
    .all<Pick<CapabilityRow, 'id' | 'name' | 'kind' | 'domain' | 'state' | 'lifecycle'>>()
    .map(c => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      domain: c.domain,
      reached: c.state !== 'locked',
      lifecycle: c.lifecycle,
    }));

  // Human burden, summed per capability over the same 30-day window the
  // opportunity engine reads.
  const burden = db
    .prepare(
      `SELECT capability_id, COUNT(*) times, COALESCE(SUM(active_seconds),0) active, COALESCE(SUM(waiting_seconds),0) waiting
     FROM human_intervention WHERE started_at >= datetime('now', '-30 days') AND capability_id IS NOT NULL
     GROUP BY capability_id ORDER BY times DESC`
    )
    .all<{ capability_id: string; times: number; active: number; waiting: number }>()
    .map(r => ({
      capability_id: r.capability_id,
      interventions_month: r.times,
      human_hours_month: Math.round(((r.active + r.waiting) / 3600) * 10) / 10,
    }));

  // Person-specific single points of failure: a reached capability only a
  // human supplies. The portfolio's "worst person-SPOF" question needs this
  // on every environment's summary, and it is a count, not a person's data.
  const person_spofs = db
    .prepare(
      `SELECT c.id FROM capabilities c
     WHERE c.kind = 'capability' AND c.state != 'locked'
       AND (SELECT COUNT(*) FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
            WHERE d.to_capability = c.id AND d.kind IN ('provides','contributes')) = 1
       AND (SELECT p.kind FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
            WHERE d.to_capability = c.id AND d.kind IN ('provides','contributes') LIMIT 1) = 'actor'`
    )
    .all<Pick<CapabilityRow, 'id'>>()
    .map(r => r.id);

  const operatingCost = db
    .prepare(
      `SELECT resource_id, SUM(cost_cents) cost_cents FROM resource_consumption
     WHERE recorded_at >= datetime('now', '-30 days') GROUP BY resource_id ORDER BY cost_cents DESC`
    )
    .all<{ resource_id: string | null; cost_cents: number }>()
    .map(r => ({ resource_id: r.resource_id, cost_cents: r.cost_cents }));

  const opportunities = (opportunitiesFor(db, 'attention') as any).opportunities || [];

  const proposals = db
    .prepare(
      'SELECT id, goal, status, economic_case, observed_roi FROM proposals ORDER BY created_at DESC'
    )
    .all<Pick<ProposalRow, 'id' | 'goal' | 'status' | 'economic_case' | 'observed_roi'>>()
    .map(p => ({
      id: p.id,
      goal: p.goal,
      status: p.status,
      economic_case: p.economic_case ? JSON.parse(p.economic_case) : undefined,
      observed_roi: p.observed_roi ? JSON.parse(p.observed_roi) : undefined,
    }));

  const summary = {
    schema_version: SCHEMA_VERSION,
    environment: process.env.AMBIT_ENV || process.env.AMBIT_RUNTIME || 'opencode',
    exported_at: new Date().toISOString(),
    capabilities,
    burden,
    person_spofs,
    operating_cost_dollars_month:
      Math.round(operatingCost.reduce((s, r) => s + r.cost_cents, 0)) / 100,
    deficits: db
      .prepare(
        `SELECT capability_id, COUNT(*) times FROM session_learning
       WHERE (action = 'blocked' OR action LIKE 'blocked:%') GROUP BY capability_id ORDER BY times DESC`
      )
      .all<{ capability_id: string; times: number }>()
      .map(d => ({ capability_id: d.capability_id, times: d.times })),
    opportunities: opportunities.slice(0, 10).map((o: any) => ({
      capability_id: o.capability_id,
      kind: o.kind,
      interventions_month: o.burden.interventions_month,
      attention_dollars_month: o.burden.attention_dollars_month,
      confidence: o.confidence,
    })),
    proposals,
  };

  const signature = signSummary(summary);
  return { ...summary, signed: !!signature, signature: signature || undefined };
}

/**
 * The receipt of another environment's summary.
 *
 *   ambit federation import <path>
 *
 * Validates shape and signature presence, then stores the receipt. Nothing is
 * merged into this graph — a portfolio reads across environments; it does not
 * absorb them.
 */
function importSummary(db: Migratable, path?: string) {
  if (!path) return { error: 'Usage: ambit federation import <path-to-summary.json>' };
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    return { error: `Cannot read ${path}: ${e?.message || e}` };
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    return {
      error: `schema_version ${parsed.schema_version} not supported (want ${SCHEMA_VERSION})`,
    };
  }
  if (!Array.isArray(parsed.capabilities)) {
    return {
      error: `${path} is not a federation summary. Run ambit federation export on the source environment.`,
    };
  }

  db.prepare(
    'INSERT OR IGNORE INTO federation_imports (environment, schema_version, signed, summary) VALUES (?, ?, ?, ?)'
  ).run(
    parsed.environment || 'unknown',
    parsed.schema_version,
    parsed.signed ? 1 : 0,
    JSON.stringify(parsed)
  );

  return {
    environment: parsed.environment,
    capabilities: parsed.capabilities.length,
    reached: parsed.capabilities.filter((c: any) => c.reached).length,
    burden: parsed.burden?.length || 0,
    signed: parsed.signed
      ? "verified-or-not — key is the importer's choice"
      : 'unsigned — signature absent',
    note: 'stored as a receipt; nothing was merged into this graph',
  };
}

export { exportSummary, importSummary };
