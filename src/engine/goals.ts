import { loadTechTree } from './paths.ts';
import type { Db } from './db.ts';
import { planFor, simulateFrontier } from './planning.ts';

/**
 * Routes a free-form goal into the graph, and compares the paths that close it.
 *
 * This is §5 of the roadmap. `ambit goal` needs a capability the model already
 * knows; a person says "maintain the homelab unattended". The gap between those
 * is a vocabulary problem, and it is solved the same way detection is: authored
 * `goal` phrases on the curated tree, matched against the sentence the way
 * `detect` patterns are matched against config ids.
 *
 * The output is a set of candidate capabilities ranked by how much of the goal
 * they plausibly cover, and — for one candidate — the alternative paths to it
 * with their risks and lock-in. Not a free-text interpreter: a ranked shortlist
 * and a plan, which is the honest route in.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'for',
  'from',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'want',
  'we',
  'what',
  'when',
  'with',
  'you',
  'your',
]);

/**
 * The words a sentence splits into, with the function words removed. Two-word
 * phrases from the goal vocabulary ("don't forget") survive as ngrams because
 * a single word loses the meaning the pair carries.
 */
function tokensOf(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

/** A capability and the goal phrases that would reach it. */
interface GoalCandidate {
  id: string;
  name: string;
  domain: string;
  phrases: string[];
  hits: number;
}

/**
 * The curated route-in: every capability with a `goal` vocabulary, plus the
 * phrases that point at it. Authored in techtree.json, the same way the
 * `detect` patterns are — one is the config-side index, this is the intent-side.
 */
function goalVocabulary(): GoalCandidate[] {
  const tree = loadTechTree();
  return (tree.nodes || [])
    .filter((n: any) => n.goal?.length)
    .map((n: any) => ({
      id: `combo:${n.id}`,
      name: n.name,
      domain: n.domain || 'meta',
      phrases: n.goal as string[],
      hits: 0,
    }));
}

/**
 * Scores a goal sentence against the curated vocabulary.
 *
 * A phrase matches when the sentence contains it verbatim, or when every
 * content word of the phrase appears in the sentence — "unattended" in
 * "maintain the homelab unattended" is the single-word case of the same rule.
 * Each matching phrase counts toward the capability that owns it, so a goal
 * the sentence names several ways outranks one it touches once.
 */
function phraseMatches(p: string, sentence: string, tokens: Set<string>): boolean {
  if (sentence.toLowerCase().includes(p)) return true;
  const words = tokensOf(p);
  if (words.length === 0) return false;
  // A phrase of several words that survives stopword removal as a single
  // common word must not match on that word alone. "without me" reduces to
  // ["without"], so every sentence containing "without" scored a hit for
  // Scheduled Work — including "search my code without sending it to a
  // cloud", where the word is part of a negation about privacy and the
  // recommendation came back as an automation capability.
  if (p.trim().split(/\s+/).length > 1 && words.length < 2) return false;
  return words.every(w => tokens.has(w));
}

/**
 * Scores a goal sentence against the curated vocabulary.
 *
 * A phrase matches when the sentence contains it verbatim, or when every
 * content word of the phrase appears in the sentence — "unattended" in
 * "maintain the homelab unattended" is the single-word case of the same rule.
 * Each matching phrase counts toward the capability that owns it, so a goal
 * the sentence names several ways outranks one it touches once.
 */
function matchGoal(sentence: string): GoalCandidate[] {
  const tokens = new Set(tokensOf(sentence));
  const vocab = goalVocabulary();
  const scored = vocab.map(c => ({
    ...c,
    hits: c.phrases.filter(p => phraseMatches(p, sentence, tokens)).length,
  }));
  return scored.filter(c => c.hits > 0).sort((a, b) => b.hits - a.hits);
}

/**
 * Routes a goal to the capabilities that plausibly cover it, with the delta
 * for each.
 *
 *   ambit goal "maintain the homelab unattended"
 *
 * Returns every capability whose authored phrases appear in the sentence,
 * ranked by coverage, each with what reaching it requires. If the goal is
 * already a known capability id or a phrase that resolves to exactly one
 * capability, the answer collapses to the single plan.
 */
function goalFor(db: Db, sentence?: string) {
  if (!sentence) return { error: 'Usage: ambit goal "<a thing you want to be able to do>"' };

  // A goal that is already a capability is the degenerate case: plan it. But
  // only when it is one — a bare word like "unattended" is not an id, and
  // routing it as one would return "no such capability" for the exact case
  // the vocabulary exists to serve.
  if (sentence.includes(':') || sentence.match(/^combo:[a-z0-9-]+$/)) {
    const plan = planFor(db, sentence) as any;
    if (!plan.error) return { goal: sentence, exact: true, ...plan };
  }
  // A bare slug that happens to name a capability also plans directly; a bare
  // word that does not falls through to the vocabulary router.
  if (sentence.match(/^[a-z0-9-]+$/)) {
    const plan = planFor(db, `combo:${sentence}`) as any;
    if (!plan.error) return { goal: sentence, exact: true, ...plan };
  }

  const matches = matchGoal(sentence);
  if (matches.length === 0) {
    return {
      goal: sentence,
      note: 'No capability in the model has words that cover this. Try ambit graph combos, or ambit authority, and use one of those names.',
      candidates: [],
    };
  }

  const tokens = new Set(tokensOf(sentence));
  const candidates = matches.map(m => {
    const plan = planFor(db, m.id) as any;
    return {
      id: m.id,
      name: m.name,
      domain: m.domain,
      score: m.hits,
      matched_phrases: m.phrases.filter(p => phraseMatches(p, sentence, tokens)),
      // The delta, folded in so a candidate list is also a plan shortlist.
      reachable: plan.error ? undefined : plan.reachable,
      steps: plan.error ? undefined : plan.steps,
      estimated_setup: plan.error ? undefined : plan.estimated_setup,
      requires_person: plan.error ? undefined : plan.requires_person,
      degraded: plan.error ? undefined : plan.degraded,
      note: plan.error ? undefined : plan.note,
    };
  });

  // One incidental word out of a whole sentence is a signal worth listing and
  // not one worth acting on. Naming a `recommended` regardless is what turned a
  // single stopword collision into a confident wrong answer, so the field is
  // now earned: either a phrase appeared verbatim, or two of them matched.
  const strong = matches[0].hits >= 2 || candidates[0].matched_phrases.length > 0;
  return {
    goal: sentence,
    ...(strong ? { recommended: candidates[0].id } : {}),
    candidates,
    note: strong
      ? "ranked by how much of the goal the model's own vocabulary covers — a shortlist, not an interpretation"
      : 'weak match: the sentence shares only an incidental word with these. Listed, not recommended — try ambit graph combos and name a capability directly.',
  };
}

/**
 * The alternative ways to close the gap to a capability.
 *
 * `tt plan` returns one ordered list of steps. `tt paths` asks the question a
 * plan cannot: given that a step can be closed several ways, what are the
 * whole paths through the choice, and what do they cost in setup, risk and
 * lock-in?
 *
 * Risk is derived, not declared: a hosted alternative moves data off the
 * machine, a recurring one adds a bill. Lock-in is the inverse of what §10 can
 * undo: a step that carries a config patch has a computed inverse, so it can be
 * reversed; one that needs an installer or a running service cannot.
 */
function pathsFor(db: Db, goal?: string) {
  if (!goal) return { error: 'Usage: ambit goal <capability> --paths' };
  const plan = planFor(db, goal) as any;
  if (plan.error) return plan;
  if (plan.degraded)
    return { goal: plan.goal, degraded: true, lifecycle: plan.lifecycle, note: plan.note };
  // `reachable` in planFor means "every step is plan-able", not "already
  // reached". A plan with zero steps is the nothing-to-close case.
  if (plan.steps === 0) return { goal: plan.goal, note: 'already reached — nothing to close' };

  const steps = (plan.order || []).map((step: any) => ({
    id: step.id,
    name: step.name,
    setup_seconds: step.setup_seconds || 0,
    requires_person: step.requires_person,
    options: step.options || [],
  }));

  // A step with no alternatives is one choice; one with alternatives is a
  // fork. The product of the forks is the space of paths, which for a real
  // goal stays small (a few forks of two or three options).
  const pathOf = (indices: number[]): any[] =>
    steps.map((s: any, i: number) => {
      const opts = s.options;
      if (opts.length === 0) {
        return {
          id: s.id,
          name: s.name,
          setup_seconds: s.setup_seconds,
          chosen: 'the only way',
          recurring_cost: undefined,
          privacy: 'local',
          reversible: false,
        };
      }
      const o = opts[indices[i]] || opts[0];
      return {
        id: s.id,
        name: s.name,
        setup_seconds: o.setup_seconds ?? s.setup_seconds ?? 0,
        chosen: o.name,
        recurring_cost: o.recurring_cost,
        privacy: o.privacy,
        // Reversible means §10's apply/rollback can undo it: a config patch
        // yields an inverse; an installer or a running service does not.
        reversible: !!o.config_patch,
      };
    });

  const paths: any[] = [];
  const forks = steps.map((s: any) => Math.max(s.options.length, 1));
  const total = forks.reduce((a: number, b: number) => a * b, 1);
  // Enumerate the product of forks. The tree is curated and steps rarely have
  // more than three alternatives, so this stays small; cap defensively anyway.
  for (let n = 0; n < Math.min(total, 64); n++) {
    const indices: number[] = [];
    let rest = n;
    for (let i = forks.length - 1; i >= 0; i--) {
      indices[i] = rest % forks[i];
      rest = Math.floor(rest / forks[i]);
    }
    const stepsInPath = pathOf(indices);
    const setup = stepsInPath.reduce((s, x) => s + (x.setup_seconds || 0), 0);
    const hosted = stepsInPath.some(x => x.privacy === 'hosted');
    const recurring = stepsInPath.some(x => x.recurring_cost && x.recurring_cost !== 'none');
    const irreversible = stepsInPath.filter(x => !x.reversible).map(x => x.name);
    const person = stepsInPath
      .filter(x => x.requires_person?.length)
      .map(x => ({ step: x.name, person: x.requires_person }));
    const sim = simulateFrontier(
      db,
      stepsInPath.map(s => s.id)
    ) as any;
    paths.push({
      setup_seconds: setup,
      estimated_setup:
        setup >= 3600 ? `${(setup / 3600).toFixed(1)}h` : `${Math.round(setup / 60)}m`,
      risk: hosted && recurring ? 'high' : hosted || recurring ? 'medium' : 'low',
      privacy: hosted ? 'hosted' : 'local',
      recurring: recurring ? 'yes' : 'none',
      lock_in: irreversible.length ? `irreversible: ${irreversible.join(', ')}` : 'reversible',
      requires_person: person.length ? person : undefined,
      frontier_after: sim.frontier_after,
      steps: stepsInPath,
    });
  }

  // Same cost, same risk, same lock-in is the same path; collapsing the noise
  // keeps a list of alternatives from reading as a list of accidents.
  const unique = new Map<string, any>();
  for (const p of paths) {
    const key = [p.setup_seconds, p.risk, p.privacy, p.recurring, p.lock_in].join('|');
    if (!unique.has(key)) unique.set(key, p);
  }
  const distinct = [...unique.values()].sort((a, b) => a.setup_seconds - b.setup_seconds);

  return {
    goal: plan.goal,
    paths: distinct.length,
    options: distinct.map(p => ({
      setup_seconds: p.setup_seconds,
      estimated_setup: p.estimated_setup,
      risk: p.risk,
      privacy: p.privacy,
      recurring: p.recurring,
      lock_in: p.lock_in,
      requires_person: p.requires_person,
      frontier_after: p.frontier_after,
      steps: p.steps.map((s: any) => ({
        name: s.name,
        chosen: s.chosen,
        setup_seconds: s.setup_seconds,
        reversible: s.reversible,
      })),
    })),
    note: 'risk: hosted moves data off the machine, recurring adds a bill. lock_in: reversible if the step is a config change §10 can undo.',
  };
}

export { goalFor, pathsFor, goalVocabulary, matchGoal, tokensOf };
