/**
 * Running a capability's declared check, and the evidence that accumulates.
 *
 * The distinction this exists to keep: configured is not verified. A check
 * that has never run and a check that passed an hour ago are different states,
 * and everything that decides availability reads the difference.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { loadTechTree } from '../paths.ts';
import { deriveLifecycles } from './lifecycle.ts';
import { evaluatePromotions } from './promote.ts';
import { pullDelegationSources, recordDelegationState } from '../delegation.ts';
import { attachObject } from '../objects.ts';
import type { CapabilityRow } from '../rows.ts';
import { CHECK_RUN_SQL, FAILING_SQL, PROBE_COMMAND, recheckCommand } from '../vocabulary.ts';

/**
 * A check declared outside the curated model — §12.5.
 *
 * techtree.json holds the checks for capabilities Ambit ships knowledge of.
 * This holds the ones an agent registered for something it wrote itself. Same
 * runner, same evidence table, same gate: a registered skill whose check fails
 * is degraded exactly like a git MCP server whose check fails.
 */
function declaredCheck(db: Db, id: string): { command: string[]; timeout_seconds: number } | null {
  let row: { command: string; timeout_seconds: number } | undefined;
  try {
    row = db
      .prepare('SELECT command, timeout_seconds FROM declared_checks WHERE capability_id = ?')
      .get<{ command: string; timeout_seconds: number }>(id);
  } catch {
    return null; // database predates the table
  }
  if (!row) return null;
  try {
    return { command: JSON.parse(row.command), timeout_seconds: row.timeout_seconds };
  } catch {
    return null;
  }
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Runs a declared check and records what happened.
 *
 * Detection proves a name exists in a config file. This proves the action can
 * be performed — the difference between `installed` and `working`, and the
 * point at which "capability" means something an agent can rely on.
 *
 * Checks execute. They come from techtree.json in this repository, are
 * read-only by construction, and run only when a person asks: nothing verifies
 * on seed. Treat adding one as you would adding a package script.
 *
 * A check belongs to a node, or to one of its contract actions. A capability
 * that declares a check but no action-level ones verifies itself; a contract
 * action may declare its own — reading a repository is a weaker claim than
 * *having read a particular repository*, and the two should not be conflated.
 */
function verifyCheck(
  db: Db,
  id: string,
  name: string,
  verify: any
): {
  id: string;
  name: string;
  status: string;
  detail?: string;
  ms: number;
} {
  const started = Date.now();
  let status: 'verified' | 'failed' | 'unverifiable' = 'unverifiable';
  let detail: string | undefined;

  if (!verify?.command) {
    detail = 'no check declared';
  } else {
    const [cmd, ...args] = verify.command;
    try {
      const out = spawnSync(cmd, args, {
        timeout: (verify.timeout_seconds || 10) * 1000,
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
    const exists = db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
    if (exists) {
      db.prepare(
        "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, ?)"
      ).run(id, status, status === 'verified' ? 1 : 0, detail || null);
    }
  }
  return { id, name, status, detail, ms };
}

/** Verifies a capability node using its own declared check. */
function verifyCapability(db: Db, nodeId: string, node: any) {
  return verifyCheck(db, `combo:${nodeId}`, node?.name || nodeId, node?.verify);
}

/** Verifies one of a capability's contract actions using its own check. */
function verifyAction(db: Db, node: any, action: any) {
  const id = `act:${node.id}/${action.id ?? action}`;
  return verifyCheck(db, id, String(action.id ?? action).replace(/_/g, ' '), action.verify);
}

/** Verification history for a capability, most recent first. */
function evidenceFor(db: Db, id: string) {
  return db
    .prepare(
      `SELECT action, outcome_score, notes, timestamp FROM session_learning
       WHERE capability_id = ? AND ${CHECK_RUN_SQL}
       ORDER BY timestamp DESC LIMIT 10`
    )
    .all(id);
}

/**
 * The check of everything whose check is failing, and nothing else.
 *
 * A failing check takes a capability out of every plan until it passes
 * again, and the only way back was to name each one: a broken token took
 * three servers down, and bringing them back meant reading `ambit status` and
 * typing three commands. This runs those checks and only those, so the
 * command to type after fixing something is the same whatever it was. It
 * still runs only when typed: a check is a command, and nothing re-runs one
 * on its own.
 */
function failingChecks(db: Db) {
  const ids = db
    .prepare(`SELECT id FROM capabilities WHERE ${FAILING_SQL} ORDER BY id`)
    .all<{ id: string }>()
    .map(r => r.id);
  const tree = loadTechTree();
  const nodes = new Map<string, any>((tree?.nodes || []).map((n: any) => [`combo:${n.id}`, n]));
  return ids.flatMap(id => {
    if (id.startsWith('act:')) {
      const [capId, actionName] = id.replace(/^act:/, '').split('/');
      const node = nodes.get(`combo:${capId}`);
      const action = node?.contract?.can?.find((a: any) => (a.id ?? a) === actionName);
      return action?.verify?.command ? [verifyAction(db, node, action)] : [];
    }
    const node = nodes.get(id);
    if (node?.verify?.command) return [verifyCapability(db, node.id, node)];
    const declared = declaredCheck(db, id);
    if (!declared) return [];
    const name = db.prepare('SELECT name FROM capabilities WHERE id = ?').get(id)?.name || id;
    return [verifyCheck(db, id, String(name), declared)];
  });
}

function runVerification(
  db: Db,
  which?: string,
  target?: string,
  options: { failing?: boolean } = {}
) {
  if (options.failing) {
    if (which) {
      return {
        error: `--failing runs every check that is failing, so it takes no capability. ambit verify ${which} runs that one.`,
      };
    }
    const results = failingChecks(db);
    // A device or service the manifest names fails a probe, which this
    // command cannot run. Named with the command that can, so "nothing is
    // failing" is never the answer while one is.
    const probed = db
      .prepare(`SELECT id, name FROM capabilities WHERE ${FAILING_SQL} ORDER BY id`)
      .all<{ id: string; name: string }>()
      .filter(r => recheckCommand(r.id) === PROBE_COMMAND)
      .map(r => ({ id: r.id, name: r.name, command: PROBE_COMMAND }));
    const notRun = probed.length ? probed : undefined;
    if (!results.length) {
      return {
        checked: 0,
        verified: 0,
        failed: 0,
        results: [],
        not_run: notRun,
        note: notRun
          ? `Nothing failing has a check this command runs. ${probed.map(p => p.name).join(', ')} failed a probe of the manifest, and ${PROBE_COMMAND} probes again.`
          : 'Nothing is failing its check.',
      };
    }
    return { ...settle(db, results, target), not_run: notRun };
  }
  // A registered skill is not in the curated model, so it is answered before
  // the model is consulted at all — otherwise `ambit verify skill:x` would say
  // no such capability about something the agent just put on the map.
  if (which?.includes(':') && !which.startsWith('combo:') && !which.startsWith('act:')) {
    const declared = declaredCheck(db, which);
    if (declared) {
      const name =
        db.prepare('SELECT name FROM capabilities WHERE id = ?').get(which)?.name || which;
      const r = verifyCheck(db, which, String(name), declared);
      const history = evidenceFor(db, which);
      deriveLifecycles(db);
      const authority = evaluatePromotions(db);
      recordDelegationState(db);
      return {
        checked: 1,
        verified: r.status === 'verified' ? 1 : 0,
        failed: r.status === 'failed' ? 1 : 0,
        results: [
          {
            ...r,
            reliability: history.length
              ? `${history.filter((h: any) => h.action === 'verified').length}/${history.length}`
              : undefined,
            lifecycle: db.prepare('SELECT lifecycle FROM capabilities WHERE id = ?').get(which)
              ?.lifecycle,
          },
        ],
        authority_changed:
          authority.promoted.length || authority.demoted.length ? authority : undefined,
      };
    }
  }
  if (which && recheckCommand(which) === PROBE_COMMAND) {
    return {
      error: `${which} is checked by probing the URL the infrastructure manifest gives it, which ${PROBE_COMMAND} does.`,
    };
  }
  const tree = loadTechTree();
  if (!tree?.nodes?.length) {
    return { error: 'No capability model to verify against.' };
  }
  // ambit verify act:<capability>/<action> — an action's own check.
  if (which?.startsWith('act:')) {
    const [capId, actionName] = which.replace(/^act:/, '').split('/');
    const node = (tree.nodes || []).find((n: any) => n.id === capId);
    const action = node?.contract?.can?.find((a: any) => (a.id ?? a) === actionName);
    if (!node || !action) return { error: `No action ${which} in the model.` };
    const r = verifyAction(db, node, action);
    const history = evidenceFor(db, r.id);
    const runs = history.length;
    const passes = history.filter((h: any) => h.action === 'verified').length;
    deriveLifecycles(db);
    const authority = evaluatePromotions(db);
    recordDelegationState(db);
    (r as any).lifecycle = db
      .prepare('SELECT lifecycle FROM capabilities WHERE id = ?')
      .get(r.id)?.lifecycle;
    return {
      checked: 1,
      verified: r.status === 'verified' ? 1 : 0,
      failed: r.status === 'failed' ? 1 : 0,
      results: [{ ...r, reliability: runs ? `${passes}/${runs}` : undefined }],
      authority_changed:
        authority.promoted.length || authority.demoted.length ? authority : undefined,
    };
  }
  // A named node verifies itself even when it declares no check — the answer
  // "no check declared" is as informative as "passed", and `tt verify <name>`
  // is how you ask. Everything runs every declared node and action check.
  const nodes = (tree.nodes || []).filter((n: any) =>
    which ? n.id === which.replace(/^combo:/, '') : n.verify?.command
  );
  if (which && nodes.length === 0) {
    return { error: `No capability ${which} in the model.` };
  }
  if (nodes.length === 0) {
    return { error: 'No checks declared.' };
  }

  const results = nodes.flatMap((n: any) => {
    const own = n.verify?.command ? [verifyCapability(db, n.id, n)] : [];
    // Contract actions that carry their own check — a capability declaring a
    // check and an action declaring one are different claims about different
    // granularities, and both get run.
    const actions = (n.contract?.can || [])
      .filter((a: any) => a?.verify?.command)
      .map((a: any) => verifyAction(db, n, a));
    // A named node with no check still answers: unverifiable.
    return own.length
      ? [...own, ...actions]
      : actions.length
        ? actions
        : [verifyCapability(db, n.id, n)];
  });

  return settle(db, results, target);
}

/**
 * What a batch of check runs comes to: each one's reliability, the lifecycles
 * and grants that move on the new evidence, and what is now unavailable.
 */
function settle(db: Db, results: any[], target?: string) {
  const withReliability = results.map((r: any) => {
    const history = evidenceFor(db, r.id);
    const runs = history.length;
    const passes = history.filter((h: any) => h.action === 'verified').length;
    return {
      ...r,
      reliability: runs ? `${passes}/${runs}` : undefined,
    };
  });

  // A check run against a named object is evidence about that object, not a
  // second claim about the verb in general. Attaching it here rather than
  // threading a parameter through every check keeps the runner unchanged: what
  // changes is what the evidence is understood to be about.
  if (target) {
    for (const r of results) attachObject(db, r.id, target);
  }

  // Evidence just changed, so what it is worth just changed too — and so has
  // what it earns. A threshold a person set in advance takes effect here
  // rather than waiting for someone to run a command named "promote".
  deriveLifecycles(db);
  const authority = evaluatePromotions(db);
  recordDelegationState(db);
  // Every declared source, read on the run where this graph's evidence changes
  // anyway. After the lifecycles and promotions above, deliberately: what
  // arrives here is evidence attributed to another system, and running it
  // before them would suggest it decides something. It does not.
  pullDelegationSources(db, path => readFileSync(path, 'utf8'));
  for (const r of withReliability) {
    r.lifecycle = db
      .prepare('SELECT lifecycle FROM capabilities WHERE id = ?')
      .get<Pick<CapabilityRow, 'lifecycle'>>(r.id)?.lifecycle;
  }

  // The gate, stated rather than implied: these now read as unavailable until
  // re-verified. The transition is immediate — no re-seed required — and is
  // why a check is worth declaring in the first place. A capability that was
  // never reached reads as detected or unknown rather than failing, so it is
  // not listed here; there was nothing available to lose.
  const nowUnavailable = withReliability.filter(
    (r: any) => r.lifecycle === 'degraded' || r.lifecycle === 'broken'
  );

  return {
    checked: withReliability.length,
    verified: withReliability.filter((r: Record<string, any>) => r.status === 'verified').length,
    failed: withReliability.filter((r: Record<string, any>) => r.status === 'failed').length,
    results: withReliability,
    now_unavailable: nowUnavailable.length
      ? nowUnavailable.map((r: any) => ({ id: r.id, name: r.name, lifecycle: r.lifecycle }))
      : undefined,
    object: target,
    gate: nowUnavailable.length
      ? 'these now read as degraded or broken — configured, but their check is failing. They are excluded from plans, simulations and authority until re-verified.'
      : undefined,
    // §12.6: what this evidence just earned, or just cost. Reported here
    // because a promotion nobody is told about is indistinguishable from a
    // permission that was always too wide.
    authority_changed:
      authority.promoted.length || authority.demoted.length ? authority : undefined,
  };
}

export { verifyCheck, verifyCapability, verifyAction, declaredCheck, evidenceFor, runVerification };
