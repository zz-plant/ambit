/**
 * What may be done to what. The roadmap's remaining architectural move, in the
 * slice that pays for itself first.
 *
 * Every object type the model needs is in place but one distinction: an action
 * has no object. *Read repository A* and *write repository B* are one node
 * called Version Control, so a grant is always coarser than the trust behind it
 * and evidence is always a claim about a verb rather than about a verb applied
 * to a thing. An agent that has committed to one repository forty times has
 * proved nothing whatsoever about the next one, and the graph could not say so.
 *
 * Restructuring the era tree around objects is a large change and not this one.
 * What this does is let authority and evidence *refer* to an object, and then
 * report the environment that way: for each target, which actions may be taken
 * on it, under what mode, on what evidence. The tree is untouched and stays
 * what it should be — a rollup over affordances rather than the ontology.
 *
 * The object vocabulary is the one already in use for scope: `repo:owner/name`,
 * `env:staging`, `device:nuc`, `svc:postgres`. Scope was always a claim about an
 * object; this reads it as one.
 */
import type { Db } from './db.ts';
import { scopeCovers, sandboxCovering } from './assure/decide.ts';

/** Every object named anywhere: in a grant's scope, a sandbox, or evidence. */
function knownObjects(db: Db): string[] {
  const out = new Set<string>();
  for (const r of db
    .prepare("SELECT DISTINCT scope FROM authority WHERE scope IS NOT NULL AND scope != ''")
    .all<{ scope: string }>())
    out.add(r.scope);
  try {
    for (const r of db.prepare('SELECT target FROM sandboxes').all<{ target: string }>())
      out.add(r.target);
  } catch {
    /* database predates sandboxes */
  }
  try {
    for (const r of db
      .prepare(
        "SELECT DISTINCT object FROM session_learning WHERE object IS NOT NULL AND object != ''"
      )
      .all<{ object: string }>())
      out.add(r.object);
  } catch {
    /* database predates the column */
  }
  for (const r of db
    .prepare(
      "SELECT id FROM capabilities WHERE kind = 'resource' OR id LIKE 'device:%' OR id LIKE 'svc:%'"
    )
    .all<{ id: string }>())
    out.add(r.id);
  return [...out].sort();
}

/**
 * What may be done to one object, and what has been proved about doing it.
 *
 * The answer a person wants before widening anything, and the answer an agent
 * wants before touching something it has not touched: not "may I use Version
 * Control" but "may I push to this repository, and has that ever been proved
 * here".
 */
function objectReport(db: Db, target?: string) {
  if (!target) {
    const objects = knownObjects(db);
    if (!objects.length) {
      return {
        note: 'No objects named yet. An object appears when a grant is scoped to one (ambit authority promote <cap> <action> --scope=repo:owner/name), when a sandbox is declared, or when evidence records one.',
      };
    }
    return {
      objects: objects.map(o => {
        const grants = grantsFor(db, o);
        return {
          object: o,
          actions: grants.length,
          unattended: grants.filter(g => g.mode === 'autonomous').length,
          forbidden: grants.filter(g => g.mode === 'forbidden').length,
        };
      }),
      note: 'ambit objects <target> is what may be done to one of them, and on what evidence.',
    };
  }

  const grants = grantsFor(db, target);
  const sandbox = sandboxCovering(db, target);
  if (!grants.length) {
    return {
      object: target,
      sandbox: sandbox?.target,
      note: sandbox
        ? `Nothing is scoped to ${target}, but it sits inside the sandbox ${sandbox.target}, so what would ask for confirmation runs unattended there.`
        : `Nothing in the graph is scoped to ${target}. Unscoped grants still apply to it — ambit authority is the general picture.`,
    };
  }

  return {
    object: target,
    sandbox: sandbox?.target,
    may: grants.filter(g => g.mode === 'autonomous').map(g => `${g.name} · ${g.action}`),
    asks: grants.filter(g => g.mode === 'confirm').map(g => `${g.name} · ${g.action}`),
    refused: grants.filter(g => g.mode === 'forbidden').map(g => `${g.name} · ${g.action}`),
    evidence: grants
      .filter(g => g.passes || g.failures)
      .map(g => ({
        action: `${g.name} · ${g.action}`,
        proved: `${g.passes} passing${g.failures ? `, ${g.failures} failing` : ''}`,
        here: true,
      })),
    note: 'Evidence here is evidence about this object. What was proved elsewhere is not a claim about this one, which is the whole reason for naming objects.',
  };
}

/** Grants whose scope covers a target, with the evidence recorded against it. */
function grantsFor(db: Db, target: string) {
  const rows = db
    .prepare(
      `SELECT a.capability_id, a.action, a.mode, a.scope, c.name
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       WHERE a.scope IS NOT NULL AND a.scope != ''`
    )
    .all<any>()
    .filter(g => scopeCovers(g.scope, target));

  return rows.map(g => {
    let passes = 0;
    let failures = 0;
    try {
      const e = db
        .prepare(
          `SELECT SUM(CASE WHEN action = 'verified' THEN 1 ELSE 0 END) AS passes,
                  SUM(CASE WHEN action = 'failed' THEN 1 ELSE 0 END) AS failures
           FROM session_learning WHERE capability_id = ? AND object = ?`
        )
        .get(g.capability_id, target);
      passes = e?.passes ?? 0;
      failures = e?.failures ?? 0;
    } catch {
      /* database predates the column */
    }
    return { ...g, passes, failures };
  });
}

/**
 * Records that a check was run against a particular object.
 *
 * `ambit verify <cap> --target=<object>` runs the capability's declared check
 * and files the result against the object, so evidence stops being a single
 * claim about a verb. The check itself is unchanged: what changes is what the
 * evidence is understood to be about.
 */
function attachObject(db: Db, capabilityId: string, object: string): number {
  const row = db
    .prepare(
      `SELECT id FROM session_learning
       WHERE capability_id = ? AND action IN ('verified','failed') AND object IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get<{ id: number }>(capabilityId);
  if (!row) return 0;
  db.prepare('UPDATE session_learning SET object = ? WHERE id = ?').run(object, row.id);
  return 1;
}

export { objectReport, knownObjects, grantsFor, attachObject };
