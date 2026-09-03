import { existsSync, statSync, writeFileSync } from 'node:fs';
import { resolveDbPath } from '../shared/db-path.ts';
import { getDb, migrate, type Db } from './db.ts';
import { C, emit, emitRaw, emitText, setSink } from './cli/output.ts';
import { HELP, HELP_SHORT } from './cli/help.ts';
import { explain, statusReport } from './cli/reports.ts';
import { runSeed } from './cli/seed.ts';
import { resolveCommand } from './cli/groups.ts';
import { shareSnapshot } from './share.ts';
import {
  discoverCombos,
  analyzeImpact,
  exportGraph,
  affordanceDomains,
  surfaceFor,
  credentialReport,
} from './inference.ts';
import {
  runVerification,
  evidenceFor,
  authorityReport,
  actionsReport,
  scopeReport,
  canExecute,
  setPromotion,
  promotionReport,
  declareSandbox,
  removeSandbox,
} from './assurance.ts';
import { setBudget, budgetReport, clearBudget } from './budgets.ts';
import { reversibilityReport } from './reversibility.ts';
import { observedReport } from './observed.ts';
import { objectReport } from './objects.ts';
import { briefing, briefingText } from './briefing.ts';
import { nextSteps } from './next.ts';
import { recordRefusal, signalReport } from './failures.ts';
import { registerSkill, registeredSkills } from './skills.ts';
import { exportSync, importSync } from './sync.ts';
import { ledgerHistory, ledgerSince } from './ledger.ts';
import { recordFailure, simulateFrontier, propose, preferencesReport } from './planning.ts';
import { goalFor, pathsFor } from './goals.ts';
import { humanDigest, notify, notifyPending } from './attention.ts';
import { workReport, usageReport } from './telemetry.ts';
import { economicsReport } from './economics.ts';
import { opportunitiesFor, opportunityFor } from './opportunities.ts';
import { roiFor, roiSummary } from './roi.ts';
import { exportSummary, importSummary } from './federation.ts';
import { portfolio } from './portfolio.ts';
import { incidents, resolveIncident } from './incident.ts';
import { catalogReport } from './catalog.ts';
import { auditFor } from './audit.ts';
import {
  approveProposal,
  approveProposals,
  rejectProposal,
  listProposals,
  pendingProposals,
  showProposal,
  applyProposal,
  rollbackProposal,
} from './governance.ts';

/**
 * Runs one resolved command against an open graph and reports through `emit`.
 *
 * Split out of `main` so it can be called directly. Everything the switch
 * needs is a parameter — the database, the verb, its positional arguments and
 * its flags — which is what lets a test ask the engine a question in-process
 * instead of spawning `node`, printing JSON and parsing it back. `main` still
 * owns argv, the first-run seed and the database's lifetime.
 */
