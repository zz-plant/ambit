import { readFileSync } from "fs";
import { join } from "path";
import { ENGINE_DIR, CONFIG_DEFAULT } from "./paths.ts";
import type { Db } from "./db.ts";
import { providersOf } from "./inference.ts";
import { inverseOf } from "./governance.ts";

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
  if (!goal) return { error: "Usage: tt plan <capability-id>" };
  const id = goal.startsWith('combo:') ? goal : `combo:${goal}`;

  const target = db.prepare("SELECT id, name, state FROM capabilities WHERE id = ?").get(id);
  if (!target) return { error: `No capability ${id}. Try tt combos for the list.` };
  // Same shape as the planned case. Returning a different one here meant
  // callers had to special-case it, and a guard reading `steps === 0` silently
  // never fired because the field was absent rather than zero.
  if (target.state !== 'locked') {
    return { goal: target.name, reachable: true, steps: 0, missing: [], order: [], note: "already reached" };
  }

  const hard = db
    .prepare("SELECT from_capability f, to_capability t FROM dependencies WHERE is_hard_requisite = 1")
    .all();
  const prereqs = new Map<string, string[]>();
  for (const d of hard) {
    if (!prereqs.has(d.t)) prereqs.set(d.t, []);
    prereqs.get(d.t)!.push(d.f);
  }
  const info = new Map(
    db.prepare("SELECT id, name, state, unlock_cost_setup FROM capabilities").all().map((c: any) => [c.id, c])
  );

  const order: any[] = [];
  const seen = new Set<string>();
  let cyclic = false;
  const walk = (node: string, stack: Set<string>) => {
    if (seen.has(node)) return;
    if (stack.has(node)) { cyclic = true; return; }
    stack.add(node);
    for (const p of prereqs.get(node) || []) {
      const c = info.get(p);
      if (!c || c.state !== 'locked') continue; // already satisfied
      walk(p, stack);
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
  const humanEdges = db
    .prepare("SELECT from_capability f, to_capability t FROM dependencies WHERE description IN ('Requires approval from a person','Supplied by a person')")
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
  let tree: any = { nodes: [] };
  try { tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8")); } catch {}
  const recipeFor = new Map<string, any>(
    (tree.nodes || []).filter((n: any) => n.acquisition).map((n: any) => [`combo:${n.id}`, n.acquisition])
  );
  for (const step of order) {
    const recipe = recipeFor.get(step.id);
    if (recipe?.alternatives?.length) step.options = recipe.alternatives;
  }

  const totalSeconds = order.reduce((s, o) => s + (o.setup_seconds || 0), 0);
  return {
    goal: target.name,
    requires_person: gatedBy,
    reachable: order.every(o => o.id.startsWith('combo:')),
    steps: order.length,
    estimated_setup: totalSeconds >= 3600 ? `${(totalSeconds / 3600).toFixed(1)}h` : `${Math.round(totalSeconds / 60)}m`,
    order,
    cyclic: cyclic || undefined,
  };
}


/**
 * Records a task failure against the capability that was missing.
 *
 * The point is not the individual failure, it is the pattern. A deficit hit
 * once is bad luck; the same one hit four times is infrastructure that should
 * exist. `tt deficits` reports the recurring ones, which is the signal for
 * turning friction into a capability rather than working around it again.
 *
 *   tt failed vector-store "semantic search over notes"
 */
function recordFailure(db: Db, capId?: string, note?: string) {
  if (!capId) return { error: 'Usage: tt failed <capability> ["what you were trying to do"]' };
  const id = capId.startsWith('combo:') || capId.includes(':') ? capId : `combo:${capId}`;
  if (!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id)) {
    return { error: `No capability ${id}. Use an id from tt combos, so deficits aggregate against something real.` };
  }
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('task', ?, 'blocked', 0, ?)"
  ).run(id, note || null);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM session_learning WHERE capability_id = ? AND action = 'blocked'")
    .get(id);
  return {
    recorded: id,
    times_blocked: count?.n ?? 1,
    note: (count?.n ?? 1) >= 3
      ? 'This has blocked work repeatedly. It is a structural deficit, not a one-off — see tt plan ' + id.replace('combo:', '')
      : undefined,
  };
}

/**
 * Capability deficits that keep recurring, worst first.
 *
 * Distinguishes incidental friction from the structural kind: whether the same
 * missing capability keeps stopping different work.
 */
