/**
 * Authority that widens on evidence, and narrows on one failure. Roadmap §12.6.
 *
 * §4 records whether a capability works. §9 records what it is permitted to do.
 * Nothing joined them, so a capability could pass its check fifty times and
 * stay behind a confirmation prompt for ever — the person doing the confirming
 * had no way to say *stop asking me once this has proved itself*, short of
 * editing the grant by hand and hoping they remembered why.
 *
 * The asymmetry is the design. Promotion needs a person: they set the
 * threshold, once, in advance, and that act is the grant of authority — the
 * evidence only decides when it takes effect. Demotion needs nobody: a single
 * failing check after promotion puts the grant back where it was, because
 * evidence that stopped holding should not need a meeting to act on.
 *
 * Never offered for a forbidden grant. A threshold on `forbidden` would be a
 * mechanism for talking a system into something it was told not to do.
 */
import type { Db } from '../db.ts';
import type { AuthorityRow } from '../rows.ts';
import { GATE_KINDS } from '../vocabulary.ts';

/** "three passing checks and two successful uses", or whichever half exists. */
function describeEvidence(e: { passes: number; uses: number }): string {
  const parts = [
    e.passes ? `${e.passes} passing ${e.passes === 1 ? 'check' : 'checks'}` : null,
    e.uses ? `${e.uses} successful ${e.uses === 1 ? 'use' : 'uses'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'no evidence';
}

/** How a window is spelled on the command line: `30d`, `12h`, `2w`, or days. */
function windowDays(spec?: string | number): number | undefined {
  if (spec == null || spec === '') return undefined;
  const s = String(spec).trim();
  const m = /^(\d+(?:\.\d+)?)\s*([dhw])?$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  if (unit === 'h') return n / 24;
  if (unit === 'w') return n * 7;
  return n;
}

/**
 * Records the threshold that would widen a grant.
 *
 * Refuses in this order: an unknown grant, a forbidden one, a grant that is
 * already autonomous, a threshold below two, and a person who is not in the
 * graph. The last is the same rule approval follows — an expansion of what runs
 * unattended has to be traceable to someone accountable.
 */
function setPromotion(
  db: Db,
  input: {
    capability?: string;
    action?: string;
    after?: number | string;
    window?: string | number;
    person?: string;
    scope?: string;
  }
) {
  const usage =
    'Usage: ambit authority promote <capability> [action] --after=N [--window=30d] [--scope=<target>] --by=<person>';
  if (!input.capability) return { error: usage };
  const capability = input.capability.includes(':')
    ? input.capability
    : `combo:${input.capability}`;
  const action = input.action || 'execute';
  const after = Number(input.after);
  if (!Number.isFinite(after) || after < 2) {
    return { error: `${usage}\n--after must be at least 2 — one passing run is not a pattern.` };
  }
  const days = windowDays(input.window ?? '30d') ?? 30;

  const humanId = input.person
    ? input.person.startsWith('human:')
      ? input.person
      : `human:${input.person}`
    : null;
  if (!humanId) return { error: `${usage}\nName the person granting it: --by=<person>` };
  const person = db
    .prepare("SELECT id, name FROM capabilities WHERE id = ? AND category = 'human'")
    .get(humanId);
  if (!person) {
    return {
      error: `${humanId} is not a person in the graph. Widening what runs unattended has to come from someone accountable — declare them in the actors block first.`,
    };
  }

  const grants = db
    .prepare(
      'SELECT id, mode, holder, scope, source FROM authority WHERE capability_id = ? AND action = ?'
    )
    .all<Pick<AuthorityRow, 'id' | 'mode' | 'holder' | 'scope' | 'source'>>(capability, action);
  if (!grants.length) {
    return {
      error: `No grant for ${capability} / ${action}. ambit authority ${input.capability} lists what it confers.`,
    };
  }
  const forbidden = grants.filter(g => g.mode === 'forbidden');
  if (forbidden.length) {
    return {
      error: `${capability} / ${action} is forbidden. A forbidden grant is not a slow yes — evidence does not open it.`,
    };
  }
  const confirmGrants = grants.filter(g => g.mode === 'confirm');
  if (!confirmGrants.length && !input.scope) {
    return { note: `${capability} / ${action} already runs unattended. Nothing to promote.` };
  }

  // A scope is the trade: a smaller blast radius bought with unattended
  // operation. The standing grant is left exactly as it is and a new one is
  // written for the target, so what is being widened is legible as its own row
  // rather than hidden as an edit to the general case.
  if (input.scope) {
    const existing = grants.find(g => g.scope === input.scope);
    if (existing) {
      db.prepare(
        'UPDATE authority SET promote_after = ?, promote_window_days = ?, promote_set_by = ? WHERE id = ?'
      ).run(after, days, humanId, existing.id);
    } else {
      db.prepare(
        `INSERT INTO authority (capability_id, action, mode, holder, scope, source, note,
                                promote_after, promote_window_days, promote_set_by)
         VALUES (?, ?, 'confirm', '', ?, 'promotion', ?, ?, ?, ?)`
      ).run(
        capability,
        action,
        input.scope,
        `scoped grant created by ${humanId} to be earned on evidence`,
        after,
        days,
        humanId
      );
    }
  } else {
    for (const g of confirmGrants) {
      db.prepare(
        'UPDATE authority SET promote_after = ?, promote_window_days = ?, promote_set_by = ? WHERE id = ?'
      ).run(after, days, humanId, g.id);
    }
  }
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, object) VALUES ('authority', ?, 'promotion-set', 1, ?, ?)"
  ).run(
    capability,
    `${action}: ${after} within ${days}d${input.scope ? ` on ${input.scope}` : ''}, set by ${humanId}`,
    input.scope ?? null
  );

  const progress = evidenceCount(db, capability, days, input.scope);
  return {
    capability,
    action,
    scope: input.scope,
    threshold: `${after} passing checks or successful uses within ${days} days${input.scope ? `, on ${input.scope} only` : ''}`,
    set_by: person.name,
    grants_updated: input.scope ? 1 : confirmGrants.length,
    evidence_so_far: progress.evidence,
    note:
      progress.evidence >= after
        ? 'The threshold is already met. It takes effect on the next ambit verify or ambit briefing.'
        : `${after - progress.evidence} more. A passing check or a successful use both count; ambit verify ${input.capability} is the fast way.`,
  };
}

/**
 * What a capability has proved inside the window, and how.
 *
 * Two kinds of evidence, counted together and reported apart. A passing check
 * is a self-test the agent triggers; a successful use is the capability doing
 * the actual job inside a run that achieved its outcome. The second is the
 * stronger claim and accumulates without anyone asking for it, which is why a
 * threshold counts both — an environment where the work succeeds every day
 * should not have to run synthetic checks to earn the trust it has already
 * demonstrated.
 *
 * Only checks count as failures. A run that failed is not evidence that this
 * capability failed: attributing a whole run's outcome to each capability it
 * touched would demote everything a bad afternoon went near.
 *
 * A scope narrows both sides to the object in question, which is what makes
 * *unattended on staging* something the evidence from staging can earn.
 */
function evidenceCount(db: Db, capability: string, days: number, scope?: string) {
  const window = `-${days} days`;
  const checks = db
    .prepare(
      `SELECT
         SUM(CASE WHEN action = 'verified' THEN 1 ELSE 0 END) AS passes,
         SUM(CASE WHEN action = 'failed' THEN 1 ELSE 0 END) AS failures,
         MAX(timestamp) AS last_seen
       FROM session_learning
       WHERE capability_id = ? AND action IN ('verified','failed')
         AND timestamp >= datetime('now', ?)
         AND (? IS NULL OR object = ? OR (object IS NOT NULL AND object LIKE ? || '%'))`
    )
    .get(capability, window, scope ?? null, scope ?? null, scope ?? null);

  let uses = 0;
  let lastUse: string | null = null;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(u.used_at) AS last_seen
         FROM capability_use u JOIN work_runs r ON r.id = u.run_id
         WHERE u.capability_id = ? AND u.used_at >= datetime('now', ?)
           AND r.outcome IN ('success', 'succeeded', 'achieved', 'ok')`
      )
      .get(capability, window);
    uses = row?.n ?? 0;
    lastUse = row?.last_seen ?? null;
  } catch {
    /* no work ledger yet */
  }
  // Use is recorded per capability and carries no object, so it cannot speak
  // to a scoped threshold. Counting it there would let work done anywhere earn
  // authority somewhere specific.
  if (scope) uses = 0;

  const passes = checks?.passes ?? 0;
  return {
    passes,
    uses,
    evidence: passes + uses,
    failures: checks?.failures ?? 0,
    last_seen: [checks?.last_seen, lastUse].filter(Boolean).sort().pop() ?? null,
  };
}

