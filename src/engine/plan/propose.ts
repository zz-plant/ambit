/**
 * What a change would buy, and the reviewable proposal that carries it.
 *
 * `simulateFrontier` answers the question before the work: assume these
 * capabilities, and what becomes reachable that was not? `propose` turns that
 * into something a person can approve — steps, an inverse for each, and the
 * economic case where one exists.
 */
import { readFileSync } from 'node:fs';
import type { Db } from '../db.ts';
import { configDefault } from '../paths.ts';
import { usable } from '../assurance.ts';
import { providersOf } from '../inference.ts';
import { inverseOf } from '../governance.ts';
import { economicCaseFor, opportunityFor } from '../opportunities.ts';
import { preferredOption } from '../observed.ts';
import { conflictForChosen, planFor } from './route.ts';

// ─── Proposals ────────────────────────────────────────────────────────────────

/**
 * The frontier as it would be if these capabilities were acquired.
 *
 * Runs against a copy of the state, never the database. The interesting output
 * is not the assumed capabilities — you already knew you were adding those —
 * but the ones that come with them: capabilities already provided by something
 * you have, held back only by a prerequisite the change satisfies. Those are
 * the reason a small acquisition can move the frontier a long way, and the
 * reason a preview is worth reading before approving.
 */
function simulateFrontier(db: Db, assume: string[]) {
  const combos = db
    .prepare("SELECT id, name, state, lifecycle FROM capabilities WHERE category = 'combo'")
    .all();
  const hard = db
    .prepare(
      'SELECT from_capability f, to_capability t FROM dependencies WHERE is_hard_requisite = 1'
    )
    .all();
  const providers = providersOf(db);

  const prereqs = new Map<string, string[]>();
  for (const d of hard) {
    if (!d.t.startsWith('combo:')) continue;
    if (!prereqs.has(d.t)) prereqs.set(d.t, []);
    prereqs.get(d.t)!.push(d.f);
  }

  const nameOf = new Map(combos.map((c: any) => [c.id, c.name]));
  // Only usable capabilities count toward the frontier and can satisfy
  // prerequisites. A degraded or broken one is configured but failing
  // verification, so it neither is reached nor can it unblock an acquisition.
  const before = new Set(
    combos.filter((c: any) => c.state !== 'locked' && usable(c.lifecycle)).map((c: any) => c.id)
  );
  const failing = new Set(
    combos.filter((c: any) => c.state !== 'locked' && !usable(c.lifecycle)).map((c: any) => c.id)
  );
  // An action is conferred by a capability rather than acquired on its own, so
  // assuming one means assuming the capability that confers it. Counting the
  // action itself would inflate the frontier with something that was never
  // separately obtainable.
  const conferredBy = new Map<string, string>(
    db
      .prepare(
        `SELECT d.to_capability action, d.from_capability capability FROM dependencies d
       JOIN capabilities c ON c.id = d.to_capability
       WHERE d.kind = 'provides' AND c.kind = 'action'`
      )
      .all()
      .map((r: any) => [r.action, r.capability])
  );
  const normalise = (a: string) => {
    const id = a.includes(':') ? a : `combo:${a}`;
    return conferredBy.get(id) || id;
  };
  const assumed = new Set(assume.map(normalise));
  const after = new Set([...before, ...assumed]);

  // Fixpoint rather than a single pass: satisfying one prerequisite can unblock
  // a capability that unblocks another, and the cascade is the point.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of combos as any[]) {
      if (after.has(c.id)) continue;
      // Only something already provided can be unblocked. A capability nothing
      // supplies does not appear merely because its prerequisites are met.
      if (!(providers.get(c.id) || []).length) continue;
      const met = (prereqs.get(c.id) || []).every(p => after.has(p) || !p.startsWith('combo:'));
      if (met) {
        after.add(c.id);
        changed = true;
      }
    }
  }

  const gained = [...assumed].filter(id => !before.has(id));
  const emergent = [...after].filter(id => !before.has(id) && !assumed.has(id));
  // An assumed acquisition whose hard prerequisite is broken rather than
  // missing: the preview must say why it will not cascade, or the plan reads
  // as if adding the step fixes the prerequisite. It does not.
  const blockedByDegraded = [...assumed].filter(id =>
    (prereqs.get(id) || []).some(p => failing.has(p))
  );
  return {
    frontier_before: before.size,
    frontier_after: after.size,
    acquired: gained.map(id => ({ id, name: nameOf.get(id) || id })),
    unblocked: emergent.map(id => ({ id, name: nameOf.get(id) || id })),
    blocked_by_degraded: blockedByDegraded.length
      ? blockedByDegraded.map(id => ({ id, name: nameOf.get(id) || id }))
      : undefined,
    note: blockedByDegraded.length
      ? 'these are held back by a capability that is configured but failing verification — re-verify, do not re-add'
      : emergent.length
        ? 'unblocked: already provided, held back only by a prerequisite this change satisfies'
        : undefined,
  };
}

/**
 * Builds a proposal for reaching a capability and stores it.
 *
 * Nothing executes, now or as a side effect later. Each step records the
 * alternative chosen and carries an `inverse` that is deliberately null: no
 * step may run without one, so an unpopulated inverse is what prevents a
 * future apply from touching this proposal at all.
 */
