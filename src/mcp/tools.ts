/**
 * Every tool this server offers, and the names it advertises them under.
 *
 * Pure data, no engine imports, no database. Split out of server.ts, which
 * held the catalogue, the JSON-RPC framing, a warm database handle and a
 * sixty-case dispatch switch. What a tool *is* and what it *does* are
 * different questions, and they are answered in different files now.
 *
 * Two things here are read by the machine and not only the person. The
 * `inputSchema` is what `validate.ts` checks a call against, so a property that
 * is declared is a property the server accepts and one that is not is refused
 * with the list of those that are. `annotations` tell a client what a call can
 * do before it makes one; the measured basis for each is in the note above the
 * presets.
 */

type Prop = { type: 'string' | 'number' | 'boolean'; description?: string };

interface Annotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, Prop>; required?: string[] };
  annotations: Annotations;
}

/**
 * What each kind of call does to the world, as a client may read it.
 *
 * Measured, not assumed: each tool was called against a copy of a seeded graph
 * and every table hashed before and after. Forty-six change nothing. Three
 * change one thing that is Ambit's own bookkeeping and no one else's, which is
 * why they are listed as writes although they are the calls an agent should
 * make most: `ambit_can` files a refusal as a deficit unless told not to,
 * and `ambit_briefing` and `ambit_context` move the mark that says what changed
 * since you were last told. The rest add a row to the ledger.
 *
 * A read-only tool says only that. `destructiveHint` is defined for writes, and
 * `openWorldHint` is left off the readers to hold the listing to its size: it
 * is a hint about writes reaching outside, and a call that changes nothing has
 * nothing to reach with. The writes set it, because its default of true would
 * tell a client that adding a row to a SQLite file may publish something.
 */
const READS: Annotations = { readOnlyHint: true };
const WRITES: Annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
// Runs a command that was declared in the graph: it can do anything a shell can.
const RUNS: Annotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
// Probes the hosts the infrastructure manifest names, records each answer as a
// check run, and opens a run per outage.
const PROBES: Annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const NONE = { type: 'object', properties: {} } as const;
const str: Prop = { type: 'string' };
const num: Prop = { type: 'number' };
const bool: Prop = { type: 'boolean' };

/**
 * The three names a capability has gone by. The advertised schema carries one
 * per tool, and `validate.ts` accepts the others: a client that learned
 * `capabilityId` from an earlier listing keeps working, and an agent that
 * guesses at the name gets an answer instead of an "unknown argument".
 */
const CAPABILITY_KEYS = ['capId', 'capabilityId', 'capability'] as const;

