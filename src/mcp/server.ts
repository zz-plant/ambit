#!/usr/bin/env node --experimental-sqlite
import { readSessionLogs, SESSION_LOG_BUDGET_MS } from '../engine/session-logs.ts';
import { ingestSpool } from '../engine/spool.ts';
import { ingestTrackerSpool } from '../engine/tracker-spool.ts';
import { readFileSync } from 'node:fs';
import { resolveDbPath } from '../shared/db-path.ts';
import { nearest } from '../shared/nearest.ts';
import { toolResult } from './protocol.ts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BASE_TOOLS, PROFILES, type Profile } from './tools.ts';
import { checkArguments, signature } from './validate.ts';
import { capabilityToAsk, resolveCapability, type Resolution } from '../engine/resolve.ts';
import { getDb, migrate, type Db } from '../engine/db.ts';
import {
  computeDecay,
  discoverCombos,
  sessionDiff,
  domainHealth,
  findBottlenecks,
  analyzeImpact,
  nearMissCombos,
  singlePointsOfFailure,
  credentialReport,
  affordanceDomains,
} from '../engine/inference.ts';
import {
  runVerification,
  evidenceFor,
  authorityReport,
  actionsReport,
  scopeReport,
  canExecute,
  promotionReport,
} from '../engine/assurance.ts';
import {
  planFor,
  recordFailure,
  deficits,
  simulateFrontier,
  propose,
  preferencesReport,
} from '../engine/planning.ts';
import {
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
  usageWindows,
} from '../engine/telemetry.ts';
import { budgetReport } from '../engine/budgets.ts';
import { reversibilityReport } from '../engine/reversibility.ts';
import { observedReport } from '../engine/observed.ts';
import { objectReport } from '../engine/objects.ts';
import { briefing, briefingText } from '../engine/briefing.ts';
import { nextSteps } from '../engine/next.ts';
import { captureFailure, recordRefusal, signalReport } from '../engine/failures.ts';
import { registerSkill, registeredSkills } from '../engine/skills.ts';
import { ledgerSince, ledgerHistory } from '../engine/ledger.ts';
import { goalFor, pathsFor } from '../engine/goals.ts';
import { humanDigest } from '../engine/attention.ts';
import { economicsReport, goalValue } from '../engine/economics.ts';
import { opportunitiesFor, opportunityFor } from '../engine/opportunities.ts';
import { roiFor, roiSummary } from '../engine/roi.ts';
import { portfolio } from '../engine/portfolio.ts';
import { incidents, resolveIncident } from '../engine/incident.ts';
import { catalogReport } from '../engine/catalog.ts';
import { auditFor } from '../engine/audit.ts';
import { listProposals, showProposal, pendingProposals } from '../engine/governance.ts';
import { judgeGoal } from '../engine/judge.ts';
import { council } from '../engine/council.ts';
import { judgeUnrouted, specGoal } from '../engine/spec.ts';
import { REACHED_SQL, graphCounts, notSeeded, reachPhrase } from '../engine/vocabulary.ts';

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
  // A client calls only the tools it was shown, so the rest of the catalogue
  // is named as the command that answers it, never as tools to call.
  ...(PROFILE === 'agent'
    ? [
        '- These ten tools are what a task needs. The rest (single points of failure, credentials, budgets, incidents, the audit trail, the council) is the ambit command in a shell: ambit help --all lists it. Started without --profile=agent, this server lists all of it as tools.',
      ]
    : []),
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
// Protocol version negotiation is now the SDK's. Ambit no longer maintains
// its own list; the SDK ships the versions it speaks and echoes a requested
// one when it can.
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

/**
 * The connected runtime, as its handshake named itself, kept as the actor a
 * proposal it drafts was drafted by. Whatever calls this server is an agent's
 * runtime; its name is what the client sent, so it is reduced to a slug
 * before it is stored or drawn.
 */
let proposer = 'agent';

