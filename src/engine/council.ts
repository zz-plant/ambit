/**
 * The council: five readings of one next step, each from a different question
 * the engine already answers, and whether they agree.
 *
 * `ambit next` names the step; the other modules each know something about it
 * the ranking does not say. Fragility knows what it would rest on. The ledger
 * knows whether anyone has priced it. Authority knows what it would be allowed
 * to do once reached. The checks know whether its foundation is working. Each
 * of those was a report of its own, read one at a time, so a person could take
 * the step the frontier recommended and find out from a later report that it
 * put a fourth dependant on one credential.
 *
 * Five seats, one sentence each, the command behind the sentence, and a stance
 * on the step. The product moment is the disagreement: when Science says reach
 * it and Defence says it rests on a single provider, both are true, and the
 * page shows both. A seat with nothing recorded to read says so and is marked
 * silent, because an advisor who invents an opinion from an empty table is the
 * failure rule 16 names. Nothing here writes, and no seat runs a command.
 */
import { shellQuote } from '../shared/shell.ts';
import type { LoopAdvisor, LoopCouncil } from '../shared/api.ts';
import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL } from './vocabulary.ts';
import { authorityReport, brokenFoundations, narrower, suggestPromotions } from './assurance.ts';
import { computeDecay, singlePointsOfFailure } from './inference.ts';
import { humanDigest } from './attention.ts';
import { budgetStanding } from './budgets.ts';
import { nextSteps } from './next.ts';
import { opportunitiesFor } from './opportunities.ts';
import { telemetryBridgeInstall } from './paths.ts';

type Motion = NonNullable<LoopCouncil['motion']>;
type Node = { id: string; name: string };

/** The ledger window the Treasury seat reads, the same as the loop page's. */
const WINDOW_DAYS = 30;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const list = (names: string[], max = 3) =>
  names.length > max
    ? `${names.slice(0, max).join(', ')} and ${names.length - max} more`
    : names.join(', ');
const bare = (id: string) => id.replace(/^combo:/, '');
/** A payback under a month is said in days, as the loop page says it. */
const payback = (months: number) =>
  months < 1
    ? `${Math.max(1, Math.round(months * 30))} days`
    : `${months} ${plural(months, 'month')}`;

/** The hard prerequisites of a capability, as `brokenFoundations` walks them. */
function prerequisitesOf(db: Db, id: string): Node[] {
  return db
    .prepare(
      `SELECT c.id, c.name FROM dependencies d
       JOIN capabilities c ON c.id = d.from_capability
       WHERE d.to_capability = ? AND d.is_hard_requisite = 1 ORDER BY c.name`
    )
    .all<Node>(id);
}

/** What the frontier recommends: the first of `ambit next`, with its reason. */
function science(top: any): LoopAdvisor {
  const seat = { seat: 'science', reads: 'the frontier' } as const;
  if (!top) {
    return {
      ...seat,
      says: 'Nothing is one step away: every capability the model knows is reached, or needs more than one acquisition.',
      stance: 'silent',
    };
  }
  return {
    ...seat,
    says: String(top.why || `${top.capability} is one step away.`),
    command: top.propose ? String(top.propose) : undefined,
    subject: { id: String(top.id), name: String(top.capability) },
    stance: 'for',
  };
}

/**
 * What the step would rest on. Against when one of its hard prerequisites has
 * a single provider, or is itself the only provider of other reached
 * capabilities: the step would be one more thing on a single point of failure.
 */
