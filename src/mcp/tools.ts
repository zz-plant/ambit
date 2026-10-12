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
const str = (description?: string): Prop => ({
  type: 'string',
  ...(description ? { description } : {}),
});
const num = (description?: string): Prop => ({
  type: 'number',
  ...(description ? { description } : {}),
});
const bool = (description?: string): Prop => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});

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
      'Capability counts: total, reached, verified, failing. For testing, use ambit_verify.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'context',
    description:
      'Session briefing as plain prose for prompts. For structured data, use ambit_briefing.',
    inputSchema: NONE,
    annotations: WRITES,
  },
  {
    name: 'cap',
    description: 'Find capabilities by query. Returns IDs. For acquisition route, use ambit_plan.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Search query') },
      required: ['query'],
    },
    annotations: READS,
  },
  {
    name: 'decay',
    description: 'Reached capabilities not verified recently. For active checks, use ambit_verify.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'combos',
    description: 'Multi-capability combos with prerequisites met. For near-misses, use ambit_near.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'diff',
    description:
      'Recent practices and regressions per domain. For execution traces, use ambit_work.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'health',
    description:
      'Health scores per domain from reach and pass rates. To test nodes, use ambit_verify.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'bottlenecks',
    description: 'Keystone capabilities others depend on most. For blast radius, use ambit_impact.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'impact',
    description:
      'Downstream dependents and blast radius of a node. To test health, use ambit_verify.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'near',
    description:
      'Combos missing 1-2 prerequisites, ranked by maturity. Ready combos: ambit_combos.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'verify',
    description:
      'Run declared verification checks to prove a capability works. Omit capId for all.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID (omit for all)') },
    },
    annotations: RUNS,
  },
  {
    name: 'evidence',
    description:
      'Verification run history for a capability: passes and fails. To run: ambit_verify.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'authority',
    description:
      'Inspect authority grants: unattended vs human approval needed. Call check: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { detail: bool('Full details') },
    },
    annotations: READS,
  },
  {
    name: 'actions',
    description:
      'Actions allowed by a capability. Omit capId for all. Permission check: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID (omit for all)') },
    },
    annotations: READS,
  },
  {
    name: 'plan',
    description:
      'Ordered plan to acquire a missing capability, with prerequisites. Goals: ambit_goal.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Target capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'goal',
    description:
      'Route a goal or spec tasks to capabilities, with plans. For known ID: ambit_plan.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: str('Goal prompt'),
        judge: bool('Local judge'),
        judgeUrl: str('Judge URL'),
        spec: str('Spec path'),
      },
    },
    annotations: READS,
  },
  {
    name: 'paths',
    description: 'Compare acquisition methods by time, risk, and lock-in. To draft: ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'preferences',
    description:
      'Human preferences (local/hosted) and plan conflicts. Recorded: ambit_preferences_observed.',
    inputSchema: {
      type: 'object',
      properties: { who: str('Person name') },
    },
    annotations: READS,
  },
  {
    name: 'scope',
    description: 'Effective authority mode across grants covering a target. Call check: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Target identifier') },
      required: ['target'],
    },
    annotations: READS,
  },
  {
    name: 'affordances',
    description: 'Affordance domains per capability: institutional, economic, cognitive, physical.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'digest',
    description:
      'Analyze human interventions over a window to find friction. Raw runs: ambit_work.',
    inputSchema: {
      type: 'object',
      properties: { days: num('Window in days') },
    },
    annotations: READS,
  },
  {
    name: 'work',
    description:
      'Recent work runs and costs: time, events, tools, interventions. Friction: ambit_digest.',
    inputSchema: {
      type: 'object',
      properties: { limit: num('Max runs') },
    },
    annotations: READS,
  },
  {
    name: 'usage',
    description:
      'Capability usage over days: calls, duration, and interventions. Errors: ambit_signals.',
    inputSchema: {
      type: 'object',
      properties: {
        days: num('Days window'),
        unmapped: bool('Include unmapped'),
        windows: bool('Token windows'),
      },
    },
    annotations: READS,
  },
  {
    name: 'run_begin',
    description:
      'Start a work run in the telemetry ledger to track events and costs. End: ambit_run_end.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: str('Goal prompt'),
        goalId: str('Goal ID'),
        runType: str('Run type'),
        source: str('Source'),
        id: str('Run ID'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'run_end',
    description:
      'Close an open work run with outcome and delivered value in cents. Started by ambit_run_begin.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: str('Run ID to close'),
        outcome: str('Outcome status'),
        outcomeValueCents: num('Value in cents'),
      },
      required: ['runId', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'work_event',
    description: 'Record an event, intervention, resource use, or outcome into an active work run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: str('Run ID'),
        kind: str('Event kind'),
        eventKind: str('Sub-kind'),
        actor: str('Actor ID'),
        capabilityId: str('Capability ID'),
        action: str('Action'),
        detail: str('Event details'),
        durationSeconds: num('Duration secs'),
        interventionKind: str('Kind'),
        activeSeconds: num('Active secs'),
        waitingSeconds: num('Waiting secs'),
        resourceId: str('Resource ID'),
        resourceKind: str('Kind'),
        quantity: num('Quantity'),
        unit: str('Unit'),
        costCents: num('Cost in cents'),
        achieved: str('Achieved flag'),
        objectiveName: str('Objective name'),
        objectiveMetric: num('Metric value'),
        valueCents: num('Value in cents'),
      },
      required: ['runId', 'kind'],
    },
    annotations: WRITES,
  },
  {
    name: 'economics',
    description:
      'Declared economics: hourly rate, tool costs, goal values. Single goal: ambit_goal_value.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'goal_value',
    description:
      'Valuation of a goal: frequency, success value, failure cost. All: ambit_economics.',
    inputSchema: {
      type: 'object',
      properties: { goal: str('Goal ID') },
      required: ['goal'],
    },
    annotations: READS,
  },
  {
    name: 'opportunities',
    description:
      'Rank proposed acquisitions by attention, ROI, or reliability. Details: ambit_opportunity.',
    inputSchema: {
      type: 'object',
      properties: {
        by: str('Rank criterion'),
        budget: num('Budget cap dollars'),
      },
    },
    annotations: READS,
  },
  {
    name: 'opportunity',
    description:
      'Details for one ranked opportunity: burden, method, impact, payback. List: ambit_opportunities.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Opportunity ID') },
      required: ['id'],
    },
    annotations: READS,
  },
  {
    name: 'can',
    description:
      'Check if a tool call is authorized. Returns yes/ask/no; records deficits. Test: ambit_verify.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: str('Capability ID or name'),
        action: str('Action to check'),
        actor: str('Requesting actor ID'),
        target: str('Target resource'),
        spendCents: num('Estimated cost cents'),
        tool: str('Command to run'),
        record: bool('Record deficit on denial'),
      },
      required: ['capability'],
    },
    annotations: WRITES,
  },
  {
    name: 'roi',
    description:
      'Realized ROI of an applied proposal: interventions, hours, reliability. Totals: ambit_roi_summary.',
    inputSchema: {
      type: 'object',
      properties: { proposalId: str('Proposal ID') },
      required: ['proposalId'],
    },
    annotations: WRITES,
  },
  {
    name: 'roi_summary',
    description:
      'Realized savings across applied proposals: hours, dollars, forecast accuracy. Single: ambit_roi.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'catalog',
    description:
      'Compare acquisition channels (build, buy, subscribe, delegate). To draft: ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: { capability: str('Capability ID') },
      required: ['capability'],
    },
    annotations: READS,
  },
  {
    name: 'audit',
    description:
      'Query audit trail: work runs, proposals, approvals, actions. Check history: ambit_evidence.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Filter target') },
    },
    annotations: READS,
  },
  {
    name: 'incidents',
    description:
      'Probe infrastructure and open incident runs for offline services. Fix: ambit_incident_resolve.',
    inputSchema: NONE,
    annotations: PROBES,
  },
  {
    name: 'incident_resolve',
    description:
      'Close an infrastructure incident run with recovery outcome and MTTR. After ambit_incidents.',
    inputSchema: {
      type: 'object',
      properties: {
        service: str('Service ID (svc:key)'),
        outcome: str('Recovery outcome'),
      },
      required: ['service', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'portfolio',
    description:
      'Federation receipts across environments: burdens, SPOFs, spend. Local stats: ambit_stats.',
    inputSchema: {
      type: 'object',
      properties: { budget: num('Budget cap dollars') },
    },
    annotations: READS,
  },
  {
    name: 'since',
    description: 'Capabilities entering the frontier between two timestamps (new vs composed).',
    inputSchema: {
      type: 'object',
      properties: {
        when: str('Start timestamp'),
        until: str('End timestamp'),
      },
    },
    annotations: READS,
  },
  {
    name: 'blocked',
    description:
      'Record that work was blocked by a missing capability or deficit, logging context.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Blocking capability ID'),
        classification: str('Deficit category'),
        note: str('Task context'),
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'simulate',
    description:
      'Simulate frontier if a capability were acquired, previewing unlocked nodes. ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'propose',
    description:
      'Draft a reversible proposal to acquire a capability, with diffs. Review queue: ambit_proposals.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Target capability ID'),
        option: num('Alternative index'),
        purpose: str('Reviewer context'),
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'proposals',
    description:
      'List drafted configuration proposals with review status. For step diffs, use ambit_proposal.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'proposal',
    description:
      'Retrieve proposal with steps, diffs, and simulated frontier. List all: ambit_proposals.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Proposal ID') },
      required: ['id'],
    },
    annotations: READS,
  },
  {
    name: 'spof',
    description:
      'Identify single points of failure: capabilities with only one provider. Keystone: ambit_bottlenecks.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'credentials',
    description:
      'Audit credentials to identify shared keys and revocation blast radius. Redundancy: ambit_spof.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'deficits',
    description:
      'Rank recurring deficits by frequency: missing tools blocking work. To draft: ambit_propose.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'ledger',
    description:
      'Historical frontier observations showing how capability reach evolved. Work runs: ambit_work.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'briefing',
    description:
      'Environment capability briefing: reached nodes, failing checks, proposals. Call at session start.',
    inputSchema: {
      type: 'object',
      properties: { text: bool('Return prose format') },
    },
    annotations: WRITES,
  },
  {
    name: 'next',
    description:
      'Rank capabilities to acquire next, prioritized by blockers and ROI. Prerequisites: ambit_plan.',
    inputSchema: {
      type: 'object',
      properties: { limit: num('Max ranked steps') },
    },
    annotations: READS,
  },
  {
    name: 'council',
    description:
      'Review top next capability across 5 seats: frontier, fragility, ledger, authority, checks.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'record_failure',
    description:
      'Log a runtime tool failure (tool, exit code, error) to the failure ledger. Permission: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: str('Failed tool command'),
        message: str('Error message or stderr'),
        exitCode: num('Process exit code'),
        errorKind: str('Failure classification'),
        capabilityId: str('Associated capability ID'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'signals',
    description:
      'Scan unrecorded tool failures to find unmapped errors. To log an error: ambit_record_failure.',
    inputSchema: {
      type: 'object',
      properties: { days: num('Window in days') },
    },
    annotations: READS,
  },
  {
    name: 'register_skill',
    description:
      'Register an agent skill with ID, capability mapping, and read-only verify command. Runs check.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Skill identifier'),
        name: str('Display name'),
        provides: str('Supplied capability ID'),
        verify: str('Verification command'),
        description: str('Skill description'),
      },
      required: ['id', 'verify'],
    },
    annotations: RUNS,
  },
  {
    name: 'skills',
    description:
      'List registered custom skills, associated capabilities, and check status. Add: ambit_register_skill.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'objects',
    description:
      'Inspect actions and proof for a target resource (repo, host). Permission scope: ambit_scope.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Target identifier') },
    },
    annotations: READS,
  },
  {
    name: 'budgets',
    description:
      'Inspect spend budgets: allocated limits, spent amounts, headroom. Check call spend: ambit_can.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'reversible',
    description:
      'Unreached capabilities acquirable autonomously via guaranteed inverses. Plan: ambit_plan.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'preferences_observed',
    description:
      'Summarize human approvals and refusals by traits (local vs hosted). Preferences: ambit_preferences.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'pending',
    description:
      'List configuration proposals awaiting human decision, with costs and nodes. Draft: ambit_propose.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'promotions',
    description:
      'Authority rules: grants widening on evidence and recent moves. Grant check: ambit_authority.',
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