const BASE_TOOLS: ToolDef[] = [
  {
    name: 'stats',
    description:
      'Counts of capabilities: total, reached, verified and failing, and reached per domain.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'context',
    description:
      'The session briefing as one block of prose, the text ambit_briefing returns with text: true.',
    inputSchema: NONE,
    annotations: WRITES,
  },
  {
    name: 'cap',
    description: 'Find capabilities by domain or name. Returns the ids the other tools take.',
    inputSchema: { type: 'object', properties: { query: str }, required: ['query'] },
    annotations: READS,
  },
  {
    name: 'decay',
    description:
      'Capabilities not touched for long enough to doubt, with days since the last config change.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'combos',
    description:
      'Combos the graph can already support: every prerequisite in place, with a confidence.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'diff',
    description:
      'Per domain, what was recently practiced, improved or regretted, from the last 50 outcomes.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'health',
    description: 'Domain health scores.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'bottlenecks',
    description:
      'The capabilities the most others depend on: where an improvement pays most and a loss costs most.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'impact',
    description: 'What would stop, and what would only lose a provider, if a capability went away.',
    inputSchema: { type: 'object', properties: { capId: str }, required: ['capId'] },
    annotations: READS,
  },
  {
    name: 'near',
    description: 'Near-miss combos: one or two prerequisites away, with high existing maturity.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'verify',
    description:
      "Run a capability's declared check and record the outcome: proof that it works, not that it is configured. Omit capId to run every declared check.",
    inputSchema: { type: 'object', properties: { capId: str } },
    annotations: RUNS,
  },
  {
    name: 'evidence',
    description:
      'Verification history of one capability: what was tried, when, and whether it passed.',
    inputSchema: { type: 'object', properties: { capId: str }, required: ['capId'] },
    annotations: READS,
  },
  {
    name: 'authority',
    description:
      'Which reached capabilities may run unattended and which need approval. Being able to act is not permission to. Pass detail: true for every grant.',
    inputSchema: { type: 'object', properties: { detail: bool } },
    annotations: READS,
  },
  {
    name: 'actions',
    description:
      'The actions a capability confers and whether each may be performed: read a repository yes, merge to its default branch no. Omit capId for all. To ask before acting, use ambit_can.',
    inputSchema: { type: 'object', properties: { capId: str } },
    annotations: READS,
  },
  {
    name: 'plan',
    description:
      'What is missing for a capability, in the order it must be closed, and which steps need a person.',
    inputSchema: { type: 'object', properties: { capId: str }, required: ['capId'] },
    annotations: READS,
  },
  {
    name: 'goal',
    description:
      'Route a goal, in words, to the capabilities that cover it: ranked, each with its plan delta.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What the user wants to do' },
        judge: {
          type: 'boolean',
          description: 'Route an unmatched goal with a local judgment model',
        },
        judgeUrl: { type: 'string', description: 'Loopback URL of that model' },
        spec: {
          type: 'string',
          description: 'Or a Spec Kit/OpenSpec dir or tasks.md: what its tasks need',
        },
      },
    },
    annotations: READS,
  },
  {
    name: 'paths',
    description:
      'The ways to reach a capability compared by setup time, risk and lock-in: which steps are config changes that can be undone, and which are installers that cannot.',
    inputSchema: { type: 'object', properties: { capId: str }, required: ['capId'] },
    annotations: READS,
  },
  {
    name: 'preferences',
    description:
      'What each person prefers, and which plans would fight it (local or hosted, one-off or recurring). Pass who for one person.',
    inputSchema: { type: 'object', properties: { who: str } },
    annotations: READS,
  },
  {
    name: 'scope',
    description:
      'What a scope covers and what it does not. For a target (repo:owner/name, device:nuc, svc:ollama): every grant, whether it covers the target, and the effective mode.',
    inputSchema: { type: 'object', properties: { target: str }, required: ['target'] },
    annotations: READS,
  },
  {
    name: 'affordances',
    description:
      'The domain of each capability, from the graph: institutional (needs an authority holder), economic (a budget), cognitive (a person), physical (a device).',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'digest',
    description:
      'How much work still runs through the human, and which interventions are reducible: recurring approvals and permission blocks are infrastructure shaped like a person. days: window (default 7).',
    inputSchema: { type: 'object', properties: { days: num } },
    annotations: READS,
  },
  {
    name: 'work',
    description:
      'Recent work runs and what each cost: elapsed time, events, capabilities exercised, human interventions, resources.',
    inputSchema: { type: 'object', properties: { limit: num } },
    annotations: READS,
  },
  {
    name: 'usage',
    description:
      "Where effort went over a window in days (default 30): times exercised, duration and interventions per capability. unmapped: tools used that no node covers. windows: tokens per five-hour window, and the current one's time left.",
    inputSchema: { type: 'object', properties: { days: num, unmapped: bool, windows: bool } },
    annotations: READS,
  },
  {
    name: 'run_begin',
    description:
      'Start a work run. Returns the run id every later telemetry call attaches to. The run stays open until run_end.',
    inputSchema: {
      type: 'object',
      properties: { goal: str, goalId: str, runType: str, source: str, id: str },
    },
    annotations: WRITES,
  },
  {
    name: 'run_end',
    description:
      'Close a work run with its outcome, and the value of that outcome in cents when known.',
    inputSchema: {
      type: 'object',
      properties: { runId: str, outcome: str, outcomeValueCents: num },
      required: ['runId', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'work_event',
    description:
      'Record one observation into a run. kind: event, use, intervention, resource or outcome. interventionKind: judgment, authority, knowledge, physical, clerical or exception.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: str,
        kind: { type: 'string', description: 'event | use | intervention | resource | outcome' },
        eventKind: str,
        actor: str,
        capabilityId: str,
        action: str,
        detail: str,
        durationSeconds: num,
        interventionKind: str,
        activeSeconds: num,
        waitingSeconds: num,
        resourceId: str,
        resourceKind: str,
        quantity: num,
        unit: str,
        costCents: num,
        achieved: str,
        objectiveName: str,
        objectiveMetric: num,
        valueCents: num,
      },
      required: ['runId', 'kind'],
    },
    annotations: WRITES,
  },
  {
    name: 'economics',
    description:
      'Declared costs and goal values: attention value per hour, recurring and purchase costs, what each goal is worth.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'goal_value',
    description:
      "One goal's economics (occurrence rate, success value, failure cost), matched by id or name.",
    inputSchema: { type: 'object', properties: { goal: str }, required: ['goal'] },
    annotations: READS,
  },
  {
    name: 'opportunities',
    description:
      'Ranked changes worth making, from recurring human burden in the ledger priced by attention. by: attention (default), cash, roi, reliability, frontier. budget (dollars): the best combination within it.',
    inputSchema: { type: 'object', properties: { by: str, budget: num } },
    annotations: READS,
  },
  {
    name: 'opportunity',
    description:
      'One ranked opportunity in full: burden, proposed capability, acquisition, expected effect, payback, confidence.',
    inputSchema: { type: 'object', properties: { id: str }, required: ['id'] },
    annotations: READS,
  },
  {
    name: 'can',
    description:
      'Ask before running a tool you have not used this session. yes: act. ask: put it to the person. no: do not retry it under another name. Also returns the reason, what is missing and the budget left. Probes nothing. A no files the deficit.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: str,
        action: str,
        actor: str,
        target: str,
        spendCents: num,
        tool: {
          type: 'string',
          description: 'The command you were about to run, kept with the deficit on a no',
        },
        record: { type: 'boolean', description: 'File the deficit on a no (default true)' },
      },
      required: ['capability'],
    },
    annotations: WRITES,
  },
  {
    name: 'roi',
    description:
      'Realized ROI of an applied proposal: interventions, hours, attention dollars and reliability before and after, against its prediction. Writes the observation back.',
    inputSchema: { type: 'object', properties: { proposalId: str }, required: ['proposalId'] },
    annotations: WRITES,
  },
  {
    name: 'roi_summary',
    description:
      "Every applied proposal's observed hours and dollars saved per year, and forecast accuracy: the cumulative headline.",
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'catalog',
    description:
      'The ways to acquire a capability (build, buy, subscribe, delegate, hire) compared by setup, one-time and recurring cost, privacy, verification and rollback.',
    inputSchema: { type: 'object', properties: { capability: str }, required: ['capability'] },
    annotations: READS,
  },
  {
    name: 'audit',
    description:
      "The audit trail: a run end to end, a proposal's steps, approval and result, or one person's approvals and interventions. target: run id, proposal id, human name, or days.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'run-... | prop-... | human:name | days' },
      },
    },
    annotations: READS,
  },
  {
    name: 'incidents',
    description:
      'Probe the hosts the infrastructure manifest names, record each answer as a check run on that device or service, and open an incident run per offline service, with the authority decision for recovery (restart ALLOW, CONFIRM or DENY).',
    inputSchema: NONE,
    annotations: PROBES,
  },
  {
    name: 'incident_resolve',
    description:
      "Close the open incident run for a service with its outcome. MTTR is the ledger's own elapsed time.",
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string', description: 'svc:key' }, outcome: str },
      required: ['service', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'portfolio',
    description:
      'Across imported federation receipts: burden that recurs in several environments, person-specific single points of failure, and (with budget) where spend gains most. Never merges.',
    inputSchema: { type: 'object', properties: { budget: num } },
    annotations: READS,
  },
  {
    name: 'since',
    description:
      'What entered the reachable frontier between two ISO timestamps (default: earliest observation to now), split into acquired and emerged through composition.',
    inputSchema: { type: 'object', properties: { when: str, until: str } },
    annotations: READS,
  },
  {
    name: 'blocked',
    description:
      'Record that a task was blocked by a missing capability. The same deficit hit repeatedly is infrastructure that should exist.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str,
        classification: {
          type: 'string',
          description: 'reasoning | knowledge | tool | permission | infrastructure | reliability',
        },
        note: { type: 'string', description: 'What you were trying to do' },
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'simulate',
    description:
      'The frontier as it would be if a capability were acquired, including what it unblocks. A preview: changes nothing.',
    inputSchema: { type: 'object', properties: { capId: str }, required: ['capId'] },
    annotations: READS,
  },
  {
    name: 'propose',
    description:
      'Draft a reviewable acquisition: ordered steps, the alternative chosen and its trade-offs, the simulated result. Nothing executes until a person approves it, and only reversible config patches can then be applied.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str,
        option: { type: 'number', description: 'Which alternative, 0-based' },
        purpose: { type: 'string', description: 'The work this is for, for the person deciding' },
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'proposals',
    description: 'Every proposal drafted so far, newest first.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'proposal',
    description: 'One proposal in full, with its steps and simulated frontier.',
    inputSchema: { type: 'object', properties: { id: str }, required: ['id'] },
    annotations: READS,
  },
  {
    name: 'spof',
    description:
      'Capabilities with exactly one provider, where redundancy is absent. Bottlenecks rank leverage; this ranks fragility.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'credentials',
    description:
      'What revoking each credential would end. Providers that present the same credential fail together.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'deficits',
    description:
      'Recurring capability deficits, worst first: which missing capabilities keep stopping different work.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'ledger',
    description:
      "Every recorded frontier observation: how the system's capacity for action has changed over time.",
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'briefing',
    description:
      'What this environment is, before you touch it: reached and proven, failing, waiting on a person, recently blocked, worth reaching next, and what changed since the last briefing. Read once at session start. Also ambit://briefing.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'boolean', description: 'Return prose instead of fields' } },
    },
    annotations: WRITES,
  },
  {
    name: 'next',
    description:
      'The capabilities worth reaching next: why, cost, and the command that proposes each. Ranked by what has blocked work once the ledger has data, by leverage per setup hour before.',
    inputSchema: { type: 'object', properties: { limit: num } },
    annotations: READS,
  },
  {
    name: 'record_failure',
    description:
      'Report a tool failure you just hit as the runtime reported it: exit code, error text or kind. Ambit classifies it, attributes it to a capability where it can, and keeps it either way.',
    inputSchema: {
      type: 'object',
      properties: { tool: str, message: str, exitCode: num, errorKind: str, capabilityId: str },
    },
    annotations: WRITES,
  },
  {
    name: 'signals',
    description:
      'Failures seen in the window that no one recorded, by class and tool, including those no capability could be attributed to: a gap in the model.',
    inputSchema: { type: 'object', properties: { days: num } },
    annotations: READS,
  },
  {
    name: 'register_skill',
    description:
      'Put a skill you wrote on the map: an id, the capability it supplies, and a read-only command that proves it works. The check runs at once, so the skill arrives proven or honest about failing.',
    inputSchema: {
      type: 'object',
      properties: { id: str, name: str, provides: str, verify: str, description: str },
      required: ['id', 'verify'],
    },
    annotations: RUNS,
  },
  {
    name: 'skills',
    description: 'Skills registered this way, and what each check last said.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'objects',
    description:
      'What may be done to a particular thing, and what is proved about doing it there. Evidence about one repository says nothing about another.',
    inputSchema: { type: 'object', properties: { target: str } },
    annotations: READS,
  },
  {
    name: 'budgets',
    description:
      'Standing budgets: what may be spent, on what, and what is left this period. A spend past a ceiling is refused until the period turns over. A person sets one.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'reversible',
    description:
      'Which unreached capabilities could be acquired without a person and which need hands. apply refuses a step with no inverse, so this is also what an agent cannot do alone.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'preferences_observed',
    description:
      'What this person has approved and refused, by trait: local or hosted, one-off or recurring. Three decisions make a trait; one that went both ways is contested.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'pending',
    description:
      'Drafts waiting on a person, each with its cost, what it bills and what it unlocks. Surface them together: a batch is one interruption.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'promotions',
    description:
      'Authority thresholds: which grants may widen on evidence, how much each still needs, what was promoted or put back. A person sets one; an agent only reads this.',
    inputSchema: NONE,
    annotations: READS,
  },
];