function defence(db: Db, motion: Motion | null): LoopAdvisor {
  const seat = { seat: 'defence', reads: 'fragility' } as const;
  const report = singlePointsOfFailure(db);
  const spofs: any[] = Array.isArray(report) ? report : [];
  const soleProvider = new Map<string, { name: string; holds: number }>();
  for (const s of spofs) {
    if (!s.provider_id) continue;
    const entry = soleProvider.get(s.provider_id) || { name: String(s.sole_provider), holds: 0 };
    entry.holds++;
    soleProvider.set(s.provider_id, entry);
  }
  const fragile = new Map(spofs.map(s => [String(s.id), s]));

  if (motion) {
    for (const p of prerequisitesOf(db, motion.id)) {
      const holds = soleProvider.get(p.id);
      if (holds) {
        return {
          ...seat,
          says: `${motion.name} would rest on ${p.name}, which is already the only provider of ${holds.holds} reached ${plural(holds.holds, 'capability', 'capabilities')}.`,
          command: `ambit impact ${shellQuote(p.id)}`,
          subject: p,
          stance: 'against',
        };
      }
      const weak = fragile.get(p.id);
      if (weak) {
        const by = weak.sole_provider
          ? `has one provider, ${weak.sole_provider}`
          : `rests on one credential, ${weak.sole_credential}`;
        return {
          ...seat,
          says: `${motion.name} would rest on ${p.name}, which ${by}.`,
          command: `ambit impact ${shellQuote(p.id)}`,
          subject: p,
          stance: 'against',
        };
      }
    }
  }

  if (spofs.length) {
    const first = spofs[0];
    const lead = motion
      ? `Nothing ${motion.name} needs rests on one provider; elsewhere`
      : 'Elsewhere';
    return {
      ...seat,
      says: `${lead} ${spofs.length} reached ${plural(spofs.length, 'capability does', 'capabilities do')}: ${list(spofs.map(s => String(s.capability)))}.`,
      command: `ambit impact ${shellQuote(String(first.provider_id || first.credential_id || first.id))}`,
      subject: { id: String(first.id), name: String(first.capability) },
      stance: 'neutral',
    };
  }
  return {
    ...seat,
    says: 'Every reached capability has more than one provider, or none is recorded.',
    stance: 'neutral',
  };
}

/**
 * Whether anyone has priced it. For when the ledger has priced the step and it
 * pays back; against when it is priced and never does. With no price on it, the
 * seat says where the month's hours went, or that a ceiling is about to be hit;
 * with nothing recorded it is silent.
 */
function treasury(db: Db, motion: Motion | null): LoopAdvisor {
  const seat = { seat: 'treasury', reads: 'the ledger' } as const;
  let opportunities: any[] = [];
  try {
    opportunities = (opportunitiesFor(db) as any)?.opportunities || [];
  } catch {
    /* the economic half needs a ledger */
  }
  const priced = motion && opportunities.find(o => o.capability_id === motion.id);
  if (priced) {
    const hours = Number(priced.burden?.human_hours_month) || 0;
    const saves = Math.round(Number(priced.expected?.savings_dollars_month) || 0);
    const payback_ = priced.payback_months;
    const pays =
      payback_ == null
        ? 'nothing is saved, so the setup never pays back'
        : `pays back in ${payback(Number(payback_))} and recovers $${saves} a month`;
    return {
      ...seat,
      says: `Stepping in for ${motion.name} cost ${hours}h this month; reaching it ${pays}.`,
      command: `ambit opportunity ${shellQuote(String(priced.id))}`,
      subject: { id: motion.id, name: motion.name },
      stance: payback_ == null ? 'against' : 'for',
    };
  }

  // The ledger prices by payback and the frontier ranks by leverage, so the
  // page's headline move and the step on the table can differ. Said here, with
  // the relation between them, instead of leaving two "next" lines on one
  // page: the priced case is on the far side of this step, or it is not.
  const first = [...opportunities]
    .filter(o => o.payback_months != null && o.capability_id)
    .sort((a, b) => a.payback_months - b.payback_months)[0];
  if (motion && first && first.capability_id !== motion.id) {
    const name = String(first.capability);
    const saves = Math.round(Number(first.expected?.savings_dollars_month) || 0);
    const onTheWay = prerequisitesOf(db, String(first.capability_id)).some(p => p.id === motion.id);
    return {
      ...seat,
      says: `The ledger prices ${name} first: it pays back in ${payback(Number(first.payback_months))} and recovers $${saves} a month, and ${motion.name} is ${onTheWay ? 'the step to it' : 'not on the way to it'}.`,
      command: `ambit opportunity ${shellQuote(String(first.id))}`,
      subject: { id: String(first.capability_id), name },
      stance: onTheWay ? 'for' : 'neutral',
    };
  }

  const ceiling = budgetOnPace(db);
  if (ceiling) return { ...seat, ...ceiling, stance: 'neutral' };

  const digest = humanDigest(db, WINDOW_DAYS) as any;
  const burden = [...(digest.reducible || []), ...(digest.keepers || [])].sort(
    (a, b) => seconds(b) - seconds(a)
  )[0];
  if (digest.interventions > 0 && burden) {
    const hours = Math.round((seconds(burden) / 3600) * 10) / 10;
    const about = motion ? `Nothing prices ${motion.name} yet; the` : 'The';
    return {
      ...seat,
      says: `${about} month's hours went to ${burden.capability}, ${hours}h over ${burden.times} ${plural(burden.times, 'ask')}.`,
      command: `ambit attention ${WINDOW_DAYS}`,
      subject: burden.capability_id
        ? { id: String(burden.capability_id), name: String(burden.capability) }
        : undefined,
      stance: 'neutral',
    };
  }
  return {
    ...seat,
    says: `No interventions recorded in the last ${WINDOW_DAYS} days, so nothing is priced.`,
    command: telemetryBridgeInstall(),
    stance: 'silent',
  };
}

