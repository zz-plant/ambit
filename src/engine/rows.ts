/**
 * What a row of each table looks like, as the engine reads it.
 *
 * node:sqlite types every row as `unknown`. The handle in db.ts used to narrow
 * that to `Record<string, any>`, which let every query site read any field
 * off a row without the compiler ever checking that the column exists or
 * that its type is what the arithmetic assumes. Both tsconfigs are `strict`,
 * and strict does nothing for a value typed `any` — which is how a report can
 * sum a column that a query never selected and return zero without a word.
 *
 * One interface per table, matching schema.sql plus the columns migrate.ts
 * adds. A query that selects a subset says so with `Pick`; one that projects
 * an aggregate declares the aliases it names. Nullability follows the schema:
 * `NOT NULL` columns are plain, the rest are `| null`.
 */

export type CapabilityRow = {
  id: string;
  name: string;
  domain: string;
  description: string;
  category: string;
  state: string;
  unlock_cost_setup: number;
  unlock_cost_tokens: number;
  unlock_cost_api: number;
  parallel_slots: number;
  maturity_score: number;
  created_at: string;
  updated_at: string;
  kind: string;
  lifecycle: string;
};

export type DependencyRow = {
  id: number;
  from_capability: string;
  to_capability: string;
  cost_setup_seconds: number;
  cost_tokens: number;
  is_hard_requisite: number;
  description: string | null;
  kind: string;
};

export type SynergyRow = {
  id: number;
  name: string;
  requirement_ids: string;
  unlocked_capability: string;
  discount_percent: number;
  description: string | null;
  created_at: string;
};

export type SessionLearningRow = {
  id: number;
  session_id: string;
  capability_id: string;
  action: string;
  outcome_score: number | null;
  notes: string | null;
  timestamp: string;
};

export type FrontierSnapshotRow = {
  id: number;
  taken_at: string;
  reached: number;
  total: number;
  verified: number;
  states: string;
  kinds: string | null;
  lifecycles: string | null;
};

export type ProposalRow = {
  id: string;
  created_at: string;
  goal: string;
  status: string;
  steps: string;
  simulated: string;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  backup_path: string | null;
  economic_case: string | null;
  budget_cents: number | null;
  scope_exclude: string | null;
  expires_at: string | null;
  approval_artifact: string | null;
  observed_roi: string | null;
};

export type AuthorityRow = {
  id: number;
  capability_id: string;
  action: string;
  mode: string;
  holder: string;
  scope: string;
  source: string;
  note: string | null;
};

export type PreferenceRow = {
  id: number;
  actor_id: string;
  preference: string;
  created_at: string;
};

export type SchemaMetaRow = {
  key: string;
  value: string;
  applied_at: string;
};

export type WorkRunRow = {
  id: string;
  goal: string | null;
  goal_id: string | null;
  run_type: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  outcome_value_cents: number | null;
};

export type WorkEventRow = {
  id: number;
  run_id: string;
  at: string;
  kind: string;
  actor: string | null;
  capability_id: string | null;
  action: string | null;
  detail: string | null;
};

export type CapabilityUseRow = {
  id: number;
  run_id: string;
  capability_id: string;
  used_at: string;
  duration_seconds: number | null;
  source: string;
};

export type HumanInterventionRow = {
  id: number;
  run_id: string | null;
  actor_id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number | null;
  waiting_seconds: number | null;
  capability_id: string | null;
  action: string | null;
  outcome: string | null;
};

export type ResourceConsumptionRow = {
  id: number;
  run_id: string | null;
  resource_id: string | null;
  kind: string;
  quantity: number;
  unit: string | null;
  cost_cents: number | null;
  recorded_at: string;
};

export type OutcomeRow = {
  id: number;
  run_id: string;
  achieved: string;
  objective_metric: number | null;
  objective_name: string | null;
  value_cents: number | null;
  recorded_at: string;
};

export type EconomicsRow = {
  id: number;
  entity_type: string;
  entity_id: string;
  metric: string;
  value_cents: number;
  period: string;
  source: string;
};

export type GoalRow = {
  id: string;
  name: string;
  description: string | null;
  occurrence_rate_per_month: number | null;
  success_value_cents: number | null;
  failure_cost_cents: number | null;
};

export type BudgetRow = {
  id: number;
  capability_id: string;
  action: string;
  scope: string;
  budget_cents: number;
  period: string;
  spent_cents: number;
};

export type FederationImportRow = {
  id: number;
  environment: string;
  received_at: string;
  schema_version: number;
  signed: number;
  summary: string;
};

export type CatalogRow = {
  id: number;
  capability_id: string;
  provider: string;
  kind: string;
  setup_seconds: number;
  cost_one_time_cents: number | null;
  recurring_cents_per_month: number | null;
  privacy: string;
  verification: string | null;
  runtimes: string | null;
  expected_reliability: number | null;
  rollback: string | null;
  source: string;
};

/**
 * The loose row: what a query gets when it declares nothing. It is the type
 * the engine had everywhere before rows were named, kept as the default so a
 * site converts when it is read, not all at once.
 */
export type Row = Record<string, any>;

/** A prepared statement, with the row type chosen at the call. */
export interface Statement {
  all<T = Row>(...params: unknown[]): T[];
  get<T = Row>(...params: unknown[]): T | undefined;
  run(...params: unknown[]): unknown;
}
