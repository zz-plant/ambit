import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
} from './cli/output.ts';
import { HELP, HELP_SHORT, groupHelp } from './cli/help.ts';
import {
  briefReport,
  explain,
  renderBrief,
  renderImpact,
  renderPlan,
  renderStatus,
  statusReport,
} from './cli/reports.ts';
import { runSeed } from './cli/seed.ts';
import { GROUPS, resolveCommand } from './cli/groups.ts';
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
import { briefing, briefingText } from './briefing.ts';
import { nextSteps } from './next.ts';
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
import { judgeGoal } from './judge.ts';
import { humanDigest, notify, notifyPending } from './attention.ts';
import { dispatchProposal, dispatchPending } from './dispatch.ts';
import { workReport, usageReport, unmappedUse } from './telemetry.ts';
import { capacityReport } from './capacity.ts';
import { declareModelPrice, economicsReport } from './economics.ts';
import { opportunitiesFor, opportunityFor } from './opportunities.ts';
import { roiFor, roiSummary } from './roi.ts';
import { exportSummary, importSummary } from './federation.ts';
import { portfolio } from './portfolio.ts';
import { incidents, resolveIncident } from './incident.ts';
import { catalogReport } from './catalog.ts';
import { auditFor } from './audit.ts';
import {
  addPerson,
  listPeople,
  approveProposal,
  approveProposals,
  rejectProposal,
  listProposals,
  pendingProposals,
  showProposal,
  applyProposal,
  rollbackProposal,
} from './governance.ts';
import { runDoctor } from './doctor.ts';
import { claudeHookOutput, claudeHookSnippet, gateToolCall } from './gate.ts';
import { runConnect } from './connect.ts';
import { runInitRules } from './init-rules.ts';
import { runReceipt } from './receipt.ts';
import { runCiCheck } from './ci-check.ts';

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
      if (flags.has('--json')) emit(briefing(db, { mark: !flags.has('--peek') }));
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
      // Drawn by its own renderer for a person; the sink and --json get the data.
      // `--brief` is what bare `ambit` shows: the next steps first, the rest here.
      if (flags.has('--brief'))
        emit(briefReport(db), report => renderBrief(report, terminalPalette()));
      else emit(statusReport(db), report => renderStatus(report, terminalPalette()));
      break;
    case 'graph': {
      // The graph is one thing with several views; none of them is a headline.
      if (arg === 'surface') emitRaw(surfaceFor(db));
      else if (arg === 'combos') emit(discoverCombos(db));
      else if (arg === 'affordances') emit(affordanceDomains(db));
      else if (arg === 'capacity') emit(capacityReport());
      else if (arg === 'unmapped') emit(unmappedUse(db, Number(value('days')) || 30));
      else emitRaw(exportGraph(db), false);
      break;
    }
    case 'goal': {
      // One entry for the gap-to-capability question, with the folds as flags:
      // paths, simulation and preferences are views of the same decision.
      if (flags.has('--prefs')) emit(preferencesReport(db, arg));
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
        const palette = terminalPalette();
        emit(routed, r => {
          if (r.exact && Array.isArray(r.order)) return renderPlan(r, palette);
          if (r.recommended) {
            const plan = planFor(db, r.recommended) as any;
            if (!plan.error) {
              const others = (r.candidates ?? [])
                .filter((c: any) => c.id !== r.recommended)
                .map((c: any) => c.name);
              return renderPlan(plan, palette, { sentence: r.goal, others });
            }
          }
          return formatGeneric(r, palette);
        });
      }
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
      // With no id it crashed on the query's missing parameter, a stack trace
      // where every other verb says how it is used.
      {
        const answer = arg ? analyzeImpact(db, arg) : { error: 'Usage: ambit impact <id>' };
        const palette = terminalPalette();
        emit(answer, r => (r.error ? formatGeneric(r, palette) : renderImpact(r, palette)));
      }
      break;
    case 'verify':
      if (flags.has('--history')) {
        emit(
          arg
            ? evidenceFor(db, arg.includes(':') ? arg : `combo:${arg}`)
            : { error: 'Usage: ambit verify <id> --history' }
        );
      } else {
        const failing = flags.has('--failing');
        const ran: any = runVerification(db, arg, value('target'), { failing });
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
          emit(
            grantAuthority(db, {
              capability: positional[1],
              mode: positional[2],
              action: value('action'),
              scope: value('scope'),
              ttl: value('ttl'),
              expires: value('expires'),
              by: value('by'),
              note: value('note'),
            })
          );
        }
      } else if (arg === 'sandbox') {
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
      // A slip is answered as one and files nothing; see `capabilityToAsk`.
      const asked = capabilityToAsk(db, arg);
      if ('answer' in asked) {
        emit(asked.answer);
        break;
      }
      const decision: any = canExecute(db, {
        actor: value('actor'),
        capability: asked.ask,
        target: value('target'),
        spendCents,
      });
      // A refusal is a deficit whoever asked. This surface used to be the
      // silent one, which meant the same question had different consequences
      // depending on where it was asked.
      if (!flags.has('--no-record')) {
        const recorded = recordRefusal(db, decision, value('tool'));
        if (recorded !== undefined) decision.recorded_deficit = recorded;
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
      else if (arg === 'object')
        emit(
          recordObjection(db, {
            record: positional[1] || value('record') || '',
            by: value('by') || '',
            basis: value('basis') || '',
            requested:
              value('requested') === 'reversal'
                ? 'reversal'
                : value('requested') === 'narrowing'
                  ? 'narrowing'
                  : 'reconsideration',
            note: value('note'),
          })
        );
      else if (arg === 'answer')
        emit(
          answerObjection(db, {
            objection: positional[1] || value('objection') || '',
            disposition: flags.has('--refuse') ? 'refused' : 'upheld',
            because: value('because') || '',
            by: value('by') || '',
          })
        );
      else if (arg === 'objections') emit(unansweredObjections(db));
      // Reading another system's stream. Foreign discrepancies land as evidence
      // attributed to the sender; they never move a lifecycle on their own.
      // Where foreign records arrive from, declared once instead of typed each
      // time. A full `ambit verify` reads every enabled one.
      else if (arg === 'sources') emit(delegationSources(db));
      else if (arg === 'source') {
        const action = positional[1];
        const id = positional[2] || value('id') || '';
        if (action === 'add')
          emit(
            declareDelegationSource(db, {
              id,
              system: value('system') || '',
              instance: value('instance'),
              location: value('from') || '',
              by: value('by') || '',
            })
          );
        else if (action === 'disable') emit(setDelegationSourceEnabled(db, id, false));
        else if (action === 'enable') emit(setDelegationSourceEnabled(db, id, true));
        else if (action === 'forget') emit(forgetDelegationSource(db, id));
        else
          emit({
            ok: false,
            reason: 'ambit delegation source add|enable|disable|forget <id>',
          });
      } else if (arg === 'pull')
        emit(pullDelegationSources(db, path => readFileSync(path, 'utf8')));
      else if (arg === 'ingest') {
        const path = positional[1] || value('file');
        if (!path) emit({ ok: false, reason: 'pass a file: ambit delegation ingest <path>' });
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
      // What exists, or what is actually waiting on a decision.
      emit(flags.has('--pending') ? pendingProposals(db) : listProposals(db));
      break;
    case 'proposal':
      emit(showProposal(db, arg));
      break;
    case 'people':
      // Declaring is not granting: a name the trail can carry, nothing more.
      emit(arg === 'add' ? addPerson(db, positional[1], positional[2]) : listPeople(db));
      break;
    case 'approve': {
      // The last positional is the person; everything before it is a proposal.
      // Approving a week's drafts in one sitting is the difference between an
      // environment that grows and a backlog nobody opens.
      const ids = positional.slice(0, -1);
      const person = positional[positional.length - 1];
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
      emit(runDoctor(db));
      break;
    }
    case 'connect': {
      const dryRun = flags.has('--dry-run');
      const force = flags.has('--force');
      emit(runConnect(arg, { dryRun, force, ledger: flags.has('--ledger') }));
      break;
    }
    case 'init-rules':
    case 'rules': {
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
      if (flags.has('--ci') || cmd === 'ci' || arg === 'ci') {
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
      } else {
        emit(runDoctor(db));
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
      const paint = terminalPalette(process.stderr);
      console.error(`${paint.red}Unknown command: ${cmd}. Try: ambit help${paint.reset}`);
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
 * `notify-approvals`, `dispatch` and `incidents` reach the network (and
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
  const resolved = resolveCommand(process.argv[2], process.argv.slice(3));
  const cmd = resolved.cmd;
  // The gate runs inside someone else's tool call, so it is answered before
  // the graph is opened for anything else. A graph it cannot open printed a
  // stack trace and exited 1, and an empty one was seeded on the spot, with
  // the seed's report on the stdout the hook reads. Neither is an answer: it
  // says nothing and exits 0, and the runtime's own settings decide.
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
  if (cmd && !ledgerCommands.has(cmd) && cmd !== 'seed' && cmd !== 'where' && cmd !== 'help') {
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
