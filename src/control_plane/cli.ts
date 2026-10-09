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
import { AdapterRefusal, commandProblem, selectAdapter } from './docker.ts';

/**
 * The adapter this invocation asked for, or a refusal printed as the answer.
 * Chosen before the graph is opened, so a Docker that cannot run the step
 * leaves no run, no proposal and no state file behind.
 */
function adapterOrExit(envDir: string, flag: string | undefined) {
  try {
    return selectAdapter(envDir, { adapter: flag });
  } catch (e) {
    if (!(e instanceof AdapterRefusal)) throw e;
    console.log(
      JSON.stringify({ error: e.message, adapter: flag || process.env.AMBIT_ADAPTER }, null, 2)
    );
    process.exit(1);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const adapterFlag = argv.find(a => a.startsWith('--adapter='))?.slice('--adapter='.length);
  const args = argv.filter(a => !a.startsWith('--adapter='));
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`Ambit Control Plane Interceptor CLI
Commands:
  setup-env <envDir> <dbPath>
  exec <envDir> <dbPath> '<requestJson>'
    requestJson supports: { agent_id, intent, tool, capability_id, simulate: true, break_glass: true, break_glass_reason: "..." }
  verify-node <dbPath> <nodeId> <status>
  approve <dbPath> <proposalId> <approver>
  audit <dbPath> <target>

Environment adapter (setup-env and exec):
  --adapter=simulated   the default: the change is merged into a JSON file and nothing runs
  --adapter=docker      an approved step's payload.command runs in a throwaway container
  AMBIT_ADAPTER         the same choice; --adapter wins
  AMBIT_DOCKER_IMAGE    the image a step runs in (default alpine:3.20); never pulled for you
  AMBIT_DOCKER_NETWORK  none (default) or bridge, given only to a step whose capability
                        holds a grant for the network action
  AMBIT_DOCKER_WORKDIR  a directory mounted read-only at /work; none by default
`);
    process.exit(0);
  }

  if (command === 'setup-env') {
    const envDir = args[1] || './mock_env';
    const dbPath = args[2] || './graph.db';
    const adapter = adapterOrExit(envDir, adapterFlag);
    const db = getDb(dbPath);
    setupControlPlaneGraph(db);
    const envState = createInitialSimulatedEnvironment(envDir);
    db.close();
    console.log(
      JSON.stringify(
        { status: 'initialized', env: envState, db: dbPath, adapter: adapter.name },
        null,
        2
      )
    );
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
    const adapter = adapterOrExit(envDir, adapterFlag);
    // A Docker step without a command could only fail after the gate had
    // recorded it as permitted, so the request is refused before either.
    const missing =
      adapter.name === 'docker' && !request.simulate && commandProblem(request.payload?.command);
    if (missing) {
      console.log(JSON.stringify({ error: missing, adapter: adapter.name }, null, 2));
      process.exit(1);
    }
    const db = getDb(dbPath);
    const result = executeThroughControlPlane(db, envDir, request, adapter);
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
