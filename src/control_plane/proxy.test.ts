/**
 * The control plane is the trust boundary: it decides whether an agent's tool
 * call reaches the environment. It used to be covered only by a pytest file
 * that CI never ran — `bun test` was the only test step — so the HMAC approval
 * path shipped unverified for as long as it has existed.
 *
 * These run in-process against the proxy rather than through the CLI, so a
 * failure names the function that broke.
 */
import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, type Db } from '../engine/db.ts';
import { approveProposal } from '../engine/governance.ts';
import { auditFor } from '../engine/audit.ts';
import {
  createInitialSimulatedEnvironment,
  readSimulatedEnvironment,
  setupControlPlaneGraph,
  executeThroughControlPlane,
  approvalCovers,
  type AgentExecutionRequest,
} from './proxy.ts';

// A fixed key so signing is deterministic and never touches ~/.config.
process.env.AMBIT_APPROVAL_KEY = 'test-secret-hmac-key-for-ambit-safety-control-plane-32chars';

let dir: string;
let envDir: string;
let db: Db;

const DEPLOY: AgentExecutionRequest = {
  agent_id: 'agent:deployer',
  intent: 'Deploy release v2.0.0 to production',
  tool: 'deploy_to_production',
  capability_id: 'combo:deploy-to-production',
  action: 'execute',
  target: 'env:production',
  payload: { target_version: 'v2.0.0' },
  hmac_approval_token: null,
};

/** The state file on disk, which is the thing a block must leave untouched. */
const onDisk = () => JSON.parse(readFileSync(join(envDir, 'environment_state.json'), 'utf8'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-control-plane-'));
  envDir = join(dir, 'simulated_prod');
  db = getDb(join(dir, 'graph.db'));
  setupControlPlaneGraph(db);
  createInitialSimulatedEnvironment(envDir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Satisfy the staging prerequisite the scenario starts out failing. */
function verifyStaging() {
  db.prepare('UPDATE capabilities SET lifecycle = ? WHERE id = ?').run(
    'verified',
    'combo:staging-healthcheck'
  );
  db.prepare(
    'INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes)' +
      " VALUES ('verify', ?, 'verified', 1, 'staging verified')"
  ).run('combo:staging-healthcheck');
}

// ── Interception ─────────────────────────────────────────────────────────────

test('an unauthorized deploy is intercepted and the environment is untouched', () => {
  const before = onDisk();
  const result = executeThroughControlPlane(db, envDir, DEPLOY);

  expect(result.ok).toBe(false);
  expect(result.status_code).toBe('AMBIT_BLOCKED_UNAUTHORIZED');
  expect(result.exit_code).toBe(2);
  expect(result.state_unchanged).toBe(true);
  expect(result.pre_state.immutable_hash).toBe(result.post_state.immutable_hash);
  expect(onDisk()).toEqual(before);
  expect(onDisk().production_version).toBe('v1.4.2');

  expect(result.trace.status.code).toBe('ERROR');
  expect(result.trace.status.description).toContain('AMBIT_BLOCKED_UNAUTHORIZED');

  const path = JSON.parse(result.trace.attributes['ambit.capability_path']);
  expect(path).toContain('combo:db-migration');
  expect(path).toContain('combo:staging-healthcheck');
  expect(path).toContain('combo:deploy-to-production');

  expect(['combo:staging-healthcheck', 'human:security-lead']).toContain(
    result.trace.attributes['ambit.missing_authorization_node']
  );
  expect(result.hmac_challenge!.length).toBeGreaterThan(10);
  expect(result.remediation_proposal_id).toMatch(/^prop-/);
});

test('the full remediation loop ends in an authorized, audited deploy', () => {
  const blocked = executeThroughControlPlane(db, envDir, DEPLOY);
  const proposalId = blocked.remediation_proposal_id!;

  verifyStaging();
  const approval = approveProposal(db, proposalId, 'human:security-lead') as any;
  expect(approval.approved_by).toBe('Alice Security Lead');
  expect(approval.artifact.sig).toBeDefined();

  const authorized = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: proposalId,
  });

  expect(authorized.ok).toBe(true);
  expect(authorized.status_code).toBe('AMBIT_EXECUTION_AUTHORIZED');
  expect(authorized.trace.status.code).toBe('OK');
  expect(onDisk().production_version).toBe('v2.0.0');
  expect(onDisk().last_deployed_by).toContain('authorized-by:human:security-lead');

  const trail = auditFor(db, proposalId) as any;
  expect(trail.status).toBe('approved');
  expect(trail.approval.by).toBe('human:security-lead');
  expect(trail.approval.artifact.signed).toBe(true);
});

// ── The approval artifact ────────────────────────────────────────────────────

test('a token naming no proposal is refused and the state survives', () => {
  verifyStaging();
  const before = onDisk();
  const result = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: 'prop-forged-fake-123456',
  });

  expect(result.ok).toBe(false);
  expect(result.status_code).toBe('AMBIT_BLOCKED_UNAUTHORIZED');
  expect(result.intercept_reason).toContain('no proposal');
  expect(result.state_unchanged).toBe(true);
  expect(onDisk()).toEqual(before);
});

