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
  }
) {
  const usage =
    'Usage: ambit authority promote <capability> [action] --after=N [--window=30d] --by=<person>';
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
  if (!confirmGrants.length) {
    return { note: `${capability} / ${action} already runs unattended. Nothing to promote.` };
  }

  for (const g of confirmGrants) {
    db.prepare(
      'UPDATE authority SET promote_after = ?, promote_window_days = ?, promote_set_by = ? WHERE id = ?'
    ).run(after, days, humanId, g.id);
  }
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('authority', ?, 'promotion-set', 1, ?)"
  ).run(capability, `${action}: ${after} passing checks within ${days}d, set by ${humanId}`);

  const progress = evidenceCount(db, capability, days);
  return {
    capability,
    action,
    threshold: `${after} passing checks within ${days} days`,
    set_by: person.name,
    grants_updated: confirmGrants.length,
    evidence_so_far: progress.passes,
    note:
      progress.passes >= after
        ? 'The threshold is already met. It takes effect on the next ambit verify or ambit briefing.'
        : `${after - progress.passes} more passing ${after - progress.passes === 1 ? 'check' : 'checks'}. Run ambit verify ${input.capability} to accumulate ${after - progress.passes === 1 ? 'it' : 'them'}.`,
  };
}

/** Passing and failing checks for a capability inside the window. */
function evidenceCount(db: Db, capability: string, days: number) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN action = 'verified' THEN 1 ELSE 0 END) AS passes,
         SUM(CASE WHEN action = 'failed' THEN 1 ELSE 0 END) AS failures,
         MAX(timestamp) AS last_seen
       FROM session_learning
       WHERE capability_id = ? AND action IN ('verified','failed')
         AND timestamp >= datetime('now', ?)`
    )
    .get(capability, `-${days} days`);
  return {
    passes: row?.passes ?? 0,
    failures: row?.failures ?? 0,
    last_seen: row?.last_seen ?? null,
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
      `SELECT id, capability_id, action, mode, promote_after, promote_window_days,
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
    const evidence = evidenceCount(db, g.capability_id, days);
    // Failures inside the window disqualify: the threshold asks for a run of
    // passing checks, not for enough passes to outvote the failures.
    if (evidence.failures > 0) continue;
    if (evidence.passes < g.promote_after) continue;

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
      JSON.stringify({ passes: evidence.passes, window_days: days, runs, after_id: watermark }),
      g.id
    );
    db.prepare(
      "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('authority', ?, 'promoted', 1, ?)"
    ).run(
      g.capability_id,
      `${g.action}: ${evidence.passes} passing checks in ${days}d — threshold set by ${g.promote_set_by}`
    );
    promoted.push({
      capability: name,
      id: g.capability_id,
      action: g.action,
      now: 'autonomous',
      on_evidence: `${evidence.passes} passing checks in ${days} days`,
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
      note: 'No promotion thresholds set. `ambit authority promote <cap> <action> --after=N --by=<person>` is how a person says "stop asking me once this has proved itself".',
      ...changes,
    };
  }
  return {
    ...changes,
    thresholds: rows.map(r => {
      const days = r.promote_window_days || 30;
      const e = evidenceCount(db, r.capability_id, days);
      return {
        capability: r.name,
        action: r.action,
        mode: r.mode,
        threshold: `${r.promote_after} in ${days}d`,
        evidence: `${e.passes} passing${e.failures ? `, ${e.failures} failing` : ''}`,
        status: r.promoted_at
          ? `unattended since ${r.promoted_at}`
          : e.failures
            ? 'held — a check is failing inside the window'
            : `${Math.max(0, r.promote_after - e.passes)} more passing ${Math.max(0, r.promote_after - e.passes) === 1 ? 'check' : 'checks'}`,
        set_by: r.promote_set_by,
      };
    }),
  };
}

export { setPromotion, evaluatePromotions, promotionReport, evidenceCount, windowDays };
