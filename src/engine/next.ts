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
import type { Db } from './db.ts';
import { usable } from './assurance.ts';
import { deficits } from './planning.ts';
import { catalogReport } from './catalog.ts';

/** How many recommendations a curriculum is. Three is a choice; ten is a list. */
const HOW_MANY = 3;

interface Candidate {
  id: string;
  name: string;
  description: string;
  setup_seconds: number;
  unlocks: string[];
  missing: string[];
  blocked_by_degraded: boolean;
  observed_blocks: number;
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
  const reached = (c: any) => c && c.state !== 'locked' && usable(c.lifecycle);

  const hard = db
    .prepare(
      `SELECT from_capability f, to_capability t FROM dependencies
       WHERE is_hard_requisite = 1 AND to_capability LIKE 'combo:%'`
    )
    .all<{ f: string; t: string }>();
  const prereqs = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const d of hard) {
    if (!prereqs.has(d.t)) prereqs.set(d.t, []);
    prereqs.get(d.t)!.push(d.f);
    if (!dependents.has(d.f)) dependents.set(d.f, []);
    dependents.get(d.f)!.push(d.t);
  }

  // How often each capability has actually stopped work. Present from the
  // first recorded deficit, which is what makes the ranking tip from
  // structural to observed without anyone switching it over.
  const blocked = new Map<string, number>();
  const recorded = deficits(db);
  if (Array.isArray(recorded)) {
    for (const d of recorded as any[]) blocked.set(d.id, d.times_blocked || 0);
  }

  const out: Candidate[] = [];
  for (const c of caps) {
    if (reached(c)) continue;
    const missing = (prereqs.get(c.id) || []).filter(p => !reached(byId.get(p)));
    if (missing.length > 1) continue; // more than one step away is a project

    // What this capability would let the graph reach that nothing else would:
    // its dependents whose only unmet prerequisite is this one.
    const unlocks = (dependents.get(c.id) || []).filter(dep => {
      const depCap = byId.get(dep);
      if (!depCap || reached(depCap)) return false;
      return (prereqs.get(dep) || []).every(p => p === c.id || reached(byId.get(p)));
    });

    out.push({
      id: c.id,
      name: c.name,
      description: c.description,
      setup_seconds: c.unlock_cost_setup || 0,
      unlocks: unlocks.map(u => byId.get(u)?.name || u),
      missing: missing.map(m => byId.get(m)?.name || m),
      blocked_by_degraded: missing.some(m => {
        const cap = byId.get(m);
        return cap && cap.state !== 'locked' && !usable(cap.lifecycle);
      }),
      observed_blocks: blocked.get(c.id) || 0,
    });
  }
  return out;
}

/** Minutes, or hours once minutes stop being readable. */
function readableCost(seconds: number): string {
  if (!seconds) return 'unknown';
  return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
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
  const scored = all
    .map(c => {
      const hours = Math.max(c.setup_seconds, 300) / 3600;
      // Leverage per hour of setup, so a cheap capability that unblocks two
      // things outranks an expensive one that unblocks three. The +1 counts
      // the capability itself: reaching it is worth something even when
      // nothing waits on it.
      const leverage = (c.unlocks.length + 1) / hours;
      return { ...c, score: observed ? c.observed_blocks * 10 + leverage : leverage };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, howMany);

  return {
    basis: observed
      ? 'observed — ranked by what has actually blocked work, then by leverage'
      : 'structural — nothing has been recorded as blocking work yet, so this ranks by what each would unblock per hour of setup',
    next: scored.map(c => {
      const short = c.id.replace('combo:', '');
      const cost = catalogReport(db, c.id) as any;
      const cheapest = Array.isArray(cost?.options) ? cost.options[0] : undefined;
      return {
        capability: c.name,
        id: c.id,
        why: c.observed_blocks
          ? `It has blocked work ${c.observed_blocks} ${c.observed_blocks === 1 ? 'time' : 'times'}.`
          : c.unlocks.length
            ? `Reaching it also reaches ${c.unlocks.join(' and ')}, which ${c.unlocks.length === 1 ? 'is' : 'are'} already supplied and waiting on this alone.`
            : // A seeded description carries its own hint after an em dash.
              // The briefing wants the claim, not the instruction that follows
              // it — `ambit goal <cap>` is where the instruction belongs.
              (c.description || '').split(' — ')[0] || 'It is one step away.',
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
        propose: `ambit propose ${short}`,
        plan: `ambit goal ${short}`,
      };
    }),
    note: observed
      ? undefined
      : 'Install the telemetry bridge and this ranks by what actually blocks work instead — see plugins/ambit-telemetry.js.',
  };
}

/** The same three, as the two lines a briefing can carry. */
function nextLines(db: Db): string[] {
  const r = nextSteps(db) as any;
  if (!r.next?.length) return [];
  return r.next.map((n: any) => `${n.capability} · ${n.cost} · ${n.why}`);
}

export { nextSteps, nextLines, candidates, readableCost };