async function runCommand(
  db: Db,
  cmd: string,
  positional: string[],
  flags: Set<string>,
  mappingOverride?: string
): Promise<void> {
  const arg = positional[0];
  /** `--key=value` off the flag set, since flags are parsed as a bare set. */
  const value = (name: string) =>
    [...flags].find(f => f.startsWith(`--${name}=`))?.slice(name.length + 3);
  switch (cmd) {
    // What an agent should know before its first tool call. Prose by default
    // because that is what gets pasted into a system prompt; --json for the
    // runtime hooks that compose it into something else.
    case 'briefing':
    case 'brief': {
      if (process.argv.includes('--json')) emit(briefing(db, { mark: !flags.has('--peek') }));
      else emitText(briefingText(db, { mark: !flags.has('--peek') }));
      break;
    }
    case 'next':
      emit(nextSteps(db, Number(arg) || undefined));
      break;
    case 'signals':
      emit(signalReport(db, Number(arg) || undefined));
      break;
    case 'preferences':
      // Declared, or observed: what someone said they want, and what they have
      // actually approved. The second is the one a draft should read.
      emit(flags.has('--observed') ? observedReport(db) : preferencesReport(db, arg));
      break;
    case 'skills':
      emit(registeredSkills(db));
      break;
    case 'budget': {
      if (arg === 'set')
        emit(
          setBudget(db, {
            capability: positional[1],
            action: positional[2],
            amount: value('amount'),
            period: value('period'),
            scope: value('scope'),
            person: value('by'),
          })
        );
      else if (arg === 'clear') emit(clearBudget(db, positional[1], positional[2], value('scope')));
      else emit(budgetReport(db));
      break;
    }
    case 'reversible':
      emit(reversibilityReport(db));
      break;
    case 'objects':
      emit(objectReport(db, arg));
      break;
    case 'sync': {
      if (arg === 'export') emit(exportSync(db, positional[1]));
      else if (arg === 'import') emit(importSync(db, positional[1]));
      else emit({ error: 'Usage: ambit sync export [path] | ambit sync import <path>' });
      break;
    }
    case 'status':
      emit(statusReport(db));
      break;
    case 'graph': {
      // The graph is one thing with several views; none of them is a headline.
      if (arg === 'surface') emitRaw(surfaceFor(db));
      else if (arg === 'combos') emit(discoverCombos(db));
      else if (arg === 'affordances') emit(affordanceDomains(db));
      else emitRaw(exportGraph(db), false);
      break;
    }
    case 'goal': {
      // One entry for the gap-to-capability question, with the folds as flags:
      // paths, simulation and preferences are views of the same decision.
      if (flags.has('--prefs')) emit(preferencesReport(db, arg));
      else if (flags.has('--paths'))
        emit(arg ? pathsFor(db, arg) : { error: 'Usage: ambit goal <capability> --paths' });
      else if (flags.has('--simulate'))
        emit(
          arg ? simulateFrontier(db, [arg]) : { error: 'Usage: ambit goal <capability> --simulate' }
        );
      else emit(goalFor(db, arg));
      break;
    }
    case 'attention':
    case 'digest':
      emit(humanDigest(db, arg));
      break;
    case 'notify':
      // async: the push is an HTTP POST and must complete before close.
      emit(await notify(db, arg));
      break;
    case 'notify-approvals':
      emit(await notifyPending(db, arg));
      break;
    case 'work':
      emit(workReport(db, parseInt(arg, 10) || 20));
      break;
    case 'usage':
      emit(usageReport(db, parseInt(arg, 10) || 30));
      break;
    case 'economics':
      emit(economicsReport(db));
      break;
    case 'opportunities': {
      const byFlag = [...flags].find(f => f.startsWith('--by='));
      const by = (byFlag ? byFlag.slice(5) : undefined) as any;
      const budgetFlag = [...flags].find(f => f.startsWith('--budget='));
      const budget = budgetFlag ? Number(budgetFlag.slice(9)) : undefined;
      emit(opportunitiesFor(db, by, Number.isFinite(budget as any) ? budget : undefined));
      break;
    }
    case 'opportunity':
      emit(opportunityFor(db, arg));
      break;
    case 'roi':
      // No proposal id means the cumulative headline: what every applied
      // proposal saved, and whether the predictions held.
      emit(arg ? roiFor(db, arg) : roiSummary(db));
      break;
    case 'incidents':
      // async: probing the manifest is a set of HTTP checks.
      emit(await incidents(db));
      break;
    case 'incident': {
      if (arg === 'resolve') emit(resolveIncident(db, positional[1], positional[2]));
      else emit({ error: 'Usage: ambit incident resolve <svc:key> <outcome>' });
      break;
    }
    case 'portfolio': {
      const budgetFlag = [...flags].find(f => f.startsWith('--budget='));
      const budget = budgetFlag ? Number(budgetFlag.slice(9)) : undefined;
      emit(portfolio(db, Number.isFinite(budget as any) ? budget : undefined));
      break;
    }
    case 'catalog':
      emit(catalogReport(db, arg));
      break;
    case 'audit':
      emit(auditFor(db, arg));
      break;
    case 'federation': {
      const verb = arg;
      if (verb === 'export') {
        const summary = exportSummary(db);
        emitRaw(summary);
        break;
      }
      if (verb === 'import') {
        emit(importSummary(db, positional[1]));
        break;
      }
      emit({ error: 'Usage: ambit federation export [path] | ambit federation import <path>' });
      break;
    }
    case 'impact':
      emit(analyzeImpact(db, arg));
      break;
    case 'verify':
      if (flags.has('--history')) {
        emit(
          arg
            ? evidenceFor(db, arg.includes(':') ? arg : `combo:${arg}`)
            : { error: 'Usage: ambit verify <id> --history' }
        );
      } else {
        emit(runVerification(db, arg, value('target')));
      }
      break;
    case 'authority': {
      // Grants, then per-capability actions, then scope coverage, then the
      // thresholds that widen a grant on evidence — one verb.
      if (arg === 'scope') emit(scopeReport(db, positional[1]));
      else if (arg === 'sandbox') {
        // Somewhere acting does not matter, so evidence can be gathered where
        // a mistake costs nothing.
        if (positional[1] === 'remove') emit(removeSandbox(db, positional[2]));
        else emit(declareSandbox(db, positional[1], value('by'), positional[2]));
      } else if (arg === 'promote') {
        if (!positional[1]) emit(promotionReport(db));
        else
          emit(
            setPromotion(db, {
              capability: positional[1],
              action: positional[2],
              after: value('after'),
              window: value('window'),
              scope: value('scope'),
              person: value('by'),
            })
          );
      } else if (arg) emit(actionsReport(db, arg));
      else emit(authorityReport(db));
      break;
    }
    case 'can': {
      const decision: any = canExecute(db, {
        actor: value('actor'),
        capability: arg,
        target: value('target'),
        spendCents: value('spend') ? Number(value('spend')) : undefined,
      });
      // A refusal is a deficit whoever asked. This surface used to be the
      // silent one, which meant the same question had different consequences
      // depending on where it was asked.
      if (!flags.has('--no-record')) {
        const recorded = recordRefusal(db, decision, value('tool'));
        if (recorded !== undefined) decision.recorded_deficit = recorded;
      }
      emit(decision);
      break;
    }
    case 'history':
      if (arg === 'since') emit(ledgerSince(db, positional[1]));
      else emit(ledgerHistory(db));
      break;
    case 'propose':
      emit(propose(db, arg, Number(positional[1]) || undefined));
      break;
    case 'proposals':
      // What exists, or what is actually waiting on a decision.
      emit(flags.has('--pending') ? pendingProposals(db) : listProposals(db));
      break;
    case 'proposal':
      emit(showProposal(db, arg));
      break;
    case 'approve': {
      // The last positional is the person; everything before it is a proposal.
      // Approving a week's drafts in one sitting is the difference between an
      // environment that grows and a backlog nobody opens.
      const ids = positional.slice(0, -1);
      const person = positional[positional.length - 1];
      emit(ids.length > 1 ? approveProposals(db, ids, person) : approveProposal(db, arg, person));
      break;
    }
    case 'reject':
      emit(rejectProposal(db, arg, positional[1], positional[2]));
      break;
    case 'apply':
      emit(applyProposal(db, arg));
      break;
    case 'credentials':
      emit(credentialReport(db));
      break;
    case 'rollback':
      emit(rollbackProposal(db, arg));
      break;
    case 'record': {
      // Two things a session records against the graph: what stopped it, and
      // what it built so that thing stops stopping it. The second is a
      // registration, and `--provides` or `--verify` is what says so.
      if (
        arg?.startsWith('skill:') ||
        flags.has('--verify') ||
        value('verify') ||
        value('provides')
      )
        emit(
          registerSkill(db, {
            id: arg,
            name: value('name'),
            provides: value('provides'),
            verify: value('verify'),
            runtime: value('by'),
            description: value('description'),
          })
        );
      else emit(recordFailure(db, arg, positional[1], positional[2]));
      break;
    }
    case 'seed': {
      runSeed(db, mappingOverride, process.argv.includes('--json'));
      break;
    }
    // Where the graph lives is not obvious once the CLI is installed rather
    // than cloned, and every other component resolves the same path.
    case 'share': {
      // Written locally, never posted: the file is the product, and where it
      // goes next is the person's decision made outside this tool.
      const out = [...flags].find(f => f.startsWith('--out='))?.slice(6) || 'ambit-map.html';
      const snap = shareSnapshot(db, { redact: flags.has('--redact') });
      writeFileSync(out, snap.html);
      emit({
        wrote: out,
        nodes: snap.nodes,
        reached: snap.reached,
        proven: snap.proven,
        redacted_names: snap.redacted_names,
        note: flags.has('--redact')
          ? 'Names outside the curated model are replaced by category and index.'
          : 'Names are included; --redact shares the shape of the setup without them. Commands, URLs, paths, and descriptions are never included.',
      });
      break;
    }
    case 'where': {
      const path = resolveDbPath();
      // Not whether the file exists — opening it creates it, so that is always
      // true by the time this runs. Whether it holds a graph is the question.
      const seeded =
        db.prepare("SELECT COUNT(*) AS n FROM capabilities WHERE kind != 'action'").get()?.n ?? 0;
      emit({
        graph: path,
        capabilities: seeded,
        seeded: seeded > 0 ? true : 'no — run ambit seed',
        bytes: existsSync(path) ? statSync(path).size : 0,
        override: 'AMBIT_DB (or TOOLCHAIN_DB)',
      });
      break;
    }
    default:
      console.log(`${C.red}Unknown: ${cmd}${C.reset}`);
  }
}

