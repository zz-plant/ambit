#!/usr/bin/env node --experimental-sqlite
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH_DEFAULT = join(__dirname, "..", "..", "toolchain-viz.db");
// OPENCODE_CONFIG is the documented way to point the engine at another config
// (README, "Using other configs"); it was accepted by bootstrap.sh but never
// read here, so seeding always used the default path regardless.
const CONFIG_DEFAULT = process.env.OPENCODE_CONFIG || join(process.env.HOME || "/", ".config", "opencode", "opencode.json");

const C = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", grey: "\x1b[90m", blue: "\x1b[36m", red: "\x1b[31m", bold: "\x1b[1m" };

/**
 * node:sqlite is experimental and types every row as `unknown`, which would
 * require a hand-written row type at each of the ~40 query sites. This narrows
 * the handle to the surface the engine actually uses, with rows as loose
 * records — the same guarantee the code had before, now stated explicitly.
 */
interface Db {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, any>[];
    get(...params: unknown[]): Record<string, any> | undefined;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
}

function getDb(dbPath?: string): Db {
  const envPath = process.env.TOOLCHAIN_DB;
  const path = dbPath || envPath || DB_PATH_DEFAULT;
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as Db;
}

function migrate(db: Db) {
  db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));
}


/**
 * Prints a result for a person to read, or raw JSON with --json.
 *
 * Every command used to dump JSON.stringify unconditionally, which meant the
 * primary surface spoke machine and the reader had to parse it themselves —
 * the single biggest reason this tool needed explaining. Formatting is generic
 * rather than per-command so no command can drift back to raw output.
 */
function emit(data: any): void {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const HEADLINE = ["name", "title", "capability_id", "domain", "id", "type"];
  const label = (k: string) => k.replace(/_/g, " ");
  const scalar = (v: any) =>
    Array.isArray(v) ? v.filter(x => typeof x !== "object").join(", ") : String(v);
  const skip = (k: string, v: any) =>
    v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (Array.isArray(v) && v.some(x => typeof x === "object"));

  const renderOne = (row: any, indent = "  ") => {
    if (typeof row !== "object" || row === null) { console.log(indent + String(row)); return; }
    const headKey = HEADLINE.find(k => row[k] !== undefined);
    if (headKey) console.log(`${indent}${C.bold}${row[headKey]}${C.reset}`);
    for (const [k, v] of Object.entries(row)) {
      if (k === headKey || skip(k, v) || typeof v === "object") continue;
      console.log(`${indent}  ${C.grey}${label(k)}:${C.reset} ${scalar(v)}`);
    }
    // One level of nesting is common (near-misses carry their own list).
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v) && v.some(x => typeof x === "object")) {
        console.log(`${indent}  ${C.grey}${label(k)}:${C.reset}`);
        for (const child of v.slice(0, 5)) renderOne(child, indent + "    ");
      }
    }
  };

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${C.grey}Nothing to report.${C.reset}`);
      return;
    }
    console.log("");
    for (const row of data) { renderOne(row); console.log(""); }
    console.log(`${C.grey}${data.length} result${data.length === 1 ? "" : "s"} · --json for machine output${C.reset}`);
    return;
  }

  console.log("");
  renderOne(data);
  console.log("");
}


// ─── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Records the whole frontier if it differs from the last observation.
 *
 * `capabilities` is overwritten on every seed, so on its own the graph can only
 * answer what the system can do *now*. Accounting for capacity to act is much
 * more useful longitudinally — what could this system do at time T, and what
 * changed since — so each observation stores every capability's state, letting a
 * past frontier be reconstructed exactly rather than inferred from counts.
 *
 * Unchanged seeds are not recorded. The table is a log of changes, not of runs.
 */
function recordFrontier(db: Db): 'recorded' | 'unchanged' {
  const rows = db.prepare("SELECT id, state FROM capabilities ORDER BY id").all();
  const states: Record<string, string> = {};
  for (const r of rows) states[r.id] = r.state;
  const serialised = JSON.stringify(states);

  const last = db
    .prepare("SELECT states FROM frontier_snapshots ORDER BY taken_at DESC, id DESC LIMIT 1")
    .get();
  if (last && last.states === serialised) return 'unchanged';

  const reached = rows.filter(r => r.state !== 'locked').length;
  db.prepare("INSERT INTO frontier_snapshots (reached, total, states) VALUES (?, ?, ?)")
    .run(reached, rows.length, serialised);
  return 'recorded';
}

/** The observation in effect at a point in time, or the earliest one after it. */
function frontierAt(db: Db, when?: string): { taken_at: string; states: Record<string, string> } | null {
  const row = when
    ? db.prepare("SELECT taken_at, states FROM frontier_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC LIMIT 1").get(when)
      || db.prepare("SELECT taken_at, states FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get()
    : db.prepare("SELECT taken_at, states FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get();
  if (!row) return null;
  return { taken_at: row.taken_at, states: JSON.parse(row.states) };
}

/**
 * What changed in the reachable frontier since a past observation.
 *
 * The entry worth the whole table is `emergent`: a capability that became
 * reached although nothing that provides it was itself added. Those are
 * composition — prerequisites satisfied by other additions — and a
 * per-component changelog cannot show them, because no single change explains
 * one.
 */
function ledgerSince(db: Db, when?: string) {
  const past = frontierAt(db, when);
  if (!past) return { error: "No frontier recorded yet. Run seed at least twice." };

  const now = db.prepare("SELECT id, name, state, category FROM capabilities ORDER BY id").all();
  const nameOf = new Map(now.map(c => [c.id, c.name]));
  const wasLocked = (id: string) => past.states[id] === 'locked';
  const isReached = (c: any) => c.state !== 'locked';

  // Newly added means absent from the observation, which the snapshot answers
  // exactly. Comparing created_at against taken_at looked equivalent and was
  // not: datetime('now') resolves to the second, so two seeds inside the same
  // second classified every addition as pre-existing.
  const addedSince = new Set(now.filter(c => past.states[c.id] === undefined).map(c => c.id));

  const providers = db
    .prepare("SELECT from_capability, to_capability FROM dependencies WHERE description = 'Provides this capability'")
    .all();
  const provedBy = new Map<string, string[]>();
  for (const p of providers) {
    if (!provedBy.has(p.to_capability)) provedBy.set(p.to_capability, []);
    provedBy.get(p.to_capability)!.push(p.from_capability);
  }

  const gained: any[] = [];
  const emergent: any[] = [];
  for (const c of now) {
    const newlyReached = isReached(c) && (wasLocked(c.id) || past.states[c.id] === undefined);
    if (!newlyReached) continue;
    const proofs = provedBy.get(c.id) || [];
    const proofAddedSince = proofs.some(p => addedSince.has(p));
    const entry = {
      id: c.id,
      name: c.name,
      proved_by: proofs.map(p => nameOf.get(p) || p).slice(0, 4),
    };
    // Reached without any of its providers being new: composition did it.
    if (!addedSince.has(c.id) && !proofAddedSince && proofs.length > 0) emergent.push(entry);
    else gained.push(entry);
  }

  const lost = now
    .filter(c => !isReached(c) && past.states[c.id] && past.states[c.id] !== 'locked')
    .map(c => ({ id: c.id, name: c.name }));

  const pastReached = Object.values(past.states).filter(v => v !== 'locked').length;
  return {
    since: past.taken_at,
    frontier_then: pastReached,
    frontier_now: now.filter(isReached).length,
    gained,
    emergent,
    lost,
    note: emergent.length
      ? "emergent: became reachable although nothing providing them was added — composition, not acquisition"
      : undefined,
  };
}

/** Every recorded observation, oldest first. */
function ledgerHistory(db: Db) {
  return db
    .prepare("SELECT taken_at, reached, total FROM frontier_snapshots ORDER BY taken_at ASC, id ASC")
    .all()
    .map((r: any) => ({ taken_at: r.taken_at, reached: r.reached, total: r.total }));
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

function parseMapping(mappingStr?: string): Record<string, any> {
  if (mappingStr) {
    try { return JSON.parse(mappingStr); } catch {}
  }
  return {
    config_keys: { mcp: { type: 'mcp', domain_field: 'type', domain_map: { remote: 'backend', local: 'infra' }, desc_template: '{type} server' }, agent: { type: 'agent', domain: 'meta', desc_field: 'description' }, provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' }, command: { type: 'tool', domain: 'devops', desc_field: 'description' } },
    skill_dirs: ["~/.agents/skills", "~/.opencode/skills"],
  };
}

function seedFromConfig(db: Db, configPath?: string, mappingStr?: string) {
  const cp = configPath || CONFIG_DEFAULT;
  if (!existsSync(cp)) return 0;
  const config = JSON.parse(readFileSync(cp, "utf8"));
  const mapping = parseMapping(mappingStr);

  let count = 0;
  const contributed: string[] = [];
  const insert = db.prepare("INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, state, maturity_score) VALUES (?, ?, ?, ?, ?, ?, ?)");

  for (const [key, cfg] of Object.entries<any>(mapping.config_keys || {})) {
    const entries = config[key] || {};
    for (const [name, val] of Object.entries<any>(entries)) {
      const type = cfg.type || 'tool';
      const domain = cfg.domain || (cfg.domain_map && cfg.domain_map[val[cfg.domain_field || 'type']]) || 'infra';
      const desc = (cfg.desc_field ? (val[cfg.desc_field] || '') : cfg.desc_template ? cfg.desc_template.replace('{type}', val.type || type) : '') || '';
      insert.run(`${type}:${name}`, name, domain, desc.slice(0, 80), type, 'unlocked', 0.5);
      contributed.push(`${type}:${name}`);
      count++;
    }
  }

  for (const dirPattern of (mapping.skill_dirs || [])) {
    const dir = dirPattern.replace(/^~/, process.env.HOME || "/");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Not entry.isDirectory(): a Dirent reports false for a symlink, and
      // symlinking skills into a runtime's directory is how they get shared
      // between runtimes. That silently skipped 23 of 47 skills in a real
      // Hermes install, all of them pointing at the same shared directory
      // OpenCode reads — precisely the capabilities two runtimes have in
      // common. existsSync follows the link.
      if (!existsSync(join(dir, entry.name, "SKILL.md"))) continue;
      insert.run(`skill:${entry.name}`, entry.name, 'meta', 'Agent skill', 'skill', 'unlocked', 0.55);
      contributed.push(`skill:${entry.name}`);
      count++;
    }
  }

  insert.run("core:reasoning", "Core Reasoning", "meta", "Base LLM reasoning", "meta", "active", 1.0);
  insert.run("tool:bash", "Shell Execution", "infra", "Run commands", "tool", "active", 1.0);
  insert.run("tool:edit", "File Editor", "meta", "Edit files", "tool", "active", 1.0);
  insert.run("tool:lsp", "LSP Diagnostics", "quality", "Language server", "tool", "active", 0.95);
  count += 4;

  db.prepare("UPDATE capabilities SET state = 'active' WHERE id IN ('core:reasoning','tool:bash','tool:edit','tool:lsp')").run();

  count += seedModels(db, config, insert);
  count += attributeToRuntime(db, insert, contributed);
  seedDependencies(db, config);
  count += seedTechTree(db, insert);
  count += seedCombos(db, config, mapping, insert);

  recordFrontier(db);

  return count;
}

/**
 * Models are real config entities the seed previously skipped, which left
 * providers as leaves and agents unconnected to anything. Their ids match the
 * visualizer's (`model:<provider>/<name>`) so both halves agree.
 */
function seedModels(db: Db, config: any, insert: any): number {
  let count = 0;
  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const [model, mv] of Object.entries<any>(pv?.models || {})) {
      const ctx = mv?.limit?.context;
      insert.run(
        `model:${provider}/${model}`,
        mv?.name || model,
        'ai-ml',
        ctx ? `${ctx} context` : 'Model',
        'model',
        'unlocked',
        0.6
      );
      count++;
    }
  }
  return count;
}

/**
 * Edges the config states outright — nothing inferred by heuristic:
 *   provider → model   a model cannot run without its provider
 *   model    → agent   an agent pinned to a model depends on it
 *
 * `from` is the prerequisite and `to` the dependent, matching how the combo
 * analyses read the table. Only edges whose endpoints both exist are written,
 * since the schema has foreign keys on both columns.
 */
function seedDependencies(db: Db, config: any): number {
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );
  let count = 0;

  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const model of Object.keys(pv?.models || {})) {
      if (!has(`provider:${provider}`) || !has(`model:${provider}/${model}`)) continue;
      link.run(`provider:${provider}`, `model:${provider}/${model}`, 1, 'Model served by provider');
      count++;
    }
  }

  for (const [name, agent] of Object.entries<any>(config.agent || {})) {
    const ref = agent?.model;
    if (typeof ref !== 'string' || !has(`agent:${name}`)) continue;
    // "provider/model" — the model half may itself contain slashes.
    const slash = ref.indexOf('/');
    if (slash < 0) continue;
    const provider = ref.slice(0, slash);
    const modelId = `model:${ref}`;
    if (has(modelId)) {
      link.run(modelId, `agent:${name}`, 1, 'Agent pinned to model');
      count++;
    } else if (has(`provider:${provider}`)) {
      // Model not declared in config; the provider dependency still holds.
      link.run(`provider:${provider}`, `agent:${name}`, 1, 'Agent pinned to provider');
      count++;
    }
  }

  return count;
}


/**
 * Records which runtime contributed these capabilities.
 *
 * Two runtimes commonly configure the same MCP server. That is one capability
 * with two providers, not two capabilities, so the ids deliberately collide and
 * merge — but the graph then cannot say which runtime supplies what, or what
 * would be lost if one went away. A runtime node with an edge to everything it
 * contributed answers both, and makes `tt impact runtime:hermes` meaningful.
 *
 * The runtime is an ordinary node: Ambit represents agent runtimes rather than
 * being one, so no runtime owns the graph.
 */
function attributeToRuntime(db: Db, insert: any, contributed: string[]): number {
  const runtime = process.env.AMBIT_RUNTIME || 'opencode';
  if (contributed.length === 0) return 0;
  const id = `runtime:${runtime}`;
  insert.run(id, runtime, 'meta', `Agent runtime — contributes ${contributed.length} capabilities`, 'runtime', 'unlocked', 0.9);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, 1, 'Contributed by runtime')"
  );
  for (const capability of contributed) link.run(id, capability);
  return 1;
}

/**
 * Places the user on the curated capability tree in techtree.json.
 *
 * The tree is authored content, the way a Civ tech tree is: everyone gets the
 * same one and differs only in where they are on it. That is what makes the
 * unlock analyses work without the user hand-authoring the interesting half —
 * previously they returned empty until someone wrote their own combos.
 *
 * Each node is matched against the ids already seeded from the user's config:
 *   detected                        → unlocked, with an edge from what proved it
 *   prerequisites met, not detected → locked, and surfaced as researchable next
 *   prerequisites unmet             → locked, further out
 *
 * Nodes are stored with a `combo:` prefix and category, because that is what
 * the existing unlock analyses select on.
 */
function seedTechTree(db: Db, insert: any): number {
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(join(__dirname, "techtree.json"), "utf8"));
  } catch {
    return 0; // A missing or unreadable tree degrades to config-only seeding.
  }

  const owned: string[] = db
    .prepare("SELECT id FROM capabilities WHERE id NOT LIKE 'combo:%'")
    .all()
    .map((r: any) => r.id);
  const modelCount = owned.filter(id => id.startsWith('model:')).length;

  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );

  // Which of the user's capabilities, if any, prove each node.
  const evidence = new Map<string, string[]>();
  for (const node of tree.nodes || []) {
    const patterns: string[] = node.detect?.any || [];
    const hits = owned.filter(id =>
      patterns.some(p => {
        try { return new RegExp(p, 'i').test(id); } catch { return false; }
      })
    );
    const meetsMin = !node.detect?.min_models || modelCount >= node.detect.min_models;
    evidence.set(node.id, hits.length && meetsMin ? hits : []);
  }

  // Resolve in era order so a node's prerequisites are settled before it is.
  // Without this the tree contradicts itself — reporting Offline Capable as
  // reached while Local Embeddings, which it requires, is still locked.
  const ordered = [...(tree.nodes || [])].sort((a: any, b: any) => (a.era || 0) - (b.era || 0));
  const unlocked = new Set<string>();

  let count = 0;
  for (const node of ordered) {
    const id = `combo:${node.id}`;
    const proof = evidence.get(node.id) || [];
    const missing: string[] = (node.requires || []).filter((r: string) => !unlocked.has(r));
    const reached = proof.length > 0 && missing.length === 0;
    if (reached) unlocked.add(node.id);

    // Having the tooling for a node whose prerequisites are unmet is the most
    // useful thing the tree can tell you, so say it rather than hiding it.
    const blocked = proof.length > 0 && missing.length > 0;
    const names = (ids: string[]) =>
      ids.map(r => (tree.nodes.find((n: any) => n.id === r)?.name || r)).join(', ');
    const description = reached
      ? node.description
      : blocked
        ? `${node.description} — configured, but ${names(missing)} is not in place yet`
        : `${node.description} — ${node.hint || ''}`.trim();

    insert.run(
      id,
      node.name,
      node.domain || 'meta',
      description,
      'combo',
      reached ? 'unlocked' : 'locked',
      reached ? 0.7 : 0
    );
    // The insert is OR IGNORE, so on a re-seed it does nothing — which left
    // every tech-tree node frozen at whatever the first run computed. Change
    // your config, re-run bootstrap, and the tree would not move. State is
    // derived, so it has to be written every time.
    db.prepare(
      `UPDATE capabilities SET state = ?, description = ?, maturity_score = ?,
       unlock_cost_setup = ?, unlock_cost_tokens = ?,
       updated_at = CASE WHEN state != ? THEN datetime('now') ELSE updated_at END
       WHERE id = ?`
    ).run(
      reached ? 'unlocked' : 'locked',
      description,
      reached ? 0.7 : 0,
      node.setup_seconds || 0,
      node.tokens || 0,
      reached ? 'unlocked' : 'locked',
      id
    );
    count++;

    // Edges from the user's own capabilities to the node they unlock, so
    // `tt impact` can answer what breaks if a given tool goes away.
    for (const hit of proof.slice(0, 6)) {
      link.run(hit, id, 1, 'Provides this capability');
    }
    // Tier progression between tree nodes.
    for (const req of node.requires || []) {
      link.run(`combo:${req}`, id, 1, 'Tech tree prerequisite');
    }
    for (const opt of node.optional || []) {
      link.run(`combo:${opt}`, id, 0, 'Strengthens this capability');
    }
  }

  return count;
}

/**
 * Combos are the unit every unlock analysis is built on, and they are a
 * judgement about what capabilities compose — not something to infer from a
 * config file. They are read from an optional `combos` block, so a fabricated
 * cluster never ends up presented as a finding:
 *
 *   "combos": { "e2e-on-edge": { "name": "E2E on Edge", "domain": "quality",
 *                                "requires": ["mcp:playwright", "skill:vitest"],
 *                                "optional": ["mcp:cloudflare"] } }
 *
 * Accepted in opencode.json or in CONFIG_MAPPING. Without one, the combo
 * analyses stay empty — which is honest, not broken.
 */
function seedCombos(db: Db, config: any, mapping: any, insert: any): number {
  const combos = { ...(mapping.combos || {}), ...(config.combos || {}) };
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );
  let count = 0;

  for (const [key, spec] of Object.entries<any>(combos)) {
    const id = key.startsWith('combo:') ? key : `combo:${key}`;
    const requires: string[] = (spec?.requires || []).filter(has);
    const optional: string[] = (spec?.optional || []).filter(has);
    // A combo whose prerequisites are all missing describes nothing.
    if (requires.length === 0 && optional.length === 0) continue;

    insert.run(
      id,
      spec?.name || key,
      spec?.domain || 'meta',
      spec?.description || 'Composed capability',
      'combo',
      'locked',
      0
    );
    count++;
    for (const dep of requires) { link.run(dep, id, 1, 'Hard prerequisite'); }
    for (const dep of optional) { link.run(dep, id, 0, 'Soft prerequisite'); }
  }

  return count;
}

// ─── Prune Recommendations ────────────────────────────────────────────────────

function pruneRecommendations(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, parallel_slots, updated_at, state FROM capabilities WHERE state IN ('unlocked','active') ORDER BY maturity_score ASC").all();
  const results = [];
  for (const cap of caps) {
    if (cap.updated_at) {
      const daysSince = (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) continue;
    } else continue;
    const slotCost = cap.parallel_slots || 1;
    const deps = db.prepare("SELECT from_capability FROM dependencies WHERE to_capability = ?").all(cap.id);
    const dependents = db.prepare("SELECT to_capability FROM dependencies WHERE from_capability = ?").all(cap.id);
    const daysSince = Math.round((Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24));
    results.push({ id: cap.id, name: cap.name, domain: cap.domain, days_since_config_change: daysSince, token_cost: slotCost, dependent_count: dependents.length, prereq_count: deps.length, recommendation: `${daysSince} days since last config change. ${dependents.length} capabilities depend on it. ${deps.length} prerequisites still active.` });
  }
  return results.sort((a, b) => b.days_since_config_change - a.days_since_config_change).slice(0, 15);
}

// ─── Fork Comparison (best combo to unlock) ──────────────────────────────────

function forkComparison(db) {
  const locked = db.prepare("SELECT id, name, domain, unlock_cost_setup, unlock_cost_tokens FROM capabilities WHERE state = 'locked'").all();
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const comboGroups = new Map();
  for (const d of deps) {
    if (!comboGroups.has(d.to_capability)) comboGroups.set(d.to_capability, []);
    comboGroups.get(d.to_capability).push(d);
  }
  const results = [];
  for (const [id, prereqs] of comboGroups) {
    const combo = capMap.get(id); if (!combo) continue;
    const hardMet = prereqs.filter(p => p.is_hard_requisite).every(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); });
    if (!hardMet) continue;
    const avgMaturity = prereqs.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / prereqs.length;
    const regret = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE capability_id = ? AND action = 'regretted'").get(id) || {}).cnt || 0;
    const cascade = db.prepare("SELECT COUNT(*) as cnt FROM dependencies WHERE from_capability = ?").get(id).cnt || 0;
    const efficiency = Math.round((cascade + (1 - regret * 0.2)) * 100 / (combo.unlock_cost_setup || 1));
    results.push({ name: combo.name, id, avg_maturity: Math.round(avgMaturity * 100), regret_count: regret, cascade_unlocks: cascade, efficiency, recommendation: regret > 0 ? `Previously regretted (${regret}x). ${cascade} cascade unlocks if committed.` : `${cascade} cascade unlocks with ${Math.round(avgMaturity * 100)}% avg prerequisite maturity.` });
  }
  return results.sort((a, b) => b.efficiency - a.efficiency);
}

// ─── Near-Miss Combos (1-2 prerequisites away) ───────────────────────────────

function nearMissCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  const results = [];
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    const metHard = hard.filter(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); });
    const missingHard = hard.filter(p => { const c = capMap.get(p.from_capability); return !c || (c.state !== 'unlocked' && c.state !== 'active'); });
    if (missingHard.length === 0) continue;
    if (missingHard.length > 2) continue;
    const avgMetMaturity = metHard.length > 0 ? metHard.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / metHard.length : 0;
    if (avgMetMaturity < 0.6) continue;
    results.push({
      name: combo.name,
      id: comboId,
      missing: missingHard.length,
      missing_names: missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability),
      met_count: metHard.length,
      total_required: hard.length,
      met_maturity: Math.round(avgMetMaturity * 100),
      investment: `Add ${missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`,
    });
  }
  return results.sort((a, b) => b.met_maturity - a.met_maturity);
}

// ─── Insights (top actionable items) ──────────────────────────────────────────

function insights(db) {
  const items = [];
  const nearMiss = nearMissCombos(db);
  if (nearMiss.length > 0) {
    items.push({ type: 'near_miss', count: nearMiss.length, detail: `${nearMiss[0].name} — ${nearMiss[0].missing} dependencies away (${nearMiss[0].met_maturity}% existing maturity). ${nearMiss[0].investment}`, near: nearMiss.slice(0, 3) });
  }
  const decay = computeDecay(db).filter(d => d.decayed).slice(0, 3);
  if (decay.length > 0) {
    items.push({ type: 'decay', count: decay.length, detail: `${decay[0].name} — ${decay[0].days_since_config_change} days since last change`, decaying: decay });
  }
  const bottlenecks = findBottlenecks(db).slice(0, 3);
  if (bottlenecks.length > 0) {
    items.push({ type: 'bottleneck', count: bottlenecks.length, detail: `${bottlenecks[0].name} unlocks ${bottlenecks[0].unlocks_count} downstream`, top: bottlenecks });
  }
  return items;
}

function computeDecay(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, updated_at FROM capabilities WHERE state IN ('unlocked','active')").all();
  const results = [];
  for (const cap of caps) {
    if (!cap.updated_at) continue;
    const daysSince = (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
    const decayAmount = Math.min(0.3, daysSince * 0.01);
    const newMaturity = Math.max(0.1, cap.maturity_score - decayAmount);
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, decayed: newMaturity < cap.maturity_score - 0.05, days_since_config_change: Math.round(daysSince), new_maturity: Math.round(newMaturity * 100) / 100 });
  }
  results.sort((a, b) => b.days_since_config_change - a.days_since_config_change);
  return results;
}

// ─── Combo Discovery ──────────────────────────────────────────────────────────

function discoverCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const results = [];
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    if (!hard.every(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); })) continue;
    const avg = prereqs.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / prereqs.length;
    if (avg < 0.4) continue;
    results.push({ name: combo.name, requirements: prereqs.map(p => capMap.get(p.from_capability)?.name || p.from_capability), unlocks: comboId, confidence: Math.min(1, avg + 0.2), reason: `All prereqs at ${Math.round(avg * 100)}% avg maturity` });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Graph Profile (evolution over time) ──────────────────────────────────────

function graphProfile(db) {
  const now = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get();
  const connections = db.prepare("SELECT COUNT(*) as cnt FROM dependencies").get().cnt || 0;
  const combos = db.prepare("SELECT COUNT(*) as cnt FROM capabilities WHERE category = 'combo' AND state IN ('unlocked','active')").get().cnt || 0;
  const density = now.total > 0 ? Math.round((connections / now.total) * 100) / 100 : 0;
  const built = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE action = 'built'").get() || {}).cnt || 0;
  const removed = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE action = 'removed'").get() || {}).cnt || 0;
  const totalEvents = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning").get() || {}).cnt || 0;

  const domainDensity = db.prepare(`
    SELECT c.domain, COUNT(*) as caps, 
    (SELECT COUNT(*) FROM dependencies d JOIN capabilities c2 ON c2.id = d.from_capability WHERE c2.domain = c.domain) as conns
    FROM capabilities c WHERE c.state IN ('unlocked','active') GROUP BY c.domain
  `).all();

  return {
    capabilities: { current: now.unlocked, total: now.total },
    connections: connections,
    combos: combos,
    density: density,
    build_history: { total_built: built, total_removed: removed, net: built - removed, total_events: totalEvents },
    domains: domainDensity.map(d => ({ domain: d.domain, caps: d.caps, connections: d.conns, density: d.caps > 0 ? Math.round((d.conns / d.caps) * 100) / 100 : 0 })),
  };
}

// ─── Session Diff ─────────────────────────────────────────────────────────────

function sessionDiff(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, state FROM capabilities WHERE state IN ('unlocked','active')").all();
  const recent = db.prepare("SELECT capability_id, action, outcome_score FROM session_learning ORDER BY timestamp DESC LIMIT 50").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const domains = new Map();
  for (const c of caps) {
    if (!domains.has(c.domain)) domains.set(c.domain, { total: 0, unlocked: 0, changed_caps: [] });
    const d = domains.get(c.domain); d.total++; if (c.state === 'unlocked' || c.state === 'active') d.unlocked++;
  }
  const seen = new Set();
  for (const e of recent) {
    if (seen.has(e.capability_id)) continue; seen.add(e.capability_id);
    const cap = capMap.get(e.capability_id); if (!cap) continue;
    const domain = domains.get(cap.domain); if (!domain) continue;
    domain.changed_caps.push({ name: cap.name, change: e.outcome_score && e.outcome_score > 0.7 ? 'improved' : e.action === 'regretted' ? 'regretted' : 'practiced', detail: `${Math.round(cap.maturity_score * 100)}% maturity` });
  }
  return Array.from(domains.entries()).map(([d, v]) => ({ domain: d, ...v }));
}

// ─── Domain Health ────────────────────────────────────────────────────────────

function domainHealth(db) {
  const caps = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as active, AVG(maturity_score) as avg_maturity FROM capabilities GROUP BY domain").all();
  const results = [];
  for (const cap of caps) {
    const regret = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'regretted' GROUP BY c.domain").get(cap.domain) || {}).cnt || 0;
    const decayRisk = cap.active > 0 ? (db.prepare("SELECT AVG(CASE WHEN sl.timestamp < datetime('now', '-30 days') OR sl.timestamp IS NULL THEN 1 ELSE 0 END) as risk FROM capabilities c LEFT JOIN session_learning sl ON sl.capability_id = c.id AND sl.action = 'used' WHERE c.domain = ? AND c.state IN ('unlocked','active')").get(cap.domain) || {}).risk || 0 : 0;
    const health = Math.max(0, Math.min(1, (cap.avg_maturity || 0) * 0.4 + (cap.active / Math.max(cap.total, 1)) * 0.3 + (1 - Math.min(regret / Math.max(cap.active, 1), 1)) * 0.2 + (1 - (decayRisk || 0)) * 0.1));
    results.push({ domain: cap.domain, health: Math.round(health * 100) / 100, total: cap.total, active: cap.active, avg_maturity: Math.round((cap.avg_maturity || 0) * 100) / 100, decay_risk: Math.round((decayRisk || 0) * 100) / 100, regret_count: regret });
  }
  results.sort((a, b) => b.health - a.health);
  return results;
}

// ─── Bottlenecks ──────────────────────────────────────────────────────────────

function findBottlenecks(db) {
  const caps = db.prepare("SELECT id, name, domain FROM capabilities WHERE state IN ('unlocked','active')").all();
  const deps = db.prepare("SELECT from_capability, to_capability FROM dependencies").all();
  const downstream = new Map();
  const comboIds = new Set(deps.filter(d => d.to_capability.startsWith('combo:')).map(d => d.to_capability));
  for (const d of deps) {
    if (!downstream.has(d.from_capability)) downstream.set(d.from_capability, new Set());
    downstream.get(d.from_capability).add(d.to_capability);
  }
  const results = [];
  for (const cap of caps) {
    const ds = downstream.get(cap.id);
    if (!ds || ds.size === 0) continue;
    let comboUnlocks = 0; ds.forEach(to => { if (comboIds.has(to)) comboUnlocks++; });
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, unlocks_count: ds.size, is_bottleneck: comboUnlocks >= 2 });
  }
  results.sort((a, b) => b.unlocks_count - a.unlocks_count);
  return results;
}

// ─── Impact Analysis ─────────────────────────────────────────────────────────

function analyzeImpact(db, capId) {
  const cap = db.prepare("SELECT id, name, maturity_score FROM capabilities WHERE id = ?").get(capId);
  if (!cap) return { capability: capId, decayed: [], combos_at_risk: [] };
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies").all();
  const allCaps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(allCaps.map(c => [c.id, c]));
  const simMaturity = Math.max(0.1, cap.maturity_score - 0.3);
  const decayed = deps.filter(d => d.from_capability === capId).map(d => {
    const t = capMap.get(d.to_capability);
    return { name: t?.name || d.to_capability, becomes_unavailable: d.is_hard_requisite && simMaturity < 0.3 };
  });
  const combos_at_risk = [];
  for (const d of deps.filter(d => d.to_capability.startsWith('combo:'))) {
    const prereqs = deps.filter(p => p.to_capability === d.to_capability);
    if (!prereqs.some(p => p.from_capability === capId)) continue;
    const combo = capMap.get(d.to_capability);
    const wouldBreak = prereqs.filter(p => p.is_hard_requisite).some(p => capMap.get(p.from_capability) && p.from_capability === capId && simMaturity < 0.3);
    combos_at_risk.push({ name: combo?.name || d.to_capability, severity: wouldBreak ? 'critical' : 'warning' });
  }
  return { capability: cap.name, decayed, combos_at_risk };
}

// ─── Budget Optimization ─────────────────────────────────────────────────────

function optimizeBudget(db, setupBudget, tokenBudget) {
  const caps = db.prepare("SELECT id, name, unlock_cost_setup, unlock_cost_tokens FROM capabilities WHERE state = 'locked'").all();
  const deps = db.prepare("SELECT from_capability, to_capability FROM dependencies").all();
  const downstream = new Map();
  for (const d of deps) downstream.set(d.from_capability, (downstream.get(d.from_capability) || 0) + 1);
  const candidates = caps.map(c => ({ ...c, unlocks: downstream.get(c.id) || 0, efficiency: ((downstream.get(c.id) || 1) / (c.unlock_cost_setup + c.unlock_cost_tokens * 0.01 + 1)) }));
  candidates.sort((a, b) => b.efficiency - a.efficiency);
  let sRem = setupBudget, tRem = tokenBudget;
  const selections = [];
  for (const c of candidates) {
    if (c.unlock_cost_setup <= sRem && c.unlock_cost_tokens <= tRem) {
      selections.push({ name: c.name, cost_setup: c.unlock_cost_setup, cost_tokens: c.unlock_cost_tokens, unlocks: c.unlocks });
      sRem -= c.unlock_cost_setup; tRem -= c.unlock_cost_tokens;
    }
  }
  return { selections, total_setup: setupBudget - sRem, total_tokens: tokenBudget - tRem, total_unlocks: selections.reduce((s, c) => s + c.unlocks, 0) };
}

// ─── Trend Projection ────────────────────────────────────────────────────────

function projectTrends(db, days) {
  days = days || 30;
  const health = domainHealth(db);
  const rate = 0.02 * days;
  return health.map(h => {
    const riskCaps = db.prepare("SELECT c.name, c.maturity_score FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'used' AND sl.timestamp < datetime('now', ?) GROUP BY c.id HAVING MAX(sl.timestamp) < datetime('now', ?) ORDER BY c.maturity_score ASC LIMIT 5").all(h.domain, `-${days} days`, `-${days} days`);
    const riskList = riskCaps.map(r => ({ name: r.name, current: Math.round(r.maturity_score * 100) / 100, projected: Math.round(Math.max(0.1, r.maturity_score - rate) * 100) / 100 }));
    const projectedDecay = Math.min(1, (h.decay_risk || 0) + riskCaps.length * 0.1);
    const projectedHealth = Math.max(0, h.health - (projectedDecay - (h.decay_risk || 0)) * 0.3);
    return { domain: h.domain, current_health: h.health, projected_health: Math.round(projectedHealth * 100) / 100, delta: Math.round((projectedHealth - h.health) * 100) / 100, risk_caps: riskList };
  });
}


// ─── Execution Layer ──────────────────────────────────────────────────────────

function applyRemoval(db, capId) {
  const configPath = process.env.OPENCODE_CONFIG || (process.env.HOME + "/.config/opencode/opencode.json");
  if (!existsSync(configPath)) return { error: "Config not found" };
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const prefix = capId.split(":")[0];
  const key = capId.replace(/^[^:]+:/, "");
  const sectionMap = { mcp: "mcp", agent: "agent", cmd: "command", provider: "provider" };
  const section = sectionMap[prefix];
  if (!section) return { error: "Unknown prefix: " + prefix };
  if (!config[section] || !config[section][key]) return { error: "Not found: " + capId };
  writeFileSync(configPath + ".bak", JSON.stringify(config, null, 2));
  delete config[section][key];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const db2 = getDb();
  try { db2.prepare("INSERT INTO session_learning (session_id, capability_id, action, notes) VALUES ('exec', ?, 'removed', 'Applied removal')").run(capId); } catch {}
  db2.close();
  seedFromConfig(db);
  return { removed: capId, section, key, backup: configPath + ".bak" };
}

function exportGraph(db) {
  const caps = db.prepare("SELECT * FROM capabilities").all();
  const deps = db.prepare("SELECT * FROM dependencies").all();
  const items = caps.map(function(c) {
    var type = c.category;
    if (type === 'mcp') type = 'mcp-server';
    if (type === 'combo') type = 'possibility';
    var status = c.state;
    if (status === 'active' || status === 'unlocked') status = 'built';
    return { id: c.id, name: c.name, type: type, status: status, description: c.description, position: { x: 0, y: 0, z: 0 }, meta: { domain: c.domain, maturity: c.maturity_score } };
  });
  var conns = deps.map(function(d) {
    var t = d.is_hard_requisite ? 'hard-dep' : 'soft-dep';
    return { from: d.from_capability, to: d.to_capability, type: t };
  });
  return { items: items, connections: conns };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const db = getDb();
  migrate(db);
  const cmd = process.argv[2];
  const arg = process.argv[3];
  const mappingOverride = process.env.CONFIG_MAPPING;
  if (!cmd || cmd === "help") {
    console.log(`tech-tree - Toolchain capability graph\n`);
    console.log("  seed              Seed from opencode config (default)");
    console.log("                    Set CONFIG_MAPPING env var for other configs");
    console.log("                    Example: CONFIG_MAPPING='{\"config_keys\":{\"tools\":{\"type\":\"tool\",\"domain\":\"devops\"}}}' node engine.ts seed");
    console.log("  stats             Maturity overview");
    console.log("  context           Session context block");
    console.log("  health            Domain health scores");
    console.log("  decay             Decaying capabilities");
    console.log("  combos            Auto-discovered combos");
    console.log("  diff              Session diff");
    console.log("  bottlenecks        High-leverage capabilities");
    console.log("  impact <id>       Impact analysis for a capability");
    console.log("  budget <s> <t>    Budget optimization");
    console.log("  trend <days>      Trend projection");
    db.close();
    return;
  }
  switch (cmd) {
    case "ledger":
      emit(ledgerHistory(db));
      break;
    case "since":
      emit(ledgerSince(db, arg));
      break;
    case "explain": {
      // Same definitions the visualizer shows, read from the shared file so
      // the two surfaces cannot drift.
      const { concepts } = JSON.parse(readFileSync(join(__dirname, "..", "shared", "concepts.json"), "utf8"));
      const wanted = (process.argv[3] || "").toLowerCase();
      const picked = wanted
        ? concepts.filter((c: any) => c.key.includes(wanted) || c.term.toLowerCase().includes(wanted))
        : concepts;
      if (picked.length === 0) {
        console.log(`${C.yellow}No concept matching "${wanted}".${C.reset}`);
        console.log(`Try: ${concepts.map((c: any) => c.key).join(", ")}`);
        break;
      }
      // Wrap to a readable measure rather than emitting one long line.
      const wrap = (text: string, width = 76, indent = "  ") => {
        const out: string[] = [];
        let line = "";
        for (const word of text.split(" ")) {
          if ((line + word).length > width) { out.push(indent + line.trim()); line = ""; }
          line += word + " ";
        }
        if (line.trim()) out.push(indent + line.trim());
        return out.join("\n");
      };
      console.log("");
      for (const c of picked) {
        console.log(`${C.bold}${c.term}${C.reset} ${C.grey}— ${c.short}${C.reset}`);
        console.log(wrap(c.long));
        console.log(`  ${C.grey}Where you see it: ${c.seen}${C.reset}`);
        console.log("");
      }
      if (!wanted) console.log(`${C.grey}tt explain <term> for one of these on its own.${C.reset}\n`);
      break;
    }
    case "seed":
      seedFromConfig(db, undefined, mappingOverride);
      const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities").get();
      console.log(`${C.green}✓${C.reset} ${c.cnt} capabilities`);
      break;
    case "stats": case "context": {
      const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get();
      console.log(`Toolchain: ${g.unlocked}/${g.total}`);
      const domains = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities GROUP BY domain ORDER BY domain").all();
      for (const d of domains) console.log(`  ${d.domain.padEnd(12)} ${d.unlocked}/${d.total}`);
      break;
    }
    case "health": emit(domainHealth(db)); break;
    case "decay": emit(computeDecay(db)); break;
    case "combos": emit(discoverCombos(db)); break;
    case "diff": emit(sessionDiff(db)); break;
    case "bottlenecks": emit(findBottlenecks(db)); break;
    case "impact": emit(analyzeImpact(db, arg)); break;
    case "budget": emit(optimizeBudget(db, parseInt(arg) || 120, parseInt(process.argv[4]) || 8000)); break;
    case "trend": emit(projectTrends(db, parseInt(arg) || 30)); break;
    case "prune": emit(pruneRecommendations(db)); break;
    case "fork": emit(forkComparison(db)); break;
    case "profile": emit(graphProfile(db)); break;
    case "export": console.log(JSON.stringify(exportGraph(db))); break;

    case "near": emit(nearMissCombos(db)); break;
    case "insight": emit(insights(db)); break;
    default: console.log(`${C.red}Unknown: ${cmd}${C.reset}`);
  }
  db.close();
}

if (import.meta.main) main();
export { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations, forkComparison, graphProfile, nearMissCombos, insights, applyRemoval };
