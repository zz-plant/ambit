/**
 * What the agent built for itself, on the map. Roadmap §12.5.
 *
 * Ambit maps what a person installed: MCP servers, models, devices, runtimes. A
 * long-running agent grows mostly through none of those. It grows by writing a
 * skill after explaining something twice, by keeping notes it can find again,
 * by proving a procedure works and then reusing it. Those are capabilities by
 * every definition this project uses, and until now the graph could not see
 * them — Skill Library read as reached because a directory existed, whatever
 * was or was not in it.
 *
 * Registration is deliberately not detection. An agent says *this is a thing I
 * made, it supplies this capability, and here is a read-only command that
 * proves it still works*. The check is what separates this from a node an agent
 * can talk itself into: a registered skill with a failing check degrades like
 * anything else, and the same gate excludes it from plans and authority.
 */
import type { Db } from './db.ts';
import { deriveLifecycles } from './assure/lifecycle.ts';
import { verifyCheck } from './assure/verify.ts';

/** Registered providers are namespaced, so nothing can shadow a curated node. */
const SKILL_PREFIX = 'skill:';

/**
 * Registers a capability the agent produced, with the check that proves it.
 *
 * Refuses a registration with no check. An unverifiable claim of new capability
 * is exactly the failure mode this project exists to prevent, and it is worse
 * coming from the agent whose reach it widens.
 */
function registerSkill(
  db: Db,
  input: {
    id?: string;
    name?: string;
    provides?: string;
    verify?: string | string[];
    runtime?: string;
    description?: string;
  }
) {
  const usage =
    'Usage: ambit record skill:<name> --provides=<capability> --verify="<read-only command>"';
  if (!input.id) return { error: usage };
  const id = input.id.startsWith(SKILL_PREFIX) ? input.id : `${SKILL_PREFIX}${input.id}`;
  const slug = id.slice(SKILL_PREFIX.length);
  if (!slug) return { error: usage };

  if (!input.verify || (Array.isArray(input.verify) && !input.verify.length)) {
    return {
      error: `${usage}\nA skill with no check is a claim, not a capability. Give a read-only command that fails when the skill stops working.`,
    };
  }
  const command = Array.isArray(input.verify)
    ? input.verify
    : String(input.verify).trim().split(/\s+/);

  const provides = input.provides
    ? input.provides.includes(':')
      ? input.provides
      : `combo:${input.provides}`
    : undefined;
  if (provides && !db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(provides)) {
    return {
      error: `No capability ${provides}. Use an id from ambit graph combos, so what the skill supplies aggregates with everything else that supplies it.`,
    };
  }

  const name = input.name || slug.replace(/[-_]/g, ' ');
  const runtime = input.runtime || process.env.AMBIT_RUNTIME || 'agent';
  const existed = db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);

  db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, kind, state, maturity_score, lifecycle)
     VALUES (?, ?, 'meta', ?, 'skill', 'provider', 'unlocked', 0.5, 'configured')
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
       updated_at = datetime('now')`
  ).run(id, name, input.description || `Registered by ${runtime}`);

  if (provides) {
    db.prepare(
      `INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description, kind)
       VALUES (?, ?, 0, 'registered skill', 'provides')`
    ).run(id, provides);
  }

  db.prepare(
    `INSERT INTO declared_checks (capability_id, command, timeout_seconds, source)
     VALUES (?, ?, 10, ?)
     ON CONFLICT(capability_id) DO UPDATE SET command = excluded.command, source = excluded.source`
  ).run(id, JSON.stringify(command), runtime);

  db.prepare(
    `INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes)
     VALUES ('skill', ?, 'registered', 1, ?)`
  ).run(id, `${runtime} registered ${name}${provides ? ` for ${provides}` : ''}`);

  // Prove it now rather than take the word for it. A registration whose own
  // check fails on the way in is the most useful moment to say so.
  const proof = verifyCheck(db, id, name, { command, timeout_seconds: 10 });
  deriveLifecycles(db);

  return {
    registered: id,
    name,
    provides,
    registered_by: runtime,
    updated: Boolean(existed),
    check: command.join(' '),
    verification: proof.status,
    detail: proof.detail,
    note:
      proof.status === 'verified'
        ? `On the map, proven. It appears in ambit status, in the next briefing, and in ambit history since as gained by ${runtime}.`
        : 'Registered, and its check does not pass — so it reads as configured-but-failing everywhere availability is decided. Fix the check or the skill.',
  };
}

/** Everything the agent registered, newest first, with what its check last said. */
function registeredSkills(db: Db) {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.lifecycle, c.updated_at, d.command, d.source,
              (SELECT to_capability FROM dependencies WHERE from_capability = c.id AND kind = 'provides' LIMIT 1) AS provides
       FROM capabilities c JOIN declared_checks d ON d.capability_id = c.id
       WHERE c.id LIKE 'skill:%' ORDER BY c.updated_at DESC`
    )
    .all<any>();
  if (!rows.length) {
    return {
      note: 'No registered skills. `ambit record skill:<name> --provides=<cap> --verify="<command>"` is how an agent puts what it wrote itself on the map.',
      skills: [],
    };
  }
  return {
    skills: rows.map(r => ({
      id: r.id,
      name: r.name,
      provides: r.provides,
      lifecycle: r.lifecycle,
      check: (JSON.parse(r.command) as string[]).join(' '),
      registered_by: r.source,
      updated: r.updated_at,
    })),
  };
}

export { SKILL_PREFIX, registerSkill, registeredSkills };
