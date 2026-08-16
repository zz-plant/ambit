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
CREATE INDEX IF NOT EXISTS idx_session_learning_cap ON session_learning(capability_id, action);

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
