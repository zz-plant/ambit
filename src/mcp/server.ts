#!/usr/bin/env node --experimental-sqlite
import { readFileSync } from 'node:fs';
import { resolveDbPath } from '../shared/db-path.ts';
import { err, respond, toolResult } from './protocol.ts';
import { TOOLS } from './tools.ts';
import type { Db } from '../engine/db.ts';
import {
  getDb,
  migrate,
  computeDecay,
  discoverCombos,
  sessionDiff,
  domainHealth,
  findBottlenecks,
  analyzeImpact,
  nearMissCombos,
  runVerification,
  evidenceFor,
  authorityReport,
  actionsReport,
  planFor,
  ledgerSince,
  ledgerHistory,
  recordFailure,
  deficits,
  singlePointsOfFailure,
  credentialReport,
  simulateFrontier,
  propose,
  listProposals,
  showProposal,
  goalFor,
  pathsFor,
  preferencesReport,
  scopeReport,
  affordanceDomains,
  humanDigest,
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
  workReport,
  usageReport,
  economicsReport,
  goalValue,
  opportunitiesFor,
  opportunityFor,
  canExecute,
  roiFor,
  roiSummary,
  catalogReport,
  auditFor,
  incidents,
  resolveIncident,
  portfolio,
  briefing,
  briefingText,
  nextSteps,
  captureFailure,
  recordRefusal,
  signalReport,
  registerSkill,
  registeredSkills,
  promotionReport,
  objectReport,
  budgetReport,
  reversibilityReport,
  observedReport,
  pendingProposals,
} from '../engine/engine.ts';
import { REACHED_SQL, graphCounts, notSeeded } from '../engine/vocabulary.ts';

const DB_PATH = resolveDbPath();
const VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

/**
 * An unseeded graph answers every question with zeroes, which an agent reads
 * as "this environment has no capabilities" rather than "this tool was never
 * set up" — the exact confusion Ambit exists to remove. Say which it is.
 */
function emptyGraphNotice(db: Db): string | null {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM capabilities').get();
  if (seeded?.n) return null;
  const n = notSeeded('Run `ambit seed` in a shell, then ask again.');
  return `${n.meaning} ${n.fix} (graph: ${DB_PATH})`;
}

let dbHandle: any = null;
function getWarmDb() {
  if (!dbHandle) {
    dbHandle = getDb(DB_PATH);
    migrate(dbHandle);
  }
  return dbHandle;
}

function tt<T>(cb: (db: Db) => T): T {
  const db = getWarmDb();
  return cb(db);
}

process.on('exit', () => {
  if (dbHandle) {
    try {
      dbHandle.close();
    } catch {}
    dbHandle = null;
  }
});

const BRIEFING_URI = 'ambit://briefing';

/**
 * What this server offers to be read rather than called.
 *
 * One resource, deliberately. A briefing that competes with four other
 * documents for the top of a context window is a briefing nobody reads.
 */
const RESOURCES = [
  {
    uri: BRIEFING_URI,
    name: 'Environment briefing',
    description:
      'What this environment can do, what is configured but failing, what is waiting on a person, what blocked work recently, and what is worth reaching next. Read it before reporting what this system can do.',
    mimeType: 'text/plain',
  },
];

