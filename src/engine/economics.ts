import { nearest } from '../shared/nearest.ts';
import { shellQuote } from '../shared/shell.ts';
import { parseAmount } from './budgets.ts';
import { shippedTree } from './catalog.ts';
import type { Migratable } from './migrate.ts';
import type { EconomicsRow, GoalRow } from './rows.ts';

/**
 * The economic model: what a unit of agency, capacity or service costs, and
 * what a goal is worth.
 *
 * Values are declared in the config's `economics` and `goals` blocks and stored
 * as cents. A model's price per million tokens can also be declared with
 * `ambit economics price`, since a Claude Code install has no such block to
 * write it in. The lookups here are the arithmetic the opportunity engine is
 * built on — attention value per hour, recurring cost per month, goal value per
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

/**
 * The three parts of a session's tokens a model is priced by, and the metric
 * each price is stored under, in cents per million tokens. Cache writes are
 * counted with fresh input, as the transcript read counts them, so the input
 * price covers both.
 */
const TOKEN_PRICES = {
  input: 'input_per_mtok',
  cached: 'cache_read_per_mtok',
  output: 'output_per_mtok',
} as const;

type TokenPart = keyof typeof TOKEN_PRICES;

/**
 * What a person declared a model's tokens cost, in cents per million, or null
 * when any of the three parts is undeclared. Never a default: tokens on a model
 * nobody priced are counted and not costed. All three or none, because every
 * session uses all three, and a spend that priced the output and left the
 * cache reads at nothing would be smaller than the person's own prices say.
 */
function modelPrice(db: Migratable, model: string): Record<TokenPart, number> | null {
  const price = {} as Record<TokenPart, number>;
  for (const [part, metric] of Object.entries(TOKEN_PRICES) as [TokenPart, string][]) {
    const cents = valueCents(db, 'model', model, metric);
    if (cents == null) return null;
    price[part] = cents;
  }
  return price;
}

/**
 * The capability a model's tokens are a use of, and so whose budget a spend on
 * the model lands on: the node of the curated tree whose `detect` patterns are
 * written for model ids and match `model:<name>`. For any model whose name does
 * not start "local", that is Hosted Inference. The tree as it ships, never an
 * overlay: a project's `.ambit.json` that moved the spend onto another node
 * would take it out from under the ceiling a person set (AGENTS.md rule 7).
 */
function spentOn(db: Migratable, model: string): string | null {
  const id = `model:${model}`;
  const matches = (pattern: string) => {
    try {
      return new RegExp(pattern, 'i').test(id);
    } catch {
      return false;
    }
  };
  for (const node of shippedTree().nodes || []) {
    const patterns: string[] = node.detect?.any || [];
    if (!patterns.some(p => p.startsWith('^model:') && matches(p))) continue;
    const capability = `combo:${node.id}`;
    if (db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(capability)) {
      return capability;
    }
  }
  return null;
}

/**
 * Declares what a model's tokens cost, so a session's tokens become a spend.
 *
 *   ambit economics price claude-opus-4-5 --input=5 --cache-read=0.5 --output=25
 *
 * Dollars per million tokens as typed, cents as stored, kept to fractions of a
 * cent, since a cache read can cost less than one. The name is the one a
 * session's transcript records and is matched exactly: a price is never applied
 * to a model whose name only resembles it. A name no session has recorded is
 * accepted, since a price can come before the first use, and the answer names
 * the recorded ones it might have meant.
 */
function declareModelPrice(
  db: Migratable,
  input: { model?: string; input?: string; cacheRead?: string; output?: string }
) {
  const usage =
    'Usage: ambit economics price <model> --input=<dollars> --cache-read=<dollars> --output=<dollars>, each per million tokens';
  const model = input.model?.trim();
  if (!model) return { error: usage };
  const parts: Record<TokenPart, number | undefined> = {
    input: parseAmount(input.input, false),
    cached: parseAmount(input.cacheRead, false),
    output: parseAmount(input.output, false),
  };
  const flagOf: Record<TokenPart, string> = {
    input: '--input',
    cached: '--cache-read',
    output: '--output',
  };
  const missing = (Object.keys(parts) as TokenPart[])
    .filter(p => parts[p] === undefined)
    .map(p => flagOf[p]);
  if (missing.length) {
    const named =
      missing.length > 1
        ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]} are`
        : `${missing[0]} is`;
    return {
      error: `${usage}\nAll three are required, in dollars: ${named} missing or not a number. A $ typed without quotes is read by the shell, so leave it off.`,
    };
  }
  const put = db.prepare(
    "INSERT OR REPLACE INTO economics (entity_type, entity_id, metric, value_cents, period, source) VALUES ('model', ?, ?, ?, 'per_mtok', 'declared')"
  );
  for (const part of Object.keys(TOKEN_PRICES) as TokenPart[]) {
    put.run(model, TOKEN_PRICES[part], parts[part] as number);
  }

  const recorded = db
    .prepare(
      "SELECT DISTINCT resource_id FROM resource_consumption WHERE kind = 'tokens' AND resource_id LIKE 'model:%'"
    )
    .all<{ resource_id: string }>()
    .map(r => r.resource_id.slice('model:'.length));
  const capability = spentOn(db, model);
  const name = capability
    ? (db.prepare('SELECT name FROM capabilities WHERE id = ?').get<{ name: string }>(capability)
        ?.name ?? capability)
    : null;
  // The budget the spend would land on: the unscoped one, since a session
  // names no target and so is inside no scope.
  const budgeted =
    capability &&
    db
      .prepare(
        "SELECT 1 AS ok FROM budgets WHERE capability_id = ? AND action = 'execute' AND scope = ''"
      )
      .get(capability);
  const perMillion = (cents: number) => `$${+(cents / 100).toFixed(6)}`;
  const unseen = recorded.length > 0 && !recorded.includes(model);
  const like = unseen ? nearest(model, recorded) : [];
  return {
    model,
    per_million_tokens: {
      input: perMillion(parts.input as number),
      cache_read: perMillion(parts.cached as number),
      output: perMillion(parts.output as number),
    },
    note: `Each Claude Code session that ends from now on has its tokens on ${model} priced at these, and sessions already recorded are not priced again. ${
      !capability
        ? 'No node of the tree covers this model, so the spend is kept on the session and counts against no budget.'
        : budgeted
          ? `The spend is recorded against the budget on ${name}.`
          : `The spend is kept on the session; no budget is set on ${name} for it to count against, and ambit budget set ${shellQuote(capability.replace('combo:', ''))} --amount=<dollars> --by=<person> sets one.`
    }`,
    ...(unseen
      ? {
          warning: `No session has recorded tokens on ${model} yet, and a price applies only to the exact name a transcript records.${like.length ? ` Recorded names like it: ${like.join(', ')}.` : ''}`,
        }
      : {}),
  };
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

  // To a millionth of a dollar: a price per million tokens can be a fraction
  // of a cent, and rounding it to whole cents would report another price.
  const dollars = (cents: number | null) =>
    cents == null ? undefined : Math.round(cents * 1e4) / 1e6;

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
    note: 'values in dollars; cents are the stored unit. An undeclared actor\u2019s attention defaults to $250/hr and is reported as such. A model\u2019s price is per million tokens and never defaults: tokens on a model with none are counted and not priced.',
  };
}

export {
  valueCents,
  metricByEntity,
  modelPrice,
  spentOn,
  declareModelPrice,
  TOKEN_PRICES,
  type TokenPart,
  attentionOwner,
  attentionValueCentsPerHour,
  goalValue,
  economicsReport,
};