function propose(db: Db, goal?: string, optionIndex?: number) {
  if (!goal) return { error: 'Usage: ambit propose <capability> [option-number]' };
  let target: string = goal;

  // An opportunity id proposes its capability, carrying the observed case.
  const opp = /^opp-(\d+)$/.exec(target);
  let fromOpportunity: any = null;
  if (opp) {
    const resolved = opportunityFor(db, target);
    if ('capability_id' in resolved) {
      fromOpportunity = resolved;
      target = resolved.capability_id;
    } else return resolved;
  }

  const plan = planFor(db, target) as any;
  if (plan.error) return plan;
  if (plan.degraded) {
    return { goal: plan.goal, degraded: true, lifecycle: plan.lifecycle, note: plan.note };
  }
  if (plan.note === 'already reached') {
    return { goal: plan.goal, note: 'Already reached. Nothing to propose.' };
  }

  let currentConfig: any = {};
  try {
    currentConfig = JSON.parse(readFileSync(configDefault(), 'utf8'));
  } catch {
    /* no config is fine */
  }

  // Which alternative to draft. An explicit option number is the person's
  // choice and is obeyed. Without one, the record decides: a proposal drafted
  // against what this person has actually approved before is likelier to be
  // approved now, and a draft that is refused costs the same interruption as
  // one that is accepted.
  const chosenBecause: string[] = [];
  const steps = (plan.order || []).map((step: any) => {
    const options = step.options || [];
    let index = 0;
    if (optionIndex != null) {
      index = Math.min(optionIndex, Math.max(options.length - 1, 0));
    } else if (options.length > 1) {
      const preferred = preferredOption(db, options);
      index = preferred.index;
      if (preferred.because && index !== 0) chosenBecause.push(preferred.because);
    }
    const chosen = options.length ? options[index] : undefined;
    return {
      id: step.id,
      name: step.name,
      chosen: chosen ? chosen.name : 'no alternative recorded',
      setup_seconds: chosen?.setup_seconds ?? step.setup_seconds ?? 0,
      recurring_cost: chosen?.recurring_cost,
      privacy: chosen?.privacy,
      requires_person: step.requires_person,
      // Where the chosen alternative fights how a required person prefers
      // things done. `planFor` warns about the default option; this is the
      // plan that actually picked one.
      preference_conflicts: conflictForChosen(step, chosen, db),
      // The gate: a step may only ever execute if its undo was computed first.
      // Declarative additive patches qualify; anything needing an installer or
      // a running service does not, and null here is a refusal rather than a
      // gap to be filled in later.
      config_patch: chosen?.config_patch,
      inverse: chosen?.config_patch ? inverseOf(chosen.config_patch, currentConfig) : null,
    };
  });

  const simulated = simulateFrontier(
    db,
    steps.map((s: any) => s.id).concat(target.includes(':') ? target : `combo:${target}`)
  );

  // The economic case: the goal capability's observed middleware burden, from
  // the opportunity engine. Null when nothing recurring was recorded — the
  // proposal then carries no predicted savings, which is the honest claim.
  const goalId = steps[steps.length - 1]?.id || (target.includes(':') ? target : `combo:${target}`);
  const economic = fromOpportunity
    ? {
        observed: fromOpportunity.burden,
        predicted: fromOpportunity.expected,
        confidence: fromOpportunity.confidence,
        note: fromOpportunity.note,
      }
    : economicCaseFor(db, goalId);

  const id = `prop-${Date.now().toString(36)}`;
  db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated, economic_case) VALUES (?, ?, 'draft', ?, ?, ?)"
  ).run(
    id,
    plan.goal,
    JSON.stringify(steps),
    JSON.stringify(simulated),
    economic ? JSON.stringify(economic) : null
  );

  const totalSeconds = steps.reduce((t: number, s: any) => t + (s.setup_seconds || 0), 0);
  return {
    proposal: id,
    goal: plan.goal,
    status: 'draft',
    estimated_setup:
      totalSeconds >= 3600
        ? `${(totalSeconds / 3600).toFixed(1)}h`
        : `${Math.round(totalSeconds / 60)}m`,
    requires_person: plan.requires_person,
    steps,
    simulated,
    economic_case: economic ?? undefined,
    // `applicable` means every step is a declarative config patch with a
    // computed inverse — the only shape `ambit apply` will run. A step
    // needing an installer or a running service has no inverse, and a
    // proposal containing one stays a document.
    applicable: steps.every((s: any) => s.inverse),
    // Named rather than silent: a default picked from someone's past decisions
    // is a claim about them, and they should be able to argue with it.
    chosen_because: chosenBecause.length ? chosenBecause[0] : undefined,
    note: steps.every((s: any) => s.inverse)
      ? 'Every step is a reversible config change. A person approves it (ambit approve), then ambit apply edits the config, re-seeds, and rolls back on a failed check.'
      : 'Draft only. A step without a computed inverse cannot be applied — it describes work a person does.',
  };
}

export { simulateFrontier, propose };
