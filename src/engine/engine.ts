#!/usr/bin/env node --experimental-sqlite
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveDbPath } from "../shared/db-path.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// OPENCODE_CONFIG is the documented way to point the engine at another config
// (README, "Using other configs"); it was accepted by bootstrap.sh but never
// read here, so seeding always used the default path regardless.
const CONFIG_DEFAULT = process.env.OPENCODE_CONFIG || join(process.env.HOME || "/", ".config", "opencode", "opencode.json");

const C = { reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", grey: "\x1b[90m", blue: "\x1b[36m", red: "\x1b[31m", bold: "\x1b[1m" };

/**
 * node:sqlite is experimental and types every row as `unknown`, which would
 * require a hand-written row type at each of the ~40 query sites. This narrows
 * the handle to the surface the engine actually uses, with rows as loose
 * records — the same guarantee the code had before, now stated explicitly.
 */
interface Db {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, any>[];
    get(...params: unknown[]): Record<string, any> | undefined;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
}

function getDb(dbPath?: string): Db {
  const path = dbPath || resolveDbPath();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as Db;
}

function migrate(db: Db) {
  db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));
}


/**
 * Prints a result for a person to read, or raw JSON with --json.
 *
 * Every command used to dump JSON.stringify unconditionally, which meant the
 * primary surface spoke machine and the reader had to parse it themselves —
 * the single biggest reason this tool needed explaining. Formatting is generic
 * rather than per-command so no command can drift back to raw output.
 */
function emit(data: any): void {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const HEADLINE = ["name", "title", "capability_id", "domain", "id", "type"];
  const label = (k: string) => k.replace(/_/g, " ");
  const scalar = (v: any) =>
    Array.isArray(v) ? v.filter(x => typeof x !== "object").join(", ") : String(v);
  const skip = (k: string, v: any) =>
    v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (Array.isArray(v) && v.some(x => typeof x === "object"));

  const renderOne = (row: any, indent = "  ") => {
    if (typeof row !== "object" || row === null) { console.log(indent + String(row)); return; }
    const headKey = HEADLINE.find(k => row[k] !== undefined);
    if (headKey) console.log(`${indent}${C.bold}${row[headKey]}${C.reset}`);
    for (const [k, v] of Object.entries(row)) {
      if (k === headKey || skip(k, v) || typeof v === "object") continue;
      console.log(`${indent}  ${C.grey}${label(k)}:${C.reset} ${scalar(v)}`);
    }
    // One level of nesting is common (near-misses carry their own list).
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v) && v.some(x => typeof x === "object")) {
        console.log(`${indent}  ${C.grey}${label(k)}:${C.reset}`);
        for (const child of v.slice(0, 5)) renderOne(child, indent + "    ");
      }
    }
  };

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${C.grey}Nothing to report.${C.reset}`);
      return;
    }
    console.log("");
    for (const row of data) { renderOne(row); console.log(""); }
    console.log(`${C.grey}${data.length} result${data.length === 1 ? "" : "s"} · --json for machine output${C.reset}`);
    return;
  }

  console.log("");
  renderOne(data);
  console.log("");
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
  try { tree = JSON.parse(readFileSync(join(__dirname, "techtree.json"), "utf8")); } catch {}
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



/**
 * The inverse of a declarative config patch: remove exactly what it adds.
 *
 * This is the gate for ever applying anything. A step may only run if its undo
 * is computed and stored *before* execution — not "we could probably reverse
 * this", but written down first or refused. Only additive patches over known
 * keys qualify, which is why an acquisition needing an installer or a running
 * service gets no inverse and is therefore not a candidate.
 *
 * Returns null when no inverse can be derived, and null is a refusal.
 */
function inverseOf(patch: any, currentConfig: any): any | null {
  if (!patch || typeof patch !== 'object') return null;
  const remove: string[] = [];
  const restore: Record<string, unknown> = {};

  for (const [section, entries] of Object.entries<any>(patch)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null;
    for (const key of Object.keys(entries)) {
      const existing = currentConfig?.[section]?.[key];
      // Overwriting something means the inverse must put the old value back,
      // and guessing at that is exactly the kind of "probably reversible" this
      // is meant to exclude.
      if (existing !== undefined) restore[`${section}.${key}`] = existing;
      else remove.push(`${section}.${key}`);
    }
  }
  return { remove, restore: Object.keys(restore).length ? restore : undefined };
}

/**
 * Records that a person approved a proposal.
 *
 * The approval is an edge from a `human:` node, so it is evidence in the graph
 * rather than a flag on a row — which means the ledger can later answer who
 * authorised a given expansion of the frontier. Approving changes nothing
 * about the world; it changes what is permitted to change it.
 */
function approveProposal(db: Db, proposalId?: string, who?: string) {
  if (!proposalId) return { error: 'Usage: tt approve <proposal-id> <person>' };
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status === 'approved') return { error: `${proposalId} is already approved by ${row.approved_by}.` };

  const humanId = who ? (who.startsWith('human:') ? who : `human:${who}`) : null;
  if (!humanId) return { error: 'Name the person approving: tt approve <proposal-id> <person>' };
  const person = db.prepare("SELECT id, name FROM capabilities WHERE id = ? AND category = 'human'").get(humanId);
  if (!person) {
    return { error: `${humanId} is not a person in the graph. Declare them in the actors block first — an approval has to come from someone accountable.` };
  }

  const steps = JSON.parse(row.steps);
  const blocking = steps.filter((s: any) => !s.inverse);
  db.prepare("UPDATE proposals SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?")
    .run(humanId, proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('approval', ?, 'approved', 1, ?)"
  ).run(humanId, `${proposalId}: ${row.goal}`);

  return {
    proposal: proposalId,
    goal: row.goal,
    approved_by: person.name,
    applicable: blocking.length === 0,
    steps_without_inverse: blocking.length ? blocking.map((s: any) => s.name) : undefined,
    note: blocking.length
      ? 'Approved, and still not applicable: these steps have no computed inverse, and nothing runs without one.'
      : 'Approved. Every step has an inverse. Applying is not implemented — this records permission, not action.',
  };
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

function listProposals(db: Db) {
  const rows = db
    .prepare("SELECT id, created_at, goal, status FROM proposals ORDER BY created_at DESC")
    .all();
  return rows.length ? rows : { note: 'No proposals. Create one with tt propose <capability>.' };
}

function showProposal(db: Db, id?: string) {
  if (!id) return { error: 'Usage: tt proposal <id>' };
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
  if (!row) return { error: `No proposal ${id}. See tt proposals.` };
  return {
    ...row,
    steps: JSON.parse(row.steps),
    simulated: JSON.parse(row.simulated),
  };
}


/**
 * Applies an approved proposal to the configuration, and only to it.
 *
 * The scope is a deliberate structural limit rather than a starting point. A
 * step carries a declarative patch or it carries nothing — there is no field
 * that holds a command, so no data file in this repository can cause something
 * to be executed. That is the same failure `addMcp` over HTTP was, and the
 * shape is worth refusing permanently rather than gating.
 *
 * Refusals come first and are all hard:
 *   not approved            → a person must have authorised it
 *   any step without an inverse → nothing runs that cannot be undone
 *   any step without a patch    → nothing else is applicable
 *   already applied         → not idempotent by accident
 *
 * The file is backed up before it is touched, the inverse is stored before the
 * write rather than after, and a failed verification rolls back automatically.
 */
function applyProposal(db: Db, proposalId?: string) {
  if (!proposalId) return { error: 'Usage: tt apply <proposal-id>' };
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status === 'applied') return { error: `${proposalId} is already applied.` };
  if (row.status !== 'approved') {
    return { error: `${proposalId} is ${row.status}. A person has to approve it first: tt approve ${proposalId} <person>` };
  }

  const steps = JSON.parse(row.steps);
  const noInverse = steps.filter((s: any) => !s.inverse).map((s: any) => s.name);
  if (noInverse.length) {
    return { error: `Refused. No inverse for: ${noInverse.join(', ')}. Nothing runs that cannot be undone.` };
  }
  const noPatch = steps.filter((s: any) => !s.config_patch).map((s: any) => s.name);
  if (noPatch.length) {
    return { error: `Refused. These are not configuration changes: ${noPatch.join(', ')}. Apply only edits configuration.` };
  }

  const configPath = CONFIG_DEFAULT;
  let config: any = {};
  try { config = JSON.parse(readFileSync(configPath, "utf8")); }
  catch { return { error: `Cannot read ${configPath}.` }; }

  // Backup before the first byte changes, so a rollback has something to fall
  // back on even if this process dies midway.
  const backup = `${configPath}.ambit-${proposalId}.bak`;
  writeFileSync(backup, JSON.stringify(config, null, 2) + "\n");

  const applied: string[] = [];
  for (const step of steps) {
    for (const [section, entries] of Object.entries<any>(step.config_patch)) {
      config[section] = config[section] || {};
      for (const [key, value] of Object.entries<any>(entries)) {
        config[section][key] = value;
        applied.push(`${section}.${key}`);
      }
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  db.prepare("UPDATE proposals SET status = 'applied', applied_at = datetime('now'), backup_path = ? WHERE id = ?")
    .run(backup, proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('apply', ?, 'applied', 1, ?)"
  ).run(row.approved_by, `${proposalId}: ${applied.join(', ')}`);

  // Verify the goal if it declares a check. An unverified apply is reported as
  // such rather than counted as a success.
  const goalId = steps[steps.length - 1]?.id;
  const verification = goalId ? (runVerification(db, goalId.replace('combo:', '')) as any) : null;
  const failed = verification?.results?.some((r: any) => r.status === 'failed');

  if (failed) {
    const undo = rollbackProposal(db, proposalId) as any;
    return {
      proposal: proposalId,
      applied: false,
      rolled_back: true,
      keys: applied,
      reason: 'Verification failed after applying, so the change was reversed.',
      rollback: undo,
    };
  }

  return {
    proposal: proposalId,
    applied: true,
    keys: applied,
    backup,
    verified: verification?.verified ? true : undefined,
    unverified: verification && !verification.verified ? 'no check declared for this capability' : undefined,
    note: 'Re-run ./bootstrap.sh (or tt seed) to fold this into the graph.',
  };
}

/**
 * Reverses an applied proposal using the inverse stored before it ran.
 *
 * Uses the recorded inverse rather than the backup file where it can, because
 * the inverse describes only what this proposal changed — restoring a whole
 * backup would also discard anything edited since.
 */
function rollbackProposal(db: Db, proposalId?: string) {
  if (!proposalId) return { error: 'Usage: tt rollback <proposal-id>' };
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status !== 'applied') return { error: `${proposalId} is ${row.status}; nothing to reverse.` };

  const steps = JSON.parse(row.steps);
  const configPath = CONFIG_DEFAULT;
  let config: any = {};
  try { config = JSON.parse(readFileSync(configPath, "utf8")); }
  catch { return { error: `Cannot read ${configPath}.` }; }

  const removed: string[] = [];
  const restored: string[] = [];
  for (const step of steps) {
    const inv = step.inverse || {};
    for (const path of inv.remove || []) {
      const [section, key] = path.split('.');
      if (config[section] && key in config[section]) { delete config[section][key]; removed.push(path); }
    }
    for (const [path, value] of Object.entries<any>(inv.restore || {})) {
      const [section, key] = path.split('.');
      config[section] = config[section] || {};
      config[section][key] = value;
      restored.push(path);
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  db.prepare("UPDATE proposals SET status = 'rolled_back' WHERE id = ?").run(proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('apply', ?, 'rolled_back', 0, ?)"
  ).run(row.approved_by || 'human:unknown', `${proposalId}`);

  return { proposal: proposalId, rolled_back: true, removed, restored, backup_kept: row.backup_path || undefined };
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Runs the declared check for a capability and records what happened.
 *
 * Detection proves a name exists in a config file. This proves the action can
 * be performed — the difference between `installed` and `working`, and the
 * point at which "capability" means something an agent can rely on.
 *
 * Checks execute. They come from techtree.json in this repository, are
 * read-only by construction, and run only when a person asks: nothing verifies
 * on seed. Treat adding one as you would adding a package script.
 *
 * Evidence lands in session_learning, which has carried the right columns since
 * the first schema and had no writer until now.
 */
function verifyCapability(db: Db, nodeId: string, node: any): {
  id: string; name: string; status: string; detail?: string; ms: number;
} {
  const id = `combo:${nodeId}`;
  const started = Date.now();
  let status: 'verified' | 'failed' | 'unverifiable' = 'unverifiable';
  let detail: string | undefined;

  if (!node?.verify?.command) {
    detail = 'no check declared';
  } else {
    const [cmd, ...args] = node.verify.command;
    try {
      const out = spawnSync(cmd, args, {
        timeout: (node.verify.timeout_seconds || 10) * 1000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (out.status === 0) status = 'verified';
      else {
        status = 'failed';
        detail = (out.stderr || out.stdout || `exit ${out.status}`).toString().trim().slice(0, 160);
      }
    } catch (e: any) {
      status = 'failed';
      detail = String(e?.message || e).slice(0, 160);
    }
  }
  const ms = Date.now() - started;

  if (status !== 'unverifiable') {
    // A capability the graph has never seen cannot carry evidence, and the
    // foreign key would reject the row.
    const exists = db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
    if (exists) {
      db.prepare(
        "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, ?)"
      ).run(id, status, status === 'verified' ? 1 : 0, detail || null);
    }
  }
  return { id, name: node?.name || nodeId, status, detail, ms };
}

/** Verification history for a capability, most recent first. */
function evidenceFor(db: Db, id: string) {
  return db
    .prepare(
      `SELECT action, outcome_score, notes, timestamp FROM session_learning
       WHERE capability_id = ? AND action IN ('verified','failed')
       ORDER BY timestamp DESC LIMIT 10`
    )
    .all(id);
}

/**
 * Verifies one capability, or every capability that declares a check.
 *
 * Reports reliability as the share of recorded runs that succeeded, which is
 * why the evidence is kept rather than only the latest result: one success is
 * not the same claim as forty-seven out of fifty.
 */
/**
 * Where a capability's authority is narrower than its technical reach.
 *
 * Being able to perform an action is not permission to perform it, so the two
 * are tracked apart. A capability that is reached but gated is not autonomously
 * exercisable, and that difference is the whole point of separating them.
 */
function authorityReport(db: Db) {
  let tree: any;
  try { tree = JSON.parse(readFileSync(join(__dirname, "techtree.json"), "utf8")); }
  catch { return { error: "No capability model." }; }

  const state = new Map(
    db.prepare("SELECT id, state FROM capabilities WHERE category = 'combo'").all().map((r: any) => [r.id, r.state])
  );
  const rows = (tree.nodes || [])
    .filter((n: any) => n.authority)
    .map((n: any) => ({
      name: n.name,
      id: `combo:${n.id}`,
      reached: state.get(`combo:${n.id}`) !== 'locked',
      observe: n.authority.observe || 'autonomous',
      execute: n.authority.execute || 'autonomous',
    }));

  return {
    autonomous: rows.filter(r => r.reached && r.execute === 'autonomous').map(r => r.name),
    needs_approval: rows.filter(r => r.reached && r.execute === 'confirm').map(r => r.name),
    forbidden: rows.filter(r => r.execute === 'forbidden').map(r => r.name),
    note: "reached means the system can perform it; execute says whether it may without asking",
    detail: rows,
  };
}

function runVerification(db: Db, which?: string) {
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(join(__dirname, "techtree.json"), "utf8"));
  } catch {
    return { error: "No capability model to verify against." };
  }
  const nodes = (tree.nodes || []).filter((n: any) =>
    which ? n.id === which.replace(/^combo:/, '') : n.verify?.command
  );
  if (nodes.length === 0) {
    return { error: which ? `No check declared for ${which}.` : "No checks declared." };
  }

  const results = nodes.map((n: any) => {
    const r = verifyCapability(db, n.id, n);
    const history = evidenceFor(db, r.id);
    const runs = history.length;
    const passes = history.filter((h: any) => h.action === 'verified').length;
    return {
      ...r,
      reliability: runs ? `${passes}/${runs}` : undefined,
    };
  });

  return {
    checked: results.length,
    verified: results.filter(r => r.status === 'verified').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  };
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Records the whole frontier if it differs from the last observation.
 *
 * `capabilities` is overwritten on every seed, so on its own the graph can only
 * answer what the system can do *now*. Accounting for capacity to act is much
 * more useful longitudinally — what could this system do at time T, and what
 * changed since — so each observation stores every capability's state, letting a
 * past frontier be reconstructed exactly rather than inferred from counts.
 *
 * Unchanged seeds are not recorded. The table is a log of changes, not of runs.
 */
function recordFrontier(db: Db): 'recorded' | 'unchanged' {
  const rows = db.prepare("SELECT id, state FROM capabilities ORDER BY id").all();
  const states: Record<string, string> = {};
  for (const r of rows) states[r.id] = r.state;
  const serialised = JSON.stringify(states);

  const last = db
    .prepare("SELECT states FROM frontier_snapshots ORDER BY taken_at DESC, id DESC LIMIT 1")
    .get();
  if (last && last.states === serialised) return 'unchanged';

  const reached = rows.filter(r => r.state !== 'locked').length;
  db.prepare("INSERT INTO frontier_snapshots (reached, total, states) VALUES (?, ?, ?)")
    .run(reached, rows.length, serialised);
  return 'recorded';
}

/** The observation in effect at a point in time, or the earliest one after it. */
function frontierAt(db: Db, when?: string): { taken_at: string; states: Record<string, string> } | null {
  const row = when
    ? db.prepare("SELECT taken_at, states FROM frontier_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC LIMIT 1").get(when)
      || db.prepare("SELECT taken_at, states FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get()
    : db.prepare("SELECT taken_at, states FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get();
  if (!row) return null;
  return { taken_at: row.taken_at, states: JSON.parse(row.states) };
}

/**
 * What changed in the reachable frontier since a past observation.
 *
 * The entry worth the whole table is `emergent`: a capability that became
 * reached although nothing that provides it was itself added. Those are
 * composition — prerequisites satisfied by other additions — and a
 * per-component changelog cannot show them, because no single change explains
 * one.
 */
function ledgerSince(db: Db, when?: string) {
  const past = frontierAt(db, when);
  if (!past) return { error: "No frontier recorded yet. Run seed at least twice." };

  const now = db.prepare("SELECT id, name, state, category FROM capabilities ORDER BY id").all();
  const nameOf = new Map(now.map(c => [c.id, c.name]));
  const wasLocked = (id: string) => past.states[id] === 'locked';
  const isReached = (c: any) => c.state !== 'locked';

  // Newly added means absent from the observation, which the snapshot answers
  // exactly. Comparing created_at against taken_at looked equivalent and was
  // not: datetime('now') resolves to the second, so two seeds inside the same
  // second classified every addition as pre-existing.
  const addedSince = new Set(now.filter(c => past.states[c.id] === undefined).map(c => c.id));

  const providers = db
    .prepare("SELECT from_capability, to_capability FROM dependencies WHERE description = 'Provides this capability'")
    .all();
  const provedBy = new Map<string, string[]>();
  for (const p of providers) {
    if (!provedBy.has(p.to_capability)) provedBy.set(p.to_capability, []);
    provedBy.get(p.to_capability)!.push(p.from_capability);
  }

  const gained: any[] = [];
  const emergent: any[] = [];
  for (const c of now) {
    const newlyReached = isReached(c) && (wasLocked(c.id) || past.states[c.id] === undefined);
    if (!newlyReached) continue;
    const proofs = provedBy.get(c.id) || [];
    const proofAddedSince = proofs.some(p => addedSince.has(p));
    const entry = {
      id: c.id,
      name: c.name,
      proved_by: proofs.map(p => nameOf.get(p) || p).slice(0, 4),
    };
    // Reached without any of its providers being new: composition did it.
    if (!addedSince.has(c.id) && !proofAddedSince && proofs.length > 0) emergent.push(entry);
    else gained.push(entry);
  }

  const lost = now
    .filter(c => !isReached(c) && past.states[c.id] && past.states[c.id] !== 'locked')
    .map(c => ({ id: c.id, name: c.name }));

  const pastReached = Object.values(past.states).filter(v => v !== 'locked').length;
  return {
    since: past.taken_at,
    frontier_then: pastReached,
    frontier_now: now.filter(isReached).length,
    gained,
    emergent,
    lost,
    note: emergent.length
      ? "emergent: became reachable although nothing providing them was added — composition, not acquisition"
      : undefined,
  };
}

/** Every recorded observation, oldest first. */
function ledgerHistory(db: Db) {
  return db
    .prepare("SELECT taken_at, reached, total FROM frontier_snapshots ORDER BY taken_at ASC, id ASC")
    .all()
    .map((r: any) => ({ taken_at: r.taken_at, reached: r.reached, total: r.total }));
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

function parseMapping(mappingStr?: string): Record<string, any> {
  if (mappingStr) {
    try { return JSON.parse(mappingStr); } catch {}
  }
  return {
    config_keys: { mcp: { type: 'mcp', domain_field: 'type', domain_map: { remote: 'backend', local: 'infra' }, desc_template: '{type} server' }, agent: { type: 'agent', domain: 'meta', desc_field: 'description' }, provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' }, command: { type: 'tool', domain: 'devops', desc_field: 'description' } },
    skill_dirs: ["~/.agents/skills", "~/.opencode/skills"],
  };
}

function seedFromConfig(db: Db, configPath?: string, mappingStr?: string) {
  const cp = configPath || CONFIG_DEFAULT;
  // A missing config used to abort the seed entirely, which left the database
  // with no tables at all — every first run without OpenCode installed ended in
  // a raw SQLite error from the next query. The curated capability model does
  // not come from the config, so seed it anyway: the graph is then a valid,
  // empty-of-your-stuff frontier rather than nothing.
  const config = existsSync(cp) ? JSON.parse(readFileSync(cp, "utf8")) : {};
  const mapping = parseMapping(mappingStr);

  let count = 0;
  const contributed: string[] = [];
  const insert = db.prepare("INSERT OR IGNORE INTO capabilities (id, name, domain, description, category, state, maturity_score) VALUES (?, ?, ?, ?, ?, ?, ?)");

  for (const [key, cfg] of Object.entries<any>(mapping.config_keys || {})) {
    const entries = config[key] || {};
    for (const [name, val] of Object.entries<any>(entries)) {
      const type = cfg.type || 'tool';
      const domain = cfg.domain || (cfg.domain_map && cfg.domain_map[val[cfg.domain_field || 'type']]) || 'infra';
      const desc = (cfg.desc_field ? (val[cfg.desc_field] || '') : cfg.desc_template ? cfg.desc_template.replace('{type}', val.type || type) : '') || '';
      insert.run(`${type}:${name}`, name, domain, desc.slice(0, 80), type, 'unlocked', 0.5);
      contributed.push(`${type}:${name}`);
      count++;
    }
  }

  for (const dirPattern of (mapping.skill_dirs || [])) {
    const dir = dirPattern.replace(/^~/, process.env.HOME || "/");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Not entry.isDirectory(): a Dirent reports false for a symlink, and
      // symlinking skills into a runtime's directory is how they get shared
      // between runtimes. That silently skipped 23 of 47 skills in a real
      // Hermes install, all of them pointing at the same shared directory
      // OpenCode reads — precisely the capabilities two runtimes have in
      // common. existsSync follows the link.
      if (!existsSync(join(dir, entry.name, "SKILL.md"))) continue;
      insert.run(`skill:${entry.name}`, entry.name, 'meta', 'Agent skill', 'skill', 'unlocked', 0.55);
      contributed.push(`skill:${entry.name}`);
      count++;
    }
  }

  insert.run("core:reasoning", "Core Reasoning", "meta", "Base LLM reasoning", "meta", "active", 1.0);
  insert.run("tool:bash", "Shell Execution", "infra", "Run commands", "tool", "active", 1.0);
  insert.run("tool:edit", "File Editor", "meta", "Edit files", "tool", "active", 1.0);
  insert.run("tool:lsp", "LSP Diagnostics", "quality", "Language server", "tool", "active", 0.95);
  count += 4;

  db.prepare("UPDATE capabilities SET state = 'active' WHERE id IN ('core:reasoning','tool:bash','tool:edit','tool:lsp')").run();

  count += seedModels(db, config, insert);
  count += attributeToRuntime(db, insert, contributed);
  seedDependencies(db, config);
  count += seedTechTree(db, insert);
  count += seedCombos(db, config, mapping, insert);
  count += seedActors(db, config, mapping, insert);

  recordFrontier(db);

  return count;
}

/**
 * Models are real config entities the seed previously skipped, which left
 * providers as leaves and agents unconnected to anything. Their ids match the
 * visualizer's (`model:<provider>/<name>`) so both halves agree.
 */
function seedModels(db: Db, config: any, insert: any): number {
  let count = 0;
  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const [model, mv] of Object.entries<any>(pv?.models || {})) {
      const ctx = mv?.limit?.context;
      insert.run(
        `model:${provider}/${model}`,
        mv?.name || model,
        'ai-ml',
        ctx ? `${ctx} context` : 'Model',
        'model',
        'unlocked',
        0.6
      );
      count++;
    }
  }
  return count;
}

/**
 * Edges the config states outright — nothing inferred by heuristic:
 *   provider → model   a model cannot run without its provider
 *   model    → agent   an agent pinned to a model depends on it
 *
 * `from` is the prerequisite and `to` the dependent, matching how the combo
 * analyses read the table. Only edges whose endpoints both exist are written,
 * since the schema has foreign keys on both columns.
 */
function seedDependencies(db: Db, config: any): number {
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );
  let count = 0;

  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const model of Object.keys(pv?.models || {})) {
      if (!has(`provider:${provider}`) || !has(`model:${provider}/${model}`)) continue;
      link.run(`provider:${provider}`, `model:${provider}/${model}`, 1, 'Model served by provider');
      count++;
    }
  }

  for (const [name, agent] of Object.entries<any>(config.agent || {})) {
    const ref = agent?.model;
    if (typeof ref !== 'string' || !has(`agent:${name}`)) continue;
    // "provider/model" — the model half may itself contain slashes.
    const slash = ref.indexOf('/');
    if (slash < 0) continue;
    const provider = ref.slice(0, slash);
    const modelId = `model:${ref}`;
    if (has(modelId)) {
      link.run(modelId, `agent:${name}`, 1, 'Agent pinned to model');
      count++;
    } else if (has(`provider:${provider}`)) {
      // Model not declared in config; the provider dependency still holds.
      link.run(`provider:${provider}`, `agent:${name}`, 1, 'Agent pinned to provider');
      count++;
    }
  }

  return count;
}


/**
 * Records which runtime contributed these capabilities.
 *
 * Two runtimes commonly configure the same MCP server. That is one capability
 * with two providers, not two capabilities, so the ids deliberately collide and
 * merge — but the graph then cannot say which runtime supplies what, or what
 * would be lost if one went away. A runtime node with an edge to everything it
 * contributed answers both, and makes `tt impact runtime:hermes` meaningful.
 *
 * The runtime is an ordinary node: Ambit represents agent runtimes rather than
 * being one, so no runtime owns the graph.
 */
function attributeToRuntime(db: Db, insert: any, contributed: string[]): number {
  const runtime = process.env.AMBIT_RUNTIME || 'opencode';
  if (contributed.length === 0) return 0;
  const id = `runtime:${runtime}`;
  insert.run(id, runtime, 'meta', `Agent runtime — contributes ${contributed.length} capabilities`, 'runtime', 'unlocked', 0.9);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, 1, 'Contributed by runtime')"
  );
  for (const capability of contributed) link.run(id, capability);
  return 1;
}

/**
 * Places the user on the curated capability tree in techtree.json.
 *
 * The tree is authored content, the way a Civ tech tree is: everyone gets the
 * same one and differs only in where they are on it. That is what makes the
 * unlock analyses work without the user hand-authoring the interesting half —
 * previously they returned empty until someone wrote their own combos.
 *
 * Each node is matched against the ids already seeded from the user's config:
 *   detected                        → unlocked, with an edge from what proved it
 *   prerequisites met, not detected → locked, and surfaced as researchable next
 *   prerequisites unmet             → locked, further out
 *
 * Nodes are stored with a `combo:` prefix and category, because that is what
 * the existing unlock analyses select on.
 */
function seedTechTree(db: Db, insert: any): number {
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(join(__dirname, "techtree.json"), "utf8"));
  } catch {
    return 0; // A missing or unreadable tree degrades to config-only seeding.
  }

  const owned: string[] = db
    .prepare("SELECT id FROM capabilities WHERE id NOT LIKE 'combo:%'")
    .all()
    .map((r: any) => r.id);
  const modelCount = owned.filter(id => id.startsWith('model:')).length;

  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );

  // Which of the user's capabilities, if any, prove each node.
  const evidence = new Map<string, string[]>();
  for (const node of tree.nodes || []) {
    const patterns: string[] = node.detect?.any || [];
    const hits = owned.filter(id =>
      patterns.some(p => {
        try { return new RegExp(p, 'i').test(id); } catch { return false; }
      })
    );
    const meetsMin = !node.detect?.min_models || modelCount >= node.detect.min_models;
    evidence.set(node.id, hits.length && meetsMin ? hits : []);
  }

  // Resolve in era order so a node's prerequisites are settled before it is.
  // Without this the tree contradicts itself — reporting Offline Capable as
  // reached while Local Embeddings, which it requires, is still locked.
  const ordered = [...(tree.nodes || [])].sort((a: any, b: any) => (a.era || 0) - (b.era || 0));
  const unlocked = new Set<string>();

  let count = 0;
  for (const node of ordered) {
    const id = `combo:${node.id}`;
    const proof = evidence.get(node.id) || [];
    const missing: string[] = (node.requires || []).filter((r: string) => !unlocked.has(r));
    const reached = proof.length > 0 && missing.length === 0;
    if (reached) unlocked.add(node.id);

    // Having the tooling for a node whose prerequisites are unmet is the most
    // useful thing the tree can tell you, so say it rather than hiding it.
    const blocked = proof.length > 0 && missing.length > 0;
    const names = (ids: string[]) =>
      ids.map(r => (tree.nodes.find((n: any) => n.id === r)?.name || r)).join(', ');
    const description = reached
      ? node.description
      : blocked
        ? `${node.description} — configured, but ${names(missing)} is not in place yet`
        : `${node.description} — ${node.hint || ''}`.trim();

    insert.run(
      id,
      node.name,
      node.domain || 'meta',
      description,
      'combo',
      reached ? 'unlocked' : 'locked',
      reached ? 0.7 : 0
    );
    // The insert is OR IGNORE, so on a re-seed it does nothing — which left
    // every tech-tree node frozen at whatever the first run computed. Change
    // your config, re-run bootstrap, and the tree would not move. State is
    // derived, so it has to be written every time.
    db.prepare(
      `UPDATE capabilities SET state = ?, description = ?, maturity_score = ?,
       unlock_cost_setup = ?, unlock_cost_tokens = ?,
       updated_at = CASE WHEN state != ? THEN datetime('now') ELSE updated_at END
       WHERE id = ?`
    ).run(
      reached ? 'unlocked' : 'locked',
      description,
      reached ? 0.7 : 0,
      node.setup_seconds || 0,
      node.tokens || 0,
      reached ? 'unlocked' : 'locked',
      id
    );
    count++;

    // Edges from the user's own capabilities to the node they unlock, so
    // `tt impact` can answer what breaks if a given tool goes away.
    for (const hit of proof.slice(0, 6)) {
      link.run(hit, id, 1, 'Provides this capability');
    }
    // Tier progression between tree nodes.
    for (const req of node.requires || []) {
      link.run(`combo:${req}`, id, 1, 'Tech tree prerequisite');
    }
    for (const opt of node.optional || []) {
      link.run(`combo:${opt}`, id, 0, 'Strengthens this capability');
    }
  }

  return count;
}


/**
 * Seeds the people in the system.
 *
 * Humans are not users of the graph, they are nodes in it. They supply things
 * machines cannot manufacture — legal authority, money, physical access,
 * subjective judgement, account ownership — and a capability that needs one of
 * those is not autonomous, however complete its technical dependencies are.
 *
 *   "actors": {
 *     "kanav": {
 *       "name": "Kanav",
 *       "provides": ["physical-access", "approve-purchases"],
 *       "authorizes": ["combo:continuous-delivery"]
 *     }
 *   }
 *
 * `provides` becomes a capability the person supplies. `authorizes` becomes a
 * hard prerequisite edge, which is what makes a plan able to say that a step is
 * someone's rather than the machine's.
 */
function seedActors(db: Db, config: any, mapping: any, insert: any): number {
  const actors = { ...(mapping.actors || {}), ...(config.actors || {}) };
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, 1, ?)"
  );
  const has = (id: string) => !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  let count = 0;

  for (const [key, spec] of Object.entries<any>(actors)) {
    const id = key.startsWith('human:') ? key : `human:${key}`;
    const name = spec?.name || key;
    insert.run(id, name, 'social', spec?.role || 'Person in the system', 'human', 'active', 1.0);
    count++;

    // Things only this person can supply.
    for (const provided of spec?.provides || []) {
      const pid = provided.includes(':') ? provided : `act:${provided}`;
      insert.run(pid, provided.replace(/-/g, ' '), 'social', `Provided by ${name}`, 'human-action', 'unlocked', 1.0);
      link.run(id, pid, 'Supplied by a person');
      count++;
    }

    // Approval as a dependency rather than a policy note. Only for capabilities
    // that exist — a typo should leave a missing edge, not a dangling one.
    for (const gated of spec?.authorizes || []) {
      const gid = gated.startsWith('combo:') || gated.includes(':') ? gated : `combo:${gated}`;
      if (has(gid)) link.run(id, gid, 'Requires approval from a person');
    }
  }
  return count;
}

/**
 * Combos are the unit every unlock analysis is built on, and they are a
 * judgement about what capabilities compose — not something to infer from a
 * config file. They are read from an optional `combos` block, so a fabricated
 * cluster never ends up presented as a finding:
 *
 *   "combos": { "e2e-on-edge": { "name": "E2E on Edge", "domain": "quality",
 *                                "requires": ["mcp:playwright", "skill:vitest"],
 *                                "optional": ["mcp:cloudflare"] } }
 *
 * Accepted in opencode.json or in CONFIG_MAPPING. Without one, the combo
 * analyses stay empty — which is honest, not broken.
 */
function seedCombos(db: Db, config: any, mapping: any, insert: any): number {
  const combos = { ...(mapping.combos || {}), ...(config.combos || {}) };
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description) VALUES (?, ?, ?, ?)"
  );
  let count = 0;

  for (const [key, spec] of Object.entries<any>(combos)) {
    const id = key.startsWith('combo:') ? key : `combo:${key}`;
    const requires: string[] = (spec?.requires || []).filter(has);
    const optional: string[] = (spec?.optional || []).filter(has);
    // A combo whose prerequisites are all missing describes nothing.
    if (requires.length === 0 && optional.length === 0) continue;

    insert.run(
      id,
      spec?.name || key,
      spec?.domain || 'meta',
      spec?.description || 'Composed capability',
      'combo',
      'locked',
      0
    );
    count++;
    for (const dep of requires) { link.run(dep, id, 1, 'Hard prerequisite'); }
    for (const dep of optional) { link.run(dep, id, 0, 'Soft prerequisite'); }
  }

  return count;
}

// ─── Prune Recommendations ────────────────────────────────────────────────────

function pruneRecommendations(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, parallel_slots, updated_at, state FROM capabilities WHERE state IN ('unlocked','active') ORDER BY maturity_score ASC").all();
  const results = [];
  for (const cap of caps) {
    if (cap.updated_at) {
      const daysSince = (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) continue;
    } else continue;
    const slotCost = cap.parallel_slots || 1;
    const deps = db.prepare("SELECT from_capability FROM dependencies WHERE to_capability = ?").all(cap.id);
    const dependents = db.prepare("SELECT to_capability FROM dependencies WHERE from_capability = ?").all(cap.id);
    const daysSince = Math.round((Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24));
    results.push({ id: cap.id, name: cap.name, domain: cap.domain, days_since_config_change: daysSince, token_cost: slotCost, dependent_count: dependents.length, prereq_count: deps.length, recommendation: `${daysSince} days since last config change. ${dependents.length} capabilities depend on it. ${deps.length} prerequisites still active.` });
  }
  return results.sort((a, b) => b.days_since_config_change - a.days_since_config_change).slice(0, 15);
}

// ─── Fork Comparison (best combo to unlock) ──────────────────────────────────

function forkComparison(db) {
  const locked = db.prepare("SELECT id, name, domain, unlock_cost_setup, unlock_cost_tokens FROM capabilities WHERE state = 'locked'").all();
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const comboGroups = new Map();
  for (const d of deps) {
    if (!comboGroups.has(d.to_capability)) comboGroups.set(d.to_capability, []);
    comboGroups.get(d.to_capability).push(d);
  }
  const results = [];
  for (const [id, prereqs] of comboGroups) {
    const combo = capMap.get(id); if (!combo) continue;
    const hardMet = prereqs.filter(p => p.is_hard_requisite).every(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); });
    if (!hardMet) continue;
    const avgMaturity = prereqs.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / prereqs.length;
    const regret = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE capability_id = ? AND action = 'regretted'").get(id) || {}).cnt || 0;
    const cascade = db.prepare("SELECT COUNT(*) as cnt FROM dependencies WHERE from_capability = ?").get(id).cnt || 0;
    const efficiency = Math.round((cascade + (1 - regret * 0.2)) * 100 / (combo.unlock_cost_setup || 1));
    results.push({ name: combo.name, id, avg_maturity: Math.round(avgMaturity * 100), regret_count: regret, cascade_unlocks: cascade, efficiency, recommendation: regret > 0 ? `Previously regretted (${regret}x). ${cascade} cascade unlocks if committed.` : `${cascade} cascade unlocks with ${Math.round(avgMaturity * 100)}% avg prerequisite maturity.` });
  }
  return results.sort((a, b) => b.efficiency - a.efficiency);
}

// ─── Near-Miss Combos (1-2 prerequisites away) ───────────────────────────────

function nearMissCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  const results = [];
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    const metHard = hard.filter(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); });
    const missingHard = hard.filter(p => { const c = capMap.get(p.from_capability); return !c || (c.state !== 'unlocked' && c.state !== 'active'); });
    if (missingHard.length === 0) continue;
    if (missingHard.length > 2) continue;
    const avgMetMaturity = metHard.length > 0 ? metHard.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / metHard.length : 0;
    if (avgMetMaturity < 0.6) continue;
    results.push({
      name: combo.name,
      id: comboId,
      missing: missingHard.length,
      missing_names: missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability),
      met_count: metHard.length,
      total_required: hard.length,
      met_maturity: Math.round(avgMetMaturity * 100),
      investment: `Add ${missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`,
    });
  }
  return results.sort((a, b) => b.met_maturity - a.met_maturity);
}

// ─── Insights (top actionable items) ──────────────────────────────────────────

function insights(db) {
  const items = [];
  const nearMiss = nearMissCombos(db);
  if (nearMiss.length > 0) {
    items.push({ type: 'near_miss', count: nearMiss.length, detail: `${nearMiss[0].name} — ${nearMiss[0].missing} dependencies away (${nearMiss[0].met_maturity}% existing maturity). ${nearMiss[0].investment}`, near: nearMiss.slice(0, 3) });
  }
  const decay = computeDecay(db).filter(d => d.decayed).slice(0, 3);
  if (decay.length > 0) {
    items.push({ type: 'decay', count: decay.length, detail: `${decay[0].name} — ${decay[0].days_since_config_change} days since last change`, decaying: decay });
  }
  const bottlenecks = findBottlenecks(db).slice(0, 3);
  if (bottlenecks.length > 0) {
    items.push({ type: 'bottleneck', count: bottlenecks.length, detail: `${bottlenecks[0].name} unlocks ${bottlenecks[0].unlocks_count} downstream`, top: bottlenecks });
  }
  return items;
}

function computeDecay(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, updated_at FROM capabilities WHERE state IN ('unlocked','active')").all();
  const results = [];
  for (const cap of caps) {
    if (!cap.updated_at) continue;
    const daysSince = (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
    const decayAmount = Math.min(0.3, daysSince * 0.01);
    const newMaturity = Math.max(0.1, cap.maturity_score - decayAmount);
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, decayed: newMaturity < cap.maturity_score - 0.05, days_since_config_change: Math.round(daysSince), new_maturity: Math.round(newMaturity * 100) / 100 });
  }
  results.sort((a, b) => b.days_since_config_change - a.days_since_config_change);
  return results;
}

// ─── Combo Discovery ──────────────────────────────────────────────────────────

function discoverCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const results = [];
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    if (!hard.every(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active'); })) continue;
    const avg = prereqs.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / prereqs.length;
    if (avg < 0.4) continue;
    results.push({ name: combo.name, requirements: prereqs.map(p => capMap.get(p.from_capability)?.name || p.from_capability), unlocks: comboId, confidence: Math.min(1, avg + 0.2), reason: `All prereqs at ${Math.round(avg * 100)}% avg maturity` });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Graph Profile (evolution over time) ──────────────────────────────────────

function graphProfile(db) {
  const now = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get();
  const connections = db.prepare("SELECT COUNT(*) as cnt FROM dependencies").get().cnt || 0;
  const combos = db.prepare("SELECT COUNT(*) as cnt FROM capabilities WHERE category = 'combo' AND state IN ('unlocked','active')").get().cnt || 0;
  const density = now.total > 0 ? Math.round((connections / now.total) * 100) / 100 : 0;
  const built = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE action = 'built'").get() || {}).cnt || 0;
  const removed = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning WHERE action = 'removed'").get() || {}).cnt || 0;
  const totalEvents = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning").get() || {}).cnt || 0;

  const domainDensity = db.prepare(`
    SELECT c.domain, COUNT(*) as caps, 
    (SELECT COUNT(*) FROM dependencies d JOIN capabilities c2 ON c2.id = d.from_capability WHERE c2.domain = c.domain) as conns
    FROM capabilities c WHERE c.state IN ('unlocked','active') GROUP BY c.domain
  `).all();

  return {
    capabilities: { current: now.unlocked, total: now.total },
    connections: connections,
    combos: combos,
    density: density,
    build_history: { total_built: built, total_removed: removed, net: built - removed, total_events: totalEvents },
    domains: domainDensity.map(d => ({ domain: d.domain, caps: d.caps, connections: d.conns, density: d.caps > 0 ? Math.round((d.conns / d.caps) * 100) / 100 : 0 })),
  };
}

// ─── Session Diff ─────────────────────────────────────────────────────────────

function sessionDiff(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, state FROM capabilities WHERE state IN ('unlocked','active')").all();
  const recent = db.prepare("SELECT capability_id, action, outcome_score FROM session_learning ORDER BY timestamp DESC LIMIT 50").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const domains = new Map();
  for (const c of caps) {
    if (!domains.has(c.domain)) domains.set(c.domain, { total: 0, unlocked: 0, changed_caps: [] });
    const d = domains.get(c.domain); d.total++; if (c.state === 'unlocked' || c.state === 'active') d.unlocked++;
  }
  const seen = new Set();
  for (const e of recent) {
    if (seen.has(e.capability_id)) continue; seen.add(e.capability_id);
    const cap = capMap.get(e.capability_id); if (!cap) continue;
    const domain = domains.get(cap.domain); if (!domain) continue;
    domain.changed_caps.push({ name: cap.name, change: e.outcome_score && e.outcome_score > 0.7 ? 'improved' : e.action === 'regretted' ? 'regretted' : 'practiced', detail: `${Math.round(cap.maturity_score * 100)}% maturity` });
  }
  return Array.from(domains.entries()).map(([d, v]) => ({ domain: d, ...v }));
}

// ─── Domain Health ────────────────────────────────────────────────────────────

function domainHealth(db) {
  const caps = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as active, AVG(maturity_score) as avg_maturity FROM capabilities GROUP BY domain").all();
  const results = [];
  for (const cap of caps) {
    const regret = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'regretted' GROUP BY c.domain").get(cap.domain) || {}).cnt || 0;
    const decayRisk = cap.active > 0 ? (db.prepare("SELECT AVG(CASE WHEN sl.timestamp < datetime('now', '-30 days') OR sl.timestamp IS NULL THEN 1 ELSE 0 END) as risk FROM capabilities c LEFT JOIN session_learning sl ON sl.capability_id = c.id AND sl.action = 'used' WHERE c.domain = ? AND c.state IN ('unlocked','active')").get(cap.domain) || {}).risk || 0 : 0;
    const health = Math.max(0, Math.min(1, (cap.avg_maturity || 0) * 0.4 + (cap.active / Math.max(cap.total, 1)) * 0.3 + (1 - Math.min(regret / Math.max(cap.active, 1), 1)) * 0.2 + (1 - (decayRisk || 0)) * 0.1));
    results.push({ domain: cap.domain, health: Math.round(health * 100) / 100, total: cap.total, active: cap.active, avg_maturity: Math.round((cap.avg_maturity || 0) * 100) / 100, decay_risk: Math.round((decayRisk || 0) * 100) / 100, regret_count: regret });
  }
  results.sort((a, b) => b.health - a.health);
  return results;
}

// ─── Bottlenecks ──────────────────────────────────────────────────────────────

function findBottlenecks(db) {
  const caps = db.prepare("SELECT id, name, domain FROM capabilities WHERE state IN ('unlocked','active')").all();
  const deps = db.prepare("SELECT from_capability, to_capability FROM dependencies").all();
  const downstream = new Map();
  const comboIds = new Set(deps.filter(d => d.to_capability.startsWith('combo:')).map(d => d.to_capability));
  for (const d of deps) {
    if (!downstream.has(d.from_capability)) downstream.set(d.from_capability, new Set());
    downstream.get(d.from_capability).add(d.to_capability);
  }
  const results = [];
  for (const cap of caps) {
    const ds = downstream.get(cap.id);
    if (!ds || ds.size === 0) continue;
    let comboUnlocks = 0; ds.forEach(to => { if (comboIds.has(to)) comboUnlocks++; });
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, unlocks_count: ds.size, is_bottleneck: comboUnlocks >= 2 });
  }
  results.sort((a, b) => b.unlocks_count - a.unlocks_count);
  return results;
}

// ─── Impact Analysis ─────────────────────────────────────────────────────────

/**
 * Who supplies each capability.
 *
 * A capability with three providers survives losing one. Nothing consulted
 * these edges, so every analysis treated each provider as though it were the
 * only one — which inflates loss exactly where there is redundancy, the case
 * you most want to distinguish from a single point of failure.
 */
function providersOf(db: Db): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT from_capability f, to_capability t FROM dependencies
       WHERE description IN ('Provides this capability', 'Contributed by runtime', 'Supplied by a person')`
    )
    .all();
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.t)) map.set(r.t, []);
    if (!map.get(r.t)!.includes(r.f)) map.get(r.t)!.push(r.f);
  }
  return map;
}