export function proposerFrom(clientName: unknown): string {
  if (typeof clientName !== 'string') return 'agent';
  const slug = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `agent:${slug}` : 'agent';
}
function getWarmDb() {
  if (!dbHandle) {
    dbHandle = getDb(DB_PATH);
    migrate(dbHandle);
    // Claude Code's and Cursor's tool calls, spooled by their hooks: read in when
    // the agent's server opens the graph, so the briefing and the ledger see them.
    try {
      ingestSpool(dbHandle);
    } catch {
      /* the spool waits for the next reader */
    }
    try {
      ingestTrackerSpool(dbHandle);
    } catch {
      /* likewise: OpenCode's config changes, from its tracker */
    }
    // The tokens Codex, OpenCode and Amp sessions used, from their own logs,
    // within the time a command's read has; AMBIT_NO_LEDGER stops it.
    try {
      readSessionLogs(dbHandle, { budgetMs: SESSION_LOG_BUDGET_MS });
    } catch {
      /* the logs wait for the next reader */
    }
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

async function dispatchTool(name: string, rawArgs: unknown): Promise<any> {
  if (typeof name !== 'string' || !name) {
    throw new McpError(ErrorCode.InvalidParams, 'tools/call needs params.name, the tool to call.');
  }
  // Dispatch is keyed on the legacy prefix, and accepts either: the
  // advertised `ambit_*` name and the unadvertised `tt_*` alias reach
  // the same case. Every tool answers whichever profile listed it.
  const bare = name.replace(/^(ambit|tt)_/, '');
  const tool = BASE_TOOLS.find(t => t.name === bare);
  if (!tool) throw new McpError(ErrorCode.InvalidParams, unknownTool(name, bare));

  // The schema is the contract. A call that breaks it is answered as a
  // failed call the model can read and correct, and never reaches the
  // engine to fail somewhere less legible.
  const checked = checkArguments({ ...tool, name: `ambit_${tool.name}` }, rawArgs);
  if (!checked.ok) {
    return toolResult({ error: checked.error, takes: checked.takes });
  }
  const args = checked.args as Record<string, any>;
  // One capability, under whichever of its three names was sent.
  let capId: string | undefined = args.capId ?? args.capabilityId ?? args.capability;

  try {
    let res: unknown;
    if (capId !== undefined && RESOLVES.has(tool.name)) {
      const wanted = capId;
      const found = tt(db => resolveCapability(db, wanted));
      if (!found.ok) return toolResult(notFound(found));
      capId = found.id;
    }
    switch (`tt_${tool.name}`) {
      case 'tt_stats':
        res = tt(db => {
          const c = graphCounts(db);
          return {
            stats: {
              // The sentence the person's own screens print, to quote.
              reach: reachPhrase(db),
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
        // A spec is read as data, the way the CLI reads it, and only
        // `judge` sends anything, to this machine, about the tasks the
        // words could not route.
        if (args?.spec !== undefined) {
          const read = tt(db => specGoal(db, args.spec));
          res = args.judge ? await judgeUnrouted(read, args.judgeUrl) : read;
        } else if (args?.goal === undefined) {
          return toolResult({
            error: 'ambit_goal: goal is required, unless spec names a spec to read.',
            takes: signature(tool),
          });
        } else if (args?.judge) {
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
      case 'tt_council':
        res = tt(db => council(db));
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
        try {
          return toolResult(await incidents(getWarmDb()));
        } catch (e) {
          return toolResult({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      case 'tt_catalog':
        res = tt(db => catalogReport(db, capId || args?.capability));
        break;
      case 'tt_work':
        res = tt(db => workReport(db, args?.limit));
        break;
      case 'tt_usage':
        res = tt(db =>
          args?.windows
            ? usageWindows(db, { days: args?.days })
            : args?.unmapped
              ? unmappedUse(db, args?.days)
              : usageReport(db, args?.days)
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
        res = tt(db => propose(db, capId, args.option, proposer, args.purpose));
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
        throw new McpError(
          ErrorCode.InternalError,
          `Internal error: ${name} is listed and has no handler.`
        );
    }
    const notice = tt(db => emptyGraphNotice(db));
    return toolResult(res, notice ?? undefined);
  } catch (e) {
    // The call was well formed and the engine failed it: a failed call
    // for the model to read, and not a fault in the protocol.
    return toolResult({ error: e instanceof Error ? e.message : String(e) });
  }
}

const server = new Server(
  { name: 'ambit', version: VERSION },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: INSTRUCTIONS,
  }
);

// The original server serialized request handling with a queue, so responses
// left in the order requests arrived. The SDK processes handlers concurrently,
// which reorders replies and breaks clients that read them in order. Serialize
// here to keep that contract.
let __lock = Promise.resolve();
function __serialize<T>(fn: () => Promise<T>): Promise<T> {
  const prev = __lock;
  let release!: () => void;
  __lock = new Promise<void>(res => {
    release = res;
  });
  return prev.then(() => fn()).finally(() => release());
}

server.oninitialized = () => {
  proposer = proposerFrom(server.getClientVersion()?.name);
};

const PermissiveInitializeSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.literal('initialize'),
  params: z
    .object({
      protocolVersion: z.string().optional(),
      capabilities: z.record(z.string(), z.unknown()).optional(),
      clientInfo: z
        .object({ name: z.string().optional(), version: z.string().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

server.setRequestHandler(PermissiveInitializeSchema as any, async (request: any) =>
  __serialize(async () => {
    const params = request.params || {};
    if (params.clientInfo?.name) proposer = proposerFrom(params.clientInfo.name);
    const requested = params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'ambit', version: VERSION },
      instructions: INSTRUCTIONS,
    };
  })
);

server.setRequestHandler(PingRequestSchema, async () => __serialize(async () => ({})));

server.setRequestHandler(ListToolsRequestSchema, async () =>
  __serialize(async () => ({
    tools: PROFILES[PROFILE],
  }))
);

server.setRequestHandler(ListResourcesRequestSchema, async () =>
  __serialize(async () => ({
    resources: RESOURCES,
  }))
);

server.setRequestHandler(ReadResourceRequestSchema, async request =>
  __serialize(async () => {
    const uri = request.params?.uri;
    if (uri !== BRIEFING_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
    }
    return {
      contents: [
        {
          uri: BRIEFING_URI,
          mimeType: 'text/plain',
          text: tt(db => briefingText(db, { mark: true })),
        },
      ],
    };
  })
);

const PermissiveCallToolSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.literal('tools/call'),
  params: z
    .object({
      name: z.unknown().optional(),
      arguments: z.unknown().optional(),
      task: z.unknown().optional(),
      _meta: z.unknown().optional(),
    })
    .passthrough()
    .optional(),
});

server.setRequestHandler(PermissiveCallToolSchema as any, async request => {
  const clientName = server.getClientVersion()?.name;
  if (clientName) proposer = proposerFrom(clientName);
  const name = request.params?.name;
  const args = request.params?.arguments ?? {};
  if (typeof name !== 'string' || !name) {
    throw new McpError(ErrorCode.InvalidParams, 'tools/call needs params.name, the tool to call.');
  }
  const bare = String(name).replace(/^(ambit|tt)_/, '');
  const isIncidents = bare === 'incidents';
  const run = () => dispatchTool(name, args);
  if (isIncidents) return await run();
  return await __serialize(run);
});

const transport = new StdioServerTransport();
await server.connect(transport);