/**
 * What the server advertises: one entry per tool, under the product's own name.
 *
 * Every tool used to be listed twice, once as `ambit_*` and once as the legacy
 * `tt_*`, so `tools/list` returned 96 entries for 48 tools, about 29KB, of
 * which half was the alias set. That is roughly 3,600 tokens of duplication in
 * the context of every agent that connects, which is a strange thing to ship
 * from a project whose subject is agents drowning in undifferentiated tools.
 *
 * `tt_*` still *dispatches*, see tools/call in server.ts, so a config written
 * before the rename keeps working. It is no longer advertised, because an
 * alias costs nothing to accept and a great deal to announce.
 */
const TOOLS = BASE_TOOLS.map(t => ({ ...t, name: `ambit_${t.name}` }));

/**
 * The ten tools an agent working on a task reaches for, in the order it
 * reaches for them: know the environment, ask before acting, see what is
 * missing and what closes it, prove a capability works, report a failure,
 * draft a change, put a skill on the map.
 *
 * The rest of the catalogue is for the person or the agent reading how the
 * system is doing, and sixty tool descriptions in the context of a session
 * that only ever asks `ambit_can` is most of the cost of connecting. A profile
 * is a shorter *listing* and nothing more: every tool still answers when it
 * is called by name, and no tool is hidden for safety. What may be done is
 * decided by the graph's grants, never by which tools an agent was shown.
 */
const AGENT_TOOLS = [
  'briefing',
  'can',
  'next',
  'impact',
  'plan',
  'goal',
  'verify',
  'record_failure',
  'propose',
  'register_skill',
] as const;

type Profile = 'full' | 'agent';

const PROFILES: Record<Profile, typeof TOOLS> = {
  full: TOOLS,
  agent: AGENT_TOOLS.map(n => TOOLS.find(t => t.name === `ambit_${n}`) as (typeof TOOLS)[number]),
};

export {
  AGENT_TOOLS,
  BASE_TOOLS,
  CAPABILITY_KEYS,
  PROFILES,
  TOOLS,
  type Annotations,
  type Profile,
  type Prop,
  type ToolDef,
};
