/**
 * The record of a delegation narrowing itself, in the shared record shape.
 *
 * Ambit holds two steps of the loop an institution runs when it delegates
 * consequential work to machines: what the assembled system can do, and which
 * of that has been delegated. STD-07, the Revisable Delegation Record
 * (https://ethotechnics.org/standards/std-07-revisable-delegation-record), is
 * the shape those two steps are written in so that a separate system can read
 * them. This module writes them.
 *
 * The division of labour matters. `canExecute` narrows a grant whose
 * foundation has stopped holding, and it does that with no help from this file
 * — a gate that only worked once a recorder had run would be advisory again.
 * What this file adds is the account: which capability failed, which grant
 * rested on it, and what the grant became. The gate enforces; the record
 * explains, afterwards, to whoever asks.
 *
 * Append-only, and hashed the way STD-07 §5 says: sha256 over the record
 * without its integrity block, keys sorted recursively, no insignificant
 * whitespace. Each record carries the hash of the one before it, so a missing
 * or reordered row is detectable.
 *
 * What is deliberately not emitted: `action` and `outcome`. Ambit ships a
 * simulated environment adapter, so an action record from here would attest to
 * something happening in a fixture. The manifest says so rather than declaring
 * a conformance level the records do not earn.
 */
import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { brokenFoundations } from './assure/decide.ts';

export const RECORD_SCHEMA_VERSION = '0.1.0';
export const RECORD_STANDARD_URL =
  'https://ethotechnics.org/standards/std-07-revisable-delegation-record';
export const RECORD_SCHEMA_URL =
  'https://ethotechnics.org/api/schema/revisable-delegation-record.schema.json';

/** The kinds Ambit emits. The other four belong to systems that hold those steps. */
export const EMITTED_KINDS = [
  'capability',
  'authorization',
  'discrepancy',
  'revision',
  'objection',
] as const;

export type DelegationRecord = {
  schema_version: string;
  record_id: string;
  kind: (typeof EMITTED_KINDS)[number];
  system: { id: 'ambit'; version?: string; origin?: string };
  actor: { id: string; kind: 'human' | 'model' | 'service' | 'institution'; on_behalf_of?: string };
  subject: string;
  summary: string;
  time: { as_of: string; recorded_at: string; valid_until?: string };
  content: Record<string, unknown>;
  depends_on?: string[];
  invalidated_by?: Array<{ condition: string; check?: string; clock?: string }>;
  authority?: { authorization_record?: string; clauses?: string[] };
  supersedes?: string;
  visibility: 'public' | 'internal' | 'private';
  contest?: { standing: string; channel?: string; reversal_clock?: string };
  integrity?: { algorithm: 'sha256'; hash: string; prior_hash?: string };
};

/**
 * Ambit's lifecycle vocabulary mapped onto the four states STD-07 defines.
 *
 * Ambit distinguishes seven; the record shape distinguishes four, because a
 * consumer only needs to know whether it may be relied on. `degraded` maps to
 * broken rather than to configured: the standard's `verified` means a check
 * passed, and a degraded capability's recent checks did not.
 */
export function recordStateFor(
  lifecycle?: string
): 'absent' | 'configured' | 'verified' | 'broken' {
  if (lifecycle === 'verified' || lifecycle === 'reliable') return 'verified';
  if (lifecycle === 'degraded' || lifecycle === 'broken') return 'broken';
  if (lifecycle === 'configured' || lifecycle === 'detected') return 'configured';
  return 'absent';
}

/** Ambit's three modes under the names the record shape uses. */
export function recordModeFor(mode?: string): 'unattended' | 'confirm' | 'forbidden' {
  if (mode === 'autonomous') return 'unattended';
  if (mode === 'forbidden') return 'forbidden';
  return 'confirm';
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)])
    );
  }
  return value;
}

/** STD-07 §5.1: the record without its integrity block, keys sorted, no whitespace. */
export function canonicalize(record: DelegationRecord): string {
  const rest: Record<string, unknown> = { ...record };
  delete rest.integrity;
  return JSON.stringify(sortDeep(rest));
}