/**
 * What would actually be lost if this went away.
 *
 * Only the loss of the *last* provider takes a capability down. Anything else
 * is a reduction in redundancy, which matters but is not the same claim.
 */
function analyzeImpact(db: Db, capId: string) {
  const cap = db.prepare("SELECT id, name, maturity_score FROM capabilities WHERE id = ?").get(capId);
  if (!cap) return { capability: capId, decayed: [], combos_at_risk: [] };

  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies").all();
  const allCaps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(allCaps.map(c => [c.id, c]));
  const providers = providersOf(db);

  /** Nothing else supplies it, so removing this ends it. */
  const isSoleProvider = (target: string) => {
    const list = providers.get(target) || [];
    return list.length > 0 && list.length === 1 && list[0] === capId;
  };
  const remaining = (target: string) => (providers.get(target) || []).filter(p => p !== capId);

  const decayed = deps
    .filter(d => d.from_capability === capId)
    .map(d => {
      const t = capMap.get(d.to_capability);
      const others = remaining(d.to_capability);
      return {
        name: t?.name || d.to_capability,
        becomes_unavailable: d.is_hard_requisite && isSoleProvider(d.to_capability),
        also_provided_by: others.length ? others.length : undefined,
      };
    });

  // Keyed by capability, not by edge. Iterating edges reported the same combo
  // once per prerequisite — "Version Control" four times for one risk.
  const risk = new Map<string, { name: string; severity: string; also_provided_by?: number }>();
  for (const d of deps) {
    if (!d.to_capability.startsWith('combo:')) continue;
    if (d.from_capability !== capId) continue;
    const combo = capMap.get(d.to_capability);
    const others = remaining(d.to_capability);
    const sole = isSoleProvider(d.to_capability);
    risk.set(d.to_capability, {
      name: combo?.name || d.to_capability,
      severity: d.is_hard_requisite && sole ? 'critical' : others.length ? 'redundant' : 'warning',
      also_provided_by: others.length || undefined,
    });
  }

  return { capability: cap.name, decayed, combos_at_risk: [...risk.values()] };
}