/**
 * Applies every threshold whose evidence now supports it, and reverses every
 * promotion whose evidence stopped holding.
 *
 * Called wherever evidence changes or is read — after a verification, and when
 * the briefing is composed — so a threshold takes effect without anyone running
 * a command named "promote". A promotion that has to be triggered by hand is
 * the confirmation prompt it was meant to replace.
 */
function evaluatePromotions(db: Db) {
  const promoted: Array<Record<string, unknown>> = [];
  const demoted: Array<Record<string, unknown>> = [];

  const pending = db
    .prepare(
      `SELECT id, capability_id, action, scope, mode, promote_after, promote_window_days,
              promote_set_by, promoted_at, promoted_on_evidence
       FROM authority WHERE promote_after IS NOT NULL`
    )
    .all<any>();

  for (const g of pending) {
    const days = g.promote_window_days || 30;
    const name =
      db.prepare('SELECT name FROM capabilities WHERE id = ?').get(g.capability_id)?.name ||
      g.capability_id;

    // Promoted already: the only question is whether it still holds. A single
    // failing check after the promotion takes it back, with no person needed.
    if (g.promoted_at) {
      // Against the row id, not the timestamp. `datetime('now')` resolves to
      // the second, so a check that fails in the same second as the promotion
      // compares as "not after it" and the demotion silently never happens —
      // the same trap the frontier ledger fell into when it compared
      // `created_at > taken_at`.
      let watermark = 0;
      try {
        watermark = JSON.parse(g.promoted_on_evidence || '{}').after_id ?? 0;
      } catch {
        watermark = 0;
      }
      const since = watermark
        ? db
            .prepare(
              `SELECT COUNT(*) AS n, MAX(timestamp) AS at FROM session_learning
               WHERE capability_id = ? AND action = 'failed' AND id > ?`
            )
            .get(g.capability_id, watermark)
        : db
            .prepare(
              `SELECT COUNT(*) AS n, MAX(timestamp) AS at FROM session_learning
               WHERE capability_id = ? AND action = 'failed' AND timestamp > ?`
            )
            .get(g.capability_id, g.promoted_at);
      if (since?.n) {
        db.prepare(
          "UPDATE authority SET mode = 'confirm', promoted_at = NULL, promoted_on_evidence = NULL WHERE id = ?"
        ).run(g.id);
        db.prepare(
          "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('authority', ?, 'demoted', 0, ?)"
        ).run(g.capability_id, `${g.action}: a check failed at ${since.at} — back to confirm`);
        demoted.push({
          capability: name,
          id: g.capability_id,
          action: g.action,
          reason: `a check failed at ${since.at}`,
          now: 'confirm',
        });
      }
      continue;
    }

    if (g.mode !== 'confirm') continue;
    const evidence = evidenceCount(db, g.capability_id, days, g.scope || undefined);
    // Failures inside the window disqualify: the threshold asks for a run of
    // clean evidence, not for enough passes to outvote the failures.
    if (evidence.failures > 0) continue;
    if (evidence.evidence < g.promote_after) continue;

    const runs = db
      .prepare(
        `SELECT timestamp FROM session_learning
         WHERE capability_id = ? AND action = 'verified' AND timestamp >= datetime('now', ?)
         ORDER BY timestamp DESC LIMIT 20`
      )
      .all(g.capability_id, `-${days} days`)
      .map((r: any) => r.timestamp);

    // The watermark: everything recorded up to this point is what earned the
    // promotion, so anything after it is what could cost it.
    const watermark =
      db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM session_learning').get()?.id ?? 0;
    db.prepare(
      "UPDATE authority SET mode = 'autonomous', promoted_at = datetime('now'), promoted_on_evidence = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        passes: evidence.passes,
        uses: evidence.uses,
        window_days: days,
        scope: g.scope || undefined,
        runs,
        after_id: watermark,
      }),
      g.id
    );
    db.prepare(
      "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('authority', ?, 'promoted', 1, ?)"
    ).run(
      g.capability_id,
      `${g.action}: ${describeEvidence(evidence)} in ${days}d — threshold set by ${g.promote_set_by}`
    );
    promoted.push({
      capability: name,
      id: g.capability_id,
      action: g.action,
      scope: g.scope || undefined,
      now: 'autonomous',
      on_evidence: `${describeEvidence(evidence)} in ${days} days`,
      threshold_set_by: g.promote_set_by,
      runs: runs.slice(0, 5),
    });
  }

  return { promoted, demoted };
}

