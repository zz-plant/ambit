import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { resolveDbPath } from "../shared/db-path.ts";
import { ENGINE_DIR, CONFIG_DEFAULT } from "./paths.ts";
import { getDb, migrate } from "./db.ts";
import { seedFromConfig } from "./discovery.ts";
import {
  computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks,
  analyzeImpact, nearMissCombos, singlePointsOfFailure, exportGraph,
  affordanceDomains, surfaceFor,
} from "./inference.ts";
import { runVerification, evidenceFor, authorityReport, actionsReport, scopeReport, canExecute } from "./assurance.ts";
import { ledgerHistory, ledgerSince } from "./ledger.ts";
import { recordFailure, deficits, simulateFrontier, propose, preferencesReport } from "./planning.ts";
import { goalFor, pathsFor } from "./goals.ts";
import { humanDigest, notify, notifyPending } from "./attention.ts";
import { workReport, usageReport } from "./telemetry.ts";
import { economicsReport } from "./economics.ts";
import { opportunitiesFor, opportunityFor } from "./opportunities.ts";
import { roiFor } from "./roi.ts";
import { exportSummary, importSummary } from "./federation.ts";
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

const HELP = `ambit - what your system can do, what it costs, what to change

  status            health · degraded · spofs · deficits · pending approvals
  graph [surface|combos|affordances]   the graph, or a runtime-owned view of it
  goal <cap-or-sentence> [--paths|--simulate|--prefs]   route a goal, plan the
                    delta, compare acquisition paths, or check preferences
  attention [days]  how much work still runs through the human, and what is reducible
  notify <topic>    push the attention digest to ntfy — nothing is sent without a topic
  notify-approvals <topic>   push the approved-proposals-waiting count to ntfy
  work [limit]      recent runs, each with what it cost
  usage [days]      where capability effort actually went
  economics         declared costs and goal values
  opportunities [--by=attention|cash|roi|reliability|frontier]   ranked
                    investments — observed burden, priced, compared
  opportunity <id>  one ranked case in full
  roi <proposal-id>   what an applied proposal actually changed — before/after
  federation export|import   the signed summary a portfolio layer reads
  impact <id>       what actually breaks if a capability goes away
  verify [cap] [--history]   run the declared check, or show past verification
  authority [cap] [scope <target>]   what may run unattended, what each action
                    may touch, and whether a scope covers a target
  can <cap> [--target X] [--spend N]   the decision API: ALLOW / CONFIRM / DENY
  history [since <when>]   how the frontier moved
  propose <cap> [option]    draft a reviewable acquisition (with its simulation)
  proposals / proposal <id>
  approve <id> <person>
  apply <id> / rollback <id>
  record <cap> [class] [note]   record that a task was blocked by a capability
  seed              seed from the agent config
  where             where the graph is stored
  help [term]       this list, or one concept explained`;

// The report `status` composes. One surface for "how are we doing", so the
// person does not have to learn six commands to answer one question.
function statusReport(db: any) {
  const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached, SUM(CASE WHEN lifecycle IN ('verified','reliable') THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN lifecycle IN ('degraded','broken') THEN 1 ELSE 0 END) as failing FROM capabilities WHERE kind != 'action'").get();
  const domains = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain").all();
  const actions = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached FROM capabilities WHERE kind = 'action'").get();

  // Degraded means configured but not working — the decision-relevant reading
  // of "decay". A lifecycle-failing capability is a repair, not an acquisition.
  const degraded = db.prepare(
    `SELECT id, name, domain FROM capabilities
     WHERE state IN ('unlocked','active') AND lifecycle IN ('degraded','broken')
     ORDER BY id`
  ).all();

  const proposals = listProposals(db);
  const pending = Array.isArray(proposals)
    ? proposals.filter((p: any) => p.status === 'draft' || p.status === 'approved')
    : [];

  return {
    reached: g.reached,
    total: g.total,
    verified: g.verified,
    failing: g.failing,
    actions: actions?.total ? { reached: actions.reached, total: actions.total } : undefined,
    domains,
    degraded: degraded.length ? degraded : undefined,
    spofs: singlePointsOfFailure(db),
    bottlenecks: findBottlenecks(db).slice(0, 10),
    deficits: deficits(db),
    frontier: ledgerHistory(db).slice(-5),
    pending,
  };
}

/** The concept glossary, shared with the visualiser so the two cannot drift. */
function explain(wanted: string): void {
  const { concepts } = JSON.parse(readFileSync(join(ENGINE_DIR, "..", "shared", "concepts.json"), "utf8"));
  const picked = wanted
    ? concepts.filter((c: any) => c.key.includes(wanted) || c.term.toLowerCase().includes(wanted))
    : concepts;
  if (picked.length === 0) {
    console.log(`${C.yellow}No concept matching "${wanted}".${C.reset}`);
    console.log(`Try: ${concepts.map((c: any) => c.key).join(", ")}`);
    return;
  }
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
  if (!wanted) console.log(`${C.grey}ambit help <term> for one of these on its own.${C.reset}\n`);
}

