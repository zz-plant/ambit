import type { Db } from './db.ts';
import { usable } from './assurance.ts';
import { NON_FRONTIER_KINDS } from './ontology.ts';

// ─── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Whether a node counts toward the frontier.
 *
 * Everything did, when every kind was something the system could do or
 * something that supplied it. A credential is neither, so it is excluded — see
 * NON_FRONTIER_KINDS for why the exclusion is by kind rather than by state.
 */
const inFrontier = (kind: string | undefined) => !NON_FRONTIER_KINDS.includes(kind as any);

/**
 * One observation of the frontier: every capability's state, and its kind and
 * lifecycle where the observation recorded them. A snapshot is one, and so is
 * the live graph read into the same shape, which is what lets a step between
 * two snapshots and a step from a snapshot to now be one computation.
 */
interface Observation {
  /** When it was taken, as the ledger stores it. Null for the live graph. */
  taken_at: string | null;
  states: Record<string, string>;
  /** Null on snapshots written before kinds were recorded. */
  kinds: Record<string, string> | null;
  /** Null on snapshots written before lifecycles were recorded. */
  lifecycles: Record<string, string> | null;
  verified: number;
}

/**
 * A timestamp as the second the ledger would store it, or null when it is not
 * one. `taken_at` is written by `datetime('now')`, so a comparison against
 * `2026-09-26T10:00:00Z` as a string put every snapshot of that day on the
 * wrong side of it: a `T` sorts after the space the ledger writes.
 *
 * It has to begin with a date. SQLite also reads a bare `10:00:00` (as a time
 * in the year 2000), a bare number (as a Julian day) and `now`, and each of
 * those answered a question about some other moment without saying so.
 */
const DATED = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/;

function secondOf(db: Db, when: string): string | null {
  if (!DATED.test(when)) return null;
  return db.prepare('SELECT datetime(?) AS second').get(when)?.second ?? null;
}

/** What to say about a value that names no second. */
const notATimestamp = (stated: string) =>
  `Not a timestamp: ${stated}. A timestamp is a date, with a time and zone if wanted, such as 2026-09-26 or 2026-09-26T10:00:00Z.`;

/** A date alone, and a time alone: the two words a shell makes of an unquoted timestamp. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BARE_TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * The timestamps a person typed, with each one a shell split in two joined
 * again. `ambit history since 2026-09-26 10:00:00` arrives as two words, and
 * read apart the second became `until`.
 */
function typedTimestamps(words: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (BARE_DATE.test(words[i]) && next !== undefined && BARE_TIME.test(next)) {
      joined.push(`${words[i]} ${next}`);
      i++;
    } else joined.push(words[i]);
  }
  return joined;
}

/** The live graph, read into the shape a snapshot stores. */
function frontierNow(db: Db): Observation {
  const rows = db.prepare('SELECT id, state, kind, lifecycle FROM capabilities ORDER BY id').all();
  const states: Record<string, string> = {};
  const kinds: Record<string, string> = {};
  const lifecycles: Record<string, string> = {};
  for (const r of rows) {
    states[r.id] = r.state;
    kinds[r.id] = r.kind;
    lifecycles[r.id] = r.lifecycle || 'unknown';
  }
  const verified = rows.filter(
    r => inFrontier(r.kind) && (r.lifecycle === 'verified' || r.lifecycle === 'reliable')
  ).length;
  return { taken_at: null, states, kinds, lifecycles, verified };
}

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
 *
 * The observation records lifecycle beside state. The ledger's answer to "what
 * could this system do" is structural, and its answer to "what was that worth"
 * is evidence — a capability whose check started failing loses the second
 * without moving the first, and that is exactly a change worth observing.
 *
 * `at` dates the observation instead of the clock, and it is compared with the
 * observation in effect at that date. The hosted demo is the reason: its
 * history is a fixture, and one dated by the clock of whoever regenerated it
 * would differ on every run.
 */
