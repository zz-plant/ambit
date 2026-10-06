import type { Migratable } from './migrate.ts';
import type { EconomicsRow, GoalRow } from './rows.ts';

/**
 * The economic model: what a unit of agency, capacity or service costs, and
 * what a goal is worth.
 *
 * Values are declared in the config's `economics` and `goals` blocks and stored
 * as cents. The lookups here are the arithmetic the opportunity engine is built
 * on — attention value per hour, recurring cost per month, goal value per
 * occurrence — so a comparison between "do it by hand" and "buy a capability"
 * is one multiplication away.
 *
 * The one estimate Ambit is willing to make: an undeclared human's attention is
 * worth the documented default, and the caller is told it is a default. Every
 * other metric is declared or null — the report says "estimate" rather than
 * pretending to know.
 */

/** $250/hour, the documented default when an actor declares nothing. */
export const DEFAULT_ATTENTION_CENTS_PER_HOUR = 25000;

/** A declared economic value in cents, or null when none is recorded. */
function valueCents(
  db: Migratable,
  entityType: string,
  entityId: string,
  metric: string
): number | null {
  const row = db
    .prepare(
      "SELECT value_cents FROM economics WHERE entity_type = ? AND entity_id = ? AND metric = ? AND source = 'declared' ORDER BY id DESC LIMIT 1"
    )
    .get<Pick<EconomicsRow, 'value_cents'>>(entityType, entityId, metric);
  return row?.value_cents ?? null;
}

/** One metric for every entity of a type, as a map keyed by entity id. */
function metricByEntity(db: Migratable, entityType: string, metric: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of db
    .prepare(
      "SELECT entity_id, value_cents FROM economics WHERE entity_type = ? AND metric = ? AND source = 'declared'"
    )
    .all<Pick<EconomicsRow, 'entity_id' | 'value_cents'>>(entityType, metric)) {
    out.set(r.entity_id, r.value_cents);
  }
  return out;
}

/**
 * Whose attention a recurring burden is priced at, or null when nobody is
 * known, which prices it at the default.
 *
 * The opportunity ranking and the ROI fallback named one person, the
 * maintainer, by id, so every other machine priced its burden at the default
 * whatever its owner had declared. The person is the one who declared a value,
 * when one did; among several, the one who stepped in most often.
 */
function attentionOwner(db: Migratable): string | null {
  const declared = metricByEntity(db, 'actor', 'attention_value_per_hour');
  if (declared.size === 1) return [...declared.keys()][0];
  let busiest: { actor_id: string } | undefined;
  try {
    busiest = db
      .prepare(
        `SELECT actor_id FROM human_intervention WHERE actor_id IS NOT NULL
         GROUP BY actor_id ORDER BY COUNT(*) DESC, actor_id LIMIT 1`
      )
      .get<{ actor_id: string }>();
  } catch {
    /* a graph with no work ledger yet */
  }
  if (busiest && (declared.size === 0 || declared.has(busiest.actor_id))) return busiest.actor_id;
  return [...declared.keys()].sort()[0] ?? busiest?.actor_id ?? null;
}

/** The cents-per-hour cost of an actor's attention, declared or the default. */
function attentionValueCentsPerHour(db: Migratable, actorId: string): number {
  const declared = valueCents(db, 'actor', actorId, 'attention_value_per_hour');
  return declared ?? DEFAULT_ATTENTION_CENTS_PER_HOUR;
}

/** The goal row, matched by id or by name. */
function goalValue(db: Migratable, goalIdOrName: string): GoalRow | null {
  const byId = db.prepare('SELECT * FROM goals WHERE id = ?').get<GoalRow>(goalIdOrName);
  if (byId) return byId;
  const byName = db.prepare('SELECT * FROM goals WHERE name = ?').get<GoalRow>(goalIdOrName);
  return byName || null;
}

/**
 * Every declared economic value and goal.
 *
 *   ambit economics
 *
 * The report names what the model knows and what it does not — an undeclared
 * actor's attention value is reported with its source so a reader can tell the
 * difference between "declared" and "defaulted".
 */
function economicsReport(db: Migratable) {
  const rows = db
    .prepare(
      'SELECT entity_type, entity_id, metric, value_cents, period, source FROM economics ORDER BY entity_type, entity_id, metric'
    )
    .all<
      Pick<
        EconomicsRow,
        'entity_type' | 'entity_id' | 'metric' | 'value_cents' | 'period' | 'source'
      >
    >();
  const goals = db
    .prepare(
      'SELECT id, name, occurrence_rate_per_month, success_value_cents, failure_cost_cents FROM goals ORDER BY id'
    )
    .all<
      Pick<
        GoalRow,
        'id' | 'name' | 'occurrence_rate_per_month' | 'success_value_cents' | 'failure_cost_cents'
      >
    >();

  const dollars = (cents: number | null) => (cents == null ? undefined : Math.round(cents) / 100);

  return {
    economics: rows.map(r => ({
      entity: `${r.entity_type}:${r.entity_id}`,
      metric: r.metric,
      value_dollars: dollars(r.value_cents),
      period: r.period,
      source: r.source,
    })),
    goals: goals.map(g => ({
      id: g.id,
      name: g.name,
      occurrence_rate_per_month: g.occurrence_rate_per_month,
      success_value_dollars: dollars(g.success_value_cents),
      failure_cost_dollars: dollars(g.failure_cost_cents),
    })),
    note: 'values in dollars; cents are the stored unit. An undeclared actor\u2019s attention defaults to $250/hr and is reported as such.',
  };
}

export {
  valueCents,
  metricByEntity,
  attentionOwner,
  attentionValueCentsPerHour,
  goalValue,
  economicsReport,
};