test('an approval for another proposal cannot authorize this deploy', () => {
  // The bearer-token hole: a signed, unexpired, correctly-actored artifact for
  // an unrelated proposal used to satisfy the confirm gate outright.
  verifyStaging();
  db.prepare(
    'INSERT INTO proposals (id, goal, status, steps, simulated, created_at)' +
      " VALUES ('prop-unrelated', 'Install a linter', 'draft', ?, '{}', datetime('now'))"
  ).run(JSON.stringify([{ id: 'combo:lint', name: 'Lint', inverse: { remove: [] } }]));
  approveProposal(db, 'prop-unrelated', 'human:security-lead');

  expect(approvalCovers(db, 'prop-unrelated', 'combo:deploy-to-production')).toBe(false);

  const before = onDisk();
  const result = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: 'prop-unrelated',
  });

  expect(result.ok).toBe(false);
  expect(result.intercept_reason).toContain('does not cover');
  expect(onDisk()).toEqual(before);
});

test('editing an approved proposal invalidates its artifact', () => {
  const blocked = executeThroughControlPlane(db, envDir, DEPLOY);
  const proposalId = blocked.remediation_proposal_id!;
  verifyStaging();
  approveProposal(db, proposalId, 'human:security-lead');

  // Approve a small thing, then swap in a large one. The artifact is signed
  // over the proposal's hash, so the substitution has to be visible.
  db.prepare('UPDATE proposals SET goal = ? WHERE id = ?').run(
    'Deploy anything at all, forever',
    proposalId
  );

  const before = onDisk();
  const result = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: proposalId,
  });

  expect(result.ok).toBe(false);
  expect(result.intercept_reason).toContain('no longer hashes to what was approved');
  expect(onDisk()).toEqual(before);
});

test('an expired approval is refused', () => {
  const blocked = executeThroughControlPlane(db, envDir, DEPLOY);
  const proposalId = blocked.remediation_proposal_id!;
  verifyStaging();
  approveProposal(db, proposalId, 'human:security-lead');

  db.prepare("UPDATE proposals SET expires_at = '2020-01-01 00:00:00' WHERE id = ?").run(
    proposalId
  );

  const result = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: proposalId,
  });

  expect(result.ok).toBe(false);
  expect(result.intercept_reason).toContain('expired');
  expect(onDisk().production_version).toBe('v1.4.2');
});

// ── Prerequisites ────────────────────────────────────────────────────────────

test('a signed approval does not excuse a failing prerequisite', () => {
  const blocked = executeThroughControlPlane(db, envDir, DEPLOY);
  const proposalId = blocked.remediation_proposal_id!;
  verifyStaging();
  approveProposal(db, proposalId, 'human:security-lead');

  // Staging regresses after the approval was granted.
  db.prepare("UPDATE capabilities SET lifecycle = 'degraded' WHERE id = ?").run(
    'combo:staging-healthcheck'
  );

  const result = executeThroughControlPlane(db, envDir, {
    ...DEPLOY,
    hmac_approval_token: proposalId,
  });

  expect(result.ok).toBe(false);
  expect(result.intercept_reason).toContain('Unmet hard prerequisite');
  expect(onDisk().production_version).toBe('v1.4.2');
});

test('a block leaves the environment byte-identical, hash included', () => {
  const before = readSimulatedEnvironment(envDir);
  executeThroughControlPlane(db, envDir, DEPLOY);
  executeThroughControlPlane(db, envDir, { ...DEPLOY, hmac_approval_token: 'prop-nope' });
  const after = readSimulatedEnvironment(envDir);
  expect(after).toEqual(before);
});
