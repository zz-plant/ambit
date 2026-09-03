/**
 * What a person actually approves, as opposed to what they said they prefer.
 *
 * A `prefers` list is a declaration made once, in a config file, about how
 * someone wants things done. It is useful and it is thin. What a person will
 * accept is visible far more precisely in the record of what they have accepted:
 * eleven local alternatives approved, every hosted one turned down, nothing
 * recurring ever agreed to.
 *
 * That record only became possible when refusal became recordable. Approval was
 * always written to the graph and refusal was not, so the evidence was
 * one-sided, and the wrong side: a list of yeses cannot tell you what a no looks
 * like. `ambit reject` closes it.
 *
 * Nothing here decides anything on a person's behalf. It orders the alternatives
 * a proposal offers so the one most likely to be accepted is the one drafted,
 * and it says why — which makes the draft arguable rather than mysterious.
 */
import type { Db } from './db.ts';

/** The properties of an alternative that a person tends to have opinions about. */
interface Traits {
  privacy?: string;
  recurring: boolean;
  setup_seconds?: number;
}

function traitsOf(step: any): Traits {
  return {
    privacy: step?.privacy,
    recurring: Boolean(step?.recurring_cost && step.recurring_cost !== 'none'),
    setup_seconds: step?.setup_seconds,
  };
}

/**
 * Every decided proposal, with the traits of what was chosen in it.
 *
 * A proposal is decided when someone approved it or turned it down. A draft
 * nobody has looked at says nothing about anyone's preferences, and counting it
 * would make silence read as consent.
 */
function decisions(db: Db) {
  const approved = db
    .prepare(
      `SELECT id, goal, steps, approved_by AS who, approved_at AS at, 'approved' AS verdict
       FROM proposals WHERE status IN ('approved', 'applied')`
    )
    .all<any>();
  let rejected: any[] = [];
  try {
    rejected = db
      .prepare(
        `SELECT p.id, p.goal, p.steps, r.rejected_by AS who, r.rejected_at AS at,
                'rejected' AS verdict, r.reason
         FROM proposal_rejections r JOIN proposals p ON p.id = r.proposal_id`
      )
      .all<any>();
  } catch {
    /* database predates the table */
  }
  return [...approved, ...rejected].map(r => {
    let steps: any[] = [];
    try {
      steps = JSON.parse(r.steps);
    } catch {
      /* a proposal written by a version that shaped steps differently */
    }
    return { ...r, traits: steps.map(traitsOf) };
  });
}

/**
 * How a trait has fared: how often it appeared in something approved, and how
 * often in something turned down.
 */
function tally(db: Db) {
  const counts = new Map<string, { approved: number; rejected: number }>();
  const bump = (key: string, verdict: string) => {
    if (!counts.has(key)) counts.set(key, { approved: 0, rejected: 0 });
    const c = counts.get(key)!;
    if (verdict === 'approved') c.approved++;
    else c.rejected++;
  };
  for (const d of decisions(db)) {
    for (const t of d.traits) {
      if (t.privacy) bump(`privacy:${t.privacy}`, d.verdict);
      bump(t.recurring ? 'cost:recurring' : 'cost:one-off', d.verdict);
    }
  }
  return counts;
}

/**
 * What the record supports saying about this person's taste.
 *
 * Deliberately shy. Two decisions are an anecdote, so nothing is claimed until
 * a trait has been decided on three times, and a trait that has gone both ways
 * is reported as contested rather than resolved by majority — a person who
 * approved two hosted services and refused two others has a rule this cannot
 * see, and pretending otherwise would put a confident wrong default in front of
 * them.
 */
function observedPreferences(db: Db) {
  const counts = tally(db);
  const learned: Array<{ trait: string; leans: string; approved: number; rejected: number }> = [];
  for (const [trait, c] of counts) {
    const total = c.approved + c.rejected;
    if (total < 3) continue;
    const ratio = c.approved / total;
    if (ratio >= 0.8) learned.push({ trait, leans: 'accepted', ...c });
    else if (ratio <= 0.2) learned.push({ trait, leans: 'refused', ...c });
    else learned.push({ trait, leans: 'contested', ...c });
  }
  return learned.sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected));
}

/**
 * Scores an alternative against what the record shows, higher being likelier to
 * be accepted. Zero when nothing has been learned, which leaves the model's own
 * ordering alone.
 */
function scoreAlternative(learned: ReturnType<typeof observedPreferences>, alt: any): number {
  const t = traitsOf(alt);
  let score = 0;
  for (const l of learned) {
    if (l.leans === 'contested') continue;
    const weight = l.leans === 'accepted' ? 1 : -1;
    if (l.trait === `privacy:${t.privacy}`) score += weight;
    if (l.trait === 'cost:recurring' && t.recurring) score += weight;
    if (l.trait === 'cost:one-off' && !t.recurring) score += weight;
  }
  return score;
}

/**
 * The alternative this person is likeliest to accept, and why.
 *
 * Returns the index into the options as given, so a caller that has its own
 * ordering keeps it when nothing has been learned.
 */
function preferredOption(db: Db, options: any[]): { index: number; because?: string } {
  if (!options?.length) return { index: 0 };
  const learned = observedPreferences(db);
  if (!learned.length) return { index: 0 };
  let best = 0;
  let bestScore = scoreAlternative(learned, options[0]);
  for (let i = 1; i < options.length; i++) {
    const score = scoreAlternative(learned, options[i]);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (bestScore <= 0 && best === 0) return { index: 0 };
  const reasons = learned
    .filter(l => l.leans !== 'contested')
    .slice(0, 2)
    .map(l => `${l.trait} ${l.leans} ${l.approved}/${l.approved + l.rejected}`);
  return { index: best, because: reasons.join(', ') };
}

/** The report behind the default: what has been approved, refused, and disputed. */
function observedReport(db: Db) {
  const decided = decisions(db);
  const learned = observedPreferences(db);
  if (!decided.length) {
    return {
      note: 'Nothing decided yet. Every approval and every rejection teaches the draft what to choose — `ambit reject <id> <person> "why"` is the half that used to go unrecorded.',
    };
  }
  return {
    decided: decided.length,
    approved: decided.filter(d => d.verdict === 'approved').length,
    rejected: decided.filter(d => d.verdict === 'rejected').length,
    learned: learned.length ? learned : undefined,
    note: learned.length
      ? 'A trait needs three decisions before it counts, and one that has gone both ways is reported as contested rather than settled by majority. `ambit propose` drafts the alternative this favours and names why.'
      : 'Not enough decided to lean on yet — three decisions on the same trait is the floor.',
  };
}

export { observedPreferences, observedReport, preferredOption, decisions, traitsOf };