/**
 * Every threshold, what it is waiting for, and what it has already widened.
 *
 * Read-only beyond the evaluation it triggers: asking what authority stands is
 * exactly the moment the answer should be current.
 */
function promotionReport(db: Db) {
  const changes = evaluatePromotions(db);
  const suggested = suggestPromotions(db);
  const rows = db
    .prepare(
      `SELECT a.capability_id, a.action, a.mode, a.promote_after, a.promote_window_days,
              a.promote_set_by, a.promoted_at, a.promoted_on_evidence, c.name
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       WHERE a.promote_after IS NOT NULL ORDER BY c.name, a.action`
    )
    .all<any>();
  if (!rows.length) {
    return {
      note: suggested.length
        ? 'No thresholds set, and there are grants that have earned one. `ambit authority promote <cap> <action> --after=N --by=<person>` is how a person says "stop asking me once this has proved itself".'
        : 'No promotion thresholds set. `ambit authority promote <cap> <action> --after=N --by=<person>` is how a person says "stop asking me once this has proved itself".',
      worth_promoting: suggested.length ? suggested : undefined,
      ...changes,
    };
  }
  return {
    ...changes,
    worth_promoting: suggested.length ? suggested : undefined,
    thresholds: rows.map(r => {
      const days = r.promote_window_days || 30;
      const e = evidenceCount(db, r.capability_id, days, r.scope || undefined);
      return {
        capability: r.name,
        action: r.action,
        scope: r.scope || undefined,
        mode: r.mode,
        threshold: `${r.promote_after} in ${days}d`,
        evidence: `${describeEvidence(e)}${e.failures ? `, ${e.failures} failing` : ''}`,
        status: r.promoted_at
          ? `unattended since ${r.promoted_at}`
          : e.failures
            ? 'held — a check is failing inside the window'
            : `${Math.max(0, r.promote_after - e.evidence)} more passing checks or successful uses`,
        set_by: r.promote_set_by,
      };
    }),
  };
}

