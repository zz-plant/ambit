import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readSessionLogs, SESSION_LOG_BUDGET_MS, sessionLogReport } from './session-logs.ts';
import { ingestSpool } from './spool.ts';
import { ingestTrackerSpool } from './tracker-spool.ts';
import { resolveDbPath } from '../shared/db-path.ts';
import { getDb, migrate, type Db } from './db.ts';
import {
  emit,
  emitRaw,
  emitText,
  formatGeneric,
  raiseExitCode,
  setSink,
  terminalPalette,
  toTerminal,
} from './cli/output.ts';
import { HELP, groupHelp } from './cli/help.ts';
import {
  briefReport,
  help,
  renderBrief,
  renderCarry,
  renderImpact,
  renderNext,
  renderApply,
  renderConnect,
  renderDoctor,
  renderPort,
  renderRepo,
  renderToggle,
  renderWindows,
  renderPlan,
  renderSpec,
  renderStatus,
  renderFix,
  statusReport,
} from './cli/reports.ts';
import { runSeed } from './cli/seed.ts';
import { GRAPH_VIEWS, GROUPS, commandWords, resolveCommand } from './cli/groups.ts';
import { nearest } from '../shared/nearest.ts';
import { shellQuote } from '../shared/shell.ts';
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
  grantAuthority,
} from './assurance.ts';
import { setBudget, budgetReport, clearBudget, parseAmount } from './budgets.ts';
import { reversibilityReport } from './reversibility.ts';
import { observedReport } from './observed.ts';
import { objectReport } from './objects.ts';
import { briefing, briefingText, taskBriefing } from './briefing.ts';
import { nextSteps } from './next.ts';
import { council } from './council.ts';
import { recordRefusal, signalReport } from './failures.ts';
import { registerSkill, registeredSkills } from './skills.ts';
import { exportSync, importSync } from './sync.ts';
import { ledgerHistory, ledgerSince, typedTimestamps } from './ledger.ts';
import {
  recordDelegationState,
  delegationRecords,
  delegationManifest,
  recordObjection,
  answerObjection,
  unansweredObjections,
  ingestForeignRecords,
  declareDelegationSource,
  setDelegationSourceEnabled,
  forgetDelegationSource,
  delegationSources,
  pullDelegationSources,
  verifyChain,
} from './delegation.ts';
import {
  planFor,
  recordFailure,
  simulateFrontier,
  propose,
  preferencesReport,
} from './planning.ts';
import { capabilityToAsk, resolveCapability } from './resolve.ts';
import { goalFor, pathsFor } from './goals.ts';
import { loadTechTree, typedCommand } from './paths.ts';
import { judgeGoal } from './judge.ts';
import { judgeUnrouted, specDirHint, specGoal } from './spec.ts';
import { humanDigest, notify, notifyPending } from './attention.ts';
import { dispatchProposal, dispatchPending } from './dispatch.ts';
import { workReport, usageReport, unmappedUse, usageWindows } from './telemetry.ts';
import { capacityReport } from './capacity.ts';
import { carryReport, weigh } from './weight.ts';
import { declareModelPrice, economicsReport } from './economics.ts';
import { opportunitiesFor, opportunityFor } from './opportunities.ts';
import { roiFor, roiSummary } from './roi.ts';
import { exportSummary, importSummary } from './federation.ts';
import { portfolio } from './portfolio.ts';
import { incidents, resolveIncident } from './incident.ts';
import { catalogReport, installText } from './catalog.ts';
import { isReached, recheckCommand } from './vocabulary.ts';
import { auditFor } from './audit.ts';
import {
  addPerson,
  listPeople,
  soleDecider,
  approveProposal,
  approveProposals,
  rejectProposal,
  listProposals,
  pendingProposals,
  showProposal,
  applyProposal,
  rollbackProposal,
} from './governance.ts';
import { runDoctor, setupGaps } from './doctor.ts';
import { listPortStatus, portServer } from './port.ts';
import { toggleServer } from './toggle.ts';
import { analyzeRepo } from './repo-inspect.ts';
import { gateNote } from './wiring.ts';
import {
  claudeHookOutput,
  claudeHookSnippet,
  decideCall,
  gateToolCall,
  throughEntry,
} from './gate.ts';
import { statusLine } from './statusline.ts';
import { runConnect } from './connect.ts';
import { runInitRules } from './init-rules.ts';
import { checkInit } from './checkInit.ts';
import { runReceipt } from './receipt.ts';
import { runCiCheck } from './ci-check.ts';
import { judgeTasks, planDecision } from './decision/goals.ts';
import { evaluateGoals, SMOKE_CASES } from './decision/evaluate.ts';
import { decisionHistory, reviewDecision } from './decision/records.ts';
import { judgeAttention, judgeTools, judgeFailures, judgeNext } from './decision/contexts.ts';
import { askDecision } from './decision/client.ts';
import type { WorkflowOptions } from './decision/workflow.ts';

/**
 * A refusal or a ceiling with what it reaches on this machine: the answer says
 * so when no gate is on, since the grant alone stops no tool call.
 */
