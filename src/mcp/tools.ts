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
const str = (description?: string): Prop => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string): Prop => ({ type: 'number', ...(description ? { description } : {}) });
const bool = (description?: string): Prop => ({ type: 'boolean', ...(description ? { description } : {}) });

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
      'Return summary counts of capabilities: total catalogued, reached, verified working, failing checks, and reach breakdown by domain. Use to inspect high-level graph metrics. To run active verification checks on capabilities, use ambit_verify instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'context',
    description:
      'Retrieve the session briefing as a single block of plain-text prose, suitable for system prompt injection. To inspect structured capability fields or JSON, use ambit_briefing instead.',
    inputSchema: NONE,
    annotations: WRITES,
  },
  {
    name: 'cap',
    description:
      'Find capabilities in the graph matching a search query by domain, id, or name, returning capability IDs used by other tools. Use to discover capability IDs. If you already have a target capability ID and need an acquisition plan, use ambit_plan instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Search query matching capability names, IDs, domains, or aliases'),
      },
      required: ['query'],
    },
    annotations: READS,
  },
  {
    name: 'decay',
    description:
      'Identify unexercised reached capabilities whose configurations have not been modified or verified recently, including elapsed days since last change. Use to detect stale tools at risk of silent failure. To execute active checks, use ambit_verify instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'combos',
    description:
      'List multi-capability combinations currently supported by this machine where every prerequisite is met, with confidence ratings. Use to discover emergent capabilities. To inspect near-miss combinations missing one prerequisite, use ambit_near instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'diff',
    description:
      'Summarize recent capability practices, improvements, and regressions per domain, derived from the last 50 recorded session outcomes. Use to review recent performance trends. To inspect raw telemetry runs, use ambit_work instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'health',
    description:
      'Compute aggregate health scores across capability domains, evaluating reach, verification pass rates, and decay. Use to get an overview of overall stack stability. To inspect individual failing capabilities, use ambit_stats or ambit_verify instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'bottlenecks',
    description:
      'Identify keystone capabilities that the most other capabilities depend on, highlighting where improvements yield high leverage and failures create wide outages. Use to prioritize hardening. To inspect blast radius of a single node, use ambit_impact instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'impact',
    description:
      'Analyze blast radius and downstream dependencies: identifies which capabilities would stop and which would only lose a provider if a capability went away. Use before deprecating or disabling tools. To test current operational health, use ambit_verify instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID or credential ID to evaluate blast radius for'),
      },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'near',
    description:
      'Detect near-miss capability combos that are only one or two prerequisites away from being unlocked, ranked by existing foundation maturity. Use to find quick-win capabilities to acquire. For fully unlocked combos, use ambit_combos instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'verify',
    description:
      "Execute declared verification checks against a capability (or all capabilities if capId is omitted) to prove operational correctness and update evidence in the ledger. Invokes external commands or network probes. Use to verify that a tool works. To inspect check history without executing, use ambit_evidence instead.",
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID to verify, or omit to run every declared check'),
      },
    },
    annotations: RUNS,
  },
  {
    name: 'evidence',
    description:
      'Retrieve the verification run history of a capability: timestamps, commands executed, and whether each check passed. Use to inspect historical proof without running checks. To actively execute a check, use ambit_verify instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID to inspect verification history for'),
      },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'authority',
    description:
      'Inspect authority grants for reached capabilities, detailing which may run unattended and which require human approval. Use to audit permissions. To evaluate whether a specific tool call is authorized right now, use ambit_can instead.',
    inputSchema: {
      type: 'object',
      properties: {
        detail: bool('Return full grant details instead of the summary'),
      },
    },
    annotations: READS,
  },
  {
    name: 'actions',
    description:
      'List the specific actions conferred by a capability and whether each is currently authorized (e.g. read repo vs merge to default branch). Omit capId for all. Use to inspect permissible actions. To ask permission before running a command, use ambit_can instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID to inspect allowed actions for, or omit for all'),
      },
    },
    annotations: READS,
  },
  {
    name: 'plan',
    description:
      'Compute the ordered acquisition plan to reach a missing capability, identifying missing prerequisites and human approval steps. Use when planning to close a specific capability gap. To route a natural-language goal, use ambit_goal instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Target capability ID to plan the prerequisites and acquisition route for'),
      },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'goal',
    description:
      'Match a natural-language goal or task specification to the capabilities that fulfill it, ranked with acquisition plan deltas. Use when given an open-ended user objective to map to the tech tree. If you already have the target capability ID, use ambit_plan instead.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: str('Natural language task or objective the user wants to accomplish'),
        judge: bool('Route an unmatched goal with a local judgment model'),
        judgeUrl: str('Loopback URL of that model'),
        spec: str('Or a Spec Kit/OpenSpec dir or tasks.md: what its tasks need'),
      },
    },
    annotations: READS,
  },
  {
    name: 'paths',
    description:
      'Compare multiple acquisition methods for a capability by setup time, risk, and lock-in, distinguishing reversible config changes from irreversible installers. Use to choose between alternative setup methods. To draft a selected alternative, use ambit_propose instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID to compare acquisition paths for'),
      },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'preferences',
    description:
      'Inspect recorded human preferences (local vs hosted, one-off vs recurring) and see which proposed plans would conflict with them. Use to align plan choices with user preferences. To inspect raw preference trait decisions, use ambit_preferences_observed instead.',
    inputSchema: {
      type: 'object',
      properties: {
        who: str('Person name to inspect preferences for'),
      },
    },
    annotations: READS,
  },
  {
    name: 'scope',
    description:
      'Evaluate the effective authority mode across all grants covering a specific target resource, device, or service. Use to inspect effective permission boundaries for a target. To check a single tool call permission, use ambit_can instead.',
    inputSchema: {
      type: 'object',
      properties: {
        target: str('Target identifier (repo:owner/name, device:hostname, svc:key)'),
      },
      required: ['target'],
    },
    annotations: READS,
  },
  {
    name: 'affordances',
    description:
      'List the affordance domains of each capability: institutional (authority holder), economic (budget), cognitive (person), physical (device). Use to understand resource requirements across the capability graph.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'digest',
    description:
      'Analyze human interventions across work runs over a time window, identifying reducible friction like recurring manual approvals that could become bounded grants. Use to optimize human agency. To inspect recent runs, use ambit_work instead.',
    inputSchema: {
      type: 'object',
      properties: {
        days: num('Window in days to analyze (default 7)'),
      },
    },
    annotations: READS,
  },
  {
    name: 'work',
    description:
      'List recent work runs and their recorded costs: elapsed time, events, capabilities exercised, human interventions, and resources. Use to audit execution history. To inspect human intervention patterns, use ambit_digest instead.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: num('Maximum number of recent work runs to return'),
      },
    },
    annotations: READS,
  },
  {
    name: 'usage',
    description:
      'Analyze capability utilization over a time window in days: invocation count, active duration, and intervention frequency per capability. Use to evaluate where effort and tokens go. To inspect unrecorded failure signals, use ambit_signals instead.',
    inputSchema: {
      type: 'object',
      properties: {
        days: num('Window in days (default 30)'),
        unmapped: bool('Include tools used that no node covers'),
        windows: bool('Include tokens per five-hour window, and time left in this one'),
      },
    },
    annotations: READS,
  },
  {
    name: 'run_begin',
    description:
      'Start a new work run in the telemetry ledger, returning a run ID to attach subsequent events and resource tracking. Call at the start of a multi-step task. Close the run with ambit_run_end upon completion.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: str('Goal or task description for this run'),
        goalId: str('Optional goal identifier'),
        runType: str('Classification of run: task, incident, maintenance'),
        source: str('Runtime or agent system initiating the run'),
        id: str('Explicit run ID, or omit to auto-generate'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'run_end',
    description:
      'Close an open work run in the telemetry ledger with its outcome classification and estimated delivered value. Call upon completing or aborting a task opened with ambit_run_begin.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: str('Run ID to close'),
        outcome: str('Outcome classification: success, failed, aborted'),
        outcomeValueCents: num('Estimated value of outcome in cents'),
      },
      required: ['runId', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'work_event',
    description:
      'Record a specific telemetry observation into an open work run, logging actions, interventions, durations, resource usage, or sub-outcomes. Use during an active work run to track fine-grained execution.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: str('Run ID this event attaches to'),
        kind: str('Event kind: event, use, intervention, resource, outcome'),
        eventKind: str('Sub-classification of the event'),
        actor: str('Actor performing the action'),
        capabilityId: str('Associated capability ID'),
        action: str('Action performed'),
        detail: str('Event details or notes'),
        durationSeconds: num('Duration in seconds'),
        interventionKind: str('Intervention kind: judgment, authority, knowledge, physical, clerical, exception'),
        activeSeconds: num('Active human time in seconds'),
        waitingSeconds: num('Waiting human time in seconds'),
        resourceId: str('Resource identifier'),
        resourceKind: str('Resource kind: token, compute, api_call'),
        quantity: num('Quantity consumed'),
        unit: str('Unit of measurement'),
        costCents: num('Financial cost in cents'),
        achieved: str('Objective outcome achieved'),
        objectiveName: str('Objective name'),
        objectiveMetric: num('Objective metric value'),
        valueCents: num('Value delivered in cents'),
      },
      required: ['runId', 'kind'],
    },
    annotations: WRITES,
  },
  {
    name: 'economics',
    description:
      'Retrieve declared economics configurations: hourly human attention value, standing purchase/recurring tool costs, and declared goal values. Use to inspect pricing parameters. To inspect economics of a specific goal, use ambit_goal_value instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'goal_value',
    description:
      "Retrieve the economic valuation parameters of a specific goal: occurrence rate, value delivered upon success, and cost of failure. Use to price task outcomes. To see all economics settings, use ambit_economics instead.",
    inputSchema: {
      type: 'object',
      properties: {
        goal: str('Goal identifier or name'),
      },
      required: ['goal'],
    },
    annotations: READS,
  },
  {
    name: 'opportunities',
    description:
      'Rank proposed capability acquisitions by recurring human attention burden, financial ROI, or reliability gains, with optional budget caps. Use to find high-ROI capability investments. To inspect a single opportunity, use ambit_opportunity instead.',
    inputSchema: {
      type: 'object',
      properties: {
        by: str('Ranking criterion: attention (default), cash, roi, reliability, frontier'),
        budget: num('Optional budget ceiling in dollars'),
      },
    },
    annotations: READS,
  },
  {
    name: 'opportunity',
    description:
      'Retrieve full details for one ranked opportunity: human burden, proposed capability, acquisition method, expected impact, payback period, and confidence. Use when evaluating a specific suggested upgrade from ambit_opportunities.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Opportunity identifier'),
      },
      required: ['id'],
    },
    annotations: READS,
  },
  {
    name: 'can',
    description:
      'Evaluate whether a tool call or capability is authorized before execution. Returns yes (proceed), ask (prompt user for confirmation), or no (prohibited or unmet prerequisite). Records deficits on refusal. Use before calling unfamiliar tools. To test if a capability works, use ambit_verify instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: str('Capability ID or bare name to check permission for'),
        action: str('Specific action to check (e.g. read, write, execute)'),
        actor: str('Agent or actor identifier requesting permission'),
        target: str('Target resource, repository path, or device identifier'),
        spendCents: num('Estimated financial cost of this call in cents'),
        tool: str('Command or tool string about to run, stored with deficit on denial'),
        record: bool('Whether to record a deficit on denial (defaults to true)'),
      },
      required: ['capability'],
    },
    annotations: WRITES,
  },
  {
    name: 'roi',
    description:
      'Measure the realized ROI of an applied proposal by comparing observed interventions, active hours, and reliability before and after adoption against original predictions. Use to assess whether a change paid off. To see cumulative savings, use ambit_roi_summary instead.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: str('Proposal ID (prop-...) to measure realized ROI for'),
      },
      required: ['proposalId'],
    },
    annotations: WRITES,
  },
  {
    name: 'roi_summary',
    description:
      "Summarize cumulative realized savings across all applied proposals: annual hours saved, dollars preserved, and forecast accuracy. Use to view aggregate efficiency gains. For individual proposal metrics, use ambit_roi instead.",
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'catalog',
    description:
      'Compare acquisition channels for a capability (build, buy, subscribe, delegate, hire) across setup effort, recurring cost, privacy profile, and rollback difficulty. Use to evaluate supply options before drafting a proposal with ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: str('Capability ID to compare acquisition channels for'),
      },
      required: ['capability'],
    },
    annotations: READS,
  },
  {
    name: 'audit',
    description:
      "Query the tamper-evident audit trail: full work runs, proposal lifecycles, human approvals, or individual actor interventions. Use for compliance and incident investigations. To inspect historical check runs only, use ambit_evidence instead.",
    inputSchema: {
      type: 'object',
      properties: {
        target: str('Filter target: run-... | prop-... | human:name | days'),
      },
    },
    annotations: READS,
  },
  {
    name: 'incidents',
    description:
      'Probe infrastructure manifests, record host check runs, and open incident work runs for offline services with restart authority recommendations (ALLOW, CONFIRM, DENY). Use during operational outages. To resolve an incident, use ambit_incident_resolve instead.',
    inputSchema: NONE,
    annotations: PROBES,
  },
  {
    name: 'incident_resolve',
    description:
      "Close an open infrastructure incident run for a service with its recovery outcome, computing Mean Time to Recovery (MTTR) in the ledger. Use after resolving an outage opened by ambit_incidents.",
    inputSchema: {
      type: 'object',
      properties: {
        service: str('Service identifier (svc:key)'),
        outcome: str('Outcome of recovery (e.g. recovered, abandoned)'),
      },
      required: ['service', 'outcome'],
    },
    annotations: WRITES,
  },
  {
    name: 'portfolio',
    description:
      'Analyze imported federation receipts across multiple environments: recurring cross-environment burdens, person-specific single points of failure, and optimal spend allocation. Use for multi-environment portfolio reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        budget: num('Optional budget ceiling in dollars'),
      },
    },
    annotations: READS,
  },
  {
    name: 'since',
    description:
      'List capabilities that entered the reachable frontier between two ISO timestamps, distinguishing newly acquired capabilities from capabilities emerged through composition. Use to track frontier progress over time.',
    inputSchema: {
      type: 'object',
      properties: {
        when: str('Start ISO timestamp'),
        until: str('End ISO timestamp'),
      },
    },
    annotations: READS,
  },
  {
    name: 'blocked',
    description:
      'Record that a task was blocked by a missing capability or deficit, logging the friction reason and task context. Call when an agent is stopped by an unmet dependency to surface recurring bottlenecks.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID that blocked work'),
        classification: str('Classification: reasoning | knowledge | tool | permission | infrastructure | reliability'),
        note: str('What you were trying to do'),
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'simulate',
    description:
      'Simulate the capability frontier as it would look if a target capability were acquired, previewing newly unlocked downstream capabilities without modifying the graph. Use to evaluate potential acquisitions before proposing them with ambit_propose.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Capability ID to simulate acquiring'),
      },
      required: ['capId'],
    },
    annotations: READS,
  },
  {
    name: 'propose',
    description:
      'Draft a reviewable, reversible configuration proposal to acquire a capability, detailing ordered steps, trade-offs, and simulated outcome. Generates a draft for human approval; does not apply changes. To view already pending proposals, use ambit_pending instead.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: str('Target capability ID to draft an acquisition proposal for'),
        option: num('Which alternative, 0-based'),
        purpose: str('The work this is for, for the person deciding'),
      },
      required: ['capId'],
    },
    annotations: WRITES,
  },
  {
    name: 'proposals',
    description:
      'List all configuration proposals drafted so far, ordered newest first with review status. Use to inspect the pending review queue. To examine the full steps of a single proposal, use ambit_proposal instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'proposal',
    description:
      'Retrieve a single proposal in full: step-by-step diffs, acquisition route, and simulated post-application frontier. Use when reviewing a specific proposal before decision. To list all drafts, use ambit_proposals instead.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Proposal ID (prop-...) to retrieve'),
      },
      required: ['id'],
    },
    annotations: READS,
  },
  {
    name: 'spof',
    description:
      'Identify single points of failure: reached capabilities supported by only one provider, lacking fallback redundancy. Use for resilience audits. To assess keystone dependency leverage, use ambit_bottlenecks instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'credentials',
    description:
      'Audit configured credentials and tokens to list which providers share keys and what capabilities would stop if revoked. Use for security and blast-radius audits. To check single provider dependencies, use ambit_spof instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'deficits',
    description:
      'Rank recurring capability deficits by frequency: identifies missing tools or permissions that have repeatedly blocked agent work. Use to pinpoint highest-friction missing tools. To draft an acquisition for a deficit, use ambit_propose instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'ledger',
    description:
      "Retrieve historical frontier observations recording how system capability reach has evolved over time. Use to analyze longitudinal growth. To inspect recent work runs, use ambit_work instead.",
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'briefing',
    description:
      'Retrieve the structured environment capability briefing: reached and proven nodes, failing checks, pending proposals, work deficits, and recent changes. Call once at session start. To retrieve raw unformatted prose for system prompt injection, use ambit_context instead.',
    inputSchema: {
      type: 'object',
      properties: {
        text: bool('Return prose instead of fields'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'next',
    description:
      'Rank and suggest the highest-leverage capabilities to acquire next, prioritized by past work blockers and setup ROI. Use when seeking the next tool or configuration to unlock. To generate prerequisites for a specific capability, use ambit_plan instead.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: num('Maximum number of ranked next steps to return'),
      },
    },
    annotations: READS,
  },
  {
    name: 'council',
    description:
      'Review the top next-step capability across five perspectives: frontier leverage, foundation stability, historical cost, authority requirements, and verification. Use for holistic evaluation before committing to an acquisition.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'record_failure',
    description:
      'Log a runtime tool failure (exit code, error message, kind) into the failure ledger and attribute it to a capability. Call immediately after an external tool execution fails. Do not use for pre-execution permission denials; use ambit_can instead.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: str('Name or command of tool that failed'),
        message: str('Error message or stderr output'),
        exitCode: num('Process exit code returned'),
        errorKind: str('Classification of failure: timeout | auth | missing_dependency | unknown'),
        capabilityId: str('Associated capability ID, if known'),
      },
    },
    annotations: WRITES,
  },
  {
    name: 'signals',
    description:
      'Scan recent unrecorded failures and classify them by tool and kind, identifying gaps in the capability model. Use to discover unmapped tool errors. To log an active failure, use ambit_record_failure instead.',
    inputSchema: {
      type: 'object',
      properties: {
        days: num('Window in days to scan unrecorded failures (default 7)'),
      },
    },
    annotations: READS,
  },
  {
    name: 'register_skill',
    description:
      'Register an agent-authored skill with an id, capability mapping, and read-only verification command, immediately executing the check. Use when registering newly created scripts or tools. To inspect existing registered skills, use ambit_skills instead.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Unique skill identifier (e.g. skill:custom-linter)'),
        name: str('Human-readable display name for the skill'),
        provides: str('Capability ID supplied by this skill'),
        verify: str('Read-only shell command to verify the skill works'),
        description: str('Description of what the skill does and when to use it'),
      },
      required: ['id', 'verify'],
    },
    annotations: RUNS,
  },
  {
    name: 'skills',
    description:
      'List all registered custom skills, their associated capabilities, and the latest verification check outcomes. Use to inspect available custom tools. To register a new skill, use ambit_register_skill instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'objects',
    description:
      'Inspect proof and evidence of actions performed against a target resource (e.g. repository, server), showing what has been verified there. Use to check resource-specific track records.',
    inputSchema: {
      type: 'object',
      properties: {
        target: str('Target identifier (e.g. repo:owner/name) to inspect proof for'),
      },
    },
    annotations: READS,
  },
  {
    name: 'budgets',
    description:
      'Inspect standing spend budgets: allocated limits, amounts consumed, and remaining headroom for the current billing period. Use before making costly API calls. To check if a call exceeds budget, use ambit_can instead.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'reversible',
    description:
      'List unreached capabilities that can be acquired autonomously without human intervention because their setup steps have guaranteed inverse operations. Use to identify self-service improvements.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'preferences_observed',
    description:
      'Summarize human approvals and refusals grouped by operational traits (local vs hosted, one-off vs recurring). Use to guide plan generation toward approved traits and away from contested ones.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'pending',
    description:
      'List all configuration proposals currently awaiting human decision, detailing financial costs and unlocked capabilities. Use to batch approval requests into a single review interaction.',
    inputSchema: NONE,
    annotations: READS,
  },
  {
    name: 'promotions',
    description:
      'Inspect authority threshold rules: which grants can widen automatically based on evidence, how much proof remains needed, and recent promotions or demotions. Use to track autonomous authority progression.',
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
