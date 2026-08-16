#!/usr/bin/env node --experimental-sqlite
import { readFileSync } from "node:fs";
import { resolveDbPath } from "../shared/db-path.ts";
import { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, nearMissCombos, runVerification, evidenceFor, authorityReport, actionsReport, planFor, ledgerSince, ledgerHistory, recordFailure, deficits, singlePointsOfFailure, simulateFrontier, propose, listProposals, showProposal, goalFor, pathsFor, preferencesReport, scopeReport, affordanceDomains, humanDigest, beginRun, endRun, addEvent, recordUse, recordIntervention, recordResource, recordOutcome, workReport, usageReport, economicsReport, goalValue, opportunitiesFor, opportunityFor, canExecute } from "../engine/engine.ts";

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
  { name: "tt_cap", description: "Capabilities by domain or name", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "tt_decay", description: "Decaying capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "tt_combos", description: "Auto-discovered combos", inputSchema: { type: "object", properties: {} } },
  { name: "tt_diff", description: "Session diff", inputSchema: { type: "object", properties: {} } },
  { name: "tt_health", description: "Domain health scores", inputSchema: { type: "object", properties: {} } },
  { name: "tt_bottlenecks", description: "High-leverage capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "tt_impact", description: "Impact analysis for a capability", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_near", description: "Near-miss combos — 1-2 prerequisites away with high existing maturity", inputSchema: { type: "object", properties: {} } },
  { name: "tt_verify", description: "Run a capability's declared check and record the outcome. Proves the action works rather than that it is configured. Omit capId to run every declared check.", inputSchema: { type: "object", properties: { capId: { type: "string", description: "Capability to verify, e.g. local-runtime" } } } },
  { name: "tt_evidence", description: "Verification history for one capability — what was tried, when, and whether it passed", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_authority", description: "Which reached capabilities may run unattended and which require approval. Being able to perform an action is not permission to.", inputSchema: { type: "object", properties: {} } },
  { name: "tt_actions", description: "The concrete actions a capability confers and whether each may be performed — read a repository yes, merge to its default branch no. Ask this before acting, not tt_authority, which answers at the coarser grain.", inputSchema: { type: "object", properties: { capId: { type: "string", description: "Capability to list actions for; omit for all" } } } },
  { name: "tt_plan", description: "What is missing for a capability, in the order it must be closed, including which steps require a person", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_goal", description: "Route a free-form goal (a sentence, not an id) to the capabilities that plausibly cover it, ranked, each with its plan delta. Use this when the user wants something and neither of you knows the capability id.", inputSchema: { type: "object", properties: { goal: { type: "string", description: "What the user wants to be able to do, in their words" } }, required: ["goal"] } },
  { name: "tt_paths", description: "The alternative ways to reach a capability, compared by setup time, risk and lock-in — which steps are a config change §10 can undo, and which are an installer that cannot be reversed", inputSchema: { type: "object", properties: { capId: { type: "string" } }, required: ["capId"] } },
  { name: "tt_preferences", description: "What each person prefers, and which plans would fight it — a preference is a word tt plan matches against a step's alternatives (local vs hosted, one-off vs recurring). Pass a name for one person.", inputSchema: { type: "object", properties: { who: { type: "string" } } } },
  { name: "tt_scope", description: "What a scope actually covers, and what it does not. Given a target an action would touch (repo:owner/name, device:nuc, svc:ollama), lists every authority grant, whether its scope covers the target, and the effective mode the covering grants resolve to. Scope was recorded; this checks it.", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } },
  { name: "tt_affordances", description: "The structural domain of each capability — derived from the graph, not pasted on. institutional needs an authority holder, economic a budget and counterparty, cognitive a person supplies it, physical a device runs it. Use this to reason about what kind of world an action operates in.", inputSchema: { type: "object", properties: {} } },
  { name: "tt_digest", description: "How much of the work still runs through the human, and which interventions are likely reducible — approvals and permission blocks that recur against the same capability are infrastructure shaped like a person. Pass a window in days (default 7).", inputSchema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tt_work", description: "Recent work runs, each with what it cost — elapsed time, events, capabilities exercised, human interventions, resources consumed. The observation the economic loop runs on.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "tt_usage", description: "Where capability effort actually went over a window — times exercised, duration, interventions per capability. Pass a window in days (default 30).", inputSchema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tt_run_begin", description: "Start a work run. Returns the run id every later telemetry call attaches to. The run is open until tt_run_end.", inputSchema: { type: "object", properties: { goal: { type: "string" }, goalId: { type: "string" }, runType: { type: "string" }, source: { type: "string" }, id: { type: "string" } } } },
  { name: "tt_run_end", description: "Close a work run with its outcome, and the value of that outcome in cents when it is known.", inputSchema: { type: "object", properties: { runId: { type: "string" }, outcome: { type: "string" }, outcomeValueCents: { type: "number" } }, required: ["runId", "outcome"] } },
  { name: "tt_work_event", description: "Record one observation into a run: a tool/event, a capability use, a human intervention, a resource, or the run's outcome. Kinds: event, use, intervention, resource, outcome. The kind of a human intervention is one of judgment, authority, knowledge, physical, clerical, exception.", inputSchema: { type: "object", properties: { runId: { type: "string" }, kind: { type: "string", description: "event | use | intervention | resource | outcome" }, eventKind: { type: "string" }, actor: { type: "string" }, capabilityId: { type: "string" }, action: { type: "string" }, detail: { type: "string" }, durationSeconds: { type: "number" }, interventionKind: { type: "string", description: "judgment | authority | knowledge | physical | clerical | exception" }, activeSeconds: { type: "number" }, waitingSeconds: { type: "number" }, resourceId: { type: "string" }, resourceKind: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" }, costCents: { type: "number" }, achieved: { type: "string" }, objectiveName: { type: "string" }, objectiveMetric: { type: "number" }, valueCents: { type: "number" } }, required: ["runId", "kind"] } },
  { name: "tt_economics", description: "Declared costs and goal values — attention value per hour, recurring costs, purchase costs, and what each goal is worth. The model that ranks investments by return.", inputSchema: { type: "object", properties: {} } },
  { name: "tt_goal_value", description: "One goal's economics — occurrence rate, success value, failure cost — matched by id or name.", inputSchema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] } },
  { name: "tt_opportunities", description: "Ranked structural changes worth making: recurring middleware burden from the work ledger, priced by attention value and compared by setup cost. Objectives: attention (default), cash, roi, reliability, frontier.", inputSchema: { type: "object", properties: { by: { type: "string", description: "attention | cash | roi | reliability | frontier" } } } },
  { name: "tt_opportunity", description: "One ranked opportunity in full — burden, proposed capability, acquisition, expected effect, payback, confidence.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "tt_can", description: "The decision API: may this actor perform this action on this target within this spend? Returns ALLOW, CONFIRM or DENY with the governing grant, scope, and remaining budget. Ask before acting; an agent can ask, never grant.", inputSchema: { type: "object", properties: { capability: { type: "string" }, action: { type: "string" }, actor: { type: "string" }, target: { type: "string" }, spendCents: { type: "number" } }, required: ["capability"] } },
  { name: "tt_since", description: "What entered the reachable frontier since a past observation, separating what was acquired from what emerged through composition", inputSchema: { type: "object", properties: { when: { type: "string", description: "ISO timestamp; defaults to the earliest observation" } } } },
  { name: "tt_blocked", description: "Record that a task was blocked by a missing capability, and why. The pattern matters more than the instance: the same deficit hit repeatedly as the same cause is infrastructure that should exist. Classification is one of reasoning, knowledge, tool, permission, infrastructure, reliability.", inputSchema: { type: "object", properties: { capId: { type: "string" }, classification: { type: "string", description: "Why it was blocked: reasoning, knowledge, tool, permission, infrastructure, or reliability" }, note: { type: "string", description: "What you were trying to do" } }, required: ["capId"] } },
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
              case "tt_stats": res = tt(db => ({ stats: db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked, SUM(CASE WHEN lifecycle IN ('verified','reliable') THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN lifecycle IN ('degraded','broken') THEN 1 ELSE 0 END) as failing FROM capabilities WHERE kind != 'action'").get(), domains: db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain").all() })); break;
              case "tt_context": res = { text: tt(db => { const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked, SUM(CASE WHEN lifecycle IN ('verified','reliable') THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN lifecycle IN ('degraded','broken') THEN 1 ELSE 0 END) as failing FROM capabilities WHERE kind != 'action'").get(); const d = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain").all(); return `Toolchain: ${g.unlocked}/${g.total} reached · ${g.verified} verified · ${g.failing} failing\n${d.map(s => `  ${s.domain.padEnd(12)} ${s.unlocked}/${s.total}`).join("\n")}`; }) }; break;
              case "tt_cap": res = tt(db => db.prepare("SELECT id, name, domain, maturity_score, state, category FROM capabilities WHERE domain = ? OR name LIKE ? ORDER BY maturity_score DESC LIMIT 20").all(args.query, `%${args.query}%`)); break;
              case "tt_decay": res = tt(db => computeDecay(db).slice(0, 10)); break;
              case "tt_combos": res = tt(db => discoverCombos(db)); break;
              case "tt_diff": res = tt(db => sessionDiff(db)); break;
              case "tt_health": res = tt(db => domainHealth(db)); break;
              case "tt_bottlenecks": res = tt(db => findBottlenecks(db).slice(0, 10)); break;
              case "tt_impact": res = tt(db => analyzeImpact(db, args.capId)); break;
              case "tt_verify": res = tt(db => runVerification(db, args?.capId)); break;
              case "tt_evidence": res = tt(db => evidenceFor(db, String(args.capId).startsWith("combo:") ? args.capId : `combo:${args.capId}`)); break;
              case "tt_authority": res = tt(db => authorityReport(db)); break;
              case "tt_actions": res = tt(db => actionsReport(db, args.capId)); break;
              case "tt_plan": res = tt(db => planFor(db, args.capId)); break;
              case "tt_goal": res = tt(db => goalFor(db, args.goal)); break;
              case "tt_paths": res = tt(db => pathsFor(db, args.capId)); break;
              case "tt_preferences": res = tt(db => preferencesReport(db, args?.who)); break;
              case "tt_scope": res = tt(db => scopeReport(db, args.target)); break;
              case "tt_affordances": res = tt(db => affordanceDomains(db)); break;
              case "tt_digest": res = tt(db => humanDigest(db, args?.days)); break;
              case "tt_economics": res = tt(db => economicsReport(db)); break;
              case "tt_goal_value": res = tt(db => goalValue(db, args.goal)); break;
              case "tt_opportunities": res = tt(db => opportunitiesFor(db, args?.by)); break;
              case "tt_opportunity": res = tt(db => opportunityFor(db, args.id)); break;
              case "tt_can": res = tt(db => canExecute(db, args)); break;
              case "tt_work": res = tt(db => workReport(db, args?.limit)); break;
              case "tt_usage": res = tt(db => usageReport(db, args?.days)); break;
              case "tt_run_begin": res = tt(db => beginRun(db, args || {})); break;
              case "tt_run_end": res = tt(db => endRun(db, args.runId, args.outcome, args.outcomeValueCents)); break;
              case "tt_work_event": res = tt(db => {
                switch (args.kind) {
                  case 'use': return recordUse(db, args.runId, args.capabilityId, { durationSeconds: args.durationSeconds });
                  case 'intervention': return recordIntervention(db, args.runId, args.actor, {
                    kind: args.interventionKind || 'clerical',
                    activeSeconds: args.activeSeconds, waitingSeconds: args.waitingSeconds,
                    capabilityId: args.capabilityId, action: args.action,
                  });
                  case 'resource': return recordResource(db, args.runId, args.resourceId, args.resourceKind, { quantity: args.quantity, unit: args.unit, costCents: args.costCents });
                  case 'outcome': return recordOutcome(db, args.runId, args.achieved, { objectiveMetric: args.objectiveMetric, objectiveName: args.objectiveName, valueCents: args.valueCents });
                  default: return addEvent(db, args.runId, {
                    kind: args.eventKind || args.kind, actor: args.actor,
                    capabilityId: args.capabilityId, action: args.action, detail: args.detail,
                  });
                }
              }); break;
              case "tt_since": res = tt(db => ledgerSince(db, args?.when)); break;
              case "tt_ledger": res = tt(db => ledgerHistory(db)); break;
              case "tt_blocked": res = tt(db => recordFailure(db, args.capId, args.classification, args.note)); break;
              case "tt_deficits": res = tt(db => deficits(db)); break;
              case "tt_spof": res = tt(db => singlePointsOfFailure(db)); break;
              case "tt_simulate": res = tt(db => simulateFrontier(db, [args.capId])); break;
              case "tt_propose": res = tt(db => propose(db, args.capId, args.option)); break;
              case "tt_proposals": res = tt(db => listProposals(db)); break;
              case "tt_proposal": res = tt(db => showProposal(db, args.id)); break;
              case "tt_near": res = tt(db => nearMissCombos(db)); break;
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
