/**
 * What to reach next, and why it is worth the afternoon. Roadmap §12.4.
 *
 * `ambit goal` answers *how do I get to X* — it needs the X. `ambit
 * opportunities` answers *what is worth building* — it needs weeks of recorded
 * work first, and on a fresh install says nothing has been observed, which is
 * true and useless. Between them sat the question a person and an agent
 * actually ask on day one: what should we do next?
 *
 * The answer is structural until the ledger has enough to say otherwise, and
 * it says which of the two it used. Leverage is what the curated model already
 * knows: how much sits downstream of a capability, and how much of that is
 * waiting on nothing else. Cost is the model's own setup estimate and whatever
 * the acquisition catalog says it bills. Neither is a guess dressed as data.
 */
import { shellQuote } from '../shared/shell.ts';
import type { Db } from './db.ts';
import { recordingHint } from './paths.ts';
import { usable } from './assurance.ts';
import { deficits, simulateFrontier } from './planning.ts';
import { catalogReport } from './catalog.ts';
import { opportunitiesFor } from './opportunities.ts';
import { PROVISION_EDGES } from './ontology.ts';
import {
  andList,
  leverageSentence,
  rankSteps,
  readableCost,
  stepCandidates,
  stepReason,
} from '../shared/nextSteps.ts';

/** How many recommendations a curriculum is. Three is a choice; ten is a list. */
const HOW_MANY = 3;

interface Candidate {
  id: string;
  name: string;
  description?: string;
  setup_seconds: number;
  /** Dependents something already supplies: reaching this reaches them. */
  unlocks: string[];
  /** Dependents nothing supplies yet: reaching this makes them a next step. */
  opens: string[];
  missing: string[];
  blocked_by_degraded: boolean;
  observed_blocks: number;
  leverage: number;
  blocks: number;
}

/**
 * Unreached capabilities whose prerequisites are already met, with what each
 * would unblock.
 *
 * "Already met" is the whole filter. A capability three acquisitions away is a
 * project, and putting it in front of someone as a next step is how a roadmap
 * becomes wallpaper. `ambit goal <cap>` is where the longer routes live.
 */
function candidates(db: Db): Candidate[] {
  const caps = db
    .prepare(
      `SELECT id, name, description, state, lifecycle, unlock_cost_setup
       FROM capabilities WHERE kind = 'capability'`
    )
    .all<any>();
  const byId = new Map(caps.map(c => [c.id, c]));

  // Requirements only. A provider's edge is hard too, and the provider is not
  // a capability this reads, so it counted as a prerequisite never met: no
  // supplied capability could be one step away or be reached by one.
  const hard = db
    .prepare(
      `SELECT from_capability f, to_capability t FROM dependencies
       WHERE is_hard_requisite = 1 AND to_capability LIKE 'combo:%'
         AND kind NOT IN (${PROVISION_EDGES.map(() => '?').join(', ')})`
    )
    .all<{ f: string; t: string }>(...PROVISION_EDGES);

  // How often each capability has actually stopped work. Present from the
  // first recorded deficit, which is what makes the ranking tip from
  // structural to observed without anyone switching it over.
  //
  // Deficits captured from a runtime attribute to the provider that failed —
  // a 403 from a git server files against that server, which is the precise
  // thing to say. This report is about capabilities, so a provider's blocks
  // are rolled up to whatever it supplies; otherwise the half of the ledger
  // that fills itself could never influence what gets suggested.
  const blocked = new Map<string, number>();
  const supplies = new Map<string, string[]>();
  const supplied = new Set<string>();
  for (const d of db
    .prepare("SELECT from_capability f, to_capability t FROM dependencies WHERE kind = 'provides'")
    .all<{ f: string; t: string }>()) {
    if (!supplies.has(d.f)) supplies.set(d.f, []);
    supplies.get(d.f)!.push(d.t);
    supplied.add(d.t);
  }
  const recorded = deficits(db);
  if (Array.isArray(recorded)) {
    for (const d of recorded as any[]) {
      const times = d.times_blocked || 0;
      blocked.set(d.id, (blocked.get(d.id) || 0) + times);
      for (const supplied of supplies.get(d.id) || []) {
        blocked.set(supplied, (blocked.get(supplied) || 0) + times);
      }
    }
  }

  const nameOf = (id: string) => byId.get(id)?.name || id;
  return stepCandidates({
    nodes: caps.map(c => ({
      id: c.id,
      name: c.name,
      configured: c.state !== 'locked',
      usable: usable(c.lifecycle),
      setupSeconds: c.unlock_cost_setup || 0,
      blocks: blocked.get(c.id) || 0,
    })),
    requires: hard.map(d => ({ from: d.f, to: d.t })),
    supplied,
  }).map(c => ({
    id: c.id,
    name: c.name,
    description: byId.get(c.id)?.description,
    setup_seconds: c.setupSeconds,
    unlocks: c.unlocks.map(nameOf),
    opens: c.opens.map(nameOf),
    missing: c.missing.map(nameOf),
    blocked_by_degraded: c.blockedByDegraded,
    observed_blocks: c.blocks,
    leverage: c.leverage,
    blocks: c.blocks,
  }));
}