const seconds = (i: { active_seconds?: number; waiting_seconds?: number }) =>
  (i.active_seconds || 0) + (i.waiting_seconds || 0);

/** A standing budget whose pace reaches its ceiling before the period ends. */
function budgetOnPace(db: Db): Pick<LoopAdvisor, 'says' | 'command' | 'subject'> | null {
  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT b.capability_id, b.action, b.budget_cents, b.spent_cents, b.period,
                b.period_start, c.name
         FROM budgets b LEFT JOIN capabilities c ON c.id = b.capability_id
         WHERE b.budget_cents > 0 ORDER BY b.capability_id`
      )
      .all<any>();
  } catch {
    return null;
  }
  for (const b of rows) {
    const standing = budgetStanding(db, b);
    const hits = standing.forecast?.hitsCeilingOn;
    if (!hits || !standing.periodEndsOn || hits >= standing.periodEndsOn) continue;
    const name = String(b.name || b.capability_id);
    return {
      says: `${name} is on pace to reach its $${(b.budget_cents / 100).toFixed(0)} ceiling on ${hits}, before the ${b.period} ends on ${standing.periodEndsOn}.`,
      command: 'ambit budget',
      subject: { id: String(b.capability_id), name },
    };
  }
  return null;
}

/**
 * What it would be allowed to do. The step's own default grant comes first,
 * because a capability that runs unattended the moment it is reached is the
 * thing a person deciding to reach it should hear; then a grant that has
 * earned a threshold nobody set; then the standing count.
 */
function justice(db: Db, motion: Motion | null): LoopAdvisor {
  const seat = { seat: 'justice', reads: 'authority' } as const;
  if (motion) {
    const grants = db
      .prepare(
        `SELECT mode, source FROM authority
         WHERE capability_id = ? AND action = 'execute'
           AND (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .all<{ mode: string; source: string }>(motion.id);
    if (grants.length) {
      const mode = grants.map(g => g.mode).reduce(narrower);
      const reads =
        mode === 'autonomous'
          ? 'run unattended'
          : mode === 'forbidden'
            ? 'be refused'
            : 'ask first';
      return {
        ...seat,
        says: `Reached, ${motion.name} would ${reads} by default, the grant the tree gives it; ${
          mode === 'autonomous'
            ? 'a narrower grant first keeps the first runs in view'
            : 'a person decides each run until a threshold is set'
        }.`,
        command:
          mode === 'autonomous'
            ? `ambit authority grant ${shellQuote(bare(motion.id))} confirm --by=<person>`
            : `ambit can ${shellQuote(bare(motion.id))}`,
        subject: { id: motion.id, name: motion.name },
        stance: 'neutral',
      };
    }
  }

  let promotable: any[] = [];
  try {
    promotable = suggestPromotions(db) as any[];
  } catch {
    /* a ledger with no interventions */
  }
  if (Array.isArray(promotable) && promotable.length) {
    const p = promotable[0];
    const asked = Number(p.asked_by_hand) || 0;
    return {
      ...seat,
      says: `${p.capability} ${p.action} has been confirmed by hand ${asked} ${plural(asked, 'time')} with ${p.evidence}; a threshold would end the asking.`,
      command: p.set_it ? String(p.set_it) : undefined,
      subject: { id: String(p.id), name: String(p.capability) },
      stance: 'neutral',
    };
  }

  const report = authorityReport(db) as any;
  if (!report || (report.note && !report.autonomous)) {
    return { ...seat, says: 'No authority is declared on this graph.', stance: 'silent' };
  }
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  const a = n(report.autonomous);
  const c = n(report.needs_approval);
  const f = n(report.forbidden);
  return {
    ...seat,
    says: `${a} reached ${plural(a, 'capability runs', 'capabilities run')} unattended, ${c} ${plural(c, 'asks', 'ask')} first and ${f} ${plural(f, 'is', 'are')} forbidden; nothing has earned a threshold yet.`,
    command: 'ambit authority',
    stance: 'neutral',
  };
}