/**
 * Grants that have earned a threshold nobody has set.
 *
 * The mechanism for widening authority on evidence existed and still required a
 * person to think of using it — which means the interruption a threshold would
 * end is exactly what stops anyone noticing it could. So the graph says it out
 * loud: this grant has been confirmed by hand repeatedly, every check has
 * passed, and here is the command that ends the asking.
 *
 * It suggests and never acts. Setting a threshold is the person's decision, and
 * an agent that could set its own would be granting itself authority through a
 * side door.
 */
function suggestPromotions(db: Db, windowDaysLookback = 30) {
  let asked: Array<{ capability_id: string; times: number }> = [];
  try {
    asked = db
      .prepare(
        `SELECT capability_id, COUNT(*) AS times FROM human_intervention
         WHERE kind IN (${GATE_KINDS.map(k => `'${k}'`).join(',')})
           AND capability_id IS NOT NULL
           AND started_at >= datetime('now', ?)
         GROUP BY capability_id HAVING times >= 3 ORDER BY times DESC LIMIT 10`
      )
      .all<{ capability_id: string; times: number }>(`-${windowDaysLookback} days`);
  } catch {
    return [];
  }
  if (!asked.length) return [];

  const out: Array<Record<string, unknown>> = [];
  for (const a of asked) {
    const grants = db
      .prepare(
        `SELECT id, action, mode, scope, promote_after FROM authority
         WHERE capability_id = ? AND mode = 'confirm' AND promote_after IS NULL`
      )
      .all<any>(a.capability_id);
    if (!grants.length) continue;
    const e = evidenceCount(db, a.capability_id, windowDaysLookback);
    if (e.failures > 0) continue;
    if (e.evidence < 2) continue;
    const name =
      db.prepare('SELECT name FROM capabilities WHERE id = ?').get(a.capability_id)?.name ||
      a.capability_id;
    const short = a.capability_id.replace('combo:', '');
    out.push({
      capability: name,
      id: a.capability_id,
      action: grants[0].action,
      asked_by_hand: a.times,
      evidence: describeEvidence(e),
      why: `You have been asked ${a.times} times in ${windowDaysLookback} days and nothing has failed.`,
      set_it: `ambit authority promote ${short} ${grants[0].action} --after=${Math.max(3, Math.min(a.times, 10))} --by=<person>`,
      or_narrow_it: `add --scope=<target> to buy the same thing for one target only`,
    });
  }
  return out;
}