function withGateNote<T>(result: T, mode?: string): T | (T & { gate: string }) {
  if ((result as { error?: unknown })?.error) return result;
  const note = gateNote(process.env.HOME || '/', mode);
  return note ? { ...result, gate: note } : result;
}

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
  // A capability a person named, read the one way `ambit can`, every MCP tool
  // and the gate read it: an exact id, a bare tree node, or a name that fits
  // exactly one node, and never a guess between two. Five commands each used
  // to read the word their own way, so `github` worked in one, was prefixed
  // into `combo:github` in another and printed "Nothing to report" in a third.
  // The person deciding: `--by`, or else the one person the graph knows. Every
  // decision names one, and `--by` is how every command takes it.
  const by = () => value('by') ?? soleDecider(db);
  // A window in days, as `--days=N` or the bare number every report used to
  // take; undefined leaves the report its default (DEFAULT_WINDOW_DAYS).
  const days = (positionalAt = arg) => Number(value('days')) || Number(positionalAt) || undefined;
  // A word that resembles no node gets a command instead of a list: `goal`
  // routes a sentence, or a word, to the capability it means, so "No
  // capability" is not where the reader is left.
  const named = (
    given?: string
  ): { id: string } | { error: string; did_you_mean?: string[]; try?: string } => {
    const r = resolveCapability(db, given);
    if (r.ok) return { id: r.id };
    if (r.did_you_mean.length) return { error: r.error, did_you_mean: r.did_you_mean };
    return r.reason === 'unknown'
      ? { error: r.error, try: `ambit goal ${shellQuote(String(given).trim())}` }
      : { error: r.error };
  };
  switch (cmd) {
    // What an agent should know before its first tool call. Prose by default
    // because that is what gets pasted into a system prompt; --json for the
    // runtime hooks that compose it into something else.
    case 'briefing': {
      // `--task="deploy the worker"`: only what that task touches, and no mark moved.
      if (value('task')) emit(taskBriefing(db, value('task') as string));
      else if (flags.has('--json')) emit(briefing(db, { mark: !flags.has('--peek') }));
      else emitText(briefingText(db, { mark: !flags.has('--peek') }));
      break;
    }
    case 'next': {
      const palette = terminalPalette();
      if (flags.has('--repo')) {
        emit(analyzeRepo(), r => renderRepo(r, palette));
      } else {
        emit(nextSteps(db, Number(arg) || undefined), r =>
          r.error ? formatGeneric(r, palette) : renderNext(r, palette)
        );
      }
      break;
    }
    case 'council':
      emit(council(db));
      break;
    case 'signals':
      emit(signalReport(db, days()));
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
      const budgeted = positional[1] ? named(positional[1]) : undefined;
      if ((arg === 'set' || arg === 'clear') && budgeted && !('id' in budgeted)) emit(budgeted);
      else if (arg === 'set')
        emit(
          withGateNote(
            setBudget(db, {
              capability: budgeted && 'id' in budgeted ? budgeted.id : positional[1],
              action: positional[2],
              amount: value('amount'),
              period: value('period'),
              scope: value('scope'),
              person: by(),
            })
          )
        );
      else if (arg === 'clear')
        emit(
          clearBudget(
            db,
            budgeted && 'id' in budgeted ? budgeted.id : positional[1],
            positional[2],
            value('scope')
          )
        );
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
      // Drawn by its own renderer for a person; the sink and --json get the data.
      // `--brief` is what bare `ambit` shows: the next steps first, the rest here.
      if (flags.has('--brief'))
        emit(briefReport(db), report => renderBrief(report, terminalPalette(), typedCommand));
      else emit(statusReport(db), report => renderStatus(report, terminalPalette()));
      break;
    case 'graph': {
      // The graph is one thing with several views; none of them is a headline.
      if (arg === 'surface') emitRaw(surfaceFor(db));
      else if (arg === 'combos') emit(discoverCombos(db));
      else if (arg === 'affordances') emit(affordanceDomains(db));
      else if (arg === 'capacity') emit(capacityReport());
      else if (arg === 'unmapped') emit(unmappedUse(db, days(positional[1])));
      // The whole graph as JSON is a view like the others, and named as one,
      // so a script can ask for it the same on a terminal and through a pipe.
      else if (arg === 'export') emitRaw(exportGraph(db), false);
      // The whole graph is one line of JSON, a hundred kilobytes on a real
      // setup: what a pipe or a file wants, and what a person typing the
      // group's name to see what it holds did not. A terminal gets the index.
      else if (!arg) {
        if (toTerminal())
          emitText(
            `${groupHelp('graph')}\n  ambit graph export > graph.json writes the whole graph, which the map draws when the file is dropped on it.`
          );
        else emitRaw(exportGraph(db), false);
      } else {
        const meant = nearest(arg, [...GRAPH_VIEWS, ...GROUPS.graph], 2);
        emit({
          error: `No graph view "${arg}". ambit graph lists them.`,
          ...(meant.length ? { did_you_mean: meant.map(m => `ambit graph ${m}`) } : {}),
        });
      }
      break;
    }
    case 'goal': {
      // One entry for the gap-to-capability question, with the folds as flags:
      // paths, simulation and preferences are views of the same decision.
      if (flags.has('--spec') || value('spec') !== undefined) {
        // A spec's tasks, each routed as a sentence would be. Read as data:
        // nothing in the file runs, and only --judge opens a socket, to this
        // machine, for the tasks the words could not route.
        const report = specGoal(db, value('spec') || arg);
        const judged =
          flags.has('--judge') || value('judge') !== undefined
            ? await judgeUnrouted(report, value('judge'))
            : report;
        // A path that is not a spec is an error and reads as one.
        emit(judged, r =>
          r.error ? formatGeneric(r, terminalPalette()) : renderSpec(r, terminalPalette())
        );
      } else if (flags.has('--prefs')) emit(preferencesReport(db, arg));
      else if (flags.has('--paths'))
        emit(arg ? pathsFor(db, arg) : { error: 'Usage: ambit goal <capability> --paths' });
      else if (flags.has('--simulate')) {
        if (!arg) emit({ error: 'Usage: ambit goal <capability> --simulate' });
        else {
          // An id the graph does not hold used to be "acquired" all the same:
          // simulating `nope` reported a larger frontier for it.
          const asked = resolveCapability(db, arg);
          emit(
            asked.ok
              ? simulateFrontier(db, [asked.id])
              : { error: asked.error, did_you_mean: asked.did_you_mean }
          );
        }
      } else if (flags.has('--judge') || value('judge') !== undefined) {
        // async: asks a judgment model on this machine, and only when the
        // vocabulary could not recommend. A goal the words cover opens no socket.
        const routed = goalFor(db, arg) as any;
        if (!arg || routed.error || routed.exact || routed.recommended) emit(routed);
        else emit({ ...routed, judged: await judgeGoal(arg, { url: value('judge') }) });
      } else {
        // A plan reads as a checklist. A sentence the vocabulary routed is
        // drawn as the plan for what it was taken to mean, said first; the
        // data, for --json and a script, is the routing as it always was.
        const routed = goalFor(db, arg) as any;
        // One task of a spec reads as a sentence the words cannot place. When
        // the checkout already carries a spec this command reads whole, name
        // it: the flag is the way in, and the sentence was never the unit.
        if (arg && !routed.exact && !routed.recommended) {
          const spec = specDirHint();
          if (spec) routed.try = `ambit goal --spec ${shellQuote(spec)}`;
        }
        const palette = terminalPalette();
        emit(routed, r => {
          if (r.exact && Array.isArray(r.order)) return renderPlan(r, palette);
          if (r.recommended) {
            const plan = planFor(db, r.recommended) as any;
            if (!plan.error) {
              const candidates: any[] = r.candidates ?? [];
              const others = candidates
                .filter((c: any) => c.id !== r.recommended)
                .map((c: any) => c.name);
              const chosen = candidates.find((c: any) => c.id === r.recommended);
              return renderPlan({ ...plan, use: chosen?.use, use_of: chosen?.use_of }, palette, {
                sentence: r.goal,
                others,
              });
            }
          }
          return formatGeneric(r, palette);
        });
      }
      break;
    }
    case 'attention':
      emit(humanDigest(db, days()));
      break;
    case 'notify':
      // async: the push is an HTTP POST and must complete before close. The
      // attention digest, or with --approvals what waits on a decision.
      emit(flags.has('--approvals') ? await notifyPending(db, arg) : await notify(db, arg));
      break;
    case 'work':
      emit(workReport(db, parseInt(arg, 10) || 20));
      break;
    case 'usage':
      // A full re-read of every agent session log, cursors set aside. What a
      // run already holds is not recorded again, so it only adds what an
      // earlier read missed.
      if (flags.has('--refresh')) emit(sessionLogReport(readSessionLogs(db, { refresh: true })));
      // The five-hour windows a subscription plan resets in, the last day's
      // unless a number of days is given.
      else if (flags.has('--windows'))
        emit(usageWindows(db, { days: parseInt(arg, 10) || 1 }), r =>
          renderWindows(r, terminalPalette())
        );
      else emit(usageReport(db, days()));
      break;
    case 'economics':
      if (arg === 'price')
        emit(
          declareModelPrice(db, {
            model: positional[1],
            input: value('input'),
            cacheRead: value('cache-read'),
            output: value('output'),
          })
        );
      else emit(economicsReport(db));
      break;
    case 'opportunities': {
      // One case, or the ranked list. The order is `--rank=`; `--by=` named it
      // before, and `--by=` names a person in every other command.
      if (arg) {
        emit(opportunityFor(db, arg));
        break;
      }
      const by = (value('rank') ?? value('by')) as any;
      const budgetFlag = [...flags].find(f => f.startsWith('--budget='));
      const budget = budgetFlag ? Number(budgetFlag.slice(9)) : undefined;
      emit(opportunitiesFor(db, by, Number.isFinite(budget as any) ? budget : undefined));
      break;
    }
    case 'roi':
      // No proposal id means the cumulative headline: what every applied
      // proposal saved, and whether the predictions held.
      emit(arg ? roiFor(db, arg) : roiSummary(db));
      break;
    case 'incidents':
      // Probe and open, or close one: `incidents resolve <svc> <outcome>`.
      if (arg === 'resolve') emit(resolveIncident(db, positional[1], positional[2]));
      else if (arg) emit({ error: 'Usage: ambit incidents [resolve <svc:key> <outcome>]' });
      // async: probing the manifest is a set of HTTP checks.
      else emit(await incidents(db));
      break;
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
      // A window by `--days=N` as everywhere else; the bare number still works.
      emit(auditFor(db, value('days') ?? arg));
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
      // With no id it crashed on the query's missing parameter, a stack trace
      // where every other verb says how it is used.
      {
        const node = arg ? named(arg) : { error: 'Usage: ambit impact <id>' };
        const answer = 'id' in node ? analyzeImpact(db, node.id) : node;
        const palette = terminalPalette();
        emit(answer, r => (r.error ? formatGeneric(r, palette) : renderImpact(r, palette)));
      }
      break;
    case 'verify':
      if (flags.has('--history')) {
        const node = arg ? named(arg) : { error: 'Usage: ambit verify <id> --history' };
        if (!('id' in node)) emit(node);
        else {
          const runs = evidenceFor(db, node.id);
          // A server's history is its capabilities': it runs no check itself.
          // Anything else with no runs, a person or a skill, has an empty one.
          const redirect = Array.isArray(runs) && !runs.length ? checksOf(db, node.id) : undefined;
          emit(redirect && 'checks' in redirect ? redirect : runs);
        }
      } else {
        const failing = flags.has('--failing');
        const node = arg && !failing ? named(arg) : undefined;
        let ran: any =
          node && !('id' in node)
            ? node
            : runVerification(db, node?.id ?? arg, value('target'), { failing });
        // A server the model holds no check for: name the checks on what it
        // provides, instead of "no capability in the model" about a word the
        // graph plainly knows. A probed service or a skill keeps its own answer.
        if (
          node &&
          'id' in node &&
          typeof ran?.error === 'string' &&
          /in the model\.$/.test(ran.error)
        ) {
          const redirect = checksOf(db, node.id);
          if ('checks' in redirect) ran = redirect;
        }
        emit(ran);
        // --exit-code lets a script gate on the checks as `git diff --exit-code`
        // lets one gate on a diff: 0 only when every check that ran passed. A
        // capability with no check to run has proved nothing, so it exits 1
        // with the flag as a failing check does. With --failing, nothing left
        // failing is the answer a script wants, so no checks to run is a 0.
        const allPassed = ran.verified === ran.checked;
        if (
          flags.has('--exit-code') &&
          !(failing ? !ran.error && allPassed : ran.checked > 0 && allPassed)
        )
          raiseExitCode(1);
      }
      break;
    case 'init': {
      // Scaffolds a declared check that is provably read-only, and prints it.
      // It never registers anything: a check is a command, and the person is
      // the one who pastes it and types verify.
      const r = checkInit(db, arg ?? '', { command: value('command') });
      emit(r);
      break;
    }
    case 'fix': {
      // A printer, not a writer: what to type for a capability that is failing
      // or not yet reached, and the acquisition options with their patches.
      const r = named(arg);
      if (!('id' in r)) {
        emit(r);
        break;
      }
      const node = db
        .prepare('SELECT id, name, state, lifecycle FROM capabilities WHERE id = ?')
        .get(r.id) as any;
      if (!node) {
        emit({ error: `No capability ${r.id} in the graph. Run ambit seed first.` });
        break;
      }
      const catalog = catalogReport(db, node.id) as any;
      // In the order `ambit goal` lists the same step's ways, the tree's own,
      // so the plan's first option is this command's first. The catalog ranks
      // by declared cost and then by name, and with no cost declared that put
      // the plan's second way first here. One the tree does not name keeps
      // the catalog's order, after those it does.
      const curated = (
        loadTechTree().nodes?.find((n: any) => `combo:${n.id}` === node.id)?.acquisition
          ?.alternatives ?? []
      ).map((a: any) => a.name);
      const rank = (o: any) => {
        const i = curated.indexOf(o.provider);
        return i === -1 ? curated.length : i;
      };
      const options = (catalog.options ?? [])
        .map((o: any, i: number) => ({ o, i }))
        .sort((a: any, b: any) => rank(a.o) - rank(b.o) || a.i - b.i)
        .map(({ o }: any) => ({ ...o, install: installText(node.id, o) }));
      const palette = terminalPalette();
      const reached = isReached(node.state);
      // Not reached is one of two things, as the map says it: a next step,
      // which nothing else stands before, or blocked, behind the steps the
      // plan orders first. The rule is `goal --spec`'s, from the same plan.
      const plan = reached ? undefined : (planFor(db, node.id) as any);
      const before = Array.isArray(plan?.order)
        ? (plan.order as { id: string; name: string }[]).filter(s => s.id !== node.id)
        : [];
      emit(
        {
          capability: node.name,
          id: node.id,
          state: node.state,
          stands: reached ? 'reached' : before.length ? 'blocked' : 'next step',
          blocked_by: before.length ? before.map(s => s.name) : undefined,
          lifecycle: node.lifecycle,
          // A check re-runs what is reached; for a next step it has nothing
          // to prove yet, and the line read as an instruction to run it.
          check: reached ? recheckCommand(node.id) : undefined,
          options,
        },
        report => renderFix(report, palette)
      );
      break;
    }
    case 'authority': {
      // Grants, then per-capability actions, then scope coverage, then the
      // thresholds that widen a grant on evidence — one verb.
      if (arg === 'scope') emit(scopeReport(db, positional[1]));
      else if (arg === 'grant') {
        if (!positional[1] || !positional[2]) {
          emit({
            error:
              'Usage: ambit authority grant <capability> <mode> [--ttl=30m] [--scope=<target>] [--by=<person>] [--action=<action>]',
          });
        } else {
          const node = named(positional[1]);
          if (!('id' in node)) emit(node);
          else
            emit(
              withGateNote(
                grantAuthority(db, {
                  capability: node.id,
                  mode: positional[2],
                  action: value('action'),
                  scope: value('scope'),
                  condition: value('condition'),
                  ttl: value('ttl'),
                  expires: value('expires'),
                  by: by(),
                  note: value('note'),
                }),
                positional[2]
              )
            );
        }
      } else if (arg === 'sandbox') {
        // Somewhere acting does not matter, so evidence can be gathered where
        // a mistake costs nothing.
        if (positional[1] === 'remove') emit(removeSandbox(db, positional[2]));
        else emit(declareSandbox(db, positional[1], by(), positional[2]));
      } else if (arg === 'promote') {
        if (!positional[1]) emit(promotionReport(db));
        else if (!('id' in named(positional[1]))) emit(named(positional[1]));
        else
          emit(
            setPromotion(db, {
              capability: (named(positional[1]) as { id: string }).id,
              action: positional[2],
              after: value('after'),
              window: value('window'),
              scope: value('scope'),
              person: by(),
            })
          );
      } else if (arg) {
        const node = named(arg);
        emit('id' in node ? actionsReport(db, node.id) : node);
      } else emit(authorityReport(db));
      break;
    }
    case 'can': {
      if (!arg) {
        emit({
          error: 'Usage: ambit can <capability> [--target=X] [--spend=<dollars>] [--exit-code]',
        });
        break;
      }
      // Dollars, read by the parser `budget set --amount` uses, so a ceiling
      // and a spend checked against it are typed in the same unit. This flag
      // used to be read as cents with Number(), and `--spend=$25` became NaN,
      // which the decision then treated as no spend at all.
      const spendGiven = value('spend') ?? (flags.has('--spend') ? '' : undefined);
      const spendCents = spendGiven === undefined ? undefined : parseAmount(spendGiven);
      if (spendGiven !== undefined && spendCents === undefined) {
        // An empty value is most often `--spend=$25` typed without quotes,
        // which the shell expanded before Ambit saw it.
        emit({
          error: spendGiven
            ? `--spend takes an amount in dollars, such as --spend=25 or --spend=0.50, and "${spendGiven}" is not one.`
            : '--spend takes an amount in dollars, such as --spend=25. A $ typed without quotes is read by the shell, so quote it or leave it off.',
        });
        break;
      }
      // A refusal is recorded as a deficit when an agent asks, and not when a
      // person does. Every refusal used to be filed, so a person trying the
      // command out, or checking a grant they had just written, counted as
      // work blocked on the capability, and that count is what ranks the next
      // step and calls a deficit structural. An agent asks before it acts, so
      // its refusal is a wall it hit; the MCP tool and the gate keep filing
      // theirs on their own paths, and a script standing in for an agent
      // passes --record. --no-record, the old way to opt out, is still read.
      const record = flags.has('--record') && !flags.has('--no-record');
      // A slip is answered as one and files nothing; see `capabilityToAsk`.
      // A word that resembles nothing goes to the gate only for an agent, for
      // whom a tool nothing supplies is a wall worth filing. A person who
      // typed it is told the graph holds no such capability, and the exit
      // code says so.
      const how = { actor: value('actor'), target: value('target'), spendCents };
      // A tool's own name (`Bash`, `mcp__github__create_issue`) is asked as
      // the gate asks about the call; see `decideCall`.
      let decision: any = decideCall(db, arg, how);
      if (!decision) {
        const asked = capabilityToAsk(db, arg);
        if ('answer' in asked) {
          emit(asked.answer);
          break;
        }
        if (!record) {
          const known = named(arg);
          if (!('id' in known)) {
            emit(known);
            break;
          }
        }
        decision = canExecute(db, { ...how, capability: asked.ask });
      }
      if (record) {
        const recorded = recordRefusal(db, decision, value('tool'));
        if (recorded !== undefined) decision.recorded_deficit = recorded;
      } else if (decision.refused === 'ungranted') {
        // The command that would answer yes next time, for the person to
        // type or not. The narrowest mode that permits: a person still asked.
        const scope = value('target') ? ` --scope=${shellQuote(value('target')!)}` : '';
        // An entry that supplies capabilities is decided through them, so a
        // grant on the entry is one no call would read. Name what the gate
        // asks instead, and the question that gets the real answer.
        const through = throughEntry(db, String(decision.capability)).filter(
          id => id !== decision.capability
        );
        if (through.length) {
          decision.gate_asks = through;
          decision.try = `ambit can ${shellQuote(through[0].replace(/^combo:/, ''))}${scope ? ` --target=${shellQuote(value('target')!)}` : ''}`;
        } else {
          decision.to_grant = `ambit authority grant ${shellQuote(String(decision.capability).replace(/^combo:/, ''))} confirm${scope}`;
        }
      }
      emit(decision);
      // --exit-code puts the decision where a shell can branch on it: 0 to go
      // ahead, 1 to ask a person first, 2 to stop.
      if (flags.has('--exit-code')) {
        raiseExitCode(decision.decision === 'ALLOW' ? 0 : decision.decision === 'CONFIRM' ? 1 : 2);
      }
      break;
    }
    case 'delegation': {
      // What the graph has recorded about grants narrowing themselves, in the
      // shared record shape. `--record` writes the account for the current
      // state; verification already calls it, so this is for asking on demand.
      if (flags.has('--record')) emit(recordDelegationState(db));
      else if (flags.has('--export')) {
        for (const record of delegationRecords(db, Number(value('limit') || 500))) {
          emitText(JSON.stringify(record));
        }
      } else if (arg === 'verify') emit(verifyChain(db));
      // A person contesting a record Ambit wrote, and the answer they are owed.
      // Neither widens authority: see recordObjection for why that is deliberate.
      else if (arg === 'object') {
        const res = recordObjection(db, {
          record: positional[1] || value('record') || '',
          by: by() || '',
          basis: value('basis') || '',
          requested:
            value('requested') === 'reversal'
              ? 'reversal'
              : value('requested') === 'narrowing'
                ? 'narrowing'
                : 'reconsideration',
          note: value('note'),
        });
        emit(!res.ok ? { error: res.reason } : res);
      } else if (arg === 'answer') {
        const res = answerObjection(db, {
          objection: positional[1] || value('objection') || '',
          disposition: flags.has('--refuse') ? 'refused' : 'upheld',
          because: value('because') || '',
          by: by() || '',
        });
        emit(!res.ok ? { error: res.reason } : res);
      } else if (arg === 'objections') emit(unansweredObjections(db));
      // Reading another system's stream. Foreign discrepancies land as evidence
      // attributed to the sender; they never move a lifecycle on their own.
      // Where foreign records arrive from, declared once instead of typed each
      // time. A full `ambit verify` reads every enabled one.
      else if (arg === 'sources') emit(delegationSources(db));
      else if (arg === 'source') {
        const action = positional[1];
        const id = positional[2] || value('id') || '';
        if (action === 'add') {
          const res = declareDelegationSource(db, {
            id,
            system: value('system') || '',
            instance: value('instance'),
            location: value('from') || '',
            by: by() || '',
          });
          emit(!res.ok ? { error: res.reason } : res);
        } else if (action === 'disable') {
          const res = setDelegationSourceEnabled(db, id, false);
          emit(!res.ok ? { error: res.reason } : res);
        } else if (action === 'enable') {
          const res = setDelegationSourceEnabled(db, id, true);
          emit(!res.ok ? { error: res.reason } : res);
        } else if (action === 'forget') {
          const res = forgetDelegationSource(db, id);
          emit(!res.ok ? { error: res.reason } : res);
        } else
          emit({
            error: 'Usage: ambit delegation source add|enable|disable|forget <id>',
          });
      } else if (arg === 'pull')
        emit(pullDelegationSources(db, path => readFileSync(path, 'utf8')));
      else if (arg === 'ingest') {
        const path = positional[1] || value('file');
        if (!path) emit({ error: 'Pass a file: ambit delegation ingest <path>' });
        else emit(ingestForeignRecords(db, readFileSync(path, 'utf8')));
      } else
        emit({
          ...delegationManifest(db),
          recent: delegationRecords(db, Number(value('limit') || 10)).map(r => ({
            record_id: r.record_id,
            kind: r.kind,
            subject: r.subject,
            summary: r.summary,
            recorded_at: r.time.recorded_at,
          })),
        });
      break;
    }
    case 'history':
      if (arg === 'since') {
        const [when, until] = typedTimestamps(positional.slice(1));
        emit(ledgerSince(db, when, until));
      } else emit(ledgerHistory(db));
      break;
    case 'propose': {
      // --by says who is drafting, as it says who declared a grant. A terminal
      // could be a person or an agent's shell, so without it nothing is
      // recorded and the page draws the request with no asker.
      const drafted = propose(
        db,
        arg,
        Number(positional[1]) || undefined,
        value('by'),
        value('for')
      );
      // --dispatch pushes the draft out of band in the same breath, so an
      // unattended loop's request reaches the person without a second verb.
      if (drafted?.proposal && (flags.has('--dispatch') || value('dispatch'))) {
        emit({
          ...drafted,
          dispatch: await dispatchProposal(db, drafted.proposal, { to: value('dispatch') }),
        });
      } else emit(drafted);
      break;
    }
    case 'dispatch': {
      // async: the push is an HTTP POST and must complete before close.
      const isPending = !arg || arg === 'pending' || flags.has('--pending') || arg === 'all';
      if (isPending) {
        emit(await dispatchPending(db, { to: value('to') }));
      } else {
        emit(await dispatchProposal(db, arg, { to: value('to') }));
      }
      break;
    }
    case 'proposals':
      // One in full, what exists, or what is actually waiting on a decision.
      if (arg) emit(showProposal(db, arg));
      else emit(flags.has('--pending') ? pendingProposals(db) : listProposals(db));
      break;
    case 'people':
      // Declaring is not granting: a name the trail can carry, nothing more.
      emit(arg === 'add' ? addPerson(db, positional[1], positional[2]) : listPeople(db));
      break;
    case 'approve': {
      // Every positional is a proposal, unless the last names a person, which
      // is how the person used to be given; `--by` is how every other decision
      // takes one, and with neither it is the one person the graph knows.
      // Approving a week's drafts in one sitting is the difference between an
      // environment that grows and a backlog nobody opens.
      // A trailing word that is not a proposal id is the person, known or not:
      // a mistyped name must be refused as one, never read as a second id and
      // approved under the default person.
      const last = positional[positional.length - 1];
      const trailing = !value('by') && positional.length > 1 && !/^prop-/.test(last ?? '');
      const ids = trailing ? positional.slice(0, -1) : positional;
      const person = trailing ? positional[positional.length - 1] : by();
      if (!person) {
        emit({ error: whoDecides(db, 'ambit approve <id> [<id>…] --by=<person>') });
        break;
      }
      const approved: any =
        ids.length > 1 ? approveProposals(db, ids, person) : approveProposal(db, arg, person);
      // --dispatch sends the signed artifact where the person is, so what
      // they read on a phone is what apply will verify here.
      if (flags.has('--dispatch') || value('dispatch')) {
        const to = value('dispatch');
        // Only what was actually approved goes out; a refused approval has
        // nothing signed to send.
        const wins: string[] =
          ids.length > 1
            ? (approved.results || []).filter((r: any) => !r.error).map((r: any) => r.id)
            : approved.error
              ? []
              : [arg];
        const pushed: Record<string, any> = {};
        for (const id of wins) pushed[id] = await dispatchProposal(db, id, { to });
        emit({ ...approved, dispatch: ids.length > 1 ? pushed : pushed[arg] });
      } else emit(approved);
      break;
    }
    case 'reject': {
      // `reject <id> --by=<person> ["why"]`, or the older `reject <id> <person> ["why"]`.
      // One word is the person, as it always was; a reason has spaces in it.
      // A misspelt name is refused, never filed as the reason under someone else.
      const word = positional[1];
      const trailing = !value('by') && Boolean(word) && !/\s/.test(word as string);
      const person = trailing ? word : by();
      if (!person) {
        emit({ error: whoDecides(db, 'ambit reject <id> --by=<person> ["why"]') });
        break;
      }
      emit(rejectProposal(db, arg, person, trailing ? positional[2] : positional[1]));
      break;
    }
    case 'apply':
      emit(applyProposal(db, arg, { to: value('to'), print: flags.has('--print') }), r =>
        renderApply(r, terminalPalette())
      );
      break;
    // What each tool server's listing costs in context. Weighing starts the
    // servers the configs declare, so it runs only when typed; --recorded
    // reads the last weighing and starts nothing.
    case 'weigh': {
      const palette = terminalPalette();
      const seconds = Number(value('timeout'));
      const report = flags.has('--recorded')
        ? carryReport(db)
        : await weigh(db, {
            only: arg,
            timeoutSeconds: seconds > 0 ? seconds : undefined,
          });
      emit(report, r => (r.error ? formatGeneric(r, palette) : renderCarry(r, palette)));
      break;
    }
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
            // Which runtime wrote the skill. `--by` named it before, and names
            // a person everywhere else.
            runtime: value('runtime') ?? value('by'),
            description: value('description'),
          })
        );
      else emit(recordFailure(db, arg, positional[1], positional[2]));
      break;
    }
    case 'seed': {
      runSeed(db, mappingOverride, flags.has('--json'));
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
    case 'gate': {
      runGate(db, flags);
      break;
    }
    case 'doctor': {
      const palette = terminalPalette();
      emit(runDoctor(db), r => renderDoctor(r, palette));
      break;
    }
    case 'connect': {
      const dryRun = flags.has('--dry-run');
      const force = flags.has('--force');
      const result = runConnect(arg, {
        dryRun,
        force,
        ledger: flags.has('--ledger'),
        statusline: flags.has('--statusline'),
        gate: flags.has('--gate'),
      });
      // Read after the write, so what this run added is no longer listed. A dry
      // run wrote nothing, and would list what it just offered to add.
      const missing = dryRun ? [] : setupGaps();
      emit({ ...result, ...(missing.length ? { still_missing: missing } : {}) }, r =>
        renderConnect(r, terminalPalette(), typedCommand)
      );
      break;
    }
    case 'port': {
      const palette = terminalPalette();
      if (!arg) {
        emit(listPortStatus(), r => renderPort(r, palette));
      } else {
        const to = value('to');
        const from = value('from');
        const dryRun = flags.has('--dry-run');
        emit(portServer(arg, { to, from, dryRun }), r => renderPort(r, palette));
      }
      break;
    }
    case 'toggle': {
      const palette = terminalPalette();
      const off = flags.has('--off');
      const on = flags.has('--on');
      const to = value('to') || value('runtime');
      const dryRun = flags.has('--dry-run');
      emit(toggleServer(arg, { off, on, to, dryRun }), r => renderToggle(r, palette));
      break;
    }
    case 'repo': {
      const palette = terminalPalette();
      const dir = arg || process.cwd();
      emit(analyzeRepo(dir), r => renderRepo(r, palette));
      break;
    }
    case 'init-rules': {
      const dryRun = flags.has('--dry-run');
      const target = value('target') || arg;
      emit(runInitRules(target, { dryRun }));
      break;
    }
    case 'receipt': {
      const hours = Number(arg) || 1;
      emit(runReceipt(db, hours));
      break;
    }
    case 'check':
    case 'ci': {
      // `ambit check` alone lists its group, as every other group does; it ran
      // the doctor, under a name that also meant the CI check.
      if (cmd === 'check' && !flags.has('--ci')) {
        emitText(groupHelp('check'));
        break;
      }
      {
        const strict = flags.has('--strict');
        const writeStepSummary =
          flags.has('--markdown') || flags.has('--ci') || Boolean(process.env.GITHUB_STEP_SUMMARY);
        const res = runCiCheck(db, { strict, writeStepSummary });
        if (flags.has('--markdown')) {
          emitText(res.markdown);
        } else {
          emit(res);
        }
        if (!res.ok) {
          process.exitCode = res.exit_code;
        }
      }
      break;
    }
    case 'judge': {
      const sub = arg;
      const options: WorkflowOptions & { live?: boolean } = {
        provider: value('provider') as any,
        url: value('url'),
        model: value('model'),
        accountId: value('account') ?? value('account-id'),
        token: value('token'),
        threshold: value('threshold') !== undefined ? Number(value('threshold')) : undefined,
        record: flags.has('--record'),
        multi: flags.has('--multi'),
        live: flags.has('--live'),
      };
      switch (sub) {
        case 'goal': {
          const text = positional.slice(1).join(' ').trim();
          if (!text) {
            emit({ error: 'Supply a goal or task sentence.' });
            break;
          }
          emit(await judgeTasks(db, [{ id: 'goal', text }], options));
          break;
        }
        case 'evaluate': {
          let cases = SMOKE_CASES;
          const filePath = positional[1] || value('file');
          if (filePath) {
            try {
              cases = JSON.parse(readFileSync(filePath, 'utf8'));
            } catch {
              emit({ error: `Cannot read evaluation cases file: ${filePath}` });
              break;
            }
          }
          emit(await evaluateGoals(db, cases, options));
          break;
        }
        case 'history': {
          const limit = value('limit') !== undefined ? Number(value('limit')) : undefined;
          emit({ decisions: decisionHistory(db, limit) });
          break;
        }
        case 'review': {
          const id = positional[1];
          const disposition = positional[2] as 'accepted' | 'rejected';
          const note = value('note') || positional[3];
          if (!id || !disposition) {
            emit({ error: 'Usage: ambit judge review <decision-id> <accepted|rejected>' });
            break;
          }
          emit(reviewDecision(db, id, disposition, note));
          break;
        }
        case 'plan': {
          const id = positional[1];
          if (!id) {
            emit({ error: 'Usage: ambit judge plan <decision-id>' });
            break;
          }
          emit(planDecision(db, id));
          break;
        }
        case 'attention': {
          const filePath = positional[1] || value('file');
          if (!filePath) {
            emit({ error: 'Pass an attention entries JSON file: ambit judge attention <file>' });
            break;
          }
          let entries: unknown;
          try {
            entries = JSON.parse(readFileSync(filePath, 'utf8'));
          } catch {
            emit({ error: `Cannot read attention file: ${filePath}` });
            break;
          }
          emit(await judgeAttention(db, entries as any, options));
          break;
        }
        case 'tools': {
          const filePath = positional[1] || value('file');
          if (!filePath) {
            emit({ error: 'Pass a tools JSON file: ambit judge tools <file>' });
            break;
          }
          let tools: unknown;
          try {
            tools = JSON.parse(readFileSync(filePath, 'utf8'));
          } catch {
            emit({ error: `Cannot read tools file: ${filePath}` });
            break;
          }
          emit(await judgeTools(db, tools as any, options));
          break;
        }
        case 'failures': {
          const filePath = positional[1] || value('file');
          if (!filePath) {
            emit({ error: 'Pass a failures JSON file: ambit judge failures <file>' });
            break;
          }
          let failures: unknown;
          try {
            failures = JSON.parse(readFileSync(filePath, 'utf8'));
          } catch {
            emit({ error: `Cannot read failures file: ${filePath}` });
            break;
          }
          emit(await judgeFailures(db, failures as any, options));
          break;
        }
        case 'next': {
          const goal = positional.slice(1).join(' ').trim();
          if (!goal) {
            emit({ error: 'Usage: ambit judge next <goal>' });
            break;
          }
          emit(await judgeNext(db, goal, options));
          break;
        }
        case 'media': {
          const filePath = positional[1] || value('file');
          if (!filePath) {
            emit({ error: 'Pass a media request JSON file: ambit judge media <file>' });
            break;
          }
          let request: unknown;
          try {
            request = JSON.parse(readFileSync(filePath, 'utf8'));
          } catch {
            emit({ error: `Cannot read media request file: ${filePath}` });
            break;
          }
          emit(await askDecision(request as any, options));
          break;
        }
        default:
          emit({
            error:
              'Usage: ambit judge goal|evaluate|history|review|plan|attention|tools|failures|next|media',
          });
          break;
      }
      break;
    }
    default: {
      // A group named with no verb after it lists what it owns, which is what
      // `ambit help` tells the reader to try. `graph` and `check` are commands
      // of their own and never reach here.
      if (cmd in GROUPS) {
        emitText(groupHelp(cmd));
        break;
      }
      // On stderr, so a caller reading stdout for an answer is not handed this
      // as one, and exiting 2, the code a usage error conventionally gets, so a
      // script can tell a mistyped verb from a command that ran and failed.
      // A typo names what it was probably meant to be, instead of sending the
      // reader to a list of forty commands to find it themselves. A graph
      // view is in the graph's index, which says each runs as `ambit <verb>`,
      // so `ambit surface` is sent to the one place it runs.
      const paint = terminalPalette(process.stderr);
      const meant = GRAPH_VIEWS.includes(cmd) ? [`graph ${cmd}`] : nearest(cmd, commandWords(), 2);
      const hint = meant.length
        ? `Did you mean ${meant.map(m => `ambit ${m}`).join(' or ')}?`
        : 'Try: ambit help';
      console.error(`${paint.red}Unknown command: ${cmd}. ${hint}${paint.reset}`);
      raiseExitCode(2);
    }
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
const VALUE_FLAGS = new Set([
  'target',
  'by',
  'scope',
  'amount',
  'period',
  'limit',
  'to',
  'from',
  'file',
  'system',
  'instance',
  'basis',
  'requested',
  'because',
  'objection',
  'timeout',
  'provider',
  'model',
  'account',
  'account-id',
  'token',
  'note',
  'verify',
  'provides',
  'runtime',
  'description',
  'url',
  'condition',
  'ttl',
  'expires',
  'actor',
  'tool',
  'command',
  'name',
  'threshold',
]);

/**
 * Normalises CLI arguments into positional arguments and flags.
 *
 * Known value flags take either `--key=value` or `--key value`. A known value
 * flag that arrives without a value is refused rather than silently dropping
 * its value into positional arguments.
 */
function parseArgv(argv: string[]): { positional: string[]; flags: Set<string>; error?: string } {
  const positional: string[] = [];
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const flagName = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (VALUE_FLAGS.has(flagName)) {
        if (eq >= 0) {
          flags.add(arg);
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          flags.add(`--${flagName}=${argv[++i]}`);
        } else {
          return {
            positional,
            flags,
            error: `Flag --${flagName} requires a value (e.g. --${flagName}=<value>)`,
          };
        }
      } else {
        flags.add(arg);
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function begin(db: Db, argv: string[], mappingOverride?: string) {
  const resolved = resolveCommand(argv[0], argv.slice(1));
  if (!resolved.cmd) throw new Error('capture needs a command');

  const state = { value: undefined as unknown, calls: 0 };
  const previous = setSink(data => {
    state.value = data;
    state.calls++;
  });
  const parsed = parseArgv(resolved.argv);
  if (parsed.error) {
    emit({ error: parsed.error });
    return { state, done: Promise.resolve(), restore: () => void setSink(previous) };
  }
  const done = runCommand(db, resolved.cmd, parsed.positional, parsed.flags, mappingOverride);
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
 * `notify`, `dispatch` and `incidents` reach the network, `weigh`
 * waits on the tool servers it starts (and
 * `propose`/`approve` do when asked to `--dispatch`, and `goal` asks a local
 * judgment model when given `--judge`), but every other case
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

/** The same seam for the commands that reach the network. */
async function captureAsync(db: Db, argv: string[], mappingOverride?: string): Promise<any> {
  const { state, done, restore } = begin(db, argv, mappingOverride);
  try {
    await done;
  } finally {
    restore();
  }
  return result(argv, state);
}

/**
 * `ambit gate`, a Claude Code PreToolUse hook's command. With no call on stdin
 * (a terminal), it prints the settings entry to paste. With one, it prints the
 * decision or nothing at all, and always exits 0: a gate that cannot read the
 * call, or the graph, says nothing, so the runtime's own permissions decide and
 * a broken gate never stops someone's work. Null is a graph that would not
 * open, which still has a snippet to print and never has an answer.
 */
function runGate(db: Db | null, flags: Set<string>): void {
  if (process.stdin.isTTY || flags.has('--snippet')) {
    emit({
      snippet: claudeHookSnippet(),
      note: "Merge this into ~/.claude/settings.json, or a project's .claude/settings.json, to put Ambit's gate on every tool call. It can deny what is forbidden and ask about what asks first or has no grant; it never allows anything Claude Code would otherwise ask about.",
    });
    return;
  }
  if (!db) return;
  let out = '';
  try {
    const call = JSON.parse(readFileSync(0, 'utf8') || '{}');
    out = claudeHookOutput(gateToolCall(db, call));
  } catch {
    out = '';
  }
  if (out) process.stdout.write(`${out}\n`);
}

async function main() {
  // Help reads no graph, so it is answered before one is opened: it used to
  // wait on the spools and the session logs before printing a word, and on a
  // fresh machine opening the graph created it. `--help` after a command asks
  // about that command: `ambit verify --help` ran every declared check, and
  // `ambit approve <id> --help` approved, because the flag every other tool
  // reads as "say what this does" was one more flag the command ignored.
  const typed = process.argv.slice(2);
  if (!typed[0] || typed[0] === 'help' || typed.some(isHelpFlag)) {
    const words = (typed[0] === 'help' ? typed.slice(1) : typed).filter(a => !a.startsWith('-'));
    if (!words.length && typed.includes('--all')) console.log(HELP);
    else help(words);
    return;
  }
  const resolved = resolveCommand(typed[0], typed.slice(1));
  const cmd = resolved.cmd ?? typed[0];
  // The gate runs inside someone else's tool call, so it is answered before
  // the graph is opened for anything else. A graph it cannot open printed a
  // stack trace and exited 1, and an empty one was seeded on the spot, with
  // the seed's report on the stdout the hook reads. Neither is an answer: it
  // says nothing and exits 0, and the runtime's own settings decide.
  // The status line runs after every message, in Claude Code's interface. It
  // opens the graph read-only and nothing else: no migration, no seed, no
  // spool. cli.js answers it without starting this file; this is the same
  // answer for `node engine.ts statusline` and `ambit report statusline`.
  if (cmd === 'statusline') {
    const line = statusLine(resolved.argv);
    if (line) process.stdout.write(`${line}\n`);
    return;
  }
  if (cmd === 'gate') {
    const flags = new Set(resolved.argv.filter(a => a.startsWith('--')));
    let db: Db | null = null;
    try {
      db = getDb();
      migrate(db);
    } catch {
      db = null;
    }
    try {
      runGate(db, flags);
    } finally {
      try {
        db?.close();
      } catch {}
    }
    return;
  }
  const db = getDb();
  migrate(db);
  // Flags are not arguments. Taking argv[3] blindly meant `tt verify --json`
  // looked for a capability named "--json", which every flag-taking command
  // silently inherited.
  const parsed = parseArgv(resolved.argv);
  if (parsed.error) {
    emit({ error: parsed.error });
    db.close();
    return;
  }
  const { positional, flags } = parsed;
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
  const ledgerCommands = new Set([
    'work',
    'usage',
    'portfolio',
    'incidents',
    'incident',
    'connect',
    'init-rules',
    'rules',
  ]);
  if (cmd && !ledgerCommands.has(cmd) && cmd !== 'seed' && cmd !== 'where') {
    const seeded = db.prepare('SELECT COUNT(*) AS n FROM capabilities').get();
    if (!seeded?.n) {
      // Seed rather than instruct. A fresh Homebrew install
      // install both land here, and "go run another command first" is the
      // wrong first impression for a tool whose pitch is "one command, your
      // map". Seeding only reads config files and writes the local graph, so
      // doing it unasked is safe; --json runs stay silent-but-seeded so
      // scripts get their answer instead of a lecture.
      const json = flags.has('--json');
      if (!json) {
        const paint = terminalPalette();
        console.log(
          `${paint.grey}First run: reading the agent configs on this machine${paint.reset}`
        );
      }
      runSeed(db, mappingOverride, json);
      if (!json) console.log('');
    }
  }
  // What Claude Code sessions and Cursor conversations did, and what
  // OpenCode's tracker saw change in its config, since the last command,
  // read in first so every report sees it. Not on `gate`, which runs before
  // every tool call and must stay quick; a failed read never stops a command.
  if (cmd !== 'gate') {
    try {
      ingestSpool(db);
    } catch {
      /* the spool waits for the next command */
    }
    try {
      ingestTrackerSpool(db);
    } catch {
      /* likewise */
    }
    // The tokens Codex, OpenCode and Amp sessions used, from their own logs:
    // what changed since the last read, for at most a second and a half, so a
    // first read of a long history spreads over a few commands. `seed` reads it
    // all, and `usage --refresh` reads it all again from the top.
    const refresh = cmd === 'usage' && flags.has('--refresh');
    if (!refresh) {
      try {
        readSessionLogs(db, { budgetMs: cmd === 'seed' ? undefined : SESSION_LOG_BUDGET_MS });
      } catch {
        /* the logs wait for the next command */
      }
    }
  }
  await runCommand(db, cmd, positional, flags, mappingOverride);
  db.close();
}

/** `--help`, or `-h`, anywhere after a command. */
function isHelpFlag(word: string): boolean {
  return word === '--help' || word === '-h';
}

/** The error when no one can be taken to decide: who could, or how to become one. */
function whoDecides(db: Db, usage: string): string {
  const people = db
    .prepare(
      "SELECT id FROM capabilities WHERE category = 'human' AND id != 'human:web' ORDER BY id"
    )
    .all<{ id: string }>()
    .map(p => p.id.replace(/^human:/, ''));
  return people.length
    ? `Name the person deciding: ${usage}, one of ${people.join(', ')}.`
    : `No person is declared to decide. ambit people add <id> declares you; then ${usage}.`;
}

/**
 * What `ambit verify <server>` means: a server declares no check of its own,
 * and the checks that prove it are the ones on what it provides. Said, with
 * the command for each, instead of "no capability in the model".
 */
function checksOf(db: Db, id: string) {
  const provides = db
    .prepare(
      `SELECT c.id, c.name FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
       WHERE d.from_capability = ? AND d.kind IN ('provides', 'contributes') AND c.id LIKE 'combo:%'
       ORDER BY c.name`
    )
    .all<{ id: string; name: string }>(id);
  const name =
    db.prepare('SELECT name FROM capabilities WHERE id = ?').get<{ name: string }>(id)?.name ?? id;
  if (!provides.length) {
    return { error: `${name} declares no check, and provides nothing on the map that does.` };
  }
  return {
    error: `${name} declares no check of its own. What it provides does:`,
    checks: provides.map(p => ({
      capability: p.name,
      command: `ambit verify ${shellQuote(p.id.replace(/^combo:/, ''))}`,
    })),
  };
}

export { emit, main, capture, captureAsync, runCommand };
