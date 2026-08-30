-- Nodes. `kind` is the ontological one — capability, action, provider,
-- resource, actor, runtime — and `category` is the older, looser label the
-- visualiser styles by. Both are kept: ids and categories are load-bearing in
-- stored frontier snapshots and in the client, and re-iding to make the prefix
-- self-describing would invalidate the one component whose value is that its
-- history is continuous. See ontology.ts.
--
-- `kind` is last in both tables rather than where it reads best, so a database
-- created from this file and one migrated by ALTER TABLE have the same shape.
-- Comments stay outside the parentheses: SQLite keeps the CREATE statement
-- verbatim and cannot rewrite a table whose body has a trailing comment.
--
-- A `credential` node holds the *identity* of a credential and nothing else.
-- There is deliberately no column a secret could be written to, and adding one
-- would be a change of kind rather than a feature: this database is read by the
-- visualiser, copied into snapshots, and backed up before every apply. The
-- value belongs in whatever already holds it. What Ambit needs is only which
-- providers present the same one, because that is what decides whether their
-- redundancy is real.
CREATE TABLE IF NOT EXISTS capabilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'skill',
    state TEXT NOT NULL DEFAULT 'locked',
    unlock_cost_setup REAL NOT NULL DEFAULT 0,
    unlock_cost_tokens INTEGER NOT NULL DEFAULT 0,
    unlock_cost_api REAL NOT NULL DEFAULT 0,
    parallel_slots INTEGER NOT NULL DEFAULT 0,
    maturity_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL DEFAULT 'provider',
    lifecycle TEXT NOT NULL DEFAULT 'unknown'
);

-- Edges. `kind` is what the edge means; `is_hard_requisite` is how much it
-- matters. The second was being asked the first.
CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_capability TEXT NOT NULL REFERENCES capabilities(id),
    to_capability TEXT NOT NULL REFERENCES capabilities(id),
    cost_setup_seconds REAL NOT NULL DEFAULT 0,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    is_hard_requisite INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    kind TEXT NOT NULL DEFAULT 'requires',
    UNIQUE(from_capability, to_capability)
);

CREATE TABLE IF NOT EXISTS synergies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    requirement_ids TEXT NOT NULL,
    unlocked_capability TEXT NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_learning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    capability_id TEXT NOT NULL REFERENCES capabilities(id),
    action TEXT NOT NULL,
    outcome_score REAL,
    notes TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capabilities_domain ON capabilities(domain);
CREATE INDEX IF NOT EXISTS idx_capabilities_state ON capabilities(state);
CREATE INDEX IF NOT EXISTS idx_dependencies_to ON dependencies(to_capability);
CREATE INDEX IF NOT EXISTS idx_session_learning_cap ON session_learning(capability_id, action);
CREATE INDEX IF NOT EXISTS idx_session_learning_action ON session_learning(action);

-- Frontier ledger. `capabilities` holds the present state and is overwritten
-- on every seed, so it cannot answer "what could this system do at time T".
-- Each row here is one observation of the whole frontier, written on seed only
-- when the state actually differs from the previous observation — so the table
-- records changes rather than runs.
CREATE TABLE IF NOT EXISTS frontier_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL DEFAULT (datetime('now')),
    reached INTEGER NOT NULL,
    total INTEGER NOT NULL,
    -- How many capabilities carried passing verification at that observation.
    -- The ledger records demonstrated reliability as well as reach: the two
    -- move apart exactly when a declared check starts failing.
    verified INTEGER NOT NULL DEFAULT 0,
    -- id -> state for every capability, so a past frontier can be reconstructed
    -- exactly rather than inferred from counts.
    states TEXT NOT NULL,
    -- id -> kind alongside it. Without this a snapshot cannot tell an expanding
    -- system from an expanding vocabulary: the run that introduced action nodes
    -- would read as forty capabilities gained on a machine where nothing
    -- changed. Null on snapshots written before kinds existed.
    kinds TEXT,
    -- id -> lifecycle beside state. A capability whose check starts failing
    -- loses its evidence worth without moving state; recording both lets the
    -- ledger answer what the system could do *and* what that was worth.
    -- Null on snapshots written before lifecycles existed.
    lifecycles TEXT
);

CREATE INDEX IF NOT EXISTS idx_frontier_taken ON frontier_snapshots(taken_at);

