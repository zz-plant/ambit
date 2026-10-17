import type { Db } from '../db.ts';
import { classifySignal, type RawFailure } from '../failures.ts';
import { BLOCK_CLASSES } from '../plan/deficits.ts';
import { nextSteps } from '../next.ts';
import { planFor } from '../planning.ts';
import { usable } from '../assurance.ts';
import { KEEPER_KINDS, MIDDLEWARE_KINDS } from '../vocabulary.ts';
import { capabilityCriteria, NONE, type CapabilitySuggestion } from './goals.ts';
import { judgeItems, thresholdOf, validItems, type WorkflowOptions } from './workflow.ts';

export interface ToolDescription {
  name: string;
  description?: string;
  inputSchema?: unknown;
  server?: string;
}
export async function judgeTools(db: Db, tools: ToolDescription[], options: WorkflowOptions = {}) {
  const threshold = thresholdOf(options);
  if (
    !threshold ||
    !validItems(tools) ||
    tools.some(
      t =>
        typeof t.name !== 'string' ||
        !t.name ||
        (t.description !== undefined && typeof t.description !== 'string')
    )
  )
    return { error: 'Supply tool descriptions with nonempty names and a valid threshold.' };
  const result = await judgeItems(
    db,
    'tools',
    tools,
    {
      type: 'choice',
      criteria: capabilityCriteria(),
      instructions:
        'Which capability is advertised by this tool description? Judge the described operation, not whether it has been exercised or authorized.',
    },
    options
  );
  if ('error' in result) return result;
  const suggestions: CapabilitySuggestion[] = result.answers.map((answer, i) => {
    const selected =
      answer.type === 'choice' && answer.choice !== NONE && answer.probability >= threshold;
    return {
      subject: tools[i].name,
      source: 'model',
      evidence_scope: 'advertised',
      capability_ids: selected && answer.type === 'choice' ? [`combo:${answer.choice}`] : [],
      abstained: !selected,
    };
  });
  const { answers: _answers, ...runs } = result;
  return {
    kind: 'tools',
    suggestions,
    ...runs,
    note: 'Advertised operations only. An accepted mapping still needs an authored detection rule and an appropriate declared check.',
  };
}

export type FailureInput = RawFailure & { id: string };
export async function judgeFailures(
  db: Db,
  failures: FailureInput[],
  options: WorkflowOptions = {}
) {
  const threshold = thresholdOf(options);
  if (
    !threshold ||
    !validItems(failures) ||
    failures.some(
      f =>
        typeof f.id !== 'string' ||
        !f.id ||
        ['tool', 'message', 'errorKind', 'capabilityId'].some(
          k =>
            f[k as keyof FailureInput] !== undefined &&
            typeof f[k as keyof FailureInput] !== 'string'
        )
    )
  )
    return { error: 'Supply bounded failure records with string ids and a valid threshold.' };
  const diagnoses: {
    id: string;
    source: 'runtime' | 'model';
    classification?: string;
    probability?: number;
    review_required?: boolean;
    next_command?: string;
  }[] = [];
  const unresolved: FailureInput[] = [];
  for (const failure of failures) {
    const classified = classifySignal(failure);
    if (classified)
      diagnoses.push({ id: failure.id, source: 'runtime', classification: classified.class });
    else unresolved.push(failure);
  }
  const criteria = {
    ...Object.fromEntries(
      BLOCK_CLASSES.map(c => [
        c,
        {
          reasoning:
            'An error in solving or implementing the task, with no established environment deficit.',
          knowledge: 'Missing task information or domain knowledge.',
          tool: 'A missing tool or advertised operation.',
          permission: 'A permission or credential problem.',
          infrastructure: 'A reachability or resource problem.',
          reliability: 'An intermittent or upstream service problem.',
        }[c],
      ])
    ),
    unknown: 'The supplied evidence does not establish a useful diagnosis.',
  };
  const result = await judgeItems(
    db,
    'failures',
    unresolved,
    {
      type: 'choice',
      criteria,
      instructions:
        'Which diagnosis is best supported? A failed test or compile alone does not establish a missing capability. Prefer unknown when evidence is insufficient.',
    },
    options
  );
  if ('error' in result) return result;
  unresolved.forEach((failure, i) => {
    const answer = result.answers[i];
    diagnoses.push({
      id: failure.id,
      source: 'model',
      classification:
        answer.type === 'choice' && answer.probability >= threshold ? answer.choice : 'unknown',
      ...(answer.type === 'choice' ? { probability: answer.probability } : {}),
      review_required: true,
    });
  });
  const order = new Map(failures.map((f, i) => [f.id, i]));
  diagnoses.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const { answers: _answers, ...runs } = result;
  return {
    kind: 'failures',
    diagnoses,
    ...runs,
    note: 'Runtime classifications remain recorded facts. Model diagnoses are hypotheses and never become deficits, failures, or check evidence.',
  };
}

