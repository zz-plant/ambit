import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULT, loadTechTree } from './paths.ts';
import type { Db } from './db.ts';
import { providersOf } from './inference.ts';
import { inverseOf } from './governance.ts';
import { usable } from './assurance.ts';
import { opportunityFor, economicCaseFor } from './opportunities.ts';

/**
 * Where a chosen way to close a step fights how a required person prefers
 * things done.
 *
 * A person's `prefers` are words — local-when-practical, minimize-recurring-
 * cost — matched against the properties of the alternative actually chosen.
 * The plan names the fight rather than hiding it, because the person is the
 * one deciding, and an un-named conflict reads as "there is no choice".
 * Returns the conflicts, or undefined when nothing disagrees.
 */
function conflictForChosen(step: any, chosen: any, db: Db): string[] | undefined {
  if (!chosen) return undefined;
  const people = step.requires_person || [];
  if (!people.length) return undefined;
  const rows = db
    .prepare(
      `SELECT p.preference, c.name FROM preferences p
       JOIN capabilities c ON c.id = p.actor_id`
    )
    .all() as any[];
  const prefsByPerson = new Map<string, string[]>();
  for (const r of rows) {
    if (!prefsByPerson.has(r.name)) prefsByPerson.set(r.name, []);
    prefsByPerson.get(r.name)!.push(r.preference);
  }

  const hits: string[] = [];
  for (const person of people) {
    const prefs = prefsByPerson.get(person)?.join(' ') || '';
    if (!prefs) continue;
    const hosted = chosen.privacy === 'hosted';
    const recurring = chosen.recurring_cost && chosen.recurring_cost !== 'none';
    if (hosted && prefs.includes('local-when-practical')) {
      const localAlt = (step.options || []).find((o: any) => o.privacy !== 'hosted');
      hits.push(
        `${person} prefers local-when-practical; the choice (${chosen.name}) is hosted${localAlt ? ` — ${localAlt.name} matches` : ''}`
      );
    }
    if (recurring && prefs.includes('minimize-recurring-cost')) {
      const oneOff = (step.options || []).find(
        (o: any) => !o.recurring_cost || o.recurring_cost === 'none'
      );
      hits.push(
        `${person} prefers minimize-recurring-cost; the choice (${chosen.name}) is recurring${oneOff ? ` — ${oneOff.name} matches` : ''}`
      );
    }
  }
  return hits.length ? hits : undefined;
}

/**
 * The gap between here and a named capability, and the order to close it in.
 *
 * This is the narrow, buildable half of goal-to-delta planning: the goal has to
 * be a capability the model already knows about, so it plans within the tree
 * rather than from an arbitrary sentence. Free-form goals need §5 proper.
 *
 * Walks hard prerequisites depth-first, emitting each unreached one before the
 * thing that needs it, so the list can be worked top to bottom.
 */