let buf = '';
// Each line is handled in its own function because the body returns to reply.
// Inlined in the loop, that `return` exited the whole stdin handler, so only
// the first message in a chunk was ever answered — and a client that batches
// initialize with tools/list, or whose requests simply arrive coalesced, would
// hang waiting for a response that was never going to come.
function handleLine(line: string) {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const { id, method, params } = msg;
    switch (method) {
      // The server used to introduce itself as "tech-tree" at version 1.0.0,
      // which is neither the name of the product nor its version — an agent
      // that connected had no way to tell what it was talking to.
      case 'initialize':
        return respond(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'ambit', version: VERSION },
        });
      case 'tools/list':
        return respond(id, { tools: TOOLS });
      // Resources are what a runtime reads on connect, without being asked to.
      // A tool an agent has to think of calling is no use to the agent that
      // does not know Ambit is there, which is exactly the one that most needs
      // to know what is broken before it starts. See docs/roadmap.md §12.1.
      case 'resources/list':
        return respond(id, { resources: RESOURCES });
      case 'resources/read': {
        const uri = params?.uri;
        if (uri !== BRIEFING_URI) return err(id, -32602, `Unknown resource: ${uri}`);
        return respond(id, {
          contents: [
            {
              uri: BRIEFING_URI,
              mimeType: 'text/plain',
              // Reading the briefing is what moves the "since last briefing"
              // mark: the next session should be told what changed since this
              // one was told, not since someone last ran a command.
              text: tt(db => briefingText(db, { mark: true })),
            },
          ],
        });
      }
      case 'tools/call': {
        const { name, arguments: args } = params;
        try {
          let res: unknown;
          // Dispatch is keyed on the legacy prefix, and accepts either: the
          // advertised `ambit_*` name and the unadvertised `tt_*` alias reach
          // the same case.
          const normalizedName = name.startsWith('ambit_') ? name.replace(/^ambit_/, 'tt_') : name;
          const capId = args?.capId || args?.capabilityId || args?.capability;
          switch (normalizedName) {
            case 'tt_stats':
              res = tt(db => {
                const c = graphCounts(db);
                return {
                  stats: {
                    total: c.total,
                    unlocked: c.reached,
                    verified: c.proven,
                    failing: c.failing,
                  },
                  domains: db
                    .prepare(
                      `SELECT domain, COUNT(*) as total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) as unlocked
                       FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain`
                    )
                    .all(),
                };
              });
              break;
            // The session context block, which is what the briefing is. This
            // used to be a second, weaker summary computed from its own copy of
            // the stats query; keeping two answers to "what is this
            // environment" only guaranteed they would disagree.
            case 'tt_context':
              res = { text: tt(db => briefingText(db, { mark: true })) };
              break;
            case 'tt_cap':
              res = tt(db =>
                db
                  .prepare(
                    'SELECT id, name, domain, maturity_score, state, category FROM capabilities WHERE domain = ? OR name LIKE ? ORDER BY maturity_score DESC LIMIT 20'
                  )
                  .all(args.query, `%${args.query}%`)
              );
              break;
            case 'tt_decay':
              res = tt(db => computeDecay(db).slice(0, 10));
              break;
            case 'tt_combos':
              res = tt(db => discoverCombos(db));
              break;
            case 'tt_diff':
              res = tt(db => sessionDiff(db));
              break;
            case 'tt_health':
              res = tt(db => domainHealth(db));
              break;
            case 'tt_bottlenecks':
              res = tt(db => findBottlenecks(db).slice(0, 10));
              break;
            case 'tt_impact':
              res = tt(db => analyzeImpact(db, capId));
              break;
            case 'tt_verify':
              res = tt(db => runVerification(db, capId));
              break;
            case 'tt_evidence':
              res = tt(db =>
                evidenceFor(db, String(capId).startsWith('combo:') ? capId : `combo:${capId}`)
              );
              break;
            case 'tt_authority':
              res = tt(db => authorityReport(db));
              break;
            case 'tt_actions':
              res = tt(db => actionsReport(db, capId));
              break;
            case 'tt_plan':
              res = tt(db => planFor(db, capId));
              break;
            case 'tt_goal':
              res = tt(db => goalFor(db, args.goal));
              break;
            case 'tt_paths':
              res = tt(db => pathsFor(db, capId));
              break;
            case 'tt_preferences':
              res = tt(db => preferencesReport(db, args?.who));
              break;
            case 'tt_scope':
              res = tt(db => scopeReport(db, args.target));
              break;
            case 'tt_affordances':
              res = tt(db => affordanceDomains(db));
              break;
            case 'tt_digest':
              res = tt(db => humanDigest(db, args?.days));
              break;
            case 'tt_economics':
              res = tt(db => economicsReport(db));
              break;
            case 'tt_goal_value':
              res = tt(db => goalValue(db, args.goal));
              break;
            case 'tt_opportunities':
              res = tt(db => opportunitiesFor(db, args?.by, args?.budget));
              break;
            case 'tt_opportunity':
              res = tt(db => opportunityFor(db, args.id));
              break;
            case 'tt_can':
              res = tt(db => {
                const decision: any = canExecute(db, {
                  ...args,
                  capability: capId || args?.capability,
                });
                // The point of asking before acting is that a refusal costs
                // nothing to record. Doing it here rather than asking the
                // agent to make a second call is what keeps the habit cheap:
                // one round trip answers the question and files the deficit.
                if (args?.record !== false) {
                  const recorded = recordRefusal(db, decision, args?.tool);
                  if (recorded !== undefined) decision.recorded_deficit = recorded;
                }
                return decision;
              });
              break;
            case 'tt_briefing':
              res = args?.text
                ? { briefing: tt(db => briefingText(db, { mark: true })) }
                : tt(db => briefing(db, { mark: true }));
              break;
            case 'tt_next':
              res = tt(db => nextSteps(db, args?.limit));
              break;
            case 'tt_record_failure':
              res = tt(db => captureFailure(db, { ...args, source: args?.source || 'agent' }));
              break;
            case 'tt_signals':
              res = tt(db => signalReport(db, args?.days));
              break;
            case 'tt_register_skill':
              res = tt(db => registerSkill(db, args || {}));
              break;
            case 'tt_skills':
              res = tt(db => registeredSkills(db));
              break;
            case 'tt_promotions':
              res = tt(db => promotionReport(db));
              break;
            case 'tt_objects':
              res = tt(db => objectReport(db, args?.target));
              break;
            case 'tt_budgets':
              res = tt(db => budgetReport(db));
              break;
            case 'tt_reversible':
              res = tt(db => reversibilityReport(db));
              break;
            case 'tt_preferences_observed':
              res = tt(db => observedReport(db));
              break;
            case 'tt_pending':
              res = tt(db => pendingProposals(db));
              break;
            case 'tt_roi':
              res = tt(db => roiFor(db, args.proposalId));
              break;
            case 'tt_audit':
              res = tt(db => auditFor(db, args.target));
              break;
            case 'tt_incident_resolve':
              res = tt(db => resolveIncident(db, args.service, args.outcome));
              break;
            case 'tt_portfolio':
              res = tt(db => portfolio(db, args?.budget));
              break;
            case 'tt_roi_summary':
              res = tt(db => roiSummary(db));
              break;
            case 'tt_incidents': {
              const adb = getWarmDb();
              incidents(adb).then(r => {
                respond(id, toolResult(r));
              });
              return;
            }
            case 'tt_catalog':
              res = tt(db => catalogReport(db, capId || args?.capability));
              break;
            case 'tt_work':
              res = tt(db => workReport(db, args?.limit));
              break;
            case 'tt_usage':
              res = tt(db => usageReport(db, args?.days));
              break;
            case 'tt_run_begin':
              res = tt(db => beginRun(db, args || {}));
              break;
            case 'tt_run_end':
              res = tt(db => endRun(db, args.runId, args.outcome, args.outcomeValueCents));
              break;
            case 'tt_work_event':
              res = tt(db => {
                switch (args.kind) {
                  case 'use':
                    return recordUse(db, args.runId, args.capabilityId || capId, {
                      durationSeconds: args.durationSeconds,
                    });
                  case 'intervention':
                    return recordIntervention(db, args.runId, args.actor, {
                      kind: args.interventionKind || 'clerical',
                      activeSeconds: args.activeSeconds,
                      waitingSeconds: args.waitingSeconds,
                      capabilityId: args.capabilityId || capId,
                      action: args.action,
                    });
                  case 'resource':
                    return recordResource(db, args.runId, args.resourceId, args.resourceKind, {
                      quantity: args.quantity,
                      unit: args.unit,
                      costCents: args.costCents,
                    });
                  case 'outcome':
                    return recordOutcome(db, args.runId, args.achieved, {
                      objectiveMetric: args.objectiveMetric,
                      objectiveName: args.objectiveName,
                      valueCents: args.valueCents,
                    });
                  default:
                    return addEvent(db, args.runId, {
                      kind: args.eventKind || args.kind,
                      actor: args.actor,
                      capabilityId: args.capabilityId || capId,
                      action: args.action,
                      detail: args.detail,
                    });
                }
              });
              break;
            case 'tt_since':
              res = tt(db => ledgerSince(db, args?.when));
              break;
            case 'tt_ledger':
              res = tt(db => ledgerHistory(db));
              break;
            case 'tt_blocked':
              res = tt(db => recordFailure(db, capId, args.classification, args.note));
              break;
            case 'tt_deficits':
              res = tt(db => deficits(db));
              break;
            case 'tt_spof':
              res = tt(db => singlePointsOfFailure(db));
              break;
            case 'tt_credentials':
              res = tt(db => credentialReport(db));
              break;
            case 'tt_simulate':
              res = tt(db => simulateFrontier(db, [capId]));
              break;
            case 'tt_propose':
              res = tt(db => propose(db, capId, args.option));
              break;
            case 'tt_proposals':
              res = tt(db => listProposals(db));
              break;
            case 'tt_proposal':
              res = tt(db => showProposal(db, args.id));
              break;
            case 'tt_near':
              res = tt(db => nearMissCombos(db));
              break;
            default:
              return err(id, -32601, `Unknown: ${name}`);
          }
          const notice = tt(db => emptyGraphNotice(db));
          return respond(id, toolResult(res, notice ?? undefined));
        } catch (e) {
          return err(id, -32000, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        if (method !== 'notifications/initialized') err(id, -32601, `Unknown: ${method}`);
    }
  } catch {}
}

process.stdin.on('data', chunk => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) handleLine(line);
});
process.stdin.on('end', () => process.exit(0));
