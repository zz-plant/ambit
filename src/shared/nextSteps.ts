/**
 * What to reach next, by one rule, wherever the question is asked.
 *
 * The engine ranks next steps for `ambit`, the briefing, My Setup and the
 * loop page. A config pasted into the hosted page was ranked by the map's own
 * rule, which counted everything a step would let the tree reach eventually,
 * so the same three servers got Local Runtime from the page and Hosting from
 * `npx ambit-cli`, and a visitor who followed the demo to the terminal watched
 * the recommendation change. Both now rank here.
 *
 * Pure: no database, no DOM. The engine reads its rows into a `StepGraph`; the
 * page builds one from the items it placed in the tab.
 */

/** A capability on the curated tree, as much of it as ranking needs. */
export interface StepNode {
  id: string;
  name: string;
  /** Configured on this machine: anything but locked. */
  configured: boolean;
  /** Its last check did not fail. A capability no check has run on is usable. */
  usable: boolean;
  setupSeconds: number;
  /** How often recorded work was blocked on it. The tab has no ledger, so none. */
  blocks?: number;
}

export interface StepGraph {
  nodes: readonly StepNode[];
  /** Hard requirements between capabilities: `from` must be reached before `to`. */
  requires: readonly { from: string; to: string }[];
  /** Capabilities something configured here already supplies. */
  supplied: ReadonlySet<string>;
}

/** A capability one step away, and what reaching it would do. */
export interface StepCandidate {
  id: string;
  name: string;
  setupSeconds: number;
  /** Dependents something already supplies: reaching this reaches them. */
  unlocks: string[];
  /** Dependents nothing supplies yet: reaching this makes them a next step. */
  opens: string[];
  /** Requirements not met: none, or one that is configured and failing its check. */
  missing: string[];
  blockedByDegraded: boolean;
  blocks: number;
  /** What it unblocks per hour of setup, itself included. */
  leverage: number;
}

const reachedIn = (node: StepNode | undefined): boolean => Boolean(node?.configured && node.usable);

/**
 * Unreached capabilities whose requirements are already met, with what each
 * would unblock.
 *
 * "Already met" is the whole filter. A capability three acquisitions away is a
 * project, and putting it in front of someone as a next step is how a roadmap
 * becomes wallpaper. `ambit goal <cap>` is where the longer routes live.
 */
export function stepCandidates(graph: StepGraph): StepCandidate[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const prereqs = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const { from, to } of graph.requires) {
    if (!prereqs.has(to)) prereqs.set(to, []);
    prereqs.get(to)!.push(from);
    if (!dependents.has(from)) dependents.set(from, []);
    dependents.get(from)!.push(to);
  }
  const reached = (id: string) => reachedIn(byId.get(id));
  // Configured and failing its check: the one requirement a step may still
  // have, since the step is to repair it.
  const degraded = (id: string) => {
    const node = byId.get(id);
    return Boolean(node?.configured && !node.usable);
  };

  const out: StepCandidate[] = [];
  for (const node of graph.nodes) {
    if (reachedIn(node)) continue;
    const missing = (prereqs.get(node.id) || []).filter(p => !reached(p));
    // A prerequisite not yet reached is a step of its own, and listing both
    // priced the capability without it.
    if (missing.length > 1 || (missing.length === 1 && !degraded(missing[0]))) continue;

    // Its dependents whose only unmet requirement is this one. Those something
    // already supplies are reached with it; the rest become next steps.
    const waiting = (dependents.get(node.id) || []).filter(dep => {
      const depNode = byId.get(dep);
      if (!depNode || reachedIn(depNode)) return false;
      // Configured and failing its own check: no step brings it, a pass does.
      if (depNode.configured) return false;
      return (prereqs.get(dep) || []).every(p => p === node.id || reached(p));
    });
    const unlocks = waiting.filter(dep => graph.supplied.has(dep));
    // Next steps past everything it reaches, not only past itself: Embeddings
    // reaches Local Embeddings, and what waits on that opens with it.
    const { opens } = stepEffect(graph, node.id);
    const hours = Math.max(node.setupSeconds, 300) / 3600;
    out.push({
      id: node.id,
      name: node.name,
      setupSeconds: node.setupSeconds,
      unlocks,
      opens,
      missing,
      blockedByDegraded: missing.some(degraded),
      blocks: node.blocks || 0,
      // Leverage per hour of setup, so a cheap capability that unblocks two
      // things outranks an expensive one that unblocks three. The +1 counts
      // the capability itself: reaching it is worth something even when
      // nothing waits on it.
      leverage: (unlocks.length + opens.length + 1) / hours,
    });
  }
  return out;
}

