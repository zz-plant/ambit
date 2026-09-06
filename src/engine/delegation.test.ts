/**
 * Authority that stops holding when what it rests on stops working.
 *
 * The graph has always known that a credential is broken and that a grant
 * depends on it. Nothing joined the two at the moment a decision was made, so
 * an unattended grant stayed unattended over a failing foundation — the
 * roadmap's "describes authority rather than mediating it", in one place you
 * could point at. These tests pin both halves: the gate narrows on its own,
 * and the record says so afterwards.
 */
import { describe, expect, it } from 'vitest';
import { makeGraph, learn } from './testing/graph.ts';
import { canExecute, brokenFoundations } from './assurance.ts';
import {
  recordDelegationState,
  delegationRecords,
  delegationManifest,
  verifyChain,
  canonicalize,
  hashRecord,
  isoFrom,
  recordStateFor,
  recordModeFor,
  EMITTED_KINDS,
  type DelegationRecord,
} from './delegation.ts';

/** A deploy capability that works, standing on a credential that can break. */
function environment(credentialLifecycle: 'verified' | 'broken' | 'degraded' = 'verified') {
  return makeGraph({
    capabilities: [
      { id: 'combo:deploy', name: 'Deploy', kind: 'capability', lifecycle: 'reliable' },
      {
        id: 'credential:k8s',
        name: 'Kubeconfig',
        kind: 'credential',
        lifecycle: credentialLifecycle,
      },
      { id: 'combo:lint', name: 'Lint', kind: 'capability', lifecycle: 'verified' },
    ],
    dependencies: [
      { from: 'credential:k8s', to: 'combo:deploy', hard: true },
      // Soft: present, failing, and not grounds to narrow anything.
      { from: 'combo:lint', to: 'combo:deploy', hard: false },
    ],
    authority: [
      { capability: 'combo:deploy', action: 'execute', mode: 'autonomous', source: 'declared' },
    ],
  });
}

describe('a grant whose foundation stopped holding', () => {
  it('runs unattended while the thing it rests on passes', () => {
    const db = environment('verified');
    const decision = canExecute(db, { capability: 'combo:deploy' }) as any;
    expect(decision.decision).toBe('ALLOW');
    expect(decision.narrowed_by).toBeUndefined();
  });

  it('asks a person once that thing is broken, without the grant being rewritten', () => {
    const db = environment('broken');
    const decision = canExecute(db, { capability: 'combo:deploy' }) as any;

    expect(decision.decision).toBe('CONFIRM');
    expect(decision.verdict).toBe('ask');
    expect(decision.reason).toContain('Kubeconfig is broken');
    expect(decision.narrowed_by).toHaveLength(1);
    expect(decision.narrowed_by[0]).toMatchObject({ id: 'credential:k8s', lifecycle: 'broken' });

    // The declared grant is untouched. What a person wrote down stays written
    // down; the narrowing is a property of the decision, not an edit.
    const stored = db
      .prepare("SELECT mode FROM authority WHERE capability_id = 'combo:deploy'")
      .get() as any;
    expect(stored.mode).toBe('autonomous');
  });

  it('treats degraded the same as broken, and ignores a failing soft prerequisite', () => {
    expect(
      (canExecute(environment('degraded'), { capability: 'combo:deploy' }) as any).decision
    ).toBe('CONFIRM');

    const db = environment('verified');
    db.prepare("UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'combo:lint'").run();
    expect(brokenFoundations(db, 'combo:deploy')).toHaveLength(0);
    expect((canExecute(db, { capability: 'combo:deploy' }) as any).decision).toBe('ALLOW');
  });

  it('does not narrow a prerequisite that was never reached', () => {
    const db = environment('verified');
    db.prepare("UPDATE capabilities SET state = 'locked' WHERE id = 'credential:k8s'").run();
    db.prepare("UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'credential:k8s'").run();
    // Unreached is a different answer from failing, and missingPrerequisites
    // already owns it. Nothing was available to lose.
    expect(brokenFoundations(db, 'combo:deploy')).toHaveLength(0);
  });

  it('leaves a sandbox unattended, because consequences are contained there', () => {
    const db = environment('broken');
    db.prepare(
      "INSERT INTO sandboxes (target, declared_by) VALUES ('env:staging', 'human:kanav')"
    ).run();
    const decision = canExecute(db, {
      capability: 'combo:deploy',
      target: 'env:staging',
    }) as any;
    expect(decision.decision).toBe('ALLOW');
  });
});

