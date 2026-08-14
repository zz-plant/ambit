import type { Db } from "./db.ts";

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
  const rows = db.prepare("SELECT id, state, kind FROM capabilities ORDER BY id").all();
  const states: Record<string, string> = {};
  const kinds: Record<string, string> = {};
  for (const r of rows) { states[r.id] = r.state; kinds[r.id] = r.kind; }
  const serialised = JSON.stringify(states);

  const last = db
    .prepare("SELECT states FROM frontier_snapshots ORDER BY taken_at DESC, id DESC LIMIT 1")
    .get();
  if (last && last.states === serialised) return 'unchanged';

  const reached = rows.filter(r => r.state !== 'locked').length;
  db.prepare("INSERT INTO frontier_snapshots (reached, total, states, kinds) VALUES (?, ?, ?, ?)")
    .run(reached, rows.length, serialised, JSON.stringify(kinds));
  return 'recorded';
}

/** The observation in effect at a point in time, or the earliest one after it. */
function frontierAt(
  db: Db,
  when?: string
): { taken_at: string; states: Record<string, string>; kinds: Record<string, string> | null } | null {
  const row = when
    ? db.prepare("SELECT taken_at, states, kinds FROM frontier_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC LIMIT 1").get(when)
      || db.prepare("SELECT taken_at, states, kinds FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get()
    : db.prepare("SELECT taken_at, states, kinds FROM frontier_snapshots ORDER BY taken_at ASC LIMIT 1").get();
  if (!row) return null;
  return {
    taken_at: row.taken_at,
    states: JSON.parse(row.states),
    kinds: row.kinds ? JSON.parse(row.kinds) : null,
  };
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

  const now = db.prepare("SELECT id, name, state, kind, category FROM capabilities ORDER BY id").all();
  const nameOf = new Map(now.map(c => [c.id, c.name]));
  const wasLocked = (id: string) => past.states[id] === 'locked';
  const isReached = (c: any) => c.state !== 'locked';

  // Newly added means absent from the observation, which the snapshot answers
  // exactly. Comparing created_at against taken_at looked equivalent and was
  // not: datetime('now') resolves to the second, so two seeds inside the same
  // second classified every addition as pre-existing.
  const addedSince = new Set(now.filter(c => past.states[c.id] === undefined).map(c => c.id));

  // Provision only, not runtime attribution: a capability contributed by a
  // runtime that already existed is not proof that something new supplied it,
  // and counting it would classify composition as acquisition.
  const providers = db
    .prepare("SELECT from_capability, to_capability FROM dependencies WHERE kind = 'provides'")
    .all();
  const provedBy = new Map<string, string[]>();
  for (const p of providers) {
    if (!provedBy.has(p.to_capability)) provedBy.set(p.to_capability, []);
    provedBy.get(p.to_capability)!.push(p.from_capability);
  }

  const gained: any[] = [];
  const emergent: any[] = [];
  const vocabulary: any[] = [];
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
    // A node the observation never saw, everything supplying which the
    // observation did see. Nothing about the system changed; Ambit started
    // naming a part of it that was already there — a new action on a contract,
    // or a capability added to the curated model. Counting those as gained
    // would report the release that introduced action nodes as forty
    // capabilities acquired on a machine where nothing happened, which is
    // exactly the dishonesty this ledger exists to avoid.
    if (addedSince.has(c.id) && proofs.length > 0 && !proofAddedSince) {
      vocabulary.push({ ...entry, kind: c.kind });
      continue;
    }
    // Reached without any of its providers being new: composition did it.
    if (!addedSince.has(c.id) && !proofAddedSince && proofs.length > 0) emergent.push(entry);
    else gained.push(entry);
  }

  const lost = now
    .filter(c => !isReached(c) && past.states[c.id] && past.states[c.id] !== 'locked')
    .map(c => ({ id: c.id, name: c.name }));

  const pastReached = Object.values(past.states).filter(v => v !== 'locked').length;
  // Counted on the same basis as `frontier_then`, so the two numbers mean the
  // same thing. Vocabulary additions are described and not counted; the total
  // including them is reported separately rather than folded in silently.
  const vocabularyIds = new Set(vocabulary.map(v => v.id));
  const reachedNow = now.filter(isReached);
  return {
    since: past.taken_at,
    frontier_then: pastReached,
    frontier_now: reachedNow.filter(c => !vocabularyIds.has(c.id)).length,
    gained,
    emergent,
    vocabulary,
    lost,
    nodes_now: reachedNow.length,
    note: emergent.length
      ? "emergent: became reachable although nothing providing them was added — composition, not acquisition"
      : undefined,
    vocabulary_note: vocabulary.length
      ? "vocabulary: Ambit started modelling these; the system did not change. Excluded from frontier_now so it stays comparable with frontier_then."
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

export { recordFrontier, frontierAt, ledgerSince, ledgerHistory };