function planFor(db: Db, goal?: string) {
  if (!goal) return { error: 'Usage: ambit goal <capability-id>' };
  // A bare name is a tech-tree node; anything already carrying a prefix is
  // taken as written, so an action — act:version-control/merge_to_default —
  // can be planned for directly rather than only the capability conferring it.
  const id = goal.includes(':') ? goal : `combo:${goal}`;

  const target = db
    .prepare('SELECT id, name, state, lifecycle FROM capabilities WHERE id = ?')
    .get(id);
  if (!target) return { error: `No capability ${id}. Try ambit graph combos for the list.` };
  // Same shape as the planned case. Returning a different one here meant
  // callers had to special-case it, and a guard reading `steps === 0` silently
  // never fired because the field was absent rather than zero.
  if (target.state !== 'locked' && !usable(target.lifecycle)) {
    // Reachable, but its check is failing. This is not an acquisition and a
    // plan that said "add it" would be proposing to buy what is already broken.
    return {
      goal: target.name,
      reachable: false,
      degraded: true,
      steps: 0,
      missing: [],
      order: [],
      lifecycle: target.lifecycle,
      note: 'configured, but verification is failing — re-verify with ambit verify before relying on it',
    };
  }
  if (target.state !== 'locked') {
    return {
      goal: target.name,
      reachable: true,
      steps: 0,
      missing: [],
      order: [],
      note: 'already reached',
    };
  }

  const hard = db
    .prepare(
      'SELECT from_capability f, to_capability t FROM dependencies WHERE is_hard_requisite = 1'
    )
    .all();
  const prereqs = new Map<string, string[]>();
  for (const d of hard) {
    if (!prereqs.has(d.t)) prereqs.set(d.t, []);
    prereqs.get(d.t)!.push(d.f);
  }
  const info = new Map(
    db
      .prepare('SELECT id, name, state, kind, unlock_cost_setup, lifecycle FROM capabilities')
      .all()
      .map((c: any) => [c.id, c])
  );

  const order: any[] = [];
  const degradedHits = new Set<string>();
  const seen = new Set<string>();
  let cyclic = false;
  const walk = (node: string, stack: Set<string>) => {
    if (seen.has(node)) return;
    if (stack.has(node)) {
      cyclic = true;
      return;
    }
    stack.add(node);
    for (const p of prereqs.get(node) || []) {
      const c = info.get(p);
      if (!c) continue;
      if (c.state === 'locked') {
        walk(p, stack);
        continue;
      }
      // A degraded or broken prerequisite is not satisfied — the capability is
      // broken, and a plan must say so rather than silently planning on top of
      // it. Re-verify, do not re-add.
      if (!usable(c.lifecycle)) degradedHits.add(c.id);
    }
    stack.delete(node);
    seen.add(node);
    // The goal belongs in its own plan. Excluding it meant that a capability
    // whose prerequisites were already met produced an empty order — "nothing
    // to do" for the case where the one thing to do is acquire it — and callers
    // reading `steps === 0` concluded it was already reached.
    const c = info.get(node);
    if (c && c.state === 'locked') {
      order.push({ id: node, name: c.name, setup_seconds: c.unlock_cost_setup || 0 });
    }
  };
  walk(id, new Set());

  // Which steps are somebody's rather than the machine's. A plan that hides
  // this reads as autonomous when it is not.
  // Whose steps, asked of the graph rather than of two sentences: an edge whose
  // source is a person, whether it supplies the step or authorises it.
  const humanEdges = db
    .prepare(
      `SELECT d.from_capability f, d.to_capability t FROM dependencies d
       JOIN capabilities c ON c.id = d.from_capability
       WHERE c.kind = 'actor' AND d.kind IN ('provides', 'authorizes')`
    )
    .all();
  const humanFor = new Map<string, string[]>();
  for (const e of humanEdges) {
    if (!humanFor.has(e.t)) humanFor.set(e.t, []);
    humanFor.get(e.t)!.push((info.get(e.f) as any)?.name || e.f);
  }
  for (const step of order) {
    const people = humanFor.get(step.id);
    if (people?.length) step.requires_person = people;
  }
  const gatedBy = humanFor.get(id);

  // How each step could be closed. Alternatives rather than one blessed
  // answer, because the trade-off is rarely setup time alone: a hosted option
  // is faster and adds a bill and a data boundary.
  const tree = loadTechTree();
  const recipeFor = new Map<string, any>(
    (tree.nodes || [])
      .filter((n: any) => n.acquisition)
      .map((n: any) => [`combo:${n.id}`, n.acquisition])
  );
  for (const step of order) {
    const recipe = recipeFor.get(step.id);
    if (recipe?.alternatives?.length) step.options = recipe.alternatives;
  }

  // Where the plan's default choice for a step fights how a required person
  // prefers things done. Named, not enforced: the person is the one deciding,
  // and a plan that hides the conflict reads as if there is no choice. Runs
  // after options are attached, because the conflict is about the choice.
  for (const step of order) {
    const conflicts = step.options?.length
      ? conflictForChosen(step, step.options[0], db)
      : undefined;
    if (conflicts) step.preference_conflicts = conflicts;
  }

  const totalSeconds = order.reduce((s, o) => s + (o.setup_seconds || 0), 0);
  const degraded = [...degradedHits].map(id => ({ id, name: (info.get(id) as any)?.name || id }));
  return {
    goal: target.name,
    requires_person: gatedBy,
    // Every step is something the model can describe how to acquire. A step
    // that is a raw provider is a thing to install, which this cannot plan.
    reachable: order.every(o => ['capability', 'action'].includes((info.get(o.id) as any)?.kind)),
    steps: order.length,
    estimated_setup:
      totalSeconds >= 3600
        ? `${(totalSeconds / 3600).toFixed(1)}h`
        : `${Math.round(totalSeconds / 60)}m`,
    order,
    degraded: degraded.length ? degraded : undefined,
    note: degraded.length
      ? 'these prerequisites are configured but failing verification — re-verify or repair them before acquiring anything that needs them'
      : undefined,
    cyclic: cyclic || undefined,
  };
}