describe('the record of that happening', () => {
  it('writes a capability, an authorization, a discrepancy and a revision', () => {
    const db = environment('broken');
    learn(db, 'credential:k8s', 'failed');

    const result = recordDelegationState(db);
    expect(result.written).toBe(4);
    expect(result.narrowed[0]).toMatchObject({
      capability: 'Deploy',
      declared: 'autonomous',
      now: 'confirm',
    });

    const records = delegationRecords(db);
    expect(records.map(r => r.kind)).toEqual([...EMITTED_KINDS]);

    const authorization = records.find(r => r.kind === 'authorization')!;
    const capability = records.find(r => r.kind === 'capability')!;
    const discrepancy = records.find(r => r.kind === 'discrepancy')!;
    const revision = records.find(r => r.kind === 'revision')!;

    // The point of the exercise: the grant names what it rests on, and what
    // would end it.
    expect(authorization.depends_on).toEqual([capability.record_id]);
    expect(authorization.invalidated_by?.[0].condition).toContain('Kubeconfig');
    expect(authorization.content.mode).toBe('unattended');
    expect(capability.content.state).toBe('broken');
    expect(discrepancy.content.observed).toContain('broken');
    expect(revision.supersedes).toBe(authorization.record_id);
    expect(revision.content.triggered_by).toEqual([discrepancy.record_id]);
  });

  it('stamps times in the format the published schema accepts', () => {
    // SQLite writes `2026-09-06 20:35:26`, which is not ISO 8601. Emitting the
    // column raw produced records the standard's own validator rejected.
    expect(isoFrom('2026-09-06 20:35:26', 'fallback')).toBe('2026-09-06T20:35:26.000Z');
    expect(isoFrom('2026-09-06T20:35:26.000Z', 'f')).toBe('2026-09-06T20:35:26.000Z');
    expect(isoFrom(undefined, 'fallback')).toBe('fallback');
    expect(isoFrom('nonsense', 'fallback')).toBe('fallback');

    const db = environment('broken');
    learn(db, 'credential:k8s', 'failed');
    recordDelegationState(db);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    for (const record of delegationRecords(db)) {
      expect(record.time.as_of).toMatch(iso);
      expect(record.time.recorded_at).toMatch(iso);
    }
  });

  it('writes nothing when every foundation holds', () => {
    const db = environment('verified');
    expect(recordDelegationState(db).written).toBe(0);
    expect(delegationRecords(db)).toHaveLength(0);
  });

  it('is idempotent over an unchanged graph, and records a recurrence separately', () => {
    const db = environment('broken');
    learn(db, 'credential:k8s', 'failed');

    expect(recordDelegationState(db).written).toBe(4);
    expect(recordDelegationState(db).written).toBe(0);

    // Fixed, then broken again: a second failure is a second discrepancy, not
    // the first one standing in for both.
    learn(db, 'credential:k8s', 'failed');
    const again = recordDelegationState(db);
    expect(again.written).toBe(3); // capability, discrepancy, revision; the authorization already stands
    expect(delegationRecords(db).filter(r => r.kind === 'discrepancy')).toHaveLength(2);
  });

  it('hashes each record over its content and chains it to the one before', () => {
    const db = environment('broken');
    learn(db, 'credential:k8s', 'failed');
    recordDelegationState(db);

    const rows = db
      .prepare('SELECT body, hash, prior_hash FROM delegation_records ORDER BY seq')
      .all() as Array<{ body: string; hash: string; prior_hash: string | null }>;

    expect(rows[0].prior_hash).toBeNull();
    for (const [i, row] of rows.entries()) {
      const record = JSON.parse(row.body) as DelegationRecord;
      expect(record.integrity?.hash).toBe(row.hash);
      expect(hashRecord(record)).toBe(row.hash);
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
      if (i > 0) expect(row.prior_hash).toBe(rows[i - 1].hash);
    }
    expect(verifyChain(db)).toMatchObject({ ok: true, records: rows.length });
  });

  it('notices a record edited after the fact', () => {
    const db = environment('broken');
    learn(db, 'credential:k8s', 'failed');
    recordDelegationState(db);

    const first = db
      .prepare('SELECT record_id, body FROM delegation_records ORDER BY seq')
      .get() as any;
    const tampered = JSON.parse(first.body);
    tampered.summary = 'nothing was ever wrong here';
    db.prepare('UPDATE delegation_records SET body = ? WHERE record_id = ?').run(
      JSON.stringify(tampered),
      first.record_id
    );

    expect(verifyChain(db)).toMatchObject({ ok: false, reason: 'content changed' });
  });

  it('canonicalizes independent of key order and excludes the integrity block', () => {
    const record: DelegationRecord = {
      schema_version: '0.1.0',
      record_id: 'ambit:capability:x#1',
      kind: 'capability',
      system: { id: 'ambit' },
      actor: { id: 'ambit', kind: 'service' },
      subject: 'x',
      summary: 's',
      time: { as_of: '2026-09-06T00:00:00Z', recorded_at: '2026-09-06T00:00:01Z' },
      content: { capability_id: 'x', state: 'broken' },
      visibility: 'internal',
    };
    const reordered = {
      visibility: record.visibility,
      content: { state: 'broken', capability_id: 'x' },
      time: { recorded_at: record.time.recorded_at, as_of: record.time.as_of },
      summary: 's',
      subject: 'x',
      actor: record.actor,
      system: record.system,
      kind: record.kind,
      record_id: record.record_id,
      schema_version: record.schema_version,
    } as DelegationRecord;

    expect(canonicalize(reordered)).toBe(canonicalize(record));
    expect(
      hashRecord({ ...record, integrity: { algorithm: 'sha256', hash: 'x'.repeat(64) } })
    ).toBe(hashRecord(record));
    expect(canonicalize(record)).not.toContain('integrity');
  });
});

describe('what Ambit claims about its own records', () => {
  it('maps its seven lifecycles onto the four states the shape defines', () => {
    expect(recordStateFor('reliable')).toBe('verified');
    expect(recordStateFor('verified')).toBe('verified');
    expect(recordStateFor('degraded')).toBe('broken');
    expect(recordStateFor('broken')).toBe('broken');
    expect(recordStateFor('configured')).toBe('configured');
    expect(recordStateFor('unknown')).toBe('absent');
    expect(recordModeFor('autonomous')).toBe('unattended');
    expect(recordModeFor('forbidden')).toBe('forbidden');
    expect(recordModeFor('confirm')).toBe('confirm');
  });

  it('claims level 2 only for the kinds it emits, and says what it does not emit', () => {
    const manifest = delegationManifest(environment('verified'));
    expect(manifest.conformance_level).toBe(2);
    expect(manifest.kinds).toEqual([...EMITTED_KINDS]);
    expect(manifest.not_emitted.kinds).toContain('action');
    expect(manifest.not_emitted.why).toContain('simulated');
    // The enforcement does not depend on the record having been written, and
    // the manifest has to keep saying so.
    expect(manifest.enforced).toContain('whether or not');
  });
});