function recordFrontier(db: Db, at?: string): 'recorded' | 'unchanged' {
  const stamp = at === undefined ? null : secondOf(db, at);
  if (at !== undefined && !stamp) throw new Error(`Not a timestamp: ${at}`);

  const now = frontierNow(db);
  const serialised = JSON.stringify(now.states);
  const lifecycleSerialised = JSON.stringify(now.lifecycles);

  const last = stamp
    ? db
        .prepare(
          'SELECT states, lifecycles FROM frontier_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC, id DESC LIMIT 1'
        )
        .get(stamp)
    : db
        .prepare(
          'SELECT states, lifecycles FROM frontier_snapshots ORDER BY taken_at DESC, id DESC LIMIT 1'
        )
        .get();
  if (last && last.states === serialised && last.lifecycles === lifecycleSerialised)
    return 'unchanged';

  const counted = Object.keys(now.states).filter(id => inFrontier(now.kinds?.[id]));
  const reached = counted.filter(id => now.states[id] !== 'locked').length;
  db.prepare(
    `INSERT INTO frontier_snapshots (taken_at, reached, total, verified, states, kinds, lifecycles)
     VALUES (COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?)`
  ).run(
    stamp,
    reached,
    Object.keys(now.states).length,
    now.verified,
    serialised,
    JSON.stringify(now.kinds),
    lifecycleSerialised
  );
  return 'recorded';
}

const OBSERVATION_COLUMNS = 'taken_at, states, kinds, lifecycles, verified';

function observation(row: any): Observation {
  return {
    taken_at: row.taken_at,
    states: JSON.parse(row.states),
    kinds: row.kinds ? JSON.parse(row.kinds) : null,
    lifecycles: row.lifecycles ? JSON.parse(row.lifecycles) : null,
    verified: row.verified || 0,
  };
}

type Dated = Observation & { taken_at: string };

/** The observation in effect at a second the ledger stores, or null before the first. */
function inEffectAt(db: Db, stamp: string): Dated | null {
  const row = db
    .prepare(
      `SELECT ${OBSERVATION_COLUMNS} FROM frontier_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC, id DESC LIMIT 1`
    )
    .get(stamp);
  return row ? (observation(row) as Dated) : null;
}

/**
 * The observation in effect at a point in time, or the earliest one after it.
 *
 * Both orderings break ties on `id`. `taken_at` resolves to the second, so two
 * snapshots can share one, and without the tie-break which of them answered
 * was whatever order SQLite read them in: the index happened to give the later
 * one and a table scan gives the earlier. In effect at a second means the last
 * recorded in it; the earliest means the first recorded.
 */
function frontierAt(db: Db, when?: string): Dated | null {
  const stamp = when ? secondOf(db, when) : null;
  const inEffect = stamp ? inEffectAt(db, stamp) : null;
  if (inEffect) return inEffect;
  const row = db
    .prepare(
      `SELECT ${OBSERVATION_COLUMNS} FROM frontier_snapshots ORDER BY taken_at ASC, id ASC LIMIT 1`
    )
    .get();
  return row ? (observation(row) as Dated) : null;
}

/**
 * What the comparison reads from the graph as it is today. A snapshot stores
 * neither names nor edges, so both sides of every step are named and
 * classified with today's; the timeline draws today's edges for the same
 * reason.
 */
interface LedgerContext {
  nameOf: (id: string) => string;
  provedBy: Map<string, string[]>;
}

function ledgerContext(db: Db): LedgerContext {
  const names = new Map<string, string>(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all()
      .map(c => [c.id, c.name])
  );
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
  return { nameOf: id => names.get(id) || id, provedBy };
}

/**
 * What changed between two observations of the frontier: a snapshot and a
 * later one, or a snapshot and the live graph.
 *
 * `ledgerSince` is this with the live graph on the right, and the map's
 * timeline is this between neighbouring snapshots. One computation is what
 * makes a step read the same in the terminal, over MCP and on the page.
 *
 * The entry worth the whole table is `emergent`: a capability that became
 * reached although nothing that provides it was itself added. Those are
 * composition — prerequisites satisfied by other additions — and a
 * per-component changelog cannot show them, because no single change explains
 * one.
 */