/**
 * Capabilities with exactly one provider — where redundancy is absent rather
 * than merely thin. This is the question `tt bottlenecks` is often asked to
 * answer and does not: it ranks by how much depends on something, which is
 * leverage, not fragility.
 */
function singlePointsOfFailure(db: Db) {
  const providers = providersOf(db);
  const names = new Map(
    db.prepare("SELECT id, name, state FROM capabilities").all().map((c: any) => [c.id, c])
  );
  const out: any[] = [];
  for (const [target, list] of providers) {
    if (list.length !== 1) continue;
    const t = names.get(target) as any;
    if (!t || t.state === 'locked') continue; // not yet reached; nothing to lose
    out.push({
      capability: t.name,
      id: target,
      sole_provider: (names.get(list[0]) as any)?.name || list[0],
      provider_id: list[0],
    });
  }
  return out.length
    ? out
    : { note: 'Every reached capability has more than one provider, or none are recorded.' };
}


// ─── Budget Optimization ─────────────────────────────────────────────────────

function optimizeBudget(db, setupBudget, tokenBudget) {
  const caps = db.prepare("SELECT id, name, unlock_cost_setup, unlock_cost_tokens FROM capabilities WHERE state = 'locked'").all();
  const deps = db.prepare("SELECT from_capability, to_capability FROM dependencies").all();
  const downstream = new Map();
  for (const d of deps) downstream.set(d.from_capability, (downstream.get(d.from_capability) || 0) + 1);
  const candidates = caps.map(c => ({ ...c, unlocks: downstream.get(c.id) || 0, efficiency: ((downstream.get(c.id) || 1) / (c.unlock_cost_setup + c.unlock_cost_tokens * 0.01 + 1)) }));
  candidates.sort((a, b) => b.efficiency - a.efficiency);
  let sRem = setupBudget, tRem = tokenBudget;
  const selections = [];
  for (const c of candidates) {
    if (c.unlock_cost_setup <= sRem && c.unlock_cost_tokens <= tRem) {
      selections.push({ name: c.name, cost_setup: c.unlock_cost_setup, cost_tokens: c.unlock_cost_tokens, unlocks: c.unlocks });
      sRem -= c.unlock_cost_setup; tRem -= c.unlock_cost_tokens;
    }
  }
  return { selections, total_setup: setupBudget - sRem, total_tokens: tokenBudget - tRem, total_unlocks: selections.reduce((s, c) => s + c.unlocks, 0) };
}

