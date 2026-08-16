import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { ENGINE_DIR } from "./paths.ts";
import type { Db } from "./db.ts";

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

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * The lifecycle a capability is actually in, derived from what it has.
 *
 *   unknown     nothing supplies it
 *   detected    something supplies it, but it is not reachable yet
 *   configured  reachable, with no check run against it
 *   verified    its check passed, and has not been run often
 *   reliable    five runs or more, and the last five all passed
 *   degraded    the last run passed, and recent ones did not
 *   broken      the last run failed
 *
 * `state` is left alone. It is what every stored frontier snapshot records, and
 * repurposing it would break the ledger to say something the ledger does not
 * ask; lifecycle sits beside it and answers the different question — not
 * whether the system can reach the capability, but how much its evidence is
 * worth. This is the distinction the whole project turns on: installed is not
 * callable is not working is not reliable.
 */
const RECENT_RUNS = 5;

/**
 * Lifecycle values that mean the capability is not currently working.
 *
 * `state` answers what the system can reach; `lifecycle` answers how much its
 * evidence is worth. The gate is the second, applied where availability is
 * decided: a capability that is reachable but degraded or broken must not be
 * relied on, planned on top of, or reported as exercisable — configured is not
 * working, and a check failing is evidence that it is not.
 */
export const FAILING_LIFECYCLES = ['degraded', 'broken'] as const;

/** Whether a lifecycle value counts as usable. Unknown/detected imply unreached. */
export const usable = (lifecycle?: string): boolean =>
  !lifecycle || !FAILING_LIFECYCLES.includes(lifecycle as any);

function lifecycleFrom(reached: boolean, hasProvider: boolean, history: { action: string }[]): string {
  if (!reached) return hasProvider ? 'detected' : 'unknown';
  if (history.length === 0) return 'configured';
  // evidenceFor returns newest first.
  if (history[0].action !== 'verified') return 'broken';
  const recent = history.slice(0, RECENT_RUNS);
  const allRecentPassed = recent.every(h => h.action === 'verified');
  if (!allRecentPassed) return 'degraded';
  return history.length >= RECENT_RUNS ? 'reliable' : 'verified';
}

/**
 * Recomputes lifecycle for every capability and action.
 *
 * Runs on seed and after verification, which are the two moments the inputs can
 * change. Nothing else writes the column, so it cannot drift from the evidence
 * it is derived from.
 */
function deriveLifecycles(db: Db): number {
  const nodes = db
    .prepare("SELECT id, state FROM capabilities WHERE kind IN ('capability', 'action')")
    .all();
  const provided = new Set(
    db.prepare("SELECT DISTINCT to_capability t FROM dependencies WHERE kind IN ('provides', 'contributes')")
      .all().map((r: any) => r.t)
  );
  const update = db.prepare("UPDATE capabilities SET lifecycle = ? WHERE id = ?");
  let count = 0;
  for (const node of nodes) {
    const history = db
      .prepare(
        `SELECT action FROM session_learning WHERE capability_id = ?
         AND action IN ('verified','failed') ORDER BY timestamp DESC, id DESC LIMIT ?`
      )
      .all(node.id, RECENT_RUNS * 2) as { action: string }[];
    update.run(lifecycleFrom(node.state !== 'locked', provided.has(node.id), history), node.id);
    count++;
  }
  return count;
}

// ─── Authority ────────────────────────────────────────────────────────────────

/** Narrowest wins. Two sources disagreeing is not a tie to break arbitrarily. */
const MODE_RANK: Record<string, number> = { autonomous: 0, confirm: 1, forbidden: 2 };

function narrower(a: string, b: string): string {
  return (MODE_RANK[b] ?? 0) > (MODE_RANK[a] ?? 0) ? b : a;
}

/**
 * Where a capability's authority is narrower than its technical reach.
 *
 * Being able to perform an action is not permission to perform it, so the two
 * are tracked apart. A capability that is reached but gated is not autonomously
 * exercisable, and that difference is the whole point of separating them.
 *
 * Read from the `authority` table rather than re-parsed out of the curated tree
 * at report time, because the tree is no longer the only source: a runtime
 * states what it permits — Hermes reports `approvals.mode` and
 * `approvals.cron_mode` — and what it permits applies to everything it
 * contributes. Where a declaration and a runtime disagree the narrower wins,
 * and the report names which source narrowed it, since that is the half worth
 * knowing.
 */