/**
 * Why a task was blocked, as distinct from *what* was missing.
 *
 * §6's unbuilt half. A block recorded against a capability says "the
 * capability was missing", which is the easy case. The useful claim is the
 * classification: was it a missing tool, a missing permission, missing
 * knowledge, weak infrastructure, an unreliable capability, or plain
 * reasoning? The same capability can be blocked by different causes on
 * different days, and "structural" should mean the cause recurs, not that the
 * capability name does.
 */
const BLOCK_CLASSES = [
  'reasoning',
  'knowledge',
  'tool',
  'permission',
  'infrastructure',
  'reliability',
] as const;
type BlockClass = (typeof BLOCK_CLASSES)[number];

const BLOCK_PREFIX = 'blocked:';

/**
 * The stored action for a classified block. `blocked` remains valid for rows
 * recorded before classification existed; the prefix is what new rows carry.
 */
function blockedAction(classifier?: string): string {
  return classifier ? `${BLOCK_PREFIX}${classifier}` : 'blocked';
}

/**
 * Records a task failure against the capability that was missing, and why.
 *
 * The point is not the individual failure, it is the pattern. A deficit hit
 * once is bad luck; the same one hit four times is infrastructure that should
 * exist. `tt deficits` reports the recurring ones, which is the signal for
 * turning friction into a capability rather than working around it again.
 *
 *   tt failed vector-store tool "semantic search over notes"
 *   tt failed vector-store reasoning
 *
 * The classification is one of: reasoning, knowledge, tool, permission,
 * infrastructure, reliability. Omitting it records an unclassified block,
 * which is exactly what the CLI did before classification existed.
 */
function recordFailure(db: Db, capId?: string, classifier?: string, note?: string) {
  if (!capId)
    return {
      error:
        'Usage: ambit record <capability> [reasoning|knowledge|tool|permission|infrastructure|reliability] ["what you were trying to do"]',
    };
  const id = capId.startsWith('combo:') || capId.includes(':') ? capId : `combo:${capId}`;
  if (!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id)) {
    return {
      error: `No capability ${id}. Use an id from ambit graph combos, so deficits aggregate against something real.`,
    };
  }
  // The second positional may be a classification or — for a call that predates
  // classification — the note itself. Only a known class is taken as one.
  const cls =
    classifier && BLOCK_CLASSES.includes(classifier as BlockClass) ? classifier : undefined;
  const storedNote = cls ? note || null : classifier || null;
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('task', ?, ?, 0, ?)"
  ).run(id, blockedAction(cls), storedNote);
  const count = db
    .prepare(
      "SELECT COUNT(*) AS n FROM session_learning WHERE capability_id = ? AND (action = 'blocked' OR action LIKE 'blocked:%')"
    )
    .get(id);
  const clsCount = cls
    ? db
        .prepare(
          'SELECT COUNT(*) AS n FROM session_learning WHERE capability_id = ? AND action = ?'
        )
        .get(id, blockedAction(cls))
    : undefined;
  return {
    recorded: id,
    classification: cls || 'unclassified',
    times_blocked: count?.n ?? 1,
    times_as_this_class: clsCount?.n ?? undefined,
    note:
      (count?.n ?? 1) >= 3
        ? 'This has blocked work repeatedly. It is a structural deficit, not a one-off — see ambit goal ' +
          id.replace('combo:', '')
        : undefined,
  };
}

/**
 * Capability deficits that keep recurring, worst first.
 *
 * Distinguishes incidental friction from the structural kind: whether the same
 * missing capability keeps stopping different work — and, since §6, *why* it
 * keeps stopping it. A capability blocked four times as a missing tool and
 * once as a missing permission is one structural deficit about the tool and an
 * incident about the permission; collapsing them would lose the distinction.
 */