-- Proposals. A reviewable, durable description of a capability acquisition:
-- what it would achieve, which alternative was chosen, in what order, and what
-- the frontier would look like afterwards.
--
-- Nothing here executes. A proposal is an artifact you read before believing,
-- and the record that makes an approval refer to a stated consequence rather
-- than a hope. `inverse` exists and is unpopulated by design: no step may ever
-- execute without one, so the column is the gate rather than an afterthought.
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    steps TEXT NOT NULL,
    simulated TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    applied_at TEXT,
    backup_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- Authority. Being able to perform an action is not permission to perform it,
-- so the two are stored apart: `state` and `lifecycle` say what the system can
-- do, this table says what it may do and who says so.
--
-- More than one source can speak about the same capability — the curated model
-- declares what an action is like in general, and the runtime that would
-- execute it declares what it permits here. They are stored as separate rows
-- rather than merged on write, because which one narrowed a capability is the
-- interesting half of the answer. `holder` and `scope` default to '' rather
-- than NULL so that re-seeding cannot duplicate a row: SQLite treats NULLs in
-- a UNIQUE constraint as distinct from each other.
CREATE TABLE IF NOT EXISTS authority (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capability_id TEXT NOT NULL REFERENCES capabilities(id),
    action TEXT NOT NULL,
    mode TEXT NOT NULL,
    holder TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    note TEXT,
    UNIQUE(capability_id, action, holder, scope, source)
);

CREATE INDEX IF NOT EXISTS idx_authority_cap ON authority(capability_id);

-- Preferences. The human is an actor in the graph — what they supply and
-- authorise is an edge — but *which* human to ask, and whether a step is worth
-- their attention, is a matter of how they prefer things done. A preference is
-- a statement a plan can match against the alternatives of a step: a person who
-- prefers local-when-practical is the wrong ask for a step whose only option
-- ships data to a hosted API. Declared in the actors block as `prefers`.
CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL REFERENCES capabilities(id),
    preference TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(actor_id, preference)
);

CREATE INDEX IF NOT EXISTS idx_preferences_actor ON preferences(actor_id);

-- What has already been done to this database. One-time backfills are recorded
-- here rather than inferred, because a backfill that cannot tell "never set"
-- from "set to the default" either runs forever or runs never.
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Work ledger (the operating half) ─────────────────────────────────────────
--
-- `session_learning` records what the *configuration* did — approvals, applies,
-- verifications, blocks. These tables record what the *work* was: one row per
-- run of actual effort, its events, the capabilities it exercised, the times
-- a human had to intervene, the resources it consumed, and what it achieved.
-- This is the observation the economic loop runs on: recurring intervention +
-- elapsed time + cost, per goal, is what an opportunity is a projection of.
--
-- Nothing here moves `capabilities.state` — the frontier stays structural. A
-- run may change the world or merely observe it; either way the ledger records
-- it, and `tt work` is the report a person reads.
CREATE TABLE IF NOT EXISTS work_runs (
    id TEXT PRIMARY KEY,
    goal TEXT,
    goal_id TEXT REFERENCES capabilities(id),
    run_type TEXT NOT NULL DEFAULT 'task',
    source TEXT NOT NULL DEFAULT 'manual',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    outcome TEXT,
    outcome_value_cents REAL
);

CREATE TABLE IF NOT EXISTS work_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL,
    actor TEXT,
    capability_id TEXT,
    action TEXT,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS capability_use (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    capability_id TEXT NOT NULL REFERENCES capabilities(id),
    used_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_seconds REAL,
    source TEXT NOT NULL DEFAULT 'event'
);

CREATE TABLE IF NOT EXISTS human_intervention (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES work_runs(id),
    actor_id TEXT NOT NULL,
    -- What the human contributed. clerical and exception are the reducible
    -- kinds; judgment and knowledge are the ones worth keeping, and an
    -- opportunity engine must never propose removing those.
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    active_seconds REAL,
    waiting_seconds REAL,
    capability_id TEXT,
    action TEXT,
    outcome TEXT
);