function authorityReport(db: Db) {
  const grants = db
    .prepare(
      `SELECT a.capability_id, a.action, a.mode, a.holder, a.scope, a.source, a.note,
              c.name, c.state, c.kind, c.lifecycle
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       ORDER BY c.name, a.action`
    )
    .all();
  if (grants.length === 0) {
    return { note: "No authority declared. Seed a graph, or declare authority on a capability in the model." };
  }

  // Runtime-wide grants apply to everything that runtime contributes, so they
  // are stored once against the runtime node and resolved here rather than
  // copied onto every capability at seed — where a later contribution would
  // silently miss them.
  const runtimeReach = new Map<string, Set<string>>();
  for (const r of db.prepare(
    `SELECT rt.from_capability runtime, p.to_capability capability
     FROM dependencies rt JOIN dependencies p ON p.from_capability = rt.to_capability
     WHERE rt.kind = 'contributes' AND p.kind = 'provides'`
  ).all()) {
    if (!runtimeReach.has(r.runtime)) runtimeReach.set(r.runtime, new Set());
    runtimeReach.get(r.runtime)!.add(r.capability);
  }
  // And one hop further, onto the actions those capabilities confer: a runtime
  // that requires approval for everything it executes requires it for the
  // individual actions too, or the finer vocabulary would quietly be the freer
  // one.
  const conferred = new Map<string, string[]>();
  for (const r of db.prepare(
    `SELECT d.from_capability capability, d.to_capability action
     FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
     WHERE d.kind = 'provides' AND c.kind = 'action'`
  ).all()) {
    if (!conferred.has(r.capability)) conferred.set(r.capability, []);
    conferred.get(r.capability)!.push(r.action);
  }
  for (const reach of runtimeReach.values()) {
    for (const capId of [...reach]) for (const actionId of conferred.get(capId) || []) reach.add(actionId);
  }

  // Collected first and resolved after, so which source wins does not depend on
  // the order rows come back in.
  const collected = new Map<string, any>();
  const record = (id: string, name: string, state: string, kind: string, lifecycle: string, action: string, mode: string, source: string, scope: string) => {
    const key = `${id}|${action}|${scope}`;
    if (!collected.has(key)) {
      collected.set(key, { name, id, kind, action, scope: scope || undefined, reached: state !== 'locked' && usable(lifecycle), lifecycle, grants: [] });
    }
    collected.get(key)!.grants.push({ source, mode });
  };

  const nodes = new Map(
    db.prepare("SELECT id, name, state, kind, lifecycle FROM capabilities").all().map((c: any) => [c.id, c])
  );

  for (const g of grants) {
    if (g.kind === 'runtime') {
      // A runtime's own grant is a statement about everything it supplies.
      for (const capId of runtimeReach.get(g.capability_id) || []) {
        const target = nodes.get(capId) as any;
        if (!target) continue;
        record(capId, target.name, target.state, target.kind, target.lifecycle, g.action, g.mode, g.source, g.scope);
      }
      continue;
    }
    record(g.capability_id, g.name, g.state, g.kind, g.lifecycle, g.action, g.mode, g.source, g.scope);
  }

  const detail = [...collected.values()]
    .map(entry => {
      const mode = entry.grants.map((g: any) => g.mode).reduce(narrower);
      const declared = entry.grants.filter((g: any) => g.source === 'techtree');
      // Narrowed means a runtime is stricter than the model says the action is
      // — the case worth surfacing, because it is the machine in front of you
      // disagreeing with the general description.
      const narrowedBy = declared.length && narrower(declared[0].mode, mode) !== declared[0].mode
        ? entry.grants.find((g: any) => g.mode === mode && g.source !== 'techtree')?.source
        : entry.grants.length === 1 && entry.grants[0].source !== 'techtree' && mode !== 'autonomous'
          ? entry.grants[0].source
          : undefined;
      const { grants: _grants, ...rest } = entry;
      return { ...rest, mode, sources: entry.grants.map((g: any) => g.source), narrowed_by: narrowedBy };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const execute = detail.filter(d => d.action === 'execute' || !['observe'].includes(d.action));
  const named = (rows: any[]) => rows.map(r => (r.scope ? `${r.name} · ${r.scope}` : r.name));

  return {
    autonomous: named(execute.filter(r => r.reached && r.mode === 'autonomous')),
    needs_approval: named(execute.filter(r => r.reached && r.mode === 'confirm')),
    forbidden: named(execute.filter(r => r.mode === 'forbidden')),
    narrowed_by_runtime: named(execute.filter(r => r.narrowed_by)),
    note: "reached means the system can perform it; mode says whether it may without asking. A degraded or broken capability is not listed as reached however its permission reads.",
    detail,
  };
}

function runVerification(db: Db, which?: string) {
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8"));
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

  // Evidence just changed, so what it is worth just changed too.
  deriveLifecycles(db);
  for (const r of results as any[]) {
    r.lifecycle = db.prepare("SELECT lifecycle FROM capabilities WHERE id = ?").get(r.id)?.lifecycle;
  }

  // The gate, stated rather than implied: these now read as unavailable until
  // re-verified. The transition is immediate — no re-seed required — and is
  // why a check is worth declaring in the first place. A capability that was
  // never reached reads as detected or unknown rather than failing, so it is
  // not listed here; there was nothing available to lose.
  const nowUnavailable = results.filter((r: any) =>
    r.lifecycle === 'degraded' || r.lifecycle === 'broken'
  );

  return {
    checked: results.length,
    verified: results.filter(r => r.status === 'verified').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
    now_unavailable: nowUnavailable.length
      ? nowUnavailable.map((r: any) => ({ id: r.id, name: r.name, lifecycle: r.lifecycle }))
      : undefined,
    gate: nowUnavailable.length
      ? 'these capabilities now read as degraded or broken — configured, but their check is failing. They are excluded from plans, simulations and authority until re-verified.'
      : undefined,
  };
}

/**
 * The concrete actions a capability confers, and whether each may be performed.
 *
 * The coarse node answers "does this system have version control". This answers
 * the question that actually decides what an agent may do next: it may read the
 * repository and commit, and it may not merge to the default branch. Authority
 * is per action because permission is per action; the capability being reached
 * says nothing about which half of it is permitted.
 */
function actionsReport(db: Db, capId?: string) {
  const scope = capId
    ? (capId.startsWith('combo:') || capId.includes(':') ? capId : `combo:${capId}`)
    : undefined;

  const actions = db
    .prepare(
      `SELECT a.id, a.name, a.state, a.lifecycle, a.description, d.from_capability capability, c.name capability_name
       FROM capabilities a
       JOIN dependencies d ON d.to_capability = a.id AND d.kind = 'provides'
       JOIN capabilities c ON c.id = d.from_capability
       WHERE a.kind = 'action' AND c.kind = 'capability'
       ORDER BY c.name, a.name`
    )
    .all()
    .filter((r: any) => !scope || r.capability === scope);

  if (actions.length === 0) {
    return scope
      ? { note: `${scope} declares no contract. Only some capabilities name their actions; see contract.can in the model.` }
      : { note: 'No actions in the graph. Seed one, or declare contract.can on a capability in the model.' };
  }

  // Effective authority, resolved the same way `tt authority` resolves it, so
  // the two surfaces cannot disagree about what is permitted.
  const authority = authorityReport(db) as any;
  const modeOf = new Map<string, any>();
  for (const row of authority.detail || []) {
    if (row.action !== 'execute' || row.scope) continue;
    modeOf.set(row.id, row);
  }

  const rows = actions.map((a: any) => {
    const grant = modeOf.get(a.id);
    return {
      name: a.name,
      id: a.id,
      capability: a.capability_name,
      // Reachable is not enough to act on: a broken action cannot be performed
      // whatever the capability's state says, and it must not read as
      // exercisable.
      reached: a.state !== 'locked' && usable(a.lifecycle),
      mode: grant?.mode || 'autonomous',
      narrowed_by: grant?.narrowed_by,
      lifecycle: a.lifecycle,
    };
  });

  return {
    actions: rows.length,
    // Reached and permitted, which is the only combination an agent can act on
    // unattended. The other three are each interesting for a different reason.
    exercisable: rows.filter(r => r.reached && r.mode === 'autonomous').map(r => r.id),
    needs_approval: rows.filter(r => r.reached && r.mode === 'confirm').map(r => r.id),
    forbidden: rows.filter(r => r.mode === 'forbidden').map(r => r.id),
    detail: rows,
  };
}

export { verifyCapability, evidenceFor, authorityReport, actionsReport, runVerification, deriveLifecycles };
