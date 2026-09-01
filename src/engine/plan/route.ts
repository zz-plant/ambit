/**
 * How to get from here to a named goal, and who it would inconvenience.
 *
 * `planFor` orders the missing prerequisites and picks an option for each;
 * `conflictForChosen` is why an option can be wrong even when it works — a
 * step that fights how someone has said they want things done is a cost, not
 * a detail. `preferencesReport` lists those declarations, which is the same
 * question asked the other way round.
 *
 * Split out of planning.ts, which was 652 lines covering routing, recorded
 * deficits and proposals — three stages of one loop, but three stages.
 */
import type { Db } from '../db.ts';
import { loadTechTree } from '../paths.ts';
import { usable } from '../assurance.ts';

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

export { conflictForChosen, planFor, preferencesReport };