// ─── Trend Projection ────────────────────────────────────────────────────────

function projectTrends(db, days) {
  days = days || 30;
  const health = domainHealth(db);
  const rate = 0.02 * days;
  return health.map(h => {
    const riskCaps = db.prepare("SELECT c.name, c.maturity_score FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'used' AND sl.timestamp < datetime('now', ?) GROUP BY c.id HAVING MAX(sl.timestamp) < datetime('now', ?) ORDER BY c.maturity_score ASC LIMIT 5").all(h.domain, `-${days} days`, `-${days} days`);
    const riskList = riskCaps.map(r => ({ name: r.name, current: Math.round(r.maturity_score * 100) / 100, projected: Math.round(Math.max(0.1, r.maturity_score - rate) * 100) / 100 }));
    const projectedDecay = Math.min(1, (h.decay_risk || 0) + riskCaps.length * 0.1);
    const projectedHealth = Math.max(0, h.health - (projectedDecay - (h.decay_risk || 0)) * 0.3);
    return { domain: h.domain, current_health: h.health, projected_health: Math.round(projectedHealth * 100) / 100, delta: Math.round((projectedHealth - h.health) * 100) / 100, risk_caps: riskList };
  });
}


// ─── Execution Layer ──────────────────────────────────────────────────────────

function applyRemoval(db, capId) {
  const configPath = process.env.OPENCODE_CONFIG || (process.env.HOME + "/.config/opencode/opencode.json");
  if (!existsSync(configPath)) return { error: "Config not found" };
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const prefix = capId.split(":")[0];
  const key = capId.replace(/^[^:]+:/, "");
  const sectionMap = { mcp: "mcp", agent: "agent", cmd: "command", provider: "provider" };
  const section = sectionMap[prefix];
  if (!section) return { error: "Unknown prefix: " + prefix };
  if (!config[section] || !config[section][key]) return { error: "Not found: " + capId };
  writeFileSync(configPath + ".bak", JSON.stringify(config, null, 2));
  delete config[section][key];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const db2 = getDb();
  try { db2.prepare("INSERT INTO session_learning (session_id, capability_id, action, notes) VALUES ('exec', ?, 'removed', 'Applied removal')").run(capId); } catch {}
  db2.close();
  seedFromConfig(db);
  return { removed: capId, section, key, backup: configPath + ".bak" };
}