/**
 * Whether the foundation works. Against when a hard prerequisite of the step is
 * failing its check: re-verify it before building on it. Otherwise what is
 * failing anywhere, then what has gone longest untended.
 */
function interior(db: Db, motion: Motion | null): LoopAdvisor {
  const seat = { seat: 'interior', reads: 'the checks' } as const;
  if (motion) {
    // A configured capability whose check fails is one `ambit next` can put
    // first, since reaching it would open what waits on it; proposing it again
    // would re-add what is already there. This seat is where that is said.
    const itself = db
      .prepare(
        `SELECT id, name FROM capabilities WHERE id = ? AND ${REACHED_SQL} AND ${FAILING_SQL}`
      )
      .get<Node>(motion.id);
    if (itself) {
      return {
        ...seat,
        says: `${motion.name} is configured and failing its check; re-verify it, do not add it again.`,
        command: `ambit verify ${shellQuote(motion.id)}`,
        subject: { id: motion.id, name: motion.name },
        stance: 'against',
      };
    }
    const broken = brokenFoundations(db, motion.id);
    if (broken.length) {
      const b = broken[0];
      return {
        ...seat,
        says: `${b.name} is configured and failing its check; re-verify it before putting ${motion.name} on top of it.`,
        command: `ambit verify ${shellQuote(b.id)}`,
        subject: { id: b.id, name: b.name },
        stance: 'against',
      };
    }
  }
  const failing = db
    .prepare(
      `SELECT id, name FROM capabilities WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
    )
    .all<Node>();
  if (failing.length) {
    return {
      ...seat,
      says: `${failing.length} reached ${plural(failing.length, 'capability is', 'capabilities are')} failing ${plural(failing.length, 'its', 'their')} check: ${list(failing.map(f => f.name))}.`,
      command: 'ambit verify --failing',
      subject: failing[0],
      stance: 'neutral',
    };
  }
  const stale = (computeDecay(db) as any[]).find(d => d.decayed);
  if (stale) {
    return {
      ...seat,
      says: `Nothing is failing; ${stale.name} has gone ${stale.days_since_config_change} days without a change, the longest on the map.`,
      subject: { id: String(stale.capability_id), name: String(stale.name) },
      stance: 'neutral',
    };
  }
  return { ...seat, says: 'Nothing is failing and nothing has gone untended.', stance: 'neutral' };
}

/** The council on the step `ambit next` puts first, and whether it is split. */
function council(db: Db): LoopCouncil {
  let report: any = {};
  try {
    report = nextSteps(db);
  } catch {
    /* a graph with no dependencies ranks nothing */
  }
  const top = report?.next?.[0];
  const motion: Motion | null = top
    ? {
        id: String(top.id),
        name: String(top.capability),
        cost: String(top.cost || ''),
        basis: String(report.basis || '').startsWith('observed') ? 'observed' : 'structural',
      }
    : null;
  const advisors: LoopAdvisor[] = [
    science(top),
    defence(db, motion),
    treasury(db, motion),
    justice(db, motion),
    interior(db, motion),
  ];
  return {
    motion,
    advisors,
    split: advisors.some(a => a.stance === 'for') && advisors.some(a => a.stance === 'against'),
  };
}

/**
 * The council as the one or two lines a briefing can carry: the step, the
 * split, and what the seats against it said. A seat that is for the step is
 * named and not quoted, since the Next line already says why; silence is left
 * out, since the briefing's other lines say what the ledger lacks.
 */
function councilLines(c: LoopCouncil): string[] {
  if (!c.motion) return [];
  const name = (a: LoopAdvisor) => a.seat[0].toUpperCase() + a.seat.slice(1);
  const against = c.advisors.filter(a => a.stance === 'against');
  const forIt = c.advisors.filter(a => a.stance === 'for').map(name);
  const head = c.split
    ? `split, ${forIt.join(' and ')} for and ${against.map(name).join(' and ')} against`
    : against.length
      ? `${against.map(name).join(' and ')} against`
      : 'no seat against it';
  return [
    `Council on ${c.motion.name}: ${head}.` +
      (against.length ? ` ${against.map(a => `${name(a)}: ${a.says}`).join(' ')}` : ''),
  ];
}

export { council, councilLines };
