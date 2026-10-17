import type { Db } from '../db.ts';
import { routeSentence } from '../goals.ts';
import { planFor } from '../planning.ts';
import { loadTechTree } from '../paths.ts';
import { askDecision } from './client.ts';
import { getDecision } from './records.ts';
import {
  judgeItems,
  remember,
  thresholdOf,
  UNTRUSTED,
  validItems,
  type Runs,
  type WorkflowOptions,
} from './workflow.ts';
import type { DecisionQuestion } from './types.ts';

export const NONE = 'none-of-these';
export interface JudgeTask {
  id: string;
  text: string;
}
export interface CapabilitySuggestion {
  subject: string;
  source: 'vocabulary' | 'model';
  capability_ids: string[];
  abstained?: boolean;
  candidates?: { id: string; probability: number }[];
  evidence_scope?: 'advertised';
}
export function capabilityCriteria(): Record<string, string> {
  const nodes: { id: string; name: string; description?: string }[] = loadTechTree().nodes;
  return {
    ...Object.fromEntries(nodes.map(n => [n.id, `${n.name}: ${n.description || ''}`])),
    [NONE]:
      'No listed capability fits the supplied evidence. A task can be outside this curated model even when an agent could perform it.',
  };
}
export async function judgeTasks(db: Db, tasks: JudgeTask[], options: WorkflowOptions = {}) {
  const threshold = thresholdOf(options);
  if (
    !threshold ||
    !validItems(tasks) ||
    !tasks.length ||
    tasks.some(
      t => typeof t.id !== 'string' || !t.id || typeof t.text !== 'string' || !t.text.trim()
    ) ||
    new Set(tasks.map(t => t.id)).size !== tasks.length
  )
    return {
      error:
        'Supply unique task ids, nonempty task text, and a threshold greater than 0.5 and at most 1.',
    };
  const suggestions: CapabilitySuggestion[] = [];
  const unresolved: JudgeTask[] = [];
  for (const task of tasks) {
    const routed = routeSentence(task.text);
    if (routed.recommended)
      suggestions.push({
        subject: task.id,
        source: 'vocabulary',
        capability_ids: [routed.recommended],
      });
    else unresolved.push(task);
  }
  const runs: Runs = { decisions: [], receipt_ids: [] };
  if (options.multi) {
    const criteria = capabilityCriteria();
    const nodes = Object.entries(criteria).filter(([id]) => id !== NONE);
    for (const task of unresolved) {
      const candidates: { id: string; probability: number }[] = [];
      for (let start = 0; start < nodes.length; start += 48) {
        const questions = Object.fromEntries(
          nodes.slice(start, start + 48).map(([id, description]) => [
            `cap.${id}`,
            {
              type: 'noul',
              instructions: `${UNTRUSTED}Would this capability directly help accomplish the supplied task? Evaluate the requested work, including negation and constraints. Capability: ${description}`,
            } satisfies DecisionQuestion,
          ])
        );
        const state = { task: task.text };
        const result = await askDecision({ state, questions }, options);
        if ('error' in result) return result;
        remember(db, `${options.kind ?? 'goal'}-multi`, result, state, options, runs);
        for (const [key, answer] of Object.entries(result.answers))
          if (answer.type === 'noul')
            candidates.push({ id: `combo:${key.slice(4)}`, probability: answer.probability });
      }
      candidates.sort((a, b) => b.probability - a.probability);
      const selected = candidates.filter(c => c.probability >= threshold).map(c => c.id);
      suggestions.push({
        subject: task.id,
        source: 'model',
        capability_ids: selected,
        abstained: !selected.length,
        candidates,
      });
    }
  } else {
    const result = await judgeItems(
      db,
      options.kind ?? 'goal',
      unresolved.map(t => ({ task: t.text })),
      {
        type: 'choice',
        instructions:
          'Which listed capability most directly enables the requested task? Do not infer that a capability works or is permitted.',
        criteria: capabilityCriteria(),
      },
      options
    );
    if ('error' in result) return result;
    runs.decisions.push(...result.decisions);
    runs.receipt_ids.push(...result.receipt_ids);
    unresolved.forEach((task, i) => {
      const answer = result.answers[i];
      if (answer.type !== 'choice') return;
      const selected = answer.choice !== NONE && answer.probability >= threshold;
      suggestions.push({
        subject: task.id,
        source: 'model',
        capability_ids: selected ? [`combo:${answer.choice}`] : [],
        abstained: !selected,
        candidates: Object.entries(answer.probabilities)
          .filter(([id]) => id !== NONE)
          .map(([id, probability]) => ({ id: `combo:${id}`, probability }))
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 3),
      });
    });
  }
  const order = new Map(tasks.map((task, i) => [task.id, i]));
  suggestions.sort((a, b) => order.get(a.subject)! - order.get(b.subject)!);
  return {
    kind: options.kind ?? 'goal',
    threshold,
    suggestions,
    ...runs,
    note: 'Model associations are suggestions. Review a recorded result before asking for its current graph plans. The threshold is a display policy, not a measured accuracy guarantee.',
  };
}

/** Acceptance authorizes planning this association; grants and checks still decide execution. */
export function planDecision(db: Db, id: string) {
  const receipt = getDecision(db, id);
  if ('error' in receipt) return receipt;
  if (
    !['goal', 'spec', 'goal-multi', 'spec-multi'].includes(receipt.kind) ||
    receipt.review?.disposition !== 'accepted'
  )
    return { error: 'Planning requires an explicitly accepted goal or spec decision receipt.' };
  const threshold = typeof receipt.summary.threshold === 'number' ? receipt.summary.threshold : 0.8;
  const ids = new Set<string>();
  for (const [key, answer] of Object.entries(receipt.result.answers)) {
    if (answer.type === 'choice' && answer.choice !== NONE && answer.probability >= threshold)
      ids.add(`combo:${answer.choice}`);
    if (answer.type === 'noul' && key.startsWith('cap.') && answer.probability >= threshold)
      ids.add(`combo:${key.slice(4)}`);
  }
  if (!ids.size)
    return { error: 'This receipt contains no association above its recorded threshold.' };
  return {
    receipt: id,
    plans: [...ids].map(capability => planFor(db, capability)),
    note: 'Plans read the current graph. Acceptance grants no authority and applies no change.',
  };
}