/**
 * Runs a command and returns what it reported, instead of printing it.
 *
 * This is the seam the engine's end-to-end tests use. They used to spawn
 * `node --experimental-sqlite engine.ts <cmd> --json` and parse stdout, once
 * per assertion, because the test runner could not load the engine at all.
 * The runner can now, so the subprocess buys nothing but forty seconds: the
 * same switch runs, against the same database, through the same `emit`.
 *
 * The argv-shaped signature is deliberate. A test says what a person would
 * type, so the command grouping, flag parsing and argument handling are all
 * still under test rather than bypassed.
 */
function begin(db: Db, argv: string[], mappingOverride?: string) {
  const resolved = resolveCommand(argv[0], argv.slice(1));
  if (!resolved.cmd) throw new Error('capture needs a command');

  const state = { value: undefined as unknown, calls: 0 };
  const previous = setSink(data => {
    state.value = data;
    state.calls++;
  });
  const done = runCommand(
    db,
    resolved.cmd,
    resolved.argv.filter(a => !a.startsWith('--')),
    new Set(resolved.argv.filter(a => a.startsWith('--'))),
    mappingOverride
  );
  return { state, done, restore: () => void setSink(previous) };
}

/** A command that reported nothing printed something else — an unknown verb,
 *  or a path that only writes. Saying so beats returning undefined and failing
 *  three assertions later. */