function deficits(db: Db) {
  const rows = db
    .prepare(
      `SELECT s.capability_id id, COUNT(*) AS times, MAX(s.timestamp) AS last_seen, c.name, c.state, c.lifecycle
       FROM session_learning s JOIN capabilities c ON c.id = s.capability_id
       WHERE s.action = 'blocked' OR s.action LIKE 'blocked:%'
       GROUP BY s.capability_id ORDER BY times DESC, last_seen DESC`
    )
    .all();
  if (rows.length === 0) {
    return {
      note: 'Nothing recorded. Use ambit record <capability> when a task is blocked by a missing one.',
    };
  }

  const byClass = db
    .prepare(
      `SELECT s.capability_id id, replace(s.action, 'blocked:', '') AS class, COUNT(*) AS times
       FROM session_learning s
       WHERE s.action LIKE 'blocked:%'
       GROUP BY s.capability_id, s.action ORDER BY times DESC`
    )
    .all();
  const classOf = new Map<string, string[]>();
  for (const r of byClass as any[]) {
    if (!classOf.has(r.id)) classOf.set(r.id, []);
    classOf.get(r.id)!.push(`${r.class} ×${r.times}`);
  }

  return rows.map((r: any) => ({
    name: r.name,
    id: r.id,
    times_blocked: r.times,
    last_seen: r.last_seen,
    still_missing: r.state === 'locked' || !usable(r.lifecycle),
    // The classification distribution, not just the count: a deficit that
    // recurs as the same cause is structural; one that recurs as several
    // causes is a capability that keeps failing for different reasons, which
    // is a different signal.
    causes: classOf.get(r.id),
    verdict:
      r.times >= 3 && r.state === 'locked'
        ? 'structural — build it'
        : r.times >= 3 && !usable(r.lifecycle)
          ? 'structural — configured but failing verification'
          : r.times >= 3
            ? 'was structural; now reached'
            : 'incidental so far',
    recommendation:
      r.times >= 3 && r.state === 'locked'
        ? `ambit propose ${r.id.replace('combo:', '')}`
        : r.times >= 3 && !usable(r.lifecycle)
          ? `ambit verify ${r.id.replace('combo:', '')}`
          : undefined,
  }));
}

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
    currentConfig = JSON.parse(readFileSync(CONFIG_DEFAULT, 'utf8'));
  } catch {
    /* no config is fine */
  }

  const steps = (plan.order || []).map((step: any) => {
    const options = step.options || [];
    const chosen = options.length
      ? options[Math.min(optionIndex ?? 0, options.length - 1)]
      : undefined;
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
    note: steps.every((s: any) => s.inverse)
      ? 'Every step is a reversible config change. A person approves it (ambit approve), then ambit apply edits the config, re-seeds, and rolls back on a failed check.'
      : 'Draft only. A step without a computed inverse cannot be applied — it describes work a person does.',
  };
}

/**
 * What each person prefers, and what a plan would be stepping on to ask them.
 *
 * §2's human half: the person is in the graph, and the graph can now say
 * *which* person a step needs. Preferences are the next question — whether a
 * step is worth a person's attention, and whether the only way to close it
 * fights how they like things done. This lists the declarations; `tt plan`
 * names the conflicts where an option disagrees with them.
 */
function preferencesReport(db: Db, who?: string) {
  const rows = db
    .prepare(
      `SELECT p.actor_id, p.preference, c.name, c.state FROM preferences p
       JOIN capabilities c ON c.id = p.actor_id
       ORDER BY c.name, p.preference`
    )
    .all() as any[];
  if (rows.length === 0) {
    return { note: 'No preferences declared. Add a `prefers` list to an actor in the config.' };
  }

  const byPerson = new Map<string, { name: string; prefs: string[] }>();
  for (const r of rows) {
    if (!byPerson.has(r.actor_id)) byPerson.set(r.actor_id, { name: r.name, prefs: [] });
    byPerson.get(r.actor_id)!.prefs.push(r.preference);
  }

  const people = [...byPerson.values()];
  if (who) {
    const hit = people.find(p => p.name.toLowerCase() === who.toLowerCase() || p.name === who);
    if (!hit) return { error: `No preferences recorded for ${who}.` };
    return {
      name: hit.name,
      preferences: hit.prefs,
      note: "matched against a step's alternatives by tt plan — local vs hosted, one-off vs recurring",
    };
  }

  return {
    people: people.map(p => ({ name: p.name, preferences: p.prefs })),
    note: "a preference is a word tt plan matches against a step's alternatives; a conflict is named, not hidden",
  };
}

export { planFor, recordFailure, deficits, simulateFrontier, propose, preferencesReport };