function exportGraph(db) {
  const caps = db.prepare("SELECT * FROM capabilities").all();
  const deps = db.prepare("SELECT * FROM dependencies").all();
  const items = caps.map(function(c) {
    var type = c.category;
    if (type === 'mcp') type = 'mcp-server';
    if (type === 'combo') type = 'possibility';
    var status = c.state;
    if (status === 'active' || status === 'unlocked') status = 'built';
    return { id: c.id, name: c.name, type: type, status: status, description: c.description, position: { x: 0, y: 0, z: 0 }, meta: { domain: c.domain, maturity: c.maturity_score } };
  });
  var conns = deps.map(function(d) {
    var t = d.is_hard_requisite ? 'hard-dep' : 'soft-dep';
    return { from: d.from_capability, to: d.to_capability, type: t };
  });
  return { items: items, connections: conns };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const db = getDb();
  migrate(db);
  const cmd = process.argv[2];
  // Flags are not arguments. Taking argv[3] blindly meant `tt verify --json`
  // looked for a capability named "--json", which every flag-taking command
  // silently inherited.
  const positional = process.argv.slice(3).filter(a => !a.startsWith("--"));
  const arg = positional[0];
  const mappingOverride = process.env.CONFIG_MAPPING;

  // An unseeded graph answered every question with "Nothing to report", which
  // is what a healthy graph with no findings says too. A Homebrew install
  // never runs bootstrap.sh, so that was the entire first-run experience:
  // a tool that appears to work and reports an empty world.
  if (cmd && cmd !== "seed" && cmd !== "where" && cmd !== "explain") {
    const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get();
    if (!seeded?.n) {
      console.log(`${C.yellow}No graph yet.${C.reset} Nothing has been discovered on this machine.`);
      console.log(`  ${C.bold}tt seed${C.reset}    read your agent config and build the graph`);
      console.log(`  ${C.grey}tt where${C.reset}   ${C.grey}where the graph is stored${C.reset}`);
      db.close();
      return;
    }
  }
  if (!cmd || cmd === "help") {
    console.log(`tech-tree - Toolchain capability graph\n`);
    console.log("  seed              Seed from opencode config (default)");
    console.log("                    Set CONFIG_MAPPING env var for other configs");
    console.log("                    Example: CONFIG_MAPPING='{\"config_keys\":{\"tools\":{\"type\":\"tool\",\"domain\":\"devops\"}}}' node engine.ts seed");
    console.log("  stats             Maturity overview");
    console.log("  context           Session context block");
    console.log("  health            Domain health scores");
    console.log("  decay             Decaying capabilities");
    console.log("  combos            Auto-discovered combos");
    console.log("  diff              Session diff");
    console.log("  bottlenecks        High-leverage capabilities");
    console.log("  impact <id>       Impact analysis for a capability");
    console.log("  budget <s> <t>    Budget optimization");
    console.log("  trend <days>      Trend projection");
    db.close();
    return;
  }
  switch (cmd) {
    case "apply":
      emit(applyProposal(db, arg));
      break;
    case "rollback":
      emit(rollbackProposal(db, arg));
      break;
    case "approve":
      emit(approveProposal(db, arg, process.argv.slice(4).filter(a => !a.startsWith('--'))[0]));
      break;
    case "propose":
      emit(propose(db, arg, Number(process.argv.slice(4).filter(a => !a.startsWith('--'))[0]) || undefined));
      break;
    case "proposals":
      emit(listProposals(db));
      break;
    case "proposal":
      emit(showProposal(db, arg));
      break;
    case "simulate":
      emit(arg ? simulateFrontier(db, [arg]) : { error: 'Usage: tt simulate <capability>' });
      break;
    case "spof":
      emit(singlePointsOfFailure(db));
      break;
    case "failed":
      emit(recordFailure(db, arg, process.argv.slice(4).filter(a => !a.startsWith('--'))[0]));
      break;
    case "deficits":
      emit(deficits(db));
      break;
    case "plan":
      emit(planFor(db, arg));
      break;
    case "authority":
      emit(authorityReport(db));
      break;
    case "verify":
      emit(runVerification(db, arg));
      break;
    case "evidence":
      emit(arg ? evidenceFor(db, arg.startsWith('combo:') ? arg : `combo:${arg}`) : { error: "Usage: tt evidence <id>" });
      break;
    case "ledger":
      emit(ledgerHistory(db));
      break;
    case "since":
      emit(ledgerSince(db, arg));
      break;
    case "explain": {
      // Same definitions the visualizer shows, read from the shared file so
      // the two surfaces cannot drift.
      const { concepts } = JSON.parse(readFileSync(join(__dirname, "..", "shared", "concepts.json"), "utf8"));
      const wanted = (process.argv[3] || "").toLowerCase();
      const picked = wanted
        ? concepts.filter((c: any) => c.key.includes(wanted) || c.term.toLowerCase().includes(wanted))
        : concepts;
      if (picked.length === 0) {
        console.log(`${C.yellow}No concept matching "${wanted}".${C.reset}`);
        console.log(`Try: ${concepts.map((c: any) => c.key).join(", ")}`);
        break;
      }
      // Wrap to a readable measure rather than emitting one long line.
      const wrap = (text: string, width = 76, indent = "  ") => {
        const out: string[] = [];
        let line = "";
        for (const word of text.split(" ")) {
          if ((line + word).length > width) { out.push(indent + line.trim()); line = ""; }
          line += word + " ";
        }
        if (line.trim()) out.push(indent + line.trim());
        return out.join("\n");
      };
      console.log("");
      for (const c of picked) {
        console.log(`${C.bold}${c.term}${C.reset} ${C.grey}— ${c.short}${C.reset}`);
        console.log(wrap(c.long));
        console.log(`  ${C.grey}Where you see it: ${c.seen}${C.reset}`);
        console.log("");
      }
      if (!wanted) console.log(`${C.grey}tt explain <term> for one of these on its own.${C.reset}\n`);
      break;
    }
    case "seed": {
      const cfg = CONFIG_DEFAULT;
      seedFromConfig(db, undefined, mappingOverride);
      const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities").get();
      console.log(`${C.green}✓${C.reset} ${c.cnt} capabilities`);
      // Say so rather than reporting a curated-model-only graph as if it had
      // read the environment. Silence here reads as "your stack is empty".
      if (!existsSync(cfg)) {
        console.log(`${C.yellow}!${C.reset} No agent config at ${C.grey}${cfg}${C.reset}`);
        console.log(`${C.grey}  Seeded the capability model only — nothing of yours is in the graph yet.${C.reset}`);
        console.log(`${C.grey}  Point it at your own config: OPENCODE_CONFIG=/path/to/config.json${C.reset}`);
        console.log(`${C.grey}  Another format: see "Other configurations" in the README (CONFIG_MAPPING).${C.reset}`);
      }
      break;
    }
    case "stats": case "context": {
      const g = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities").get();
      console.log(`Toolchain: ${g.unlocked}/${g.total}`);
      const domains = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as unlocked FROM capabilities GROUP BY domain ORDER BY domain").all();
      for (const d of domains) console.log(`  ${d.domain.padEnd(12)} ${d.unlocked}/${d.total}`);
      break;
    }
    case "health": emit(domainHealth(db)); break;
    case "decay": emit(computeDecay(db)); break;
    case "combos": emit(discoverCombos(db)); break;
    case "diff": emit(sessionDiff(db)); break;
    case "bottlenecks": emit(findBottlenecks(db)); break;
    case "impact": emit(analyzeImpact(db, arg)); break;
    case "budget": emit(optimizeBudget(db, parseInt(arg) || 120, parseInt(process.argv[4]) || 8000)); break;
    case "trend": emit(projectTrends(db, parseInt(arg) || 30)); break;
    case "prune": emit(pruneRecommendations(db)); break;
    case "fork": emit(forkComparison(db)); break;
    case "profile": emit(graphProfile(db)); break;
    case "export": console.log(JSON.stringify(exportGraph(db))); break;

    case "near": emit(nearMissCombos(db)); break;
    case "insight": emit(insights(db)); break;
    // Where the graph lives is not obvious once the CLI is installed rather
    // than cloned, and every other component resolves the same path.
    case "where": {
      const path = resolveDbPath();
      // Not whether the file exists — opening it creates it, so that is always
      // true by the time this runs. Whether it holds a graph is the question.
      const seeded = db.prepare("SELECT COUNT(*) AS n FROM capabilities").get()?.n ?? 0;
      emit({
        graph: path,
        capabilities: seeded,
        seeded: seeded > 0 ? true : "no — run tt seed",
        bytes: existsSync(path) ? statSync(path).size : 0,
        override: "TOOLCHAIN_DB",
      });
      break;
    }
    default: console.log(`${C.red}Unknown: ${cmd}${C.reset}`);
  }
  db.close();
}

if (import.meta.main) main();
export { getDb, migrate, seedFromConfig, computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks, analyzeImpact, optimizeBudget, projectTrends, pruneRecommendations, forkComparison, graphProfile, nearMissCombos, insights, applyRemoval, runVerification, evidenceFor, authorityReport, planFor, ledgerSince, ledgerHistory, recordFailure, deficits, singlePointsOfFailure, simulateFrontier, propose, listProposals, showProposal, approveProposal, inverseOf, applyProposal, rollbackProposal };
