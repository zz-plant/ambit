#!/usr/bin/env node --experimental-sqlite
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH_DEFAULT = join(__dirname, "..", "..", "toolchain-viz.db");
const CONFIG_DEFAULT = join(process.env.HOME || "/", ".config", "opencode", "opencode.json");

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
  const insert = db.prepare("INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, state, maturity_score) VALUES (?, ?, ?, ?, ?, ?, ?)");

  for (const [key, cfg] of Object.entries<any>(mapping.config_keys || {})) {
    const entries = config[key] || {};
    for (const [name, val] of Object.entries<any>(entries)) {
      const type = cfg.type || 'tool';
      const domain = cfg.domain || (cfg.domain_map && cfg.domain_map[val[cfg.domain_field || 'type']]) || 'infra';
      const desc = (cfg.desc_field ? (val[cfg.desc_field] || '') : cfg.desc_template ? cfg.desc_template.replace('{type}', val.type || type) : '') || '';
      insert.run(`${type}:${name}`, name, domain, desc.slice(0, 80), type, 'unlocked', 0.5);
      count++;
    }
  }

  for (const dirPattern of (mapping.skill_dirs || [])) {
    const dir = dirPattern.replace(/^~/, process.env.HOME || "/");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(dir, entry.name, "SKILL.md"))) continue;
      insert.run(`skill:${entry.name}`, entry.name, 'meta', 'Agent skill', 'skill', 'unlocked', 0.55);
      count++;
    }
  }

  insert.run("core:reasoning", "Core Reasoning", "meta", "Base LLM reasoning", "meta", "active", 1.0);
  insert.run("tool:bash", "Shell Execution", "infra", "Run commands", "tool", "active", 1.0);
  insert.run("tool:edit", "File Editor", "meta", "Edit files", "tool", "active", 1.0);
  insert.run("tool:lsp", "LSP Diagnostics", "quality", "Language server", "tool", "active", 0.95);
  count += 4;

  db.prepare("UPDATE capabilities SET state = 'active' WHERE id IN ('core:reasoning','tool:bash','tool:edit','tool:lsp')").run();

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
    case "health": console.log(JSON.stringify(domainHealth(db), null, 2)); break;
    case "decay": console.log(JSON.stringify(computeDecay(db), null, 2)); break;
    case "combos": console.log(JSON.stringify(discoverCombos(db), null, 2)); break;
    case "diff": console.log(JSON.stringify(sessionDiff(db), null, 2)); break;
    case "bottlenecks": console.log(JSON.stringify(findBottlenecks(db), null, 2)); break;
    case "impact": console.log(JSON.stringify(analyzeImpact(db, arg), null, 2)); break;
    case "budget": console.log(JSON.stringify(optimizeBudget(db, parseInt(arg) || 120, parseInt(process.argv[4]) || 8000), null, 2)); break;
    case "trend": console.log(JSON.stringify(projectTrends(db, parseInt(arg) || 30), null, 2)); break;
    case "prune": console.log(JSON.stringify(pruneRecommendations(db), null, 2)); break;
    case "fork": console.log(JSON.stringify(forkComparison(db), null, 2)); break;
    case "profile": console.log(JSON.stringify(graphProfile(db), null, 2)); break;
    case "export": console.log(JSON.stringify(exportGraph(db))); break;

    case "near": console.log(JSON.stringify(nearMissCombos(db), null, 2)); break;
    case "insight": console.log(JSON.stringify(insights(db), null, 2)); break;
    default: console.log(`${C.red}Unknown: ${cmd}${C.reset}`);
  }
  db.close();
}

if (import.meta.main) main();
export { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations, forkComparison, graphProfile, nearMissCombos, insights, applyRemoval };