/**
 * Declares a target as a place where acting does not matter.
 *
 * The cheapest evidence is evidence gathered where a mistake costs nothing, and
 * nothing in the model let a person say where that is. A sandbox relaxes
 * confirmation inside itself and never touches a refusal: what was forbidden
 * stays forbidden there, because a practice ground that could rehearse a
 * forbidden action would be a way round the refusal rather than a way to earn
 * past it.
 */
function declareSandbox(db: Db, target?: string, person?: string, note?: string) {
  const usage = 'Usage: ambit authority sandbox <target> --by=<person> ["what it is"]';
  if (!target) {
    const rows = db.prepare('SELECT target, declared_by, note, created_at FROM sandboxes').all();
    return rows.length
      ? { sandboxes: rows }
      : {
          note: `No sandbox declared. ${usage} — somewhere an agent can act unattended and accumulate the evidence a threshold needs.`,
        };
  }
  const humanId = person ? (person.startsWith('human:') ? person : `human:${person}`) : null;
  if (!humanId) return { error: `${usage}\nName the person declaring it: --by=<person>` };
  if (
    !db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ? AND category = 'human'").get(humanId)
  ) {
    return {
      error: `${humanId} is not a person in the graph. A sandbox widens what runs unattended inside it, so it has to come from someone accountable.`,
    };
  }
  db.prepare(
    `INSERT INTO sandboxes (target, declared_by, note) VALUES (?, ?, ?)
     ON CONFLICT(target) DO UPDATE SET declared_by = excluded.declared_by, note = excluded.note`
  ).run(target, humanId, note ?? null);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, object) VALUES ('authority', ?, 'sandbox-declared', 1, ?, ?)"
  ).run(humanId, `${target} declared a sandbox`, target);
  return {
    sandbox: target,
    declared_by: humanId,
    covers: `${target} and anything under it`,
    effect:
      'Actions that would ask for confirmation run unattended here. Anything forbidden stays forbidden — a sandbox is somewhere to practise, not a way round a refusal.',
    next: `Evidence gathered here earns a scoped grant: ambit authority promote <cap> <action> --scope=${target} --after=N --by=${humanId.replace('human:', '')}`,
  };
}

/** Withdraws a sandbox declaration. */
function removeSandbox(db: Db, target?: string) {
  if (!target) return { error: 'Usage: ambit authority sandbox remove <target>' };
  const existed = db.prepare('SELECT target FROM sandboxes WHERE target = ?').get(target);
  if (!existed) return { error: `${target} is not a declared sandbox.` };
  db.prepare('DELETE FROM sandboxes WHERE target = ?').run(target);
  return { removed: target, note: 'Actions there ask for confirmation again.' };
}

export {
  setPromotion,
  evaluatePromotions,
  promotionReport,
  suggestPromotions,
  declareSandbox,
  removeSandbox,
  evidenceCount,
  describeEvidence,
  windowDays,
};
