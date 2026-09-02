import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Migratable } from './migrate.ts';
import type { ProposalRow } from './rows.ts';

/**
 * The approval broker: mints a signed artifact that binds an approval to an
 * exact proposal, an exact actor, an exact budget and an expiry — and verifies
 * that artifact before anything executes.
 *
 * The separation is the point. Proposing more capability and granting more
 * authority are different acts, and the artifact is what keeps them apart: a
 * browser or an ntfy reply can mint an approval, but only the executor (apply)
 * can spend it, and only when the artifact is present, signed, unexpired and
 * covers exactly what is about to run. The approval broker never carries a
 * command; the artifact is data, and the executor checks it.
 */

/** The key. A local file so the broker and the executor can both read it
 *  without one knowing the other's process; env override for machines that
 *  want the key elsewhere. */
function approvalKey(): string {
  const override = process.env.AMBIT_APPROVAL_KEY;
  if (override) return override;
  const path = join(process.env.HOME || '/', '.config', 'opencode', 'ambit-approval.key');
  try {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
    mkdirSync(join(process.env.HOME || '/', '.config', 'opencode'), { recursive: true });
    const key = randomBytes(32).toString('hex');
    writeFileSync(path, key + '\n', { mode: 0o600 });
    return key;
  } catch {
    // An unreadable key is a refusal to mint, not a fallback to unsigned.
    throw new Error('cannot read or create the approval key');
  }
}

function sign(payload: string): string {
  return createHmac('sha256', approvalKey()).update(payload).digest('hex');
}

/** A stable hash of everything that makes a proposal what it is. */
function proposalHash(_db: Migratable, row: any): string {
  const body = [row.id, row.goal, row.steps, row.simulated, row.economic_case || ''].join('|');
  return createHmac('sha256', 'ambit-proposal').update(body).digest('hex').slice(0, 16);
}

export interface MintApprovalInput {
  actor: string;
  budgetCents?: number | null;
  scopeExclude?: string[];
  ttlHours?: number;
}

/**
 * Mints the approval artifact for an approved proposal and stores it.
 *
 * The artifact binds: proposal hash (what is approved), actor (who approved),
 * budget (how much this is allowed to cost), scope (what it is not allowed to
 * touch), expiry (when the approval dies), timestamp. The executor verifies
 * all of it against the row it is about to apply.
 */
function mintApproval(db: Migratable, proposalId: string, input: MintApprovalInput) {
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get<ProposalRow>(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status !== 'approved')
    return { error: `${proposalId} is ${row.status}; an approval artifact is minted on approval.` };

  const steps = JSON.parse(row.steps);
  const scopeExclude = input.scopeExclude || (steps as any[]).map((s: any) => s.id).filter(Boolean);
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 24) * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const artifact = {
    proposal_hash: proposalHash(db, row),
    actor: input.actor,
    budget_cents: input.budgetCents ?? row.budget_cents ?? null,
    scope_exclude: scopeExclude,
    expires_at: expiresAt,
    timestamp,
  };
  const payload = JSON.stringify(artifact);
  const signed = { ...artifact, sig: sign(payload) };

  db.prepare(
    'UPDATE proposals SET budget_cents = ?, scope_exclude = ?, expires_at = ?, approval_artifact = ? WHERE id = ?'
  ).run(
    artifact.budget_cents,
    JSON.stringify(scopeExclude),
    expiresAt,
    JSON.stringify(signed),
    proposalId
  );
  return { proposal: proposalId, artifact: signed };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies the artifact an apply is about to rely on.
 *
 * Refusals, in order: no artifact stored, bad signature (the row was tampered
 * with after minting), expired, actor not the recorded approver. Each is a
 * hard no — an approval that no longer covers what it claims is not an
 * approval at all.
 */
function verifyApproval(db: Migratable, proposalId: string, applyActor?: string): VerifyResult {
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { ok: false, reason: `no proposal ${proposalId}` };
  if (!row.approval_artifact) return { ok: false, reason: 'no approval artifact minted' };

  let artifact: any;
  try {
    artifact = JSON.parse(row.approval_artifact);
  } catch {
    return { ok: false, reason: 'approval artifact is corrupt' };
  }
  const { sig, ...rest } = artifact;
  if (sign(JSON.stringify(rest)) !== sig) {
    return {
      ok: false,
      reason: 'approval artifact signature does not verify — the proposal changed after approval',
    };
  }
  if (rest.proposal_hash !== proposalHash(db, row)) {
    return { ok: false, reason: 'the proposal no longer hashes to what was approved' };
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // Checked from the stored artifact and from the row's own column — the
  // executor reads the row, and either one being past refuses the apply.
  if (rest.expires_at && rest.expires_at < now) {
    return { ok: false, reason: `approval expired ${rest.expires_at}` };
  }
  if (row.expires_at && row.expires_at < now) {
    return { ok: false, reason: `approval expired ${row.expires_at}` };
  }
  if (applyActor && rest.actor && rest.actor !== applyActor) {
    return { ok: false, reason: `approval was granted to ${rest.actor}, not ${applyActor}` };
  }
  return { ok: true };
}

export { proposalHash, mintApproval, verifyApproval };