export function hashRecord(record: DelegationRecord): string {
  return createHash('sha256').update(canonicalize(record), 'utf8').digest('hex');
}

/** Whether a stored chain still hashes to what it says it does. */
export function verifyChain(db: Db): {
  records: number;
  ok: boolean;
  broken_at?: string;
  reason?: string;
} {
  const rows = db
    .prepare('SELECT record_id, body, hash, prior_hash FROM delegation_records ORDER BY seq')
    .all<{ record_id: string; body: string; hash: string; prior_hash: string | null }>();
  let previous: string | null = null;
  for (const row of rows) {
    const record = JSON.parse(row.body) as DelegationRecord;
    if (hashRecord(record) !== row.hash) {
      return {
        records: rows.length,
        ok: false,
        broken_at: row.record_id,
        reason: 'content changed',
      };
    }
    if ((row.prior_hash ?? null) !== previous) {
      return { records: rows.length, ok: false, broken_at: row.record_id, reason: 'chain broken' };
    }
    previous = row.hash;
  }
  return { records: rows.length, ok: true };
}

/** Appends one record, chained to the last. Returns null if the id already exists. */
function append(db: Db, record: DelegationRecord): DelegationRecord | null {
  const exists = db
    .prepare('SELECT 1 AS present FROM delegation_records WHERE record_id = ?')
    .get(record.record_id);
  if (exists) return null;
  const prior =
    db.prepare('SELECT hash FROM delegation_records ORDER BY seq DESC LIMIT 1').get<{
      hash: string;
    }>()?.hash ?? null;
  const hash = hashRecord(record);
  const sealed: DelegationRecord = {
    ...record,
    integrity: { algorithm: 'sha256', hash, ...(prior ? { prior_hash: prior } : {}) },
  };
  db.prepare(
    `INSERT INTO delegation_records (record_id, kind, subject, recorded_at, body, hash, prior_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.record_id,
    record.kind,
    record.subject,
    record.time.recorded_at,
    JSON.stringify(sealed),
    hash,
    prior
  );
  return sealed;
}

/**
 * SQLite's `datetime('now')` in the format the record shape requires.
 *
 * SQLite writes `2026-09-06 20:35:26` — UTC, space-separated, no zone — and
 * STD-07 asks for ISO 8601. Emitting the raw column produced records that
 * every field of matched the schema and that the published validator rejected,
 * which is the kind of defect only a consumer finds. Anything already carrying
 * a `T` is passed through, so an ISO string stays one.
 */
export function isoFrom(stamp: string | null | undefined, fallback: string): string {
  if (!stamp) return fallback;
  if (stamp.includes('T')) return stamp;
  const [date, time] = stamp.trim().split(' ');
  if (!date || !time) return fallback;
  return `${date}T${time}${time.includes('.') ? '' : '.000'}Z`;
}

/** The evidence row that put a capability where it is, so a recurrence is a new record. */
function latestFailure(db: Db, capabilityId: string): { id: number; at: string } | null {
  return (
    db
      .prepare(
        `SELECT id, timestamp AS at FROM session_learning
         WHERE capability_id = ? AND action = 'failed' ORDER BY id DESC LIMIT 1`
      )
      .get<{ id: number; at: string }>(capabilityId) ?? null
  );
}

/**
 * Who may contest what, and how long an answer has.
 *
 * Two standings, because the two claims are contested differently. A grant or a
 * narrowing is an exercise of authority, and the people with standing are the
 * ones it binds. A capability state or a discrepancy is an observation, and the
 * way to contest an observation is to show the check reads otherwise — which
 * anyone able to run it can do, whether or not they hold the grant.
 *
 * Every emitted record carries one of them. A record declaring no standing is a
 * claim with no route to challenge it, which STD-07 reads as a log that cannot
 * be argued with, and it was what held this stream below Level 3.
 */
const CONTEST = {
  standing: 'the person who holds or granted this authority',
  reversal_clock: 'P1D',
};

const CONTEST_OBSERVATION = {
  standing: 'anyone who can run the declared check and show it reads otherwise',
  reversal_clock: 'P1D',
};

/**
 * Writes the account of every grant currently narrowed by a failing foundation.
 *
 * Idempotent by construction. A record's id carries the evidence row that
 * caused it, so running this twice over an unchanged graph writes nothing, and
 * a capability that breaks, is fixed, and breaks again produces two distinct
 * discrepancies rather than one that quietly stands for both.
 *
 * Called after verification, which is the moment evidence changes, and
 * available on its own as `ambit delegation --record`.
 */
export function recordDelegationState(db: Db): {
  written: number;
  narrowed: Array<Record<string, unknown>>;
  records: DelegationRecord[];
} {
  const now = new Date().toISOString();
  const grants = db
    .prepare(
      `SELECT a.id, a.capability_id, a.action, a.mode, a.holder, a.scope, a.source, c.name
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       WHERE a.mode = 'autonomous' ORDER BY a.capability_id, a.action`
    )
    .all<{
      id: number;
      capability_id: string;
      action: string;
      mode: string;
      holder: string;
      scope: string;
      source: string;
      name: string;
    }>();

  const written: DelegationRecord[] = [];
  const narrowed: Array<Record<string, unknown>> = [];

  for (const grant of grants) {
    const foundation = brokenFoundations(db, grant.capability_id);
    if (!foundation.length) continue;

    for (const failing of foundation) {
      const evidence = latestFailure(db, failing.id);
      const stamp = evidence ? String(evidence.id) : 'unknown';
      const asOf = isoFrom(evidence?.at, now);

      const capabilityId = `ambit:capability:${failing.id}#${stamp}`;
      const capabilityRecord: DelegationRecord = {
        schema_version: RECORD_SCHEMA_VERSION,
        record_id: capabilityId,
        kind: 'capability',
        system: { id: 'ambit' },
        actor: { id: 'ambit', kind: 'service' },
        subject: failing.id,
        summary: `${failing.name} is ${failing.lifecycle}: its declared check is not passing.`,
        time: { as_of: asOf, recorded_at: now },
        content: {
          capability_id: failing.id,
          state: recordStateFor(failing.lifecycle),
          ambit_lifecycle: failing.lifecycle,
        },
        visibility: 'internal',
        contest: CONTEST_OBSERVATION,
      };
      const capabilityWritten = append(db, capabilityRecord);
      if (capabilityWritten) written.push(capabilityWritten);

      // The grant as declared, recorded once, so the revision has something to
      // supersede. Its depends_on is the point of the whole exercise: this is
      // where the grant says what it rests on.
      const authorizationId = `ambit:authorization:${grant.id}`;
      const authorizationRecord: DelegationRecord = {
        schema_version: RECORD_SCHEMA_VERSION,
        record_id: authorizationId,
        kind: 'authorization',
        system: { id: 'ambit' },
        actor: { id: grant.source || 'ambit', kind: 'service' },
        subject: `${grant.capability_id}/${grant.action}`,
        summary: `${grant.name} may run ${grant.action} unattended${grant.scope ? ` within ${grant.scope}` : ''}.`,
        time: { as_of: asOf, recorded_at: now },
        content: {
          scope: grant.scope || 'everywhere',
          holder: grant.holder || 'any actor',
          granted_by: grant.source,
          mode: recordModeFor(grant.mode),
          revocation_conditions: [
            'a hard prerequisite stops passing its declared check',
            'the capability itself stops passing its declared check',
          ],
        },
        depends_on: [capabilityId],
        invalidated_by: [
          {
            condition: `${failing.name} stops passing its declared check`,
            clock: 'PT0S',
          },
        ],
        authority: { clauses: ['STD-07.2.2', 'STD-07.3.4'] },
        visibility: 'internal',
        contest: CONTEST,
      };
      const authorizationWritten = append(db, authorizationRecord);
      if (authorizationWritten) written.push(authorizationWritten);

      const discrepancyId = `ambit:discrepancy:${grant.id}:${failing.id}#${stamp}`;
      const discrepancyRecord: DelegationRecord = {
        schema_version: RECORD_SCHEMA_VERSION,
        record_id: discrepancyId,
        kind: 'discrepancy',
        system: { id: 'ambit' },
        actor: { id: 'ambit', kind: 'service' },
        subject: failing.id,
        summary: `${failing.name} was expected to be passing and is ${failing.lifecycle}.`,
        time: { as_of: asOf, recorded_at: now },
        content: {
          expected: `${failing.name} passing its declared check`,
          observed: `${failing.name} is ${failing.lifecycle}`,
          source: 'ambit declared check',
          severity: 'high',
        },
        depends_on: [capabilityId],
        authority: { clauses: ['STD-07.3.3'] },
        visibility: 'internal',
        contest: CONTEST_OBSERVATION,
      };
      const discrepancyWritten = append(db, discrepancyRecord);
      if (discrepancyWritten) written.push(discrepancyWritten);

      const revisionRecord: DelegationRecord = {
        schema_version: RECORD_SCHEMA_VERSION,
        record_id: `ambit:revision:${grant.id}:${failing.id}#${stamp}`,
        kind: 'revision',
        system: { id: 'ambit' },
        actor: { id: 'ambit', kind: 'service' },
        subject: `${grant.capability_id}/${grant.action}`,
        summary: `${grant.name} asks a person for ${grant.action} until ${failing.name} passes again.`,
        time: { as_of: asOf, recorded_at: now },
        content: {
          reason: `${failing.name} is ${failing.lifecycle}, and the grant depends on it`,
          triggered_by: [discrepancyId],
          mode_now: 'confirm',
          mode_declared: recordModeFor(grant.mode),
          enforced_by: 'canExecute, at every decision',
        },
        depends_on: [discrepancyId],
        supersedes: authorizationId,
        authority: { clauses: ['STD-07.1.2', 'STD-07.3.3'] },
        visibility: 'internal',
        contest: CONTEST,
      };
      const revisionWritten = append(db, revisionRecord);
      if (revisionWritten) written.push(revisionWritten);

      narrowed.push({
        capability: grant.name,
        action: grant.action,
        declared: grant.mode,
        now: 'confirm',
        because: `${failing.name} is ${failing.lifecycle}`,
      });
    }
  }

  return { written: written.length, narrowed, records: written };
}

/** The records, newest last, as stored. */
/** A record as it was stored, or null when nothing carries that id. */
function storedRecord(db: Db, recordId: string): DelegationRecord | null {
  const row = db
    .prepare('SELECT body FROM delegation_records WHERE record_id = ?')
    .get<{ body: string }>(recordId);
  if (!row) return null;
  return JSON.parse(row.body) as DelegationRecord;
}

export type ObjectionInput = {
  /** The record being challenged. */
  record: string;
  /** The person objecting. An objection with no author has no standing to check. */
  by: string;
  /** Why they have standing, in their own words. */
  basis: string;
  requested: 'reconsideration' | 'reversal' | 'narrowing';
  note?: string;
};

export type ObjectionResult =
  | { ok: false; reason: string }
  | { ok: true; record: DelegationRecord };

/**
 * A person contesting a record Ambit wrote.
 *
 * This is the half of Article IV that a machine cannot supply for itself. Ambit
 * can declare who has standing on every record it emits, and does; whether
 * anyone ever uses that standing is a fact about the institution, not about the
 * code. So this is a channel, and the objection it writes is evidence that the
 * channel was used.
 *
 * What it deliberately does not do is change the decision. An objection that
 * restored an unattended grant would make the gate negotiable — anyone able to
 * write a sentence could talk past a failing prerequisite, which is exactly the
 * nominal safeguard the whole exercise exists to avoid. Widening authority
 * still costs what it costs: fix the capability, or re-declare the grant.
 */
export function recordObjection(db: Db, input: ObjectionInput): ObjectionResult {
  const by = input.by.trim();
  const basis = input.basis.trim();
  if (!by) return { ok: false, reason: 'an objection needs an author: pass --by' };
  if (!basis) return { ok: false, reason: 'an objection needs a basis for standing: pass --basis' };

  const challenged = storedRecord(db, input.record);
  if (!challenged) {
    return { ok: false, reason: `no record with id ${input.record}` };
  }
  if (!challenged.contest?.standing) {
    // Not a technicality. A record granting no standing is one nobody was told
    // they could argue with, and accepting an objection to it anyway would let
    // this log look contestable while the record itself still says otherwise.
    return {
      ok: false,
      reason: `${input.record} declares no standing to object, so there is nothing to object under`,
    };
  }

  const existing =
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM delegation_records WHERE kind = 'objection' AND subject = ?"
      )
      .get<{ n: number }>(input.record)?.n ?? 0;

  const now = new Date().toISOString();
  const record: DelegationRecord = {
    schema_version: RECORD_SCHEMA_VERSION,
    record_id: `ambit:objection:${input.record}#${existing + 1}`,
    kind: 'objection',
    system: { id: 'ambit' },
    actor: { id: by, kind: 'human' },
    subject: input.record,
    summary: `${by} challenges ${input.record} and asks for ${input.requested}.`,
    time: { as_of: now, recorded_at: now },
    content: {
      challenges: input.record,
      standing_basis: basis,
      standing_declared: challenged.contest.standing,
      requested: input.requested,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      changes_nothing_by_itself:
        'Recording an objection does not widen authority. The narrowing stands until the capability passes its check again or the grant is re-declared.',
    },
    depends_on: [input.record],
    authority: { clauses: ['STD-07.4.1', 'STD-07.4.2'] },
    visibility: 'internal',
    contest: CONTEST,
  };

  const written = append(db, record);
  if (!written) return { ok: false, reason: 'that objection is already recorded' };
  return { ok: true, record: written };
}

export type AnswerInput = {
  objection: string;
  disposition: 'upheld' | 'refused';
  because: string;
  by: string;
};

/**
 * The answer an objection is owed.
 *
 * STD-07 asks that an objection be accepted *and answered*; an unanswered one
 * is a channel that exists on paper. Either disposition is a real answer, and
 * refusing with a reason is not a lesser outcome than upholding — a system
 * where every objection succeeds is not being governed either.
 *
 * The answer supersedes the objection. §4.2 says an objection produces "a
 * revision or a reasoned refusal, itself a record" without naming the kind a
 * refusal takes, and the first version of this wrote a `revision` superseding
 * nothing — which the published schema rejects, because §1.2 requires a
 * revision to name what it replaces. Superseding the objection is the reading
 * that is true either way: the challenge was the open item and this closes it.
 * What it must not claim to supersede is the record challenged, since upholding
 * an objection does not by itself change what that record said.
 */
export function answerObjection(db: Db, input: AnswerInput): ObjectionResult {
  const because = input.because.trim();
  const by = input.by.trim();
  if (!by) return { ok: false, reason: 'an answer needs an author: pass --by' };
  if (!because) return { ok: false, reason: 'an answer needs a reason: pass --because' };

  const objection = storedRecord(db, input.objection);
  if (!objection || objection.kind !== 'objection') {
    return { ok: false, reason: `no objection with id ${input.objection}` };
  }

  const answered =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM delegation_records
       WHERE kind = 'revision' AND body LIKE ?`
      )
      .get<{ n: number }>(`%"answers":"${input.objection}"%`)?.n ?? 0;
  if (answered) return { ok: false, reason: `${input.objection} was already answered` };

  const now = new Date().toISOString();
  const record: DelegationRecord = {
    schema_version: RECORD_SCHEMA_VERSION,
    record_id: `ambit:revision:answer:${input.objection}`,
    kind: 'revision',
    system: { id: 'ambit' },
    actor: { id: by, kind: 'human' },
    subject: String(objection.content.challenges ?? objection.subject),
    summary:
      input.disposition === 'upheld'
        ? `${by} upholds the objection to ${objection.subject}.`
        : `${by} refuses the objection to ${objection.subject}, and the record stands.`,
    time: { as_of: now, recorded_at: now },
    content: {
      answers: input.objection,
      disposition: input.disposition,
      reason: because,
      triggered_by: [input.objection],
      enforcement_unchanged:
        'An answer records what a person decided about the record. It does not move any capability lifecycle, so the gate returns what the evidence supports either way.',
    },
    depends_on: [input.objection],
    supersedes: input.objection,
    authority: { clauses: ['STD-07.4.2'] },
    visibility: 'internal',
    contest: CONTEST,
  };

  const written = append(db, record);
  if (!written) return { ok: false, reason: 'that answer is already recorded' };
  return { ok: true, record: written };
}

/** Objections nobody has answered yet, oldest first. */
export function unansweredObjections(db: Db): DelegationRecord[] {
  return delegationRecords(db, 1000)
    .filter(record => record.kind === 'objection')
    .filter(objection => {
      const answered =
        db
          .prepare('SELECT COUNT(*) AS n FROM delegation_records WHERE body LIKE ?')
          .get<{ n: number }>(`%"answers":"${objection.record_id}"%`)?.n ?? 0;
      return answered === 0;
    });
}

export function delegationRecords(db: Db, limit = 50): DelegationRecord[] {
  return db
    .prepare('SELECT body FROM delegation_records ORDER BY seq DESC LIMIT ?')
    .all<{ body: string }>(limit)
    .map(r => JSON.parse(r.body) as DelegationRecord)
    .reverse();
}

/**
 * What Ambit declares about the records it emits.
 *
 * Level 2 is claimed for the four kinds listed and nothing else. The standard's
 * own adoption note says declaring a level honestly is conformance and claiming
 * one the log does not earn is not, so the caveat travels with the number.
 */
export function delegationManifest(db?: Db) {
  return {
    standard: RECORD_STANDARD_URL,
    schema: RECORD_SCHEMA_URL,
    schema_version: RECORD_SCHEMA_VERSION,
    // Declared at 2 rather than 3 on purpose. Every emitted record now carries
    // standing, which is the first of the two things Level 3 asks for; the
    // second is an objection actually made and answered, and no manifest can
    // promise that in advance. A stream containing one has been measured at
    // Level 3 by the published checker; a stream from a graph nobody has
    // objected in earns 2, and that is the number worth publishing.
    conformance_level: 2,
    level_3_when:
      'the exported stream contains an objection and its answer. ambit delegation object / answer is the channel; whether anyone uses it is a fact about the institution, not the code.',
    kinds: [...EMITTED_KINDS],
    not_emitted: {
      kinds: ['belief', 'action', 'outcome'],
      why: 'Ambit holds the capability and authorization steps. Its environment adapter is simulated, so an action record from here would attest to a fixture.',
    },
    consumes: {
      kinds: ['discrepancy'],
      how: 'ambit delegation ingest <file>',
      effect:
        'A foreign discrepancy about a capability this graph knows is recorded as evidence attributed to the sending system. It does not move a lifecycle, so no remote system can narrow a grant here by sending a file.',
    },
    enforced:
      'canExecute narrows an unattended grant whose hard prerequisite is failing, at every decision, whether or not these records have been written.',
    records: db ? verifyChain(db) : undefined,
  };
}

export type IngestSummary = {
  read: number;
  rejected: Array<{ at: string; reason: string }>;
  /** Discrepancies about capabilities this graph knows, recorded as evidence. */
  admitted: Array<{ record_id: string; system: string; capability: string; summary: string }>;
  /** Discrepancies about subjects this graph has never heard of. */
  unmatched: Array<{ record_id: string; subject: string }>;
  ignored: Partial<Record<string, number>>;
};

/**
 * Reading another system's records.
 *
 * Until this, every system in the loop emitted the shared shape and none
 * consumed it, which makes a record format a documentation format. This is the
 * consuming half: a stream from a system that detects mismatch — Refract over a
 * claim's evidence, say — carrying discrepancies about things this graph has
 * capabilities for.
 *
 * Three restrictions, each of which is the point rather than a limitation.
 *
 * A foreign discrepancy is admitted as *evidence*, into the same table an
 * observed tool failure lands in, attributed to the system that sent it. It
 * does not move a capability's lifecycle and so cannot narrow a grant by
 * itself. A remote system that could flip this graph's state would be a way to
 * revoke anyone's authority by sending a file, and the gate would then be
 * enforcing a claim nobody here verified.
 *
 * Only `discrepancy` records are read. A foreign `authorization` is that
 * system's account of its own grants and says nothing about what may run here;
 * treating one as admissible would be importing authority rather than evidence.
 *
 * And a record whose subject names nothing in this graph is reported as
 * unmatched rather than dropped, because "the sender and the receiver disagree
 * about what exists" is the most useful thing a first integration can tell you.
 */
export function ingestForeignRecords(db: Db, text: string): IngestSummary {
  const summary: IngestSummary = {
    read: 0,
    rejected: [],
    admitted: [],
    unmatched: [],
    ignored: {},
  };

  const trimmed = text.trim();
  if (!trimmed) return summary;

  let entries: unknown[];
  if (trimmed.startsWith('[')) {
    try {
      entries = JSON.parse(trimmed) as unknown[];
    } catch {
      summary.rejected.push({ at: 'the whole stream', reason: 'not valid JSON' });
      return summary;
    }
  } else {
    entries = [];
    trimmed.split('\n').forEach((line, index) => {
      if (!line.trim()) return;
      try {
        entries.push(JSON.parse(line));
      } catch {
        summary.rejected.push({ at: `line ${index + 1}`, reason: 'not valid JSON' });
      }
    });
  }

  for (const [index, entry] of entries.entries()) {
    const at = `entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      summary.rejected.push({ at, reason: 'not a record object' });
      continue;
    }
    const record = entry as Partial<DelegationRecord>;
    if (!record.record_id || !record.kind || !record.subject) {
      summary.rejected.push({ at, reason: 'missing record_id, kind or subject' });
      continue;
    }
    const system = record.system?.id;
    if (!system) {
      summary.rejected.push({
        at: record.record_id,
        reason: 'no system.id: nothing to attribute it to',
      });
      continue;
    }
    if (system === 'ambit') {
      summary.rejected.push({
        at: record.record_id,
        reason:
          'this graph emitted that record; ingesting it would make its own output look like outside evidence',
      });
      continue;
    }
    summary.read += 1;

    if (record.kind !== 'discrepancy') {
      summary.ignored[record.kind] = (summary.ignored[record.kind] ?? 0) + 1;
      continue;
    }

    const known = db
      .prepare('SELECT id, name FROM capabilities WHERE id = ?')
      .get<{ id: string; name: string }>(record.subject);
    if (!known) {
      summary.unmatched.push({ record_id: record.record_id, subject: record.subject });
      continue;
    }

    const observed =
      typeof record.content?.observed === 'string' ? record.content.observed : record.summary || '';
    const already =
      db
        .prepare('SELECT COUNT(*) AS n FROM failure_signals WHERE detail LIKE ?')
        .get<{ n: number }>(`%${record.record_id}%`)?.n ?? 0;
    if (already) continue;

    db.prepare(
      `INSERT INTO failure_signals (source, session_id, tool, class, signal, capability_id, detail)
       VALUES (?, NULL, NULL, 'reported', 'foreign-discrepancy', ?, ?)`
    ).run(`std07:${system}`, known.id, `${record.record_id} — ${observed}`.slice(0, 300));

    summary.admitted.push({
      record_id: record.record_id,
      system,
      capability: known.name,
      summary: record.summary || observed,
    });
  }

  return summary;
}