/**
 * The order next steps are offered in. What blocked work comes first, and
 * leverage only orders the rest: a weighted sum let a five-minute capability
 * nothing had ever waited on outrank one that had blocked work. A tie keeps
 * the tree's order, which the seed and the page both take from `placeOnTree`,
 * so the two name the same step.
 */
export function rankSteps<C extends Pick<StepCandidate, 'blocks' | 'leverage'>>(
  candidates: readonly C[]
): C[] {
  return [...candidates].sort((a, b) => b.blocks - a.blocks || b.leverage - a.leverage);
}

/**
 * What else is reached if these were: every capability something here
 * already supplies whose requirements the assumption meets, through every
 * hop. A capability nothing supplies does not appear because its requirements
 * are met, and one configured and failing its own check is brought by no
 * acquisition, only by a passing check.
 */
export function reachedWith(graph: StepGraph, assume: readonly string[]): string[] {
  const prereqs = new Map<string, string[]>();
  for (const { from, to } of graph.requires) {
    if (!prereqs.has(to)) prereqs.set(to, []);
    prereqs.get(to)!.push(from);
  }
  const before = new Set(graph.nodes.filter(reachedIn).map(n => n.id));
  const after = new Set([...before, ...assume]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (after.has(node.id)) continue;
      if (node.configured && !node.usable) continue;
      if (!graph.supplied.has(node.id)) continue;
      if ((prereqs.get(node.id) || []).every(p => after.has(p))) {
        after.add(node.id);
        changed = true;
      }
    }
  }
  const assumed = new Set(assume);
  return [...after].filter(id => !before.has(id) && !assumed.has(id));
}

/**
 * What reaching `id` brings: the capabilities reached with it, through every
 * hop of what something here supplies, and the next steps that leaves, one hop
 * past all of them and no further. The readout says this set and the map
 * lights it. The map kept a closure of its own, which took a next step as
 * reached and went on past it, so Hosting lit Launch Ready, three steps away,
 * beside a sentence naming the three next steps on the way to it.
 */
export function stepEffect(graph: StepGraph, id: string): { reaches: string[]; opens: string[] } {
  const prereqs = new Map<string, string[]>();
  for (const { from, to } of graph.requires) {
    if (!prereqs.has(to)) prereqs.set(to, []);
    prereqs.get(to)!.push(from);
  }
  const reaches = reachedWith(graph, [id]);
  const before = new Set(graph.nodes.filter(reachedIn).map(n => n.id));
  const after = new Set([...before, id, ...reaches]);
  const opens = graph.nodes
    .filter(node => {
      if (after.has(node.id)) return false;
      // Configured and failing its own check: no step brings it, a pass does.
      if (node.configured) return false;
      const needs = prereqs.get(node.id) || [];
      // Met only now: one already met was a next step before this one.
      return needs.length > 0 && needs.every(p => after.has(p)) && needs.some(p => !before.has(p));
    })
    .map(node => node.id);
  return { reaches, opens };
}

/**
 * "A, B and C": three joined by "and" alone read as a stammer. Past `max`
 * names, the rest are counted: "A, B, C and 2 more".
 */
export function andList(names: readonly string[], max = Number.POSITIVE_INFINITY): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const all = rest > 0 ? [...shown, `${rest} more`] : shown;
  return all.length > 1
    ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`
    : (all[0] ?? '');
}

/** What reaching a step does, in one sentence, by name. Empty when it does nothing more. */
export function leverageSentence(reaches: readonly string[], opens: readonly string[]): string {
  const reached = reaches.length
    ? `Reaching it also reaches ${andList(reaches)}, which something here already supplies`
    : '';
  const opened = opens.length
    ? `${reached ? ', and makes' : 'Reaching it makes'} ${andList(opens)} ${opens.length === 1 ? 'a next step' : 'next steps'}`
    : '';
  return reached || opened ? `${reached}${opened}.` : '';
}

/**
 * Why a step is worth taking, as the readout says it: what it opens, or, for a
 * step that opens nothing, the claim its description makes. A description
 * carries its own hint after an em dash, and the readout wants the claim, not
 * the instruction that follows it; `ambit goal <cap>` is where that belongs.
 */
export function stepReason(sentence: string, description = ''): string {
  return sentence || description.split(' \u2014 ')[0] || 'It is one step away.';
}

/** Minutes, or hours once minutes stop being readable; 'unknown' when the tree states none. */
export function readableCost(seconds: number): string {
  if (!seconds) return 'unknown';
  return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
}