function compareFrontiers(
  db: Db,
  past: Observation,
  now: Observation,
  context: LedgerContext = ledgerContext(db)
) {
  const { nameOf, provedBy } = context;
  const ids = Object.keys(now.states);
  const kindOf = (id: string) => now.kinds?.[id];
  const isReached = (state: string | undefined) => state !== undefined && state !== 'locked';

  // Newly added means absent from the observation, which the snapshot answers
  // exactly. Comparing created_at against taken_at looked equivalent and was
  // not: datetime('now') resolves to the second, so two seeds inside the same
  // second classified every addition as pre-existing.
  const addedSince = new Set(ids.filter(id => past.states[id] === undefined));

  const gained: any[] = [];
  const emergent: any[] = [];
  const vocabulary: any[] = [];
  for (const id of ids) {
    if (!inFrontier(kindOf(id))) continue;
    const newlyReached =
      isReached(now.states[id]) && (past.states[id] === 'locked' || past.states[id] === undefined);
    if (!newlyReached) continue;
    const proofs = provedBy.get(id) || [];
    const proofAddedSince = proofs.some(p => addedSince.has(p));
    const entry = {
      id,
      name: nameOf(id),
      proved_by: proofs.map(nameOf).slice(0, 4),
    };
    // A node the observation never saw, everything supplying which the
    // observation did see. Nothing about the system changed; Ambit started
    // naming a part of it that was already there — a new action on a contract,
    // or a capability added to the curated model. Counting those as gained
    // would report the release that introduced action nodes as forty
    // capabilities acquired on a machine where nothing happened, which is
    // exactly the dishonesty this ledger exists to avoid.
    if (addedSince.has(id) && proofs.length > 0 && !proofAddedSince) {
      vocabulary.push({ ...entry, kind: kindOf(id) });
      continue;
    }
    // Reached without any of its providers being new: composition did it.
    if (!addedSince.has(id) && !proofAddedSince && proofs.length > 0) emergent.push(entry);
    else gained.push(entry);
  }

  const lost = ids
    .filter(
      id =>
        inFrontier(kindOf(id)) &&
        !isReached(now.states[id]) &&
        past.states[id] &&
        past.states[id] !== 'locked'
    )
    .map(id => ({ id, name: nameOf(id) }));

  // Still reached, but no longer usable: a declared check started failing.
  // Structural reach does not move, which is why no per-component changelog
  // sees it — the evidence column is the only thing that changed. An
  // observation with no lifecycles cannot say, so nothing is claimed.
  const diminished =
    past.lifecycles && now.lifecycles
      ? ids
          .filter(id => {
            if (!inFrontier(kindOf(id))) return false;
            const then = past.lifecycles![id];
            return (
              then && usable(then) && isReached(now.states[id]) && !usable(now.lifecycles![id])
            );
          })
          .map(id => ({
            id,
            name: nameOf(id),
            lifecycle: now.lifecycles![id],
            reason: 'verification failing',
          }))
      : [];

  // Both sides exclude the same kinds. A snapshot taken before credentials
  // existed has none to exclude and `kinds` may be null altogether, so an old
  // observation counts exactly as it always did — which is what keeps
  // `frontier_then` and `frontier_now` the same measurement.
  const pastReached = Object.entries(past.states).filter(
    ([id, v]) => v !== 'locked' && inFrontier(past.kinds?.[id])
  ).length;
  // Counted on the same basis as `frontier_then`, so the two numbers mean the
  // same thing. Vocabulary additions are described and not counted; the total
  // including them is reported separately rather than folded in silently.
  const vocabularyIds = new Set(vocabulary.map(v => v.id));
  const reachedNow = ids.filter(id => inFrontier(kindOf(id)) && isReached(now.states[id]));
  const frontierNowCount = reachedNow.filter(id => !vocabularyIds.has(id)).length;
  return {
    moved: movedSentence({
      before: pastReached,
      after: frontierNowCount,
      emergent: emergent.length,
      failing: diminished.length,
      // An observation written before lifecycles were recorded has a verified
      // count of zero by default, which is not the same as none proven.
      verified:
        past.lifecycles && now.lifecycles
          ? { before: past.verified, after: now.verified }
          : undefined,
    }),
    frontier_then: pastReached,
    frontier_now: frontierNowCount,
    // Demonstrated reliability as a trend: a capability whose check starts
    // failing shows up here as a count leaving `verified_now`, and in
    // `diminished` by name.
    verified_then: past.verified,
    verified_now: now.verified,
    gained,
    emergent,
    vocabulary,
    lost,
    diminished: diminished.length ? diminished : undefined,
    nodes_now: reachedNow.length,
    note: emergent.length
      ? 'emergent: became reachable although nothing providing them was added — composition, not acquisition'
      : undefined,
    vocabulary_note: vocabulary.length
      ? 'vocabulary: Ambit started modelling these; the system did not change. Excluded from frontier_now so it stays comparable with frontier_then.'
      : undefined,
  };
}

/**
 * A step in the one sentence every surface prints: how far reach moved, what
 * emerged, how many were proven, and what went failing. The timeline puts a
 * date in front of it and the terminal prints it beside `since`, so it carries
 * none of its own.
 */
