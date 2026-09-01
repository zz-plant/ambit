#!/usr/bin/env node --experimental-sqlite
import { getDb } from '../engine/db.ts';
import { approveProposal } from '../engine/governance.ts';
import { auditFor } from '../engine/audit.ts';
import {
  createInitialSimulatedEnvironment,
  setupControlPlaneGraph,
  executeThroughControlPlane,
  type AgentExecutionRequest,
} from './proxy.ts';

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`Ambit Control Plane Interceptor CLI
Commands:
  setup-env <envDir> <dbPath>
  exec <envDir> <dbPath> '<requestJson>'
  verify-node <dbPath> <nodeId> <status>
  approve <dbPath> <proposalId> <approver>
  audit <dbPath> <target>
`);
    process.exit(0);
  }

  if (command === 'setup-env') {
    const envDir = args[1] || './mock_env';
    const dbPath = args[2] || './graph.db';
    const db = getDb(dbPath);
    setupControlPlaneGraph(db);
    const envState = createInitialSimulatedEnvironment(envDir);
    db.close();
    console.log(JSON.stringify({ status: 'initialized', env: envState, db: dbPath }, null, 2));
    process.exit(0);
  }

  if (command === 'exec') {
    const envDir = args[1];
    const dbPath = args[2];
    const rawReq = args[3];
    if (!envDir || !dbPath || !rawReq) {
      console.error("Usage: ambit-control-plane exec <envDir> <dbPath> '<requestJson>'");
      process.exit(1);
    }
    const request: AgentExecutionRequest = JSON.parse(rawReq);
    const db = getDb(dbPath);
    const result = executeThroughControlPlane(db, envDir, request);
    db.close();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exit_code);
  }

  if (command === 'verify-node') {
    const dbPath = args[1];
    const nodeId = args[2];
    const status = args[3] || 'verified';
    const db = getDb(dbPath);
    db.prepare('UPDATE capabilities SET lifecycle = ? WHERE id = ?').run(status, nodeId);
    db.prepare(
      "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, ?)"
    ).run(
      nodeId,
      status,
      status === 'verified' || status === 'reliable' ? 1 : 0,
      `Manual/automated verification check passed: ${status}`
    );
    db.close();
    console.log(JSON.stringify({ node: nodeId, lifecycle: status, verified: true }, null, 2));
    process.exit(0);
  }

  if (command === 'approve') {
    const dbPath = args[1];
    const proposalId = args[2];
    const approver = args[3] || 'human:security-lead';
    const db = getDb(dbPath);
    const res = approveProposal(db, proposalId, approver);
    db.close();
    console.log(JSON.stringify(res, null, 2));
    process.exit((res as any)?.error ? 1 : 0);
  }

  if (command === 'audit') {
    const dbPath = args[1];
    const target = args[2];
    const db = getDb(dbPath);
    const trail = auditFor(db, target);
    db.close();
    console.log(JSON.stringify(trail, null, 2));
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main();