/**
 * The three capabilities worth reaching next, each with a reason and a price.
 *
 * Ranks on observed blocks where the ledger has them and on leverage per hour
 * where it does not, and names which. A recommendation whose basis is hidden
 * cannot be argued with, and this one should be arguable — it is asking for
 * someone's afternoon.
 */
function nextSteps(db: Db, howMany = HOW_MANY) {
  const all = candidates(db);
  if (!all.length) {
    return {
      note: 'Nothing is one step away. Every capability the model knows is either reached or needs more than one acquisition — ambit goal <capability> routes the longer ones.',
      next: [],
    };
  }

  const observed = all.some(c => c.observed_blocks > 0);

  // The other ranker. `opportunities` prices observed human burden and this
  // ranks structural leverage; they answer the same question from different
  // evidence and used to have no idea the other existed, so a person could be
  // told two different next steps with no way to see they were related. Where
  // both have an opinion about a capability, this one names the priced case
  // rather than restating it.
  const priced = new Map<string, string>();
  try {
    const ranked = opportunitiesFor(db) as any;
    for (const o of ranked?.opportunities || []) {
      if (o.capability_id && o.id) priced.set(o.capability_id, o.id);
    }
  } catch {
    /* the economic half needs a ledger; structural ranking stands alone */
  }
  // What blocked work comes first, as the basis says, and leverage only
  // orders the rest (src/shared/nextSteps.ts).
  const scored = rankSteps(all).slice(0, howMany);

  return {
    basis: observed
      ? 'observed — ranked by what has actually blocked work, then by leverage'
      : 'structural — nothing has been recorded as blocking work yet, so this ranks by what each would unblock per hour of setup',
    next: scored.map(c => {
      const short = c.id.replace('combo:', '');
      // What comes with it, by the simulation `ambit goal --simulate` and
      // `ambit_simulate` run, so the three never disagree: everything something
      // here already supplies that reaching it lets the frontier reach, through
      // every hop, not only what waits on it alone. A step whose own
      // prerequisite is failing carries nothing with it until that passes.
      const sim = simulateFrontier(db, [c.id]) as any;
      const reaches = sim.blocked_by_degraded
        ? []
        : [...new Set([...c.unlocks, ...(sim.unblocked ?? []).map((u: any) => String(u.name))])];
      const leverage = leverageSentence(reaches, c.opens);
      const cost = catalogReport(db, c.id) as any;
      const cheapest = Array.isArray(cost?.options) ? cost.options[0] : undefined;
      return {
        capability: c.name,
        id: c.id,
        // Blocked work leads, and what the step would reach follows it: the
        // second used to be dropped whenever the first was there, so the step
        // that mattered most said least about what it would open.
        why: c.observed_blocks
          ? [
              `It has blocked work ${c.observed_blocks} ${c.observed_blocks === 1 ? 'time' : 'times'}.`,
              leverage,
            ]
              .filter(Boolean)
              .join(' ')
          : stepReason(leverage, c.description),
        // The same, as data: what reaching it reaches, what it makes a next
        // step, and how often work was blocked on it. The briefing says these
        // to the agent in its own words.
        reaches: reaches.length ? reaches : undefined,
        opens: c.opens.length ? c.opens : undefined,
        blocked_times: c.observed_blocks || undefined,
        cost: readableCost(c.setup_seconds),
        recurring: cheapest?.recurring_cost || 'none declared',
        privacy: cheapest?.privacy,
        missing: c.missing.length ? c.missing : undefined,
        note: c.blocked_by_degraded
          ? 'Its prerequisite is configured and failing its check — re-verify it, do not re-add it.'
          : undefined,
        // The command, not a drafted proposal: drafting three proposals to
        // answer "what next" would write three rows every time someone asked a
        // question. `ambit propose` is one keystroke away and is the moment a
        // person has actually chosen.
        propose: `ambit propose ${shellQuote(short)}`,
        plan: `ambit goal ${shellQuote(short)}`,
        // Both rankers have priced this one. Say so rather than pretending
        // this is the only reading.
        priced_case: priced.has(c.id) ? `ambit opportunities ${priced.get(c.id)}` : undefined,
      };
    }),
    note: observed
      ? undefined
      : `Record what blocks work and this ranks by it instead: ${recordingHint(db)}.`,
  };
}

/** The same three, as the two lines a briefing can carry. */
function nextLines(db: Db): string[] {
  const r = nextSteps(db) as any;
  if (!r.next?.length) return [];
  return r.next.map((n: any) => `${n.capability} · ${n.cost} · ${n.why}`);
}

export { nextSteps, nextLines, candidates, readableCost, andList };