CREATE TABLE IF NOT EXISTS resource_consumption (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES work_runs(id),
    resource_id TEXT,
    kind TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT,
    cost_cents REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    achieved TEXT NOT NULL,
    objective_metric REAL,
    objective_name TEXT,
    value_cents REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_runs_started ON work_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_work_events_run ON work_events(run_id);
CREATE INDEX IF NOT EXISTS idx_capability_use_run ON capability_use(run_id, capability_id);
CREATE INDEX IF NOT EXISTS idx_intervention_actor ON human_intervention(actor_id, started_at);
CREATE INDEX IF NOT EXISTS idx_resource_run ON resource_consumption(run_id);

-- ─── Economics (WP-4) ─────────────────────────────────────────────────────────
--
-- What a unit of agency, capacity or service costs, declared in the config's
-- `economics` block and normalised here to cents. The whole point of the model
-- is to make acquisition alternatives and recurring friction comparable, so
-- every value is a single number with a period; nothing is left as prose.
--
--   "economics": {
--     "actors":    { "kanav": { "attention_value_per_hour": 250 } },
--     "resources": { "device:nuc": { "purchase_cost": 3000,
--                                    "power_cost_per_hour": 0.22 } },
--     "providers": { "provider:acme": { "recurring_cost_per_month": 80,
--                                       "marginal_cost_per_request": 0.002 } }
--   }
CREATE TABLE IF NOT EXISTS economics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value_cents REAL NOT NULL,
    period TEXT NOT NULL DEFAULT 'one_time',
    source TEXT NOT NULL DEFAULT 'declared',
    UNIQUE(entity_type, entity_id, metric, source)
);

CREATE INDEX IF NOT EXISTS idx_economics_entity ON economics(entity_type, entity_id);

-- What a goal is worth, so a recurring one has a price. `occurrence_rate` and
-- the value/failure columns are what turn a frequency from the work ledger into
-- an annual figure an opportunity can rank. Declared in dollars; stored in
-- cents like every other value in this model.
--
--   "goals": { "recover-production": {
--       "name": "Recover production service",
--       "occurrence_rate_per_month": 2,
--       "success_value": 40,
--       "failure_cost": 500 } }
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    occurrence_rate_per_month REAL,
    success_value_cents REAL,
    failure_cost_cents REAL
);

-- How much a granted action may cost. The authority table says what may be
-- done; this says within what budget, so canExecute can refuse a spend that
-- would exceed it rather than merely reporting permission.
--
--   "budgets": { "combo:shell-execution": { "execute": { "budget_cents": 50000, "period": "month" } } }
CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capability_id TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'execute',
    scope TEXT NOT NULL DEFAULT '',
    budget_cents REAL NOT NULL,
    period TEXT NOT NULL DEFAULT 'month',
    spent_cents REAL NOT NULL DEFAULT 0,
    UNIQUE(capability_id, action, scope)
);

-- Signed summaries received from another environment's Ambit. A portfolio
-- layer reads these; it does not merge them into this graph. The row is the
-- receipt, so an import is auditable and re-imports are idempotent.
CREATE TABLE IF NOT EXISTS federation_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    environment TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    schema_version INTEGER NOT NULL,
    signed INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL,
    UNIQUE(environment, received_at)
);

-- The supply side: how a capability can be acquired, compared on cost,
-- privacy, verification and rollback. Declared in the config's `catalog`
-- block, plus a row per acquisition alternative the curated model names. A
-- demand-first project: the catalog fills in for capabilities the opportunity
-- engine keeps proposing, not an invented marketplace.
--
--   "catalog": { "combo:invoice-reconciliation": [
--       { "provider": "saas-x", "kind": "subscribe",
--         "setup_seconds": 1800, "recurring_dollars_per_month": 490,
--         "privacy": "hosted", "verification": "API check",
--         "runtimes": ["opencode"], "expected_reliability": 0.98,
--         "rollback": "revoke the credential" } ] }
CREATE TABLE IF NOT EXISTS catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capability_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'build',
    setup_seconds REAL NOT NULL DEFAULT 0,
    cost_one_time_cents REAL,
    recurring_cents_per_month REAL,
    privacy TEXT NOT NULL DEFAULT 'local',
    verification TEXT,
    runtimes TEXT,
    expected_reliability REAL,
    rollback TEXT,
    source TEXT NOT NULL DEFAULT 'declared',
    UNIQUE(capability_id, provider, source)
);

CREATE INDEX IF NOT EXISTS idx_catalog_cap ON catalog(capability_id);
CREATE INDEX IF NOT EXISTS idx_intervention_cap ON human_intervention(capability_id);