export interface AttentionInput {
  id: string;
  description: string;
  kind?: string;
  active_seconds?: number;
}
export async function judgeAttention(
  db: Db,
  entries: AttentionInput[],
  options: WorkflowOptions = {}
) {
  const threshold = thresholdOf(options);
  if (
    !threshold ||
    !validItems(entries) ||
    entries.some(
      e =>
        typeof e.id !== 'string' ||
        !e.id ||
        typeof e.description !== 'string' ||
        !e.description.trim() ||
        (e.kind !== undefined && typeof e.kind !== 'string') ||
        (e.active_seconds !== undefined &&
          (!Number.isFinite(e.active_seconds) || e.active_seconds < 0))
    )
  )
    return {
      error: 'Supply intervention ids and descriptions, with measured nonnegative time when known.',
    };
  const interventions: {
    id: string;
    source: 'recorded' | 'model';
    kind?: string;
    keeper?: boolean;
    suggested_kind?: string;
    active_seconds?: number;
    review_required?: boolean;
  }[] = [];
  const unresolved = entries.filter(e => !e.kind);
  for (const entry of entries.filter(e => e.kind))
    interventions.push({
      id: entry.id,
      source: 'recorded',
      kind: entry.kind,
      keeper: KEEPER_KINDS.has(entry.kind!),
      ...(entry.active_seconds !== undefined ? { active_seconds: entry.active_seconds } : {}),
    });
  const kinds = [...new Set([...KEEPER_KINDS, ...MIDDLEWARE_KINDS])];
  const kindByOption = new Map(kinds.map(kind => [kind.replaceAll(' ', '-'), kind]));
  const criteria = {
    ...Object.fromEntries(
      kinds.map(kind => [
        kind.replaceAll(' ', '-'),
        kind === 'judgment'
          ? 'A person chooses a tradeoff, interpretation, or acceptable outcome.'
          : kind === 'knowledge'
            ? 'A person supplies information or expertise needed by the work.'
            : `The intervention consists of ${kind}.`,
      ])
    ),
    unknown: 'The kind is not established by this description.',
  };
  const result = await judgeItems(
    db,
    'attention',
    unresolved,
    {
      type: 'choice',
      criteria,
      instructions:
        'Classify what the person contributed. Repetition does not make judgment or knowledge dispensable. Do not estimate time or decide that an intervention should be removed.',
    },
    options
  );
  if ('error' in result) return result;
  unresolved.forEach((entry, i) => {
    const answer = result.answers[i];
    interventions.push({
      id: entry.id,
      source: 'model',
      suggested_kind:
        answer.type === 'choice' && answer.probability >= threshold
          ? (kindByOption.get(answer.choice) ?? 'unknown')
          : 'unknown',
      ...(entry.active_seconds !== undefined ? { active_seconds: entry.active_seconds } : {}),
      review_required: true,
    });
  });
  const order = new Map(entries.map((e, i) => [e.id, i]));
  interventions.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const { answers: _answers, ...runs } = result;
  return {
    kind: 'attention',
    interventions,
    ...runs,
    note: 'Recorded labels remain authoritative. Suggestions never relabel the ledger or count as saved time.',
  };
}

export async function judgeNext(db: Db, goal: string, options: WorkflowOptions = {}) {
  if (!thresholdOf(options) || typeof goal !== 'string' || !goal.trim())
    return { error: 'Supply a goal and a valid threshold.' };
  const base = nextSteps(db, 24);
  const originalRank = new Map(base.next.map((candidate, i) => [candidate.id, i + 1]));
  const eligible = base.next.filter(candidate => {
    const row = db
      .prepare('SELECT lifecycle FROM capabilities WHERE id = ?')
      .get<{ lifecycle: string }>(candidate.id);
    const plan = planFor(db, candidate.id) as { error?: string; degraded?: boolean | unknown[] };
    return (
      row &&
      usable(row.lifecycle) &&
      !plan.error &&
      plan.degraded !== true &&
      !(Array.isArray(plan.degraded) && plan.degraded.length)
    );
  });
  const result = await judgeItems(
    db,
    'next',
    eligible.map(candidate => ({ goal, candidate })),
    {
      type: 'score',
      instructions:
        'How directly would this graph-generated next step advance the supplied goal? Judge relevance only. The supplied costs, checks, permissions and dependencies are facts.',
      criteria: [
        'Unrelated',
        'Indirectly helpful',
        'Directly helpful',
        'Necessary for the stated goal',
      ],
    },
    options
  );
  if ('error' in result) return result;
  const next = eligible
    .map((candidate, i) => ({
      ...candidate,
      original_rank: originalRank.get(candidate.id)!,
      relevance: result.answers[i].type === 'score' ? result.answers[i].score : 0,
    }))
    .sort((a, b) => b.relevance - a.relevance || a.original_rank - b.original_rank);
  const { answers: _answers, ...runs } = result;
  return {
    kind: 'next',
    next,
    ...runs,
    note: 'Relevance is a model judgment. Costs and structural evidence come from the graph; the council and ordinary next ranking are unchanged.',
  };
}
