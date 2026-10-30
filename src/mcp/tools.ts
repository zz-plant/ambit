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
  title?: string;
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
    description: 'Counts: total, reached, verified, failing. Test: ambit_verify.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'context',
    description: 'Briefing as prose for prompts. Structured: ambit_briefing.',
    inputSchema: NONE,
    annotations: WRITES,
  },
  {
    name: 'cap',
    description: 'Capabilities by query, as IDs. Route: ambit_plan.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Search query') },
      required: ['query'],
    },
    annotations: READS,
  },
  {
    name: 'decay',
    description: 'Unchanged capabilities, and days since their last config change.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'combos',
    description: 'Combos whose prerequisites are met. Near misses: ambit_near.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'diff',
    description: 'Recent practices and regressions by domain. Traces: ambit_work.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'health',
    description: 'Health scores by domain, from reach and pass rates. Test: ambit_verify.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'bottlenecks',
    description: 'Capabilities with the most dependents. Impact: ambit_impact.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'impact',
    title: 'Dependency Impact Analysis',
    description: 'What depends on a capability, and what fails with it. Test: ambit_verify.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'near',
    description: 'Combos 1-2 prerequisites away, ranked. Ready: ambit_combos.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'verify',
    title: 'Verification Check',
    description: 'Run declared checks. Omit capId to run every one.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID (omit for all)') },
    },
    annotations: RUNS,
  },
  {
    name: 'evidence',
    description: 'Past check runs for a capability. Run one: ambit_verify.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'authority',
    description: 'Authority grants: runs without asking or asks first. Check a call: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { detail: bool('Full details') },
    },
    annotations: READS,
  },
  {
    name: 'actions',
    description: 'Actions a capability allows. Omit capId for all. Permit: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID (omit for all)') },
    },
    annotations: READS,
  },
  {
    name: 'plan',
    title: 'Acquisition Plan',
    description: 'Ordered steps to acquire a capability. Goals: ambit_goal.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Target capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'goal',
    title: 'Goal Capability Routing',
    description: 'Route a goal or spec tasks to capabilities. Known ID: ambit_plan.',
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
    description: 'Acquisition methods by time, risk and lock-in. Draft: ambit_propose.',
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
      'Preferences (local or hosted) and plan conflicts. Observed: ambit_preferences_observed.',
    inputSchema: {
      type: 'object',
      properties: { who: str('Person name') },
    },
    annotations: READS,
  },
  {
    name: 'scope',
    description: 'Authority mode a target resolves to. Check a call: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Target identifier') },
      required: ['target'],
    },
    annotations: READS,
  },
  {
    name: 'affordances',
    description: 'Affordance domains: institutional, economic, cognitive, physical.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'digest',
    description:
      'Human interventions over a window: which capability interrupts you most. Runs: ambit_work.',
    inputSchema: {
      type: 'object',
      properties: { days: num('Window in days') },
    },
    annotations: READS,
  },
  {
    name: 'work',
    description:
      'Recent runs and costs: time, events, tools, interventions. Interruptions: ambit_digest.',
    inputSchema: {
      type: 'object',
      properties: { limit: num('Max runs') },
    },
    annotations: READS,
  },
  {
    name: 'usage',
    description: 'Calls, duration and interventions by day. Errors: ambit_signals.',
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
    description: 'Open a work run to track events and costs. End: ambit_run_end.',
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
    description: 'Close a work run with its outcome and delivered value. Start: ambit_run_begin.',
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
    description: 'Record an event, intervention, resource use or outcome into a run.',
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
    description: 'Declared costs: hourly rate, tools, goal values. One goal: ambit_goal_value.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'goal_value',
    description: 'Goal value: frequency, success value, failure cost. All: ambit_economics.',
    inputSchema: {
      type: 'object',
      properties: { goal: str('Goal ID') },
      required: ['goal'],
    },
    annotations: READS,
  },
  {
    name: 'opportunities',
    description: 'Opportunities ranked by attention, ROI or reliability. One: ambit_opportunity.',
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
    description: 'One opportunity: attention, method, impact, payback. All: ambit_opportunities.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Opportunity ID') },
      required: ['id'],
    },
    annotations: READS,
  },
  {
    name: 'can',
    title: 'Authority Gate',
    description: 'Is a tool call authorized? yes/ask/no; records deficits. Test: ambit_verify.',
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
      'Realized ROI of one applied proposal: hours, reliability. Totals: ambit_roi_summary.',
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
      'Savings across applied proposals: hours, dollars, forecast accuracy. One: ambit_roi.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'catalog',
    description: 'Acquisition channels: build, buy, subscribe, delegate. Draft: ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: { capability: str('Capability ID') },
      required: ['capability'],
    },
    annotations: READS,
  },
  {
    name: 'audit',
    description: 'The trail: work runs, proposals, approvals, actions. Checks: ambit_evidence.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Filter target') },
    },
    annotations: READS,
  },
  {
    name: 'incidents',
    description: 'Probe infrastructure and open incident runs. Fix: ambit_incident_resolve.',
    inputSchema: NONE,
    annotations: PROBES,
  },
  {
    name: 'incident_resolve',
    description: 'Close an incident run with recovery outcome and MTTR. After: ambit_incidents.',
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
      'Federation receipts: attention, single points of failure, spend. Local: ambit_stats.',
    inputSchema: {
      type: 'object',
      properties: { budget: num('Budget cap dollars') },
    },
    annotations: READS,
  },
  {
    name: 'since',
    description: 'Capabilities added or unlocked between two times, new or composed.',
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
    description: 'Record work blocked by a missing capability, with context.',
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
    description: 'What acquiring a capability would unlock. Draft: ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: { capId: str('Capability ID') },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'propose',
    title: 'Configuration Proposal',
    description: 'Draft a reversible change with its diffs. Queue: ambit_proposals.',
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
    description: 'Drafted proposals and their review status. Diffs: ambit_proposal.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'proposal',
    description: 'One proposal: steps, diffs, simulated frontier. All: ambit_proposals.',
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
      'Single points of failure: capabilities with one provider. Dependents: ambit_bottlenecks.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'credentials',
    description: 'Shared keys and what revoking one would break. Redundancy: ambit_spof.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'deficits',
    description: 'Deficits by how often they blocked work. Draft: ambit_propose.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'ledger',
    description: 'Frontier observations over time: how reach changed. Runs: ambit_work.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'briefing',
    title: 'Capability Briefing',
    description: 'Briefing: reached nodes, failing checks, proposals. Call at session start.',
    inputSchema: {
      type: 'object',
      properties: { text: bool('Return prose format') },
    },
    annotations: WRITES,
  },
  {
    name: 'next',
    title: 'Next Step Recommendation',
    description: 'Capabilities to acquire next, by blockers then ROI. Steps: ambit_plan.',
    inputSchema: {
      type: 'object',
      properties: { limit: num('Max ranked steps') },
    },
    annotations: READS,
  },
  {
    name: 'council',
    description:
      'The top next capability read five ways: frontier, fragility, ledger, authority, checks.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'record_failure',
    title: 'Tool Failure Logger',
    description: 'Log a tool failure (tool, exit code, error). Permission: ambit_can.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: str('Failed tool command'),
        message: str('Error message or stderr'),
        exitCode: num('Process exit code'),
        errorKind: str('Runtime-reported error kind; omit if not supplied by runtime'),
        capabilityId: str('Associated capability ID'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'signals',
    description: 'Unrecorded tool failures and unmapped errors. Log one: ambit_record_failure.',
    inputSchema: {
      type: 'object',
      properties: { days: num('Window in days') },
    },
    annotations: READS,
  },
  {
    name: 'register_skill',
    title: 'Custom Skill Registration',
    description: 'Register a skill: ID, capability, read-only check. Runs the check.',
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
      'Registered skills, their capabilities and check status. Add: ambit_register_skill.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'objects',
    description: 'Actions and proof for a resource (repo, host). Scope: ambit_scope.',
    inputSchema: {
      type: 'object',
      properties: { target: str('Target identifier') },
    },
    annotations: READS,
  },
  {
    name: 'budgets',
    description: 'Spend budgets: limits, spent, headroom. Check a call: ambit_can.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'reversible',
    description: 'Unreached capabilities acquirable without asking. Plan: ambit_plan.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'preferences_observed',
    description: 'Approvals and refusals by trait (local or hosted). Declared: ambit_preferences.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'pending',
    description: 'Proposals waiting on a person, with costs and nodes. Draft: ambit_propose.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'promotions',
    description: 'Grants widening on evidence, and recent moves. Grants: ambit_authority.',
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