function movedSentence(step: {
  before: number | null;
  after: number;
  emergent?: number;
  failing?: number;
  verified?: { before: number; after: number };
}): string {
  const parts = [
    step.before === null
      ? `first observation, reached ${step.after}`
      : step.before === step.after
        ? `reached ${step.after}`
        : `reached ${step.before} to ${step.after}`,
  ];
  if (step.emergent) parts.push(`${step.emergent} emergent`);
  if (step.verified && step.verified.before !== step.verified.after) {
    parts.push(`verified ${step.verified.before} to ${step.verified.after}`);
  }
  if (step.failing) parts.push(`${step.failing} went failing`);
  return parts.join(', ');
}

/**
 * What changed in the reachable frontier since a past observation: up to the
 * live graph, or up to a later observation when `until` names one.
 *
 * `when` may start from the earliest observation after it. `until` may not:
 * standing in a later observation for it answers about a moment nobody named,
 * so before the first observation it is an error that says where the ledger
 * begins.
 */
function ledgerSince(db: Db, when?: string, until?: string) {
  for (const stated of [when, until]) {
    if (stated && !secondOf(db, stated)) return { error: notATimestamp(stated) };
  }
  const past = frontierAt(db, when);
  if (!past) return { error: 'No frontier recorded yet. Run seed at least twice.' };
  const now = until ? inEffectAt(db, secondOf(db, until)!) : frontierNow(db);
  if (!now) {
    return {
      error: `Nothing was observed at or before ${until}. The earliest observation is ${frontierAt(db)!.taken_at}.`,
    };
  }
  if (now.taken_at !== null && now.taken_at < past.taken_at) {
    return {
      error: `The observation in effect at ${until} (${now.taken_at}) is earlier than the one at ${when ?? 'the start'} (${past.taken_at}).`,
    };
  }
  return {
    since: past.taken_at,
    until: now.taken_at ?? undefined,
    ...compareFrontiers(db, past, now),
  };
}

/**
 * The ledger as a series: one observation per second a snapshot was taken,
 * oldest first, each with what moved since the one before.
 *
 * A second is all a timestamp names, so snapshots that share one collapse to
 * the last recorded in it, the same one `frontierAt` answers for that second.
 * The last entry says what moved between the newest snapshot and the live
 * graph, which can differ: `verify` changes lifecycles and records nothing.
 */
function frontierSeries(db: Db): {
  ticks: (Observation & { taken_at: string; moved: string })[];
  movedSinceLast: string | null;
} {
  const observations = db
    .prepare(
      `SELECT ${OBSERVATION_COLUMNS} FROM frontier_snapshots
       WHERE id IN (SELECT MAX(id) FROM frontier_snapshots GROUP BY taken_at)
       ORDER BY taken_at ASC, id ASC`
    )
    .all()
    .map(observation) as (Observation & { taken_at: string })[];
  if (!observations.length) return { ticks: [], movedSinceLast: null };

  const context = ledgerContext(db);
  const ticks = observations.map((o, i) => ({
    ...o,
    moved:
      i === 0
        ? movedSentence({
            before: null,
            after: Object.entries(o.states).filter(
              ([id, v]) => v !== 'locked' && inFrontier(o.kinds?.[id])
            ).length,
          })
        : compareFrontiers(db, observations[i - 1], o, context).moved,
  }));

  // Unchanged by the test `recordFrontier` applies: the same states and the
  // same lifecycles. Anything else is a step the ledger has not recorded yet.
  const last = observations[observations.length - 1];
  const live = frontierNow(db);
  const unchanged =
    JSON.stringify(last.states) === JSON.stringify(live.states) &&
    JSON.stringify(last.lifecycles) === JSON.stringify(live.lifecycles);
  return {
    ticks,
    movedSinceLast: unchanged ? null : compareFrontiers(db, last, live, context).moved,
  };
}

/** Every recorded observation, oldest first. */
function ledgerHistory(db: Db) {
  return db
    .prepare(
      'SELECT taken_at, reached, total, verified FROM frontier_snapshots ORDER BY taken_at ASC, id ASC'
    )
    .all()
    .map((r: any) => ({
      taken_at: r.taken_at,
      reached: r.reached,
      total: r.total,
      verified: r.verified || 0,
    }));
}

export {
  recordFrontier,
  frontierAt,
  frontierNow,
  frontierSeries,
  compareFrontiers,
  ledgerSince,
  ledgerHistory,
  typedTimestamps,
  type Observation,
};
