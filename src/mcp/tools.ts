/**
 * Every tool this server offers, and the names it advertises them under.
 *
 * Pure data — no engine imports, no database. Split out of server.ts, which
 * held the catalogue, the JSON-RPC framing, a warm database handle and a
 * forty-eight-case dispatch switch in 870 lines. What a tool *is* and what it
 * *does* are different questions, and they are answered in different files now.
 */

const BASE_TOOLS = [
  {
    name: 'stats',
    description: 'Toolchain maturity overview',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'context',
    description: 'Session context block',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cap',
    description: 'Capabilities by domain or name',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'decay',
    description: 'Decaying capabilities',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'combos',
    description: 'Auto-discovered combos',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'diff', description: 'Session diff', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'health',
    description: 'Domain health scores',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bottlenecks',
    description: 'High-leverage capabilities',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'impact',
    description: 'Impact analysis for a capability',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'near',
    description: 'Near-miss combos — 1-2 prerequisites away with high existing maturity',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'verify',
    description:
      "Run a capability's declared check and record the outcome. Proves the action works rather than that it is configured. Omit capId to run every declared check.",
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string', description: 'Capability to verify, e.g. local-runtime' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'evidence',
    description:
      'Verification history for one capability — what was tried, when, and whether it passed',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'authority',
    description:
      'Which reached capabilities may run unattended and which require approval. Being able to perform an action is not permission to.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'actions',
    description:
      'The concrete actions a capability confers and whether each may be performed — read a repository yes, merge to its default branch no. Ask this before acting, not authority, which answers at the coarser grain.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string', description: 'Capability to list actions for; omit for all' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'plan',
    description:
      'What is missing for a capability, in the order it must be closed, including which steps require a person',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'goal',
    description:
      'Route a free-form goal (a sentence, not an id) to the capabilities that plausibly cover it, ranked, each with its plan delta. Use this when the user wants something and neither of you knows the capability id.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'What the user wants to be able to do, in their words',
        },
      },
      required: ['goal'],
    },
  },
  {
    name: 'paths',
    description:
      'The alternative ways to reach a capability, compared by setup time, risk and lock-in — which steps are a config change §10 can undo, and which are an installer that cannot be reversed',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'preferences',
    description:
      "What each person prefers, and which plans would fight it — a preference is a word plan matches against a step's alternatives (local vs hosted, one-off vs recurring). Pass a name for one person.",
    inputSchema: { type: 'object', properties: { who: { type: 'string' } } },
  },
  {
    name: 'scope',
    description:
      'What a scope actually covers, and what it does not. Given a target an action would touch (repo:owner/name, device:nuc, svc:ollama), lists every authority grant, whether its scope covers the target, and the effective mode the covering grants resolve to. Scope was recorded; this checks it.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
  },
  {
    name: 'affordances',
    description:
      'The structural domain of each capability — derived from the graph, not pasted on. institutional needs an authority holder, economic a budget and counterparty, cognitive a person supplies it, physical a device runs it. Use this to reason about what kind of world an action operates in.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'digest',
    description:
      'How much of the work still runs through the human, and which interventions are likely reducible — approvals and permission blocks that recur against the same capability are infrastructure shaped like a person. Pass a window in days (default 7).',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'work',
    description:
      'Recent work runs, each with what it cost — elapsed time, events, capabilities exercised, human interventions, resources consumed. The observation the economic loop runs on.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'usage',
    description:
      'Where capability effort actually went over a window — times exercised, duration, interventions per capability. Pass a window in days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'run_begin',
    description:
      'Start a work run. Returns the run id every later telemetry call attaches to. The run is open until run_end.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        goalId: { type: 'string' },
        runType: { type: 'string' },
        source: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'run_end',
    description:
      'Close a work run with its outcome, and the value of that outcome in cents when it is known.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        outcome: { type: 'string' },
        outcomeValueCents: { type: 'number' },
      },
      required: ['runId', 'outcome'],
    },
  },
  {
    name: 'work_event',
    description:
      "Record one observation into a run: a tool/event, a capability use, a human intervention, a resource, or the run's outcome. Kinds: event, use, intervention, resource, outcome. The kind of a human intervention is one of judgment, authority, knowledge, physical, clerical, exception.",
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        kind: { type: 'string', description: 'event | use | intervention | resource | outcome' },
        eventKind: { type: 'string' },
        actor: { type: 'string' },
        capabilityId: { type: 'string' },
        action: { type: 'string' },
        detail: { type: 'string' },
        durationSeconds: { type: 'number' },
        interventionKind: {
          type: 'string',
          description: 'judgment | authority | knowledge | physical | clerical | exception',
        },
        activeSeconds: { type: 'number' },
        waitingSeconds: { type: 'number' },
        resourceId: { type: 'string' },
        resourceKind: { type: 'string' },
        quantity: { type: 'number' },
        unit: { type: 'string' },
        costCents: { type: 'number' },
        achieved: { type: 'string' },
        objectiveName: { type: 'string' },
        objectiveMetric: { type: 'number' },
        valueCents: { type: 'number' },
      },
      required: ['runId', 'kind'],
    },
  },
  {
    name: 'economics',
    description:
      'Declared costs and goal values — attention value per hour, recurring costs, purchase costs, and what each goal is worth. The model that ranks investments by return.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'goal_value',
    description:
      "One goal's economics — occurrence rate, success value, failure cost — matched by id or name.",
    inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
  },
  {
    name: 'opportunities',
    description:
      'Ranked structural changes worth making: recurring middleware burden from the work ledger, priced by attention value and compared by setup cost. Objectives: attention (default), cash, roi, reliability, frontier. Pass budget (dollars) to get the best combination within it.',
    inputSchema: {
      type: 'object',
      properties: {
        by: { type: 'string', description: 'attention | cash | roi | reliability | frontier' },
        budget: { type: 'number', description: 'dollars to allocate across opportunities' },
      },
    },
  },
  {
    name: 'opportunity',
    description:
      'One ranked opportunity in full — burden, proposed capability, acquisition, expected effect, payback, confidence.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'can',
    description:
      'Ask before running a tool you have not used this session. Answers verdict yes (act), ask (put it to the person) or no (do not retry it under another name), with the reason, what is missing, the governing grant, scope and remaining budget. One indexed read of the graph — nothing is probed or executed. A no records the deficit itself, so a wall you hit repeatedly becomes visible as infrastructure that should exist. An agent can ask; it can never grant.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string' },
        capId: { type: 'string' },
        action: { type: 'string' },
        actor: { type: 'string' },
        target: { type: 'string' },
        spendCents: { type: 'number' },
        tool: {
          type: 'string',
          description:
            'The tool or command you were about to run, recorded with the deficit on a no.',
        },
        record: {
          type: 'boolean',
          description: 'Record the deficit on a no. Default true — that is the point of asking.',
        },
      },
    },
  },
  {
    name: 'roi',
    description:
      "Realized ROI for an applied proposal: before/after intervention count, human hours, attention dollars and reliability on the affected capability, projected annually, verdict against the proposal's own prediction. Writes the observation back so future predictions learn.",
    inputSchema: {
      type: 'object',
      properties: { proposalId: { type: 'string' } },
      required: ['proposalId'],
    },
  },
  {
    name: 'roi_summary',
    description:
      "The cumulative headline: every applied proposal's observed hours and dollars saved per year, and forecast accuracy (average observed÷predicted ratio, count near forecast). The number to show a buyer.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'catalog',
    description:
      'The ways to acquire a capability — build, buy, subscribe, delegate, hire — compared by setup, one-time and recurring cost, privacy, verification and rollback. The supply side for the demand the opportunity engine finds.',
    inputSchema: {
      type: 'object',
      properties: { capability: { type: 'string' }, capId: { type: 'string' } },
    },
  },
  {
    name: 'audit',
    description:
      "The audit trail: a run end to end, a proposal's steps/approval/enforcement/result, or one person's approvals and interventions. target is a run id, proposal id, human name, or a day window.",
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'run-… | prop-… | human:name | days' } },
    },
  },
  {
    name: 'incidents',
    description:
      "Probe the infrastructure manifest and open an incident run for every offline service, recording detection and the authority decision for its recovery (restart ALLOW / CONFIRM / DENY). The managed-ops loop's first turn.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'incident_resolve',
    description:
      "Close the open incident run for a service with its outcome. MTTR is the ledger's own elapsed time.",
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'svc:key' },
        outcome: { type: 'string' },
      },
      required: ['service', 'outcome'],
    },
  },
  {
    name: 'portfolio',
    description:
      'Across imported federation receipts: where the same human burden recurs in several environments, person-specific SPOFs, and (with budget) which environment would gain most from capex. Reads receipts only, never merges.',
    inputSchema: {
      type: 'object',
      properties: {
        budget: { type: 'number', description: 'dollars to allocate across environments' },
      },
    },
  },
  {
    name: 'since',
    description:
      'What entered the reachable frontier since a past observation, separating what was acquired from what emerged through composition',
    inputSchema: {
      type: 'object',
      properties: {
        when: {
          type: 'string',
          description: 'ISO timestamp; defaults to the earliest observation',
        },
      },
    },
  },
  {
    name: 'blocked',
    description:
      'Record that a task was blocked by a missing capability, and why. The pattern matters more than the instance: the same deficit hit repeatedly as the same cause is infrastructure that should exist. Classification is one of reasoning, knowledge, tool, permission, infrastructure, reliability.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        classification: {
          type: 'string',
          description:
            'Why it was blocked: reasoning, knowledge, tool, permission, infrastructure, or reliability',
        },
        note: { type: 'string', description: 'What you were trying to do' },
      },
    },
  },
  {
    name: 'simulate',
    description:
      'The frontier as it would be if a capability were acquired, including what it unblocks. Pure preview — changes nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        capability: { type: 'string' },
      },
    },
  },
  {
    name: 'propose',
    description:
      'Draft a reviewable acquisition: ordered steps, the alternative chosen and its trade-offs, and the simulated result. Nothing executes here — a person approves the draft (ambit approve), and only steps that are reversible config patches can then be applied.',
    inputSchema: {
      type: 'object',
      properties: {
        capId: { type: 'string' },
        capabilityId: { type: 'string' },
        option: { type: 'number', description: 'Which alternative to choose, 0-based' },
      },
    },
  },
  {
    name: 'proposals',
    description: 'Every proposal drafted so far, newest first',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'proposal',
    description: 'One proposal in full, with its steps and simulated frontier',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'spof',
    description:
      'Capabilities with exactly one provider — where redundancy is absent. Distinct from bottlenecks, which ranks leverage rather than fragility.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'credentials',
    description:
      'What revoking each credential would end. Providers presenting the same credential fail together, so several providers is not necessarily redundancy.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'deficits',
    description:
      'Recurring capability deficits, worst first — which missing capabilities keep stopping different work',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ledger',
    description:
      "Every recorded frontier observation — how the system's capacity for action has changed over time",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'briefing',
    description:
      'What this environment is, before you touch it: what is reached and proven, what is configured but failing, what is waiting on a person, what blocked work recently, what is worth reaching next, and what changed since the last briefing. Read this at the start of a session rather than inferring the stack from what you happen to try. Also available as the resource ambit://briefing.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'boolean', description: 'Return the prose form rather than the fields.' },
      },
    },
  },
  {
    name: 'next',
    description:
      'The capabilities worth reaching next, each with why, what it costs, and the command that would propose it. Ranked by what has actually blocked work once the ledger has observations, and by leverage per hour of setup before then — the answer says which.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'record_failure',
    description:
      'Report a tool failure you just hit, as the runtime reported it — exit code, error text, or the error kind. Ambit classifies it (tool, permission, infrastructure, reliability), attributes it to a capability where it can, and keeps it either way. Cheaper and more honest than deciding yourself whether it was worth recording.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string' },
        message: { type: 'string' },
        exitCode: { type: 'number' },
        errorKind: { type: 'string' },
        capabilityId: { type: 'string' },
      },
    },
  },
  {
    name: 'signals',
    description:
      'Failures observed in the window without anyone recording them, by class and by tool — including the ones Ambit could not attribute to any capability, which are a gap in the model rather than in the environment.',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'register_skill',
    description:
      'Put a skill you wrote on the map: an id, the capability it supplies, and a read-only command that proves it still works. The check is required — an unverifiable claim of new capability is worth less than nothing — and it runs immediately, so the registration either arrives proven or arrives honest about failing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        provides: { type: 'string' },
        verify: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id', 'verify'],
    },
  },
  {
    name: 'skills',
    description: 'What has been registered this way, and what each check last said.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'promotions',
    description:
      "Authority thresholds: which grants a person has said may widen on evidence, how much evidence each still needs, and what has already been promoted or put back. Setting a threshold is a person's act on the CLI — an agent can read this, never set it.",
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * What the server advertises: one entry per tool, under the product's own name.
 *
 * Every tool used to be listed twice, once as `ambit_*` and once as the legacy
 * `tt_*`, so `tools/list` returned 96 entries for 48 tools — about 29KB, of
 * which half was the alias set. That is roughly 3,600 tokens of duplication in
 * the context of every agent that connects, which is a strange thing to ship
 * from a project whose subject is agents drowning in undifferentiated tools.
 *
 * `tt_*` still *dispatches* — see tools/call below — so a config written
 * before the rename keeps working. It is no longer advertised, because an
 * alias costs nothing to accept and a great deal to announce.
 */
const TOOLS = BASE_TOOLS.map(t => ({ ...t, name: `ambit_${t.name}` }));

export { BASE_TOOLS, TOOLS };
