import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { resolveDbPath } from "../shared/db-path.ts";
import { ENGINE_DIR, CONFIG_DEFAULT } from "./paths.ts";
import { getDb, migrate } from "./db.ts";
import { seedFromConfig } from "./discovery.ts";
import {
  computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks,
  analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations,
  forkComparison, graphProfile, nearMissCombos, insights,
  singlePointsOfFailure, exportGraph, affordanceDomains, surfaceFor,
} from "./inference.ts";
import { runVerification, evidenceFor, authorityReport, actionsReport, scopeReport } from "./assurance.ts";
import { ledgerHistory, ledgerSince } from "./ledger.ts";
import { planFor, recordFailure, deficits, simulateFrontier, propose, preferencesReport } from "./planning.ts";
import { goalFor, pathsFor } from "./goals.ts";
import { humanDigest, notify } from "./attention.ts";
import {
  approveProposal, listProposals, showProposal, applyProposal, rollbackProposal,
} from "./governance.ts";

const C = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", grey: "\x1b[90m", blue: "\x1b[36m", red: "\x1b[31m", bold: "\x1b[1m" };

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

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();
  migrate(db);
  const cmd = process.argv[2];
  // Flags are not arguments. Taking argv[3] blindly meant `tt verify --json`
  // looked for a capability named "--json", which every flag-taking command
  // silently inherited.
  const positional = process.argv.slice(3).filter(a => !a.startsWith("--"));
  const arg = positional[0];
  const mappingOverride = process.env.CONFIG_MAPPING;

  // An unseeded graph answered every question with "Nothing to report", which
  // is what a healthy graph with no findings says too. A Homebrew install
  // never runs bootstrap.sh, so that was the entire first-run experience:
  // a tool that appears to work and reports an empty world.
  if (cmd && cmd !== "seed" && cmd !== "where" && cmd !== "explain") {
    const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get();
    if (!seeded?.n) {
      console.log(`${C.yellow}No graph yet.${C.reset} Nothing has been discovered on this machine.`);
      console.log(`  ${C.bold}tt seed${C.reset}    read your agent config and build the graph`);
      console.log(`  ${C.grey}tt where${C.reset}   ${C.grey}where the graph is stored${C.reset}`);
      db.close();
      return;
    }
  }
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
    console.log("  plan <cap>        Steps to a capability, in the order to close them");
    console.log("  goal <sentence>   Route a free-form goal to the capabilities that cover it");
    console.log("  paths <cap>       The alternative ways to reach a capability, with risk and lock-in");
    console.log("  preferences [who] Who prefers what, and which plans would fight it");
    console.log("  authority         What may run unattended, and what may not");
    console.log("  actions [id]      The concrete actions a capability confers");
    console.log("  affordances       The structural domain of each capability — institutional, economic, cognitive, physical");
    console.log("  digest [days]     How much work still runs through the human, and what is reducible");
    console.log("  notify <topic>    Push the digest to ntfy — nothing is sent without a topic");
    console.log("  budget <s> <t>    Budget optimization");
    console.log("  trend <days>      Trend projection");
    db.close();
    return;
  }
  switch (cmd) {
    case "apply":
      emit(applyProposal(db, arg));
      break;
    case "rollback":
      emit(rollbackProposal(db, arg));
      break;
    case "approve":
      emit(approveProposal(db, arg, process.argv.slice(4).filter(a => !a.startsWith('--'))[0]));
      break;
    case "propose":
      emit(propose(db, arg, Number(process.argv.slice(4).filter(a => !a.startsWith('--'))[0]) || undefined));
      break;
    case "proposals":
      emit(listProposals(db));
      break;
    case "proposal":
      emit(showProposal(db, arg));
      break;
    case "simulate":
      emit(arg ? simulateFrontier(db, [arg]) : { error: 'Usage: tt simulate <capability>' });
      break;
    case "spof":
      emit(singlePointsOfFailure(db));
      break;
    case "failed":
      emit(recordFailure(db, arg, positional[1], positional[2]));
      break;
    case "deficits":
      emit(deficits(db));
      break;
    case "plan":
      emit(planFor(db, arg));
      break;
    case "goal":
      emit(goalFor(db, arg));
      break;
    case "paths":
      emit(pathsFor(db, arg));
      break;
    case "preferences":
      emit(preferencesReport(db, arg));
      break;
    case "scope":
      emit(scopeReport(db, arg));
      break;
    case "affordances":
      emit(affordanceDomains(db));
      break;
    case "digest":
      emit(humanDigest(db, arg));
      break;
    case "notify":
      // async: the push is an HTTP POST and must complete before close.
      emit(await notify(db, arg));
      break;
    case "authority":
      emit(authorityReport(db));
      break;
    case "actions":
      emit(actionsReport(db, arg));
      break;
    case "verify":
      emit(runVerification(db, arg));
      break;
    case "evidence":
      emit(arg ? evidenceFor(db, arg.includes(':') ? arg : `combo:${arg}`) : { error: "Usage: tt evidence <id>" });
      break;
    case "ledger":
      emit(ledgerHistory(db));
      break;
    case "since":
      emit(ledgerSince(db, arg));
      break;
    case "explain": {
      // Same definitions the visualizer shows, read from the shared file so
      // the two surfaces cannot drift.
      const { concepts } = JSON.parse(readFileSync(join(ENGINE_DIR, "..", "shared", "concepts.json"), "utf8"));
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
    case "seed": {
      const cfg = CONFIG_DEFAULT;
      seedFromConfig(db, undefined, mappingOverride);
      const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities").get();
      console.log(`${C.green}✓${C.reset} ${c.cnt} capabilities`);
      // Say so rather than reporting a curated-model-only graph as if it had
      // read the environment. Silence here reads as "your stack is empty".
      if (!existsSync(cfg)) {
        console.log(`${C.yellow}!${C.reset} No agent config at ${C.grey}${cfg}${C.reset}`);
        console.log(`${C.grey}  Seeded the capability model only — nothing of yours is in the graph yet.${C.reset}`);
        console.log(`${C.grey}  Point it at your own config: OPENCODE_CONFIG=/path/to/config.json${C.reset}`);
        console.log(`${C.grey}  Another format: see "Other configurations" in the README (CONFIG_MAPPING).${C.reset}`);
      }
      break;
    }
    case "stats": case "context": {
      // Actions are counted apart. Folding them in would have made the release
      // that introduced them look like a machine that suddenly did half as much
      // again, which is the same false reading `tt since` reports as vocabulary
      // rather than as gain.
      //
      // Reached stays structural; verified and failing are the demonstrated
      // half. The block handed to agents must never let one be mistaken for the
      // other: a capability whose check last failed is configured but not
      // working, and the failing count names how many are in that state.
      const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked, SUM(CASE WHEN lifecycle IN ('verified','reliable') THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN lifecycle IN ('degraded','broken') THEN 1 ELSE 0 END) as failing FROM capabilities WHERE kind != 'action'").get();
      console.log(`Toolchain: ${g.unlocked}/${g.total} reached · ${g.verified} verified · ${g.failing} failing`);
      const domains = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain").all();
      for (const d of domains) console.log(`  ${d.domain.padEnd(12)} ${d.unlocked}/${d.total}`);
      const a = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached FROM capabilities WHERE kind = 'action'").get();
      if (a?.total) console.log(`  ${'actions'.padEnd(12)} ${a.reached}/${a.total}  ${C.grey}tt actions${C.reset}`);
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
    case "surface": console.log(JSON.stringify(surfaceFor(db), null, 2)); break;

    case "near": emit(nearMissCombos(db)); break;
    case "insight": emit(insights(db)); break;
    // Where the graph lives is not obvious once the CLI is installed rather
    // than cloned, and every other component resolves the same path.
    case "where": {
      const path = resolveDbPath();
      // Not whether the file exists — opening it creates it, so that is always
      // true by the time this runs. Whether it holds a graph is the question.
      const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get()?.n ?? 0;
      emit({
        graph: path,
        capabilities: seeded,
        seeded: seeded > 0 ? true : "no — run tt seed",
        bytes: existsSync(path) ? statSync(path).size : 0,
        override: "TOOLCHAIN_DB",
      });
      break;
    }
    default: console.log(`${C.red}Unknown: ${cmd}${C.reset}`);
  }
  db.close();
}


export { emit, main };