function deficits(db: Db) {
  const rows = db
    .prepare(
      `SELECT s.capability_id id, COUNT(*) AS times, MAX(s.timestamp) AS last_seen, c.name, c.state
       FROM session_learning s JOIN capabilities c ON c.id = s.capability_id
       WHERE s.action = 'blocked'
       GROUP BY s.capability_id ORDER BY times DESC, last_seen DESC`
    )
    .all();
  if (rows.length === 0) {
    return { note: 'Nothing recorded. Use tt failed <capability> when a task is blocked by a missing one.' };
  }
  return rows.map((r: any) => ({
    name: r.name,
    id: r.id,
    times_blocked: r.times,
    last_seen: r.last_seen,
    still_missing: r.state === 'locked',
    verdict: r.times >= 3 && r.state === 'locked' ? 'structural — build it' : r.times >= 3 ? 'was structural; now reached' : 'incidental so far',
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
    .prepare("SELECT id, name, state FROM capabilities WHERE category = 'combo'")
    .all();
  const hard = db
    .prepare("SELECT from_capability f, to_capability t FROM dependencies WHERE is_hard_requisite = 1")
    .all();
  const providers = providersOf(db);

  const prereqs = new Map<string, string[]>();
  for (const d of hard) {
    if (!d.t.startsWith('combo:')) continue;
    if (!prereqs.has(d.t)) prereqs.set(d.t, []);
    prereqs.get(d.t)!.push(d.f);
  }

  const nameOf = new Map(combos.map((c: any) => [c.id, c.name]));
  const before = new Set(combos.filter((c: any) => c.state !== 'locked').map((c: any) => c.id));
  const assumed = new Set(assume.map(a => (a.startsWith('combo:') ? a : `combo:${a}`)));
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
      if (met) { after.add(c.id); changed = true; }
    }
  }

  const gained = [...assumed].filter(id => !before.has(id));
  const emergent = [...after].filter(id => !before.has(id) && !assumed.has(id));
  return {
    frontier_before: before.size,
    frontier_after: after.size,
    acquired: gained.map(id => ({ id, name: nameOf.get(id) || id })),
    unblocked: emergent.map(id => ({ id, name: nameOf.get(id) || id })),
    note: emergent.length
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
  if (!goal) return { error: 'Usage: tt propose <capability> [option-number]' };
  const plan = planFor(db, goal) as any;
  if (plan.error) return plan;
  if (plan.note === 'already reached') {
    return { goal: plan.goal, note: 'Already reached. Nothing to propose.' };
  }

  let currentConfig: any = {};
  try { currentConfig = JSON.parse(readFileSync(CONFIG_DEFAULT, "utf8")); } catch { /* no config is fine */ }

  const steps = (plan.order || []).map((step: any) => {
    const options = step.options || [];
    const chosen = options.length ? options[Math.min(optionIndex ?? 0, options.length - 1)] : undefined;
    return {
      id: step.id,
      name: step.name,
      chosen: chosen ? chosen.name : 'no alternative recorded',
      setup_seconds: chosen?.setup_seconds ?? step.setup_seconds ?? 0,
      recurring_cost: chosen?.recurring_cost,
      privacy: chosen?.privacy,
      requires_person: step.requires_person,
      // The gate: a step may only ever execute if its undo was computed first.
      // Declarative additive patches qualify; anything needing an installer or
      // a running service does not, and null here is a refusal rather than a
      // gap to be filled in later.
      config_patch: chosen?.config_patch,
      inverse: chosen?.config_patch ? inverseOf(chosen.config_patch, currentConfig) : null,
    };
  });

  const simulated = simulateFrontier(db, steps.map((s: any) => s.id).concat(
    goal.startsWith('combo:') ? goal : `combo:${goal}`
  ));

  const id = `prop-${Date.now().toString(36)}`;
  db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, ?, 'draft', ?, ?)"
  ).run(id, plan.goal, JSON.stringify(steps), JSON.stringify(simulated));

  const totalSeconds = steps.reduce((t: number, s: any) => t + (s.setup_seconds || 0), 0);
  return {
    proposal: id,
    goal: plan.goal,
    status: 'draft',
    estimated_setup: totalSeconds >= 3600 ? `${(totalSeconds / 3600).toFixed(1)}h` : `${Math.round(totalSeconds / 60)}m`,
    requires_person: plan.requires_person,
    steps,
    simulated,
    // Two different claims. `applicable` is about this proposal being safe to
    // apply; `executable` is about apply existing at all, which it does not.
    applicable: steps.every((s: any) => s.inverse),
    executable: false,
    note: 'Draft only. Applying is not implemented; a step without an inverse could not run even if it were.',
  };
}

export { planFor, recordFailure, deficits, simulateFrontier, propose };
