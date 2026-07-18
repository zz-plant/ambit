#!/usr/bin/env node --experimental-sqlite
import { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations, forkComparison, graphProfile, nearMissCombos, insights } from "../engine/engine.ts";

const DB_PATH = process.env.TOOLCHAIN_DB || process.env.HOME + "/.config/opencode/toolchain-viz.db";

function respond(id, r) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: r }) + "\n"); }
function err(id, c, m) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: c, message: m } }) + "\n"); }

function tt(cb) { const db = getDb(DB_PATH); migrate(db); const r = cb(db); db.close(); return r; }

const TOOLS = [
  { name: "tt_stats", description: "Toolchain maturity overview", inputSchema: { type: "object", properties: {} } },
  { name: "tt_context", description: "Session context block", inputSchema: { type: "object", properties: {} } },
  { name: "tt_recs", description: "Unlock recommendations", inputSchema: { type: "object", properties: {} } },
  { name: "tt_cap", description: "Capabilities by domain or name", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "tt_decay", description: "Decaying capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "tt_combos", description: "Auto-discovered combos", inputSchema: { type: "object", properties: {} } },
  { name: "tt_diff", description: "Session diff", inputSchema: { type: "object", properties: {} } },
  { name: "tt_health", description: "Domain health scores", inputSchema: { type: "object", properties: {} } },
  { name: "tt_bottlenecks", description: "High-leverage capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "tt_impact", description: "Impact analysis for a capability", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_budget", description: "Budget-optimized unlocks", inputSchema: { type: "object", properties: { setup: { type: "number" }, tokens: { type: "number" } } } },
  { name: "tt_trend", description: "Trend projection", inputSchema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tt_prune", description: "Find unused capabilities costing tokens — prune recommendations", inputSchema: { type: "object", properties: {} } },
  { name: "tt_fork", description: "Compare best combo to unlock — efficiency, regret, cascade", inputSchema: { type: "object", properties: {} } },
  { name: "tt_profile", description: "Graph evolution — density, build history, removals, maturation over time", inputSchema: { type: "object", properties: {} } },
  { name: "tt_near", description: "Near-miss combos — 1-2 prerequisites away with high existing maturity", inputSchema: { type: "object", properties: {} } },
  { name: "tt_insight", description: "Top actionable items — what to build, maintain, or prune right now", inputSchema: { type: "object", properties: {} } },
];

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n"); buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const { id, method, params } = msg;
      switch (method) {
        case "initialize": return respond(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "tech-tree", version: "1.0.0" } });
        case "tools/list": return respond(id, { tools: TOOLS });
        case "tools/call": {
          const { name, arguments: args } = params;
          try {
            let res;
            switch (name) {
              case "tt_stats": res = tt(db => ({ stats: db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get(), domains: db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities GROUP BY domain ORDER BY domain").all() })); break;
              case "tt_context": res = { text: tt(db => { const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get(); const d = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities GROUP BY domain ORDER BY domain").all(); return `Toolchain: ${g.unlocked}/${g.total}\n${d.map(s => `  ${s.domain.padEnd(12)} ${s.unlocked}/${s.total}`).join("\n")}`; }) }; break;
              case "tt_recs": res = tt(db => { const caps = db.prepare("SELECT id, name, domain, unlock_cost_setup, unlock_cost_tokens, state FROM capabilities WHERE state = 'locked'").all(); const deps = db.prepare("SELECT from_capability, to_capability FROM dependencies").all(); const ds = {}; for (const d of deps) ds[d.from_capability] = (ds[d.from_capability] || 0) + 1; return caps.filter(c => ds[c.id]).map(c => ({ ...c, unlocks: ds[c.id] })).sort((a, b) => (b.unlocks || 0) - (a.unlocks || 0)).slice(0, 10); }); break;
              case "tt_cap": res = tt(db => db.prepare("SELECT id, name, domain, maturity_score, state, category FROM capabilities WHERE domain = ? OR name LIKE ? ORDER BY maturity_score DESC LIMIT 20").all(args.query, `%${args.query}%`)); break;
              case "tt_decay": res = tt(db => computeDecay(db).slice(0, 10)); break;
              case "tt_combos": res = tt(db => discoverCombos(db)); break;
              case "tt_diff": res = tt(db => sessionDiff(db)); break;
              case "tt_health": res = tt(db => domainHealth(db)); break;
              case "tt_bottlenecks": res = tt(db => findBottlenecks(db).slice(0, 10)); break;
              case "tt_impact": res = tt(db => analyzeImpact(db, args.capId)); break;
              case "tt_budget": res = tt(db => optimizeBudget(db, args.setup || 120, args.tokens || 8000)); break;
              case "tt_trend": res = tt(db => projectTrends(db, args.days || 30)); break;
              case "tt_prune": res = tt(db => pruneRecommendations(db)); break;
              case "tt_fork": res = tt(db => forkComparison(db)); break;
              case "tt_profile": res = tt(db => graphProfile(db)); break;
              case "tt_near": res = tt(db => nearMissCombos(db)); break;
              case "tt_insight": res = tt(db => insights(db)); break;
              default: return err(id, -32601, `Unknown: ${name}`);
            }
            return respond(id, { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] });
          } catch (e) { return err(id, -32000, e.message); }
        }
        default: if (method !== "notifications/initialized") err(id, -32601, `Unknown: ${method}`);
      }
    } catch {}
  }
});
process.stdin.on("end", () => process.exit(0));
