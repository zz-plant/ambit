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
  try { tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8")); }
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

  return {
    checked: results.length,
    verified: results.filter(r => r.status === 'verified').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  };
}

export { verifyCapability, evidenceFor, authorityReport, runVerification };
