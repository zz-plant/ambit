#!/usr/bin/env node --experimental-sqlite
import { readFileSync } from 'node:fs';
import { resolveDbPath } from '../shared/db-path.ts';
import { nearest } from '../shared/nearest.ts';
import { err, respond, toolResult } from './protocol.ts';
import { BASE_TOOLS, PROFILES, type Profile } from './tools.ts';
import { checkArguments } from './validate.ts';
import { capabilityToAsk, resolveCapability, type Resolution } from '../engine/resolve.ts';
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
  unmappedUse,
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
import { judgeGoal } from '../engine/judge.ts';
import { REACHED_SQL, graphCounts, notSeeded } from '../engine/vocabulary.ts';

const DB_PATH = resolveDbPath();
const VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

/**
 * Which listing this process offers: `--profile=agent`, or AMBIT_MCP_PROFILE.
 *
 * Failing to start on a name it does not know is deliberate. Falling back to
 * the full list would answer a typo with sixty tools, which is the outcome the
 * flag was typed to avoid, and the client would show it as a working server.
 */
function chosenProfile(): Profile {
  const argv = process.argv.slice(2);
  const at = argv.findIndex(a => a === '--profile' || a.startsWith('--profile='));
  const fromFlag =
    at < 0 ? undefined : argv[at].includes('=') ? argv[at].split('=')[1] : argv[at + 1];
  const wanted = fromFlag ?? process.env.AMBIT_MCP_PROFILE ?? 'full';
  if (!Object.hasOwn(PROFILES, wanted)) {
    process.stderr.write(
      `ambit mcp: unknown profile "${wanted}". Known: ${Object.keys(PROFILES).join(', ')}.\n`
    );
    process.exit(2);
  }
  return wanted as Profile;
}
const PROFILE = chosenProfile();

/**
 * What a client is told about this server when it connects.
 *
 * The habit Ambit exists to teach is one question before an unfamiliar tool,
 * and the README used to ask the user to paste it into their agent's
 * instructions. A client that reads `instructions` puts this in front of the
 * model without anyone pasting anything, which is the only way it reaches the
 * agent nobody configured. It is short on purpose: it is in the context of
 * every session.
 */
const INSTRUCTIONS = [
  'Ambit is the map of what this machine, its agents and its tools can do together, and what may be done without asking.',
  '',
  '- Before running a tool you have not used this session, call ambit_can with the capability. yes: act. ask: put it to the person. no: it has recorded the deficit, so do not retry it under another name.',
  '- Call ambit_briefing once at the start of a session, or read ambit://briefing.',
  '- When a tool fails, report it with ambit_record_failure. When something missing blocks you, ambit_plan says what closes it and ambit_propose drafts the change for a person to approve.',
  '- You can ask and propose. You can never grant or approve.',
  `- A capability is named by id, such as combo:shell-execution. A bare name such as shell-execution works too${PROFILE === 'full' ? ', and ambit_cap finds one' : ''}.`,
].join('\n');

/**
 * The protocol versions this server implements, oldest first.
 *
 * It answered 2024-11-05 to everyone. The spec asks for the client's own
 * version back when the server speaks it, and a client that asked for a newer
 * one was told an older one while being sent fields (`structuredContent`) that
 * only the newer one defines. A version this list does not hold is answered
 * with the newest one that is not newer than the request, so a client that
 * stops at 2025-03-26 is offered 2024-11-05, which it speaks, and not a
 * 2025-06-18 it does not. 2025-03-26 added JSON-RPC batching, which this
 * server does not read, so it does not claim that version.
 */
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-06-18'];

function negotiate(requested: unknown): string {
  if (typeof requested !== 'string') return PROTOCOL_VERSIONS[0];
  if (PROTOCOL_VERSIONS.includes(requested)) return requested;
  const older = PROTOCOL_VERSIONS.filter(v => v < requested);
  return older.length ? older[older.length - 1] : PROTOCOL_VERSIONS[0];
}