async function main() {
  const db = getDb();
  migrate(db);
  const cmd = process.argv[2];
  // Flags are not arguments. Taking argv[3] blindly meant `tt verify --json`
  // looked for a capability named "--json", which every flag-taking command
  // silently inherited.
  const positional = process.argv.slice(3).filter(a => !a.startsWith("--"));
  const arg = positional[0];
  const flags = new Set(process.argv.slice(3).filter(a => a.startsWith("--")));
  const mappingOverride = process.env.CONFIG_MAPPING;

  // An unseeded graph answered every question with "Nothing to report", which
  // is what a healthy graph with no findings says too. A Homebrew install
  // never runs bootstrap.sh, so that was the entire first-run experience:
  // a tool that appears to work and reports an empty world.
  //
  // `work` and `usage` read the work ledger, which a runtime adapter can fill
  // before any capability has been discovered — so they are exempt, and report
  // an empty ledger rather than "no graph".
  const ledgerCommands = new Set(['work', 'usage']);
  if (cmd && !ledgerCommands.has(cmd) && cmd !== "seed" && cmd !== "where" && cmd !== "help") {
    const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get();
    if (!seeded?.n) {
      console.log(`${C.yellow}No graph yet.${C.reset} Nothing has been discovered on this machine.`);
      console.log(`  ${C.bold}ambit seed${C.reset}    read your agent config and build the graph`);
      console.log(`  ${C.grey}ambit where${C.reset}   ${C.grey}where the graph is stored${C.reset}`);
      db.close();
      return;
    }
  }
  if (!cmd || cmd === "help") {
    if (cmd === "help" && arg) { explain(arg.toLowerCase()); db.close(); return; }
    console.log(HELP);
    db.close();
    return;
  }
  switch (cmd) {
    case "status":
      emit(statusReport(db));
      break;
    case "graph": {
      // The graph is one thing with several views; none of them is a headline.
      if (arg === "surface") console.log(JSON.stringify(surfaceFor(db), null, 2));
      else if (arg === "combos") emit(discoverCombos(db));
      else if (arg === "affordances") emit(affordanceDomains(db));
      else console.log(JSON.stringify(exportGraph(db)));
      break;
    }
    case "goal": {
      // One entry for the gap-to-capability question, with the folds as flags:
      // paths, simulation and preferences are views of the same decision.
      if (flags.has("--prefs")) emit(preferencesReport(db, arg));
      else if (flags.has("--paths")) emit(arg ? pathsFor(db, arg) : { error: 'Usage: ambit goal <capability> --paths' });
      else if (flags.has("--simulate")) emit(arg ? simulateFrontier(db, [arg]) : { error: 'Usage: ambit goal <capability> --simulate' });
      else emit(goalFor(db, arg));
      break;
    }
    case "attention":
    case "digest":
      emit(humanDigest(db, arg));
      break;
    case "notify":
      // async: the push is an HTTP POST and must complete before close.
      emit(await notify(db, arg));
      break;
    case "notify-approvals":
      emit(await notifyPending(db, arg));
      break;
    case "work":
      emit(workReport(db, parseInt(arg) || 20));
      break;
    case "usage":
      emit(usageReport(db, parseInt(arg) || 30));
      break;
    case "economics":
      emit(economicsReport(db));
      break;
    case "opportunities": {
      const byFlag = [...flags].find(f => f.startsWith('--by='));
      const by = (byFlag ? byFlag.slice(5) : undefined) as any;
      emit(opportunitiesFor(db, by));
      break;
    }
    case "opportunity":
      emit(opportunityFor(db, arg));
      break;
    case "roi":
      emit(roiFor(db, arg));
      break;
    case "federation": {
      const verb = arg;
      if (verb === "export") {
        const summary = exportSummary(db);
        console.log(JSON.stringify(summary, null, 2));
        break;
      }
      if (verb === "import") {
        emit(importSummary(db, positional[1]));
        break;
      }
      emit({ error: 'Usage: ambit federation export [path] | ambit federation import <path>' });
      break;
    }
    case "impact":
      emit(analyzeImpact(db, arg));
      break;
    case "verify":
      if (flags.has("--history")) {
        emit(arg ? evidenceFor(db, arg.includes(':') ? arg : `combo:${arg}`) : { error: "Usage: ambit verify <id> --history" });
      } else {
        emit(runVerification(db, arg));
      }
      break;
    case "authority": {
      // Grants, then per-capability actions, then scope coverage — one verb.
      if (arg === "scope") emit(scopeReport(db, positional[1]));
      else if (arg) emit(actionsReport(db, arg));
      else emit(authorityReport(db));
      break;
    }
    case "can": {
      const target = [...flags].find(f => f.startsWith('--target='))?.slice(9);
      const spend = [...flags].find(f => f.startsWith('--spend='))?.slice(8);
      const actor = [...flags].find(f => f.startsWith('--actor='))?.slice(8);
      emit(canExecute(db, {
        actor,
        capability: arg,
        target,
        spendCents: spend ? Number(spend) : undefined,
      }));
      break;
    }
    case "history":
      if (arg === "since") emit(ledgerSince(db, positional[1]));
      else emit(ledgerHistory(db));
      break;
    case "propose":
      emit(propose(db, arg, Number(positional[1]) || undefined));
      break;
    case "proposals":
      emit(listProposals(db));
      break;
    case "proposal":
      emit(showProposal(db, arg));
      break;
    case "approve":
      emit(approveProposal(db, arg, positional[1]));
      break;
    case "apply":
      emit(applyProposal(db, arg));
      break;
    case "rollback":
      emit(rollbackProposal(db, arg));
      break;
    case "record":
      emit(recordFailure(db, arg, positional[1], positional[2]));
      break;
    case "seed": {
      const cfg = CONFIG_DEFAULT;
      seedFromConfig(db, undefined, mappingOverride);
      const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities").get();
      console.log(`${C.green}✓${C.reset} ${c?.cnt ?? 0} capabilities`);
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
        seeded: seeded > 0 ? true : "no — run ambit seed",
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