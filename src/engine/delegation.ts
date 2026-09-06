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
export const EMITTED_KINDS = ['capability', 'authorization', 'discrepancy', 'revision'] as const;

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

const CONTEST = {
  standing: 'the person who holds or granted this authority',
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
    conformance_level: 2,
    kinds: [...EMITTED_KINDS],
    not_emitted: {
      kinds: ['belief', 'action', 'objection', 'outcome'],
      why: 'Ambit holds the capability and authorization steps. Its environment adapter is simulated, so an action record from here would attest to a fixture.',
    },
    enforced:
      'canExecute narrows an unattended grant whose hard prerequisite is failing, at every decision, whether or not these records have been written.',
    records: db ? verifyChain(db) : undefined,
  };
}