/** An unknown tool is a protocol error, and says which one was probably meant. */
function unknownTool(name: string, bare: string): string {
  const close = nearest(
    bare,
    BASE_TOOLS.map(t => t.name)
  ).map(n => `ambit_${n}`);
  return close.length
    ? `Unknown tool: ${name}. Did you mean ${close.join(', ')}?`
    : `Unknown tool: ${name}. tools/list shows what this server offers.`;
}

/** What an agent is told when the capability it named is not one node. */
function notFound(r: Extract<Resolution, { ok: false }>) {
  return {
    error: r.error,
    ...(r.did_you_mean.length
      ? { did_you_mean: r.did_you_mean }
      : { hint: 'ambit_cap finds a capability by name or domain.' }),
  };
}

// The tools whose first argument names a node: each takes what the resolver
// makes exact and refuses what it cannot, so a slightly wrong id is answered
// the same way by all of them. `can` is not here, it treats an unknown id as
// a question worth answering; see its case below.
const RESOLVES = new Set([
  'impact',
  'evidence',
  'plan',
  'paths',
  'simulate',
  'propose',
  'blocked',
  'catalog',
  'verify',
  'actions',
]);

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
async function handleLine(line: string) {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return err(null, -32700, 'Parse error: a message is one JSON object on one line.');
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return err(null, -32600, 'Invalid Request: expected one JSON-RPC message per line.');
  }
  const { id, method, params } = msg;
  try {
    switch (method) {
      // The server used to introduce itself as "tech-tree" at version 1.0.0,
      // which is neither the name of the product nor its version — an agent
      // that connected had no way to tell what it was talking to.
      case 'initialize':
        return respond(id, {
          protocolVersion: negotiate(params?.protocolVersion),
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'ambit', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      // A client that pings to see whether the server is alive was answered
      // "Unknown: ping", which it reads as the server being broken.
      case 'ping':
        return respond(id, {});
      case 'tools/list':
        return respond(id, { tools: PROFILES[PROFILE] });
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
        const name = params?.name;
        if (typeof name !== 'string' || !name) {
          return err(id, -32602, 'tools/call needs params.name, the tool to call.');
        }
        // Dispatch is keyed on the legacy prefix, and accepts either: the
        // advertised `ambit_*` name and the unadvertised `tt_*` alias reach
        // the same case. Every tool answers whichever profile listed it.
        const bare = name.replace(/^(ambit|tt)_/, '');
        const tool = BASE_TOOLS.find(t => t.name === bare);
        if (!tool) return err(id, -32602, unknownTool(name, bare));

        // The schema is the contract. A call that breaks it is answered as a
        // failed call the model can read and correct, and never reaches the
        // engine to fail somewhere less legible.
        const checked = checkArguments({ ...tool, name: `ambit_${tool.name}` }, params.arguments);
        if (!checked.ok) {
          return respond(id, toolResult({ error: checked.error, takes: checked.takes }));
        }
        const args = checked.args as Record<string, any>;
        // One capability, under whichever of its three names was sent.
        let capId: string | undefined = args.capId ?? args.capabilityId ?? args.capability;

        try {
          let res: unknown;
          if (capId !== undefined && RESOLVES.has(tool.name)) {
            const wanted = capId;
            const found = tt(db => resolveCapability(db, wanted));
            if (!found.ok) return respond(id, toolResult(notFound(found)));
            capId = found.id;
          }
          switch (`tt_${tool.name}`) {
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
              res = tt(db => analyzeImpact(db, capId as string));
              break;
            case 'tt_verify':
              res = tt(db => runVerification(db, capId));
              break;
            case 'tt_evidence':
              res = tt(db => evidenceFor(db, capId as string));
              break;
            // The report is a short answer, who may act alone, who must ask and
            // what is forbidden, followed by one row per grant. The rows were
            // most of what came back, about 10KB of 11 on a seeded machine, and
            // they answer a question nobody asked when the call is "what may I
            // do". `ambit_can` and `ambit_actions` answer the specific one.
            case 'tt_authority':
              res = tt(db => {
                const report: any = authorityReport(db);
                if (args.detail || report.detail === undefined) return report;
                const { detail, ...summary } = report;
                const rows = Array.isArray(detail) ? detail.length : Object.keys(detail).length;
                return {
                  ...summary,
                  detail_omitted: rows,
                  hint: 'Pass detail: true for every grant.',
                };
              });
              break;
            case 'tt_actions':
              res = tt(db => actionsReport(db, capId));
              break;
            case 'tt_plan':
              res = tt(db => planFor(db, capId));
              break;
            case 'tt_goal':
              if (args?.judge) {
                const base = tt(db => goalFor(db, args.goal));
                const judged = await judgeGoal(args.goal, { url: args.judgeUrl });
                res = { ...base, judged };
              } else {
                res = tt(db => goalFor(db, args.goal));
              }
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
                // A slip is answered as one and files nothing; see the helper.
                const asked = capabilityToAsk(db, capId);
                if ('answer' in asked) return asked.answer;
                const decision: any = canExecute(db, { ...args, capability: asked.ask });
                // The point of asking before acting is that a refusal costs
                // nothing to record. Doing it here rather than asking the
                // agent to make a second call is what keeps the habit cheap:
                // one round trip answers the question and files the deficit.
                if (args.record !== false) {
                  const recorded = recordRefusal(db, decision, args.tool);
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
            // Answered from the callback, so a slow probe does not hold up the
            // requests queued behind it, a ping among them. It has a rejection
            // handler because a probe that threw was an unhandled rejection,
            // which ends the whole server.
            case 'tt_incidents': {
              const answering = incidents(getWarmDb()).then(
                r => respond(id, toolResult(r)),
                e => respond(id, toolResult({ error: e instanceof Error ? e.message : String(e) }))
              );
              answering.finally(() => inflight.delete(answering));
              inflight.add(answering);
              return;
            }
            case 'tt_catalog':
              res = tt(db => catalogReport(db, capId || args?.capability));
              break;
            case 'tt_work':
              res = tt(db => workReport(db, args?.limit));
              break;
            case 'tt_usage':
              res = tt(db =>
                args?.unmapped ? unmappedUse(db, args?.days) : usageReport(db, args?.days)
              );
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
              res = tt(db => ledgerSince(db, args?.when, args?.until));
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
              res = tt(db => simulateFrontier(db, [capId as string]));
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
            // Unreachable while every listed tool has a case above, and the
            // test that calls each one holds that.
            default:
              return err(id, -32603, `Internal error: ${name} is listed and has no handler.`);
          }
          const notice = tt(db => emptyGraphNotice(db));
          return respond(id, toolResult(res, notice ?? undefined));
        } catch (e) {
          // The call was well formed and the engine failed it: a failed call
          // for the model to read, and not a fault in the protocol.
          return respond(id, toolResult({ error: e instanceof Error ? e.message : String(e) }));
        }
      }
      default:
        // A notification has no id and is never answered; replying to one, as
        // this did for anything but `initialized`, is an error line the client
        // did not ask for and cannot match to a request.
        if (id !== undefined) err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    // This used to swallow the failure, which left a client waiting forever
    // for a reply that was never going to be written.
    if (id !== undefined) err(id, -32603, `Internal error: ${e instanceof Error ? e.message : e}`);
  }
}

let queue: Promise<unknown> = Promise.resolve();
// Answers still being worked on when their request has already been handled.
// The queue does not hold them, so the end of input has to, or a client that
// closes its side after sending gets no reply to a slow call.
const inflight = new Set<Promise<unknown>>();

process.stdin.on('data', chunk => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    queue = queue.then(() => handleLine(line));
  }
});

process.stdin.on('end', async () => {
  if (buf.trim()) {
    queue = queue.then(() => handleLine(buf));
    buf = '';
  }
  await queue;
  await Promise.allSettled([...inflight]);
  process.exit(0);
});
