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
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_capability TEXT NOT NULL REFERENCES capabilities(id),
    to_capability TEXT NOT NULL REFERENCES capabilities(id),
    cost_setup_seconds REAL NOT NULL DEFAULT 0,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    is_hard_requisite INTEGER NOT NULL DEFAULT 1,
    description TEXT,
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
