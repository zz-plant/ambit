#!/usr/bin/env node --experimental-sqlite
import { readFileSync } from "node:fs";
import { resolveDbPath } from "../shared/db-path.ts";
import { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations, forkComparison, graphProfile, nearMissCombos, insights, runVerification, evidenceFor, authorityReport, planFor, ledgerSince, ledgerHistory, recordFailure, deficits, singlePointsOfFailure, simulateFrontier, propose, listProposals, showProposal } from "../engine/engine.ts";

const DB_PATH = resolveDbPath();
const VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/**
 * An unseeded graph answers every question with zeroes, which an agent reads
 * as "this environment has no capabilities" rather than "this tool was never
 * set up" — the exact confusion Ambit exists to remove. Say which it is.
 */
function emptyGraphNotice(db) {
  const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get();
  if (seeded?.n) return null;
  return {
    graph: "not seeded",
    meaning: "This is not an environment without capabilities — Ambit has not been run here yet. Do not report the user's stack as empty.",
    fix: "Run `tt seed` in a shell, or ./bootstrap.sh from a checkout, then ask again.",
    database: DB_PATH,
  };
}

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
  { name: "tt_verify", description: "Run a capability's declared check and record the outcome. Proves the action works rather than that it is configured. Omit capId to run every declared check.", inputSchema: { type: "object", properties: { capId: { type: "string", description: "Capability to verify, e.g. local-runtime" } } } },
  { name: "tt_evidence", description: "Verification history for one capability — what was tried, when, and whether it passed", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_authority", description: "Which reached capabilities may run unattended and which require approval. Being able to perform an action is not permission to.", inputSchema: { type: "object", properties: {} } },
  { name: "tt_plan", description: "What is missing for a capability, in the order it must be closed, including which steps require a person", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_since", description: "What entered the reachable frontier since a past observation, separating what was acquired from what emerged through composition", inputSchema: { type: "object", properties: { when: { type: "string", description: "ISO timestamp; defaults to the earliest observation" } } } },
  { name: "tt_blocked", description: "Record that a task was blocked by a missing capability. The pattern matters more than the instance: the same deficit hit repeatedly is infrastructure that should exist.", inputSchema: { type: "object", properties: { capId: { type: "string" }, note: { type: "string", description: "What you were trying to do" } }, required: ["capId"] } },
  { name: "tt_simulate", description: "The frontier as it would be if a capability were acquired, including what it unblocks. Pure preview — changes nothing.", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_propose", description: "Draft a reviewable acquisition: ordered steps, the alternative chosen and its trade-offs, and the simulated result. Nothing executes; proposals have no inverse and so cannot be applied.", inputSchema: { type: "object", properties: { capId: { type: "string" }, option: { type: "number", description: "Which alternative to choose, 0-based" } }, required: ["capId"] } },
  { name: "tt_proposals", description: "Every proposal drafted so far, newest first", inputSchema: { type: "object", properties: {} } },
  { name: "tt_proposal", description: "One proposal in full, with its steps and simulated frontier", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "tt_spof", description: "Capabilities with exactly one provider — where redundancy is absent. Distinct from tt_bottlenecks, which ranks leverage rather than fragility.", inputSchema: { type: "object", properties: {} } },
  { name: "tt_deficits", description: "Recurring capability deficits, worst first — which missing capabilities keep stopping different work", inputSchema: { type: "object", properties: {} } },
  { name: "tt_ledger", description: "Every recorded frontier observation — how the system's capacity for action has changed over time", inputSchema: { type: "object", properties: {} } },
];

let buf = "";
// Each line is handled in its own function because the body returns to reply.
// Inlined in the loop, that `return` exited the whole stdin handler, so only
// the first message in a chunk was ever answered — and a client that batches
// initialize with tools/list, or whose requests simply arrive coalesced, would
// hang waiting for a response that was never going to come.
function handleLine(line) {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const { id, method, params } = msg;
      switch (method) {
        // The server used to introduce itself as "tech-tree" at version 1.0.0,
        // which is neither the name of the product nor its version — an agent
        // that connected had no way to tell what it was talking to.
        case "initialize": return respond(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ambit", version: VERSION } });
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
              case "tt_verify": res = tt(db => runVerification(db, args?.capId)); break;
              case "tt_evidence": res = tt(db => evidenceFor(db, String(args.capId).startsWith("combo:") ? args.capId : `combo:${args.capId}`)); break;
              case "tt_authority": res = tt(db => authorityReport(db)); break;
              case "tt_plan": res = tt(db => planFor(db, args.capId)); break;
              case "tt_since": res = tt(db => ledgerSince(db, args?.when)); break;
              case "tt_ledger": res = tt(db => ledgerHistory(db)); break;
              case "tt_blocked": res = tt(db => recordFailure(db, args.capId, args.note)); break;
              case "tt_deficits": res = tt(db => deficits(db)); break;
              case "tt_spof": res = tt(db => singlePointsOfFailure(db)); break;
              case "tt_simulate": res = tt(db => simulateFrontier(db, [args.capId])); break;
              case "tt_propose": res = tt(db => propose(db, args.capId, args.option)); break;
              case "tt_proposals": res = tt(db => listProposals(db)); break;
              case "tt_proposal": res = tt(db => showProposal(db, args.id)); break;
              case "tt_fork": res = tt(db => forkComparison(db)); break;
              case "tt_profile": res = tt(db => graphProfile(db)); break;
              case "tt_near": res = tt(db => nearMissCombos(db)); break;
              case "tt_insight": res = tt(db => insights(db)); break;
              default: return err(id, -32601, `Unknown: ${name}`);
            }
            const notice = tt(db => emptyGraphNotice(db));
            if (notice) res = { ...notice, result: res };
            return respond(id, { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] });
          } catch (e) { return err(id, -32000, e.message); }
        }
        default: if (method !== "notifications/initialized") err(id, -32601, `Unknown: ${method}`);
      }
    } catch {}
}

process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n"); buf = lines.pop() || "";
  for (const line of lines) handleLine(line);
});
process.stdin.on("end", () => process.exit(0));