function result(argv: string[], state: { value: unknown; calls: number }): any {
  if (state.calls === 0) throw new Error(`\`${argv.join(' ')}\` reported no result`);
  return state.value;
}

/**
 * Runs a command and returns what it reported, for the commands that finish
 * without awaiting anything — which is all but three of them.
 *
 * Synchronous on purpose. `runCommand` is declared async because `notify`,
 * `notify-approvals` and `incidents` reach the network, but every other case
 * runs to completion before the call returns, so the result is already in hand.
 * Making the seam synchronous is what lets a test read
 * `cli('status').health` rather than parenthesising an await at 137 call sites.
 */
function capture(db: Db, argv: string[], mappingOverride?: string): any {
  const { state, done, restore } = begin(db, argv, mappingOverride);
  try {
    if (state.calls === 0) {
      // It awaited something, so the answer is not ready and never will be on
      // this path. Do not leave the rejection unhandled while saying so.
      done.catch(() => {});
      throw new Error(`\`${argv.join(' ')}\` is asynchronous — use captureAsync`);
    }
  } finally {
    restore();
  }
  return result(argv, state);
}

/** The same seam for the three commands that reach the network. */
async function captureAsync(db: Db, argv: string[], mappingOverride?: string): Promise<any> {
  const { state, done, restore } = begin(db, argv, mappingOverride);
  try {
    await done;
  } finally {
    restore();
  }
  return result(argv, state);
}

async function main() {
  const db = getDb();
  migrate(db);
  const resolved = resolveCommand(process.argv[2], process.argv.slice(3));
  const cmd = resolved.cmd;
  // Flags are not arguments. Taking argv[3] blindly meant `tt verify --json`
  // looked for a capability named "--json", which every flag-taking command
  // silently inherited.
  const positional = resolved.argv.filter(a => !a.startsWith('--'));
  const arg = positional[0];
  const flags = new Set(resolved.argv.filter(a => a.startsWith('--')));
  const mappingOverride = process.env.CONFIG_MAPPING;

  // An unseeded graph answered every question with "Nothing to report", which
  // is what a healthy graph with no findings says too. A Homebrew install
  // never runs bootstrap.sh, so that was the entire first-run experience:
  // a tool that appears to work and reports an empty world.
  //
  // `work` and `usage` read the work ledger, `portfolio` reads federation
  // imports, `incidents` probes a manifest — all can work before any
  // capability has been discovered — so they are exempt, and report their own
  // emptiness rather than "no graph".
  const ledgerCommands = new Set(['work', 'usage', 'portfolio', 'incidents', 'incident']);
  if (cmd && !ledgerCommands.has(cmd) && cmd !== 'seed' && cmd !== 'where' && cmd !== 'help') {
    const seeded = db.prepare('SELECT COUNT(*) AS n FROM capabilities').get();
    if (!seeded?.n) {
      // Seed rather than instruct. A fresh Homebrew install
      // install both land here, and "go run another command first" is the
      // wrong first impression for a tool whose pitch is "one command, your
      // map". Seeding only reads config files and writes the local graph, so
      // doing it unasked is safe; --json runs stay silent-but-seeded so
      // scripts get their answer instead of a lecture.
      const json = process.argv.includes('--json');
      if (!json) {
        console.log(
          `${C.grey}First run — reading your agent config and building the graph…${C.reset}`
        );
      }
      runSeed(db, mappingOverride, json);
      if (!json) console.log('');
    }
  }
  if (!cmd || cmd === 'help') {
    if (cmd === 'help' && arg && arg !== '--all') {
      explain(arg.toLowerCase());
      db.close();
      return;
    }
    console.log(flags.has('--all') ? HELP : HELP_SHORT);
    db.close();
    return;
  }
  await runCommand(db, cmd, positional, flags, mappingOverride);
  db.close();
}

export { emit, main, capture, captureAsync, runCommand };
