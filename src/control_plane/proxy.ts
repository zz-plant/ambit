import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb, type Db } from "../engine/db.ts";
import { migrate } from "../engine/migrate.ts";
import { canExecute, runVerification, evidenceFor } from "../engine/assurance.ts";
import { beginRun, endRun, addEvent, recordIntervention, recordUse } from "../engine/telemetry.ts";
import { propose } from "../engine/planning.ts";
import { approveProposal, applyProposal, rollbackProposal, inverseOf, listProposals } from "../engine/governance.ts";
import { mintApproval, verifyApproval, proposalHash } from "../engine/approval.ts";
import { auditFor } from "../engine/audit.ts";

export interface MockEnvironmentState {
  environment: string;
  db_schema_version: string;
  staging_health: "passing" | "failing" | "unverified";
  api_keys_rotated: boolean;
  production_version: string;
  active_containers: string[];
  last_deployed_at: string | null;
  last_deployed_by: string | null;
  immutable_hash: string;
}

export interface AgentExecutionRequest {
  agent_id: string;
  intent: string;
  tool: string;
  capability_id: string;
  action?: string;
  target?: string;
  payload?: Record<string, any>;
  hmac_approval_token?: string | null;
  run_id?: string;
}

export interface OpenTelemetrySpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  start_time: string;
  end_time: string;
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    timestamp: string;
    attributes: Record<string, any>;
  }>;
  status: {
    code: "OK" | "ERROR";
    description?: string;
  };
}

export interface ControlPlaneResult {
  ok: boolean;
  status_code: string;
  exit_code: number;
  trace: OpenTelemetrySpan;
  intercept_reason?: string;
  remediation_proposal_id?: string;
  remediation_payload?: any;
  hmac_challenge?: string;
  audit_summary?: any;
  state_unchanged: boolean;
  pre_state: MockEnvironmentState;
  post_state: MockEnvironmentState;
}

/**
 * Compute sha256 checksum of environment state to prove state invariance.
 */
export function computeStateHash(state: Omit<MockEnvironmentState, "immutable_hash">): string {
  const serialized = JSON.stringify(state, Object.keys(state).sort());
  return createHmac("sha256", "ambit-state-checksum").update(serialized).digest("hex");
}

export function createInitialMockEnvironment(envDir: string): MockEnvironmentState {
  mkdirSync(envDir, { recursive: true });
  const raw: Omit<MockEnvironmentState, "immutable_hash"> = {
    environment: "production",
    db_schema_version: "v2.1.0-migrated",
    staging_health: "failing", // Unverified / failing staging check
    api_keys_rotated: false,
    production_version: "v1.4.2",
    active_containers: ["web-prod-1", "web-prod-2"],
    last_deployed_at: "2026-08-25 12:00:00",
    last_deployed_by: "human:ops-lead",
  };
  const hash = computeStateHash(raw);
  const state: MockEnvironmentState = { ...raw, immutable_hash: hash };
  writeFileSync(join(envDir, "environment_state.json"), JSON.stringify(state, null, 2) + "\n");
  return state;
}

export function readMockEnvironment(envDir: string): MockEnvironmentState {
  const p = join(envDir, "environment_state.json");
  if (!existsSync(p)) return createInitialMockEnvironment(envDir);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeMockEnvironment(envDir: string, state: MockEnvironmentState): void {
  const { immutable_hash, ...rest } = state;
  const hash = computeStateHash(rest);
  const updated: MockEnvironmentState = { ...rest, immutable_hash: hash };
  writeFileSync(join(envDir, "environment_state.json"), JSON.stringify(updated, null, 2) + "\n");
}

/**
 * Initialize Ambit control plane schema and governance DAG for the production deployment scenario.
 */
export function setupControlPlaneGraph(db: Db): void {
  migrate(db);

  // Define actors
  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('human:security-lead', 'Alice Security Lead', 'governance', 'Human Security and Release Authority', 'human', 'active', 'actor', 'reliable')`).run();

  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('agent:deployer', 'Autonomous Deploy Agent', 'ai-ml', 'Automated CI/CD Orchestration Agent', 'agent', 'active', 'actor', 'reliable')`).run();

  // Define capability DAG nodes
  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('combo:db-migration', 'Database Migration', 'infra', 'Executes database schema migration', 'skill', 'unlocked', 'capability', 'verified')`).run();

  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('combo:staging-healthcheck', 'Staging Health Check', 'infra', 'Validates staging environment health and smoke tests', 'skill', 'unlocked', 'capability', 'degraded')`).run();

  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('combo:api-key-rotation', 'API Key Rotation', 'sec', 'Rotates sensitive external API credentials', 'skill', 'unlocked', 'capability', 'verified')`).run();

  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('combo:deploy-to-production', 'Deploy To Production', 'infra', 'Promotes build container to production traffic', 'skill', 'unlocked', 'capability', 'configured')`).run();

  // Define contract action
  db.prepare(`INSERT OR REPLACE INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
              VALUES ('act:deploy-to-production/deploy', 'deploy to production', 'infra', 'Live traffic rollout', 'action', 'unlocked', 'action', 'configured')`).run();

  // Define DAG dependencies
  db.prepare(`INSERT OR REPLACE INTO dependencies (from_capability, to_capability, is_hard_requisite, kind)
              VALUES ('combo:db-migration', 'combo:deploy-to-production', 1, 'requires')`).run();

  db.prepare(`INSERT OR REPLACE INTO dependencies (from_capability, to_capability, is_hard_requisite, kind)
              VALUES ('combo:staging-healthcheck', 'combo:deploy-to-production', 1, 'requires')`).run();

  db.prepare(`INSERT OR REPLACE INTO dependencies (from_capability, to_capability, is_hard_requisite, kind)
              VALUES ('combo:api-key-rotation', 'combo:deploy-to-production', 1, 'requires')`).run();

  // Authority rules: deploy-to-production action requires 'confirm' mode (Human-in-the-loop HMAC signed approval)
  db.prepare(`INSERT OR REPLACE INTO authority (capability_id, action, mode, holder, scope, source, note)
              VALUES ('combo:deploy-to-production', 'execute', 'confirm', '', 'env:production', 'policy:pci-dss-sec-4', 'Production rollouts require explicit human security lead approval')`).run();

  db.prepare(`INSERT OR REPLACE INTO authority (capability_id, action, mode, holder, scope, source, note)
              VALUES ('act:deploy-to-production/deploy', 'execute', 'confirm', '', 'env:production', 'policy:pci-dss-sec-4', 'Production deploy action requires signed human artifact')`).run();
}

/**
 * Execute an agent tool invocation through Ambit's Control Plane Proxy.
 */
export function executeThroughControlPlane(
  db: Db,
  envDir: string,
  request: AgentExecutionRequest
): ControlPlaneResult {
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const startTime = new Date().toISOString();

  const preState = readMockEnvironment(envDir);
  const preHash = preState.immutable_hash;

  const runId = request.run_id || `run-incident-${Date.now()}`;
  beginRun(db, {
    id: runId,
    goal: request.intent,
    runType: "task",
    source: "mcp_proxy",
  });

  const spanEvents: Array<{ name: string; timestamp: string; attributes: Record<string, any> }> = [];

  spanEvents.push({
    name: "tool_invocation_received",
    timestamp: new Date().toISOString(),
    attributes: {
      agent_id: request.agent_id,
      tool: request.tool,
      capability_id: request.capability_id,
      intent: request.intent,
      target: request.target || "env:production",
    },
  });

  addEvent(db, runId, {
    kind: "discovery",
    actor: request.agent_id,
    capabilityId: request.capability_id,
    action: request.action || "execute",
    detail: `Agent attempting tool invocation ${request.tool} for ${request.capability_id}`,
  });

  // 1. DAG & Prerequisites Check
  const capabilityId = request.capability_id.startsWith("combo:") ? request.capability_id : `combo:${request.capability_id}`;
  const action = request.action || "execute";
  const target = request.target || "env:production";

  // Check dependencies
  const deps = db.prepare(`
    SELECT d.from_capability, c.name, c.lifecycle, c.state
    FROM dependencies d
    JOIN capabilities c ON c.id = d.from_capability
    WHERE d.to_capability = ? AND d.is_hard_requisite = 1
  `).all(capabilityId) as Array<{ from_capability: string; name: string; lifecycle: string; state: string }>;

  const unverifiedDeps = deps.filter(d => d.lifecycle === "degraded" || d.lifecycle === "broken" || d.lifecycle === "unknown");
  const capabilityPath = deps.map(d => d.from_capability).concat([capabilityId]);

  spanEvents.push({
    name: "dag_evaluation",
    timestamp: new Date().toISOString(),
    attributes: {
      capability_path: JSON.stringify(capabilityPath),
      total_dependencies: deps.length,
      unverified_dependencies: JSON.stringify(unverifiedDeps.map(d => d.from_capability)),
    },
  });

  // 2. Authority & Decision Evaluation
  const decision = canExecute(db, {
    actor: request.agent_id,
    capability: capabilityId,
    action,
    target,
  });

  let blockedReason: string | null = null;
  let missingAuthorizationNode: string | null = null;

  if (unverifiedDeps.length > 0) {
    blockedReason = `Unmet hard prerequisite in DAG: [${unverifiedDeps.map(d => `${d.name} (${d.lifecycle})`).join(", ")}]`;
    missingAuthorizationNode = unverifiedDeps[0].from_capability;
  } else if (decision.decision === "DENY") {
    blockedReason = `Authority denied: ${decision.reason}`;
    missingAuthorizationNode = capabilityId;
  } else if (decision.decision === "CONFIRM") {
    // Mode is confirm: check if valid HMAC approval token is supplied
    if (!request.hmac_approval_token) {
      blockedReason = `Action requires explicit human authorization with HMAC signature (Governing grant: ${decision.governing_grant?.source || "pci-dss-sec-4"})`;
      missingAuthorizationNode = "human:security-lead";
    } else {
      // Verify token
      const proposalId = request.hmac_approval_token;
      const verifyRes = verifyApproval(db, proposalId, "human:security-lead");
      if (!verifyRes.ok) {
        blockedReason = `Invalid HMAC approval artifact: ${verifyRes.reason}`;
        missingAuthorizationNode = "human:security-lead";
      }
    }
  }

  // Handle Blocked Execution
  if (blockedReason) {
    const challengeHash = createHmac("sha256", "ambit-challenge")
      .update(`${runId}|${capabilityId}|${target}|${Date.now()}`)
      .digest("hex")
      .slice(0, 24);

    // Draft a formal remediation proposal in the graph
    const proposalId = `prop-remediate-${Date.now()}`;
    const remediationSteps = [
      {
        id: "combo:staging-healthcheck",
        name: "Staging Health Check Verification",
        chosen: "automated-health-and-smoke-test-verification",
        setup_seconds: 10,
        requires_person: false,
        inverse: { remove: [] },
      },
      {
        id: capabilityId,
        name: "Authorized Production Release Deployment",
        chosen: "blue-green-canary-rollout-v2.0.0",
        setup_seconds: 60,
        requires_person: true,
        inverse: { remove: [] },
      },
    ];

    const simulation = {
      frontier_before: 4,
      frontier_after: 5,
      acquired: [{ id: capabilityId, name: "Deploy To Production" }],
      unblocked: [{ id: "act:deploy-to-production/deploy", name: "Live traffic rollout" }],
      note: "Remediation satisfies staging verification prerequisite and unlocks human HMAC-gated deployment.",
    };

    db.prepare(`
      INSERT INTO proposals (id, goal, status, steps, simulated, created_at)
      VALUES (?, ?, 'draft', ?, ?, datetime('now'))
    `).run(
      proposalId,
      `Remediate and Authorize Deploy to Production (${request.payload?.target_version || "v2.0.0"})`,
      JSON.stringify(remediationSteps),
      JSON.stringify(simulation)
    );

    // Record intervention in telemetry
    recordIntervention(db, runId, "human:security-lead", {
      kind: "authority",
      capabilityId,
      action,
      activeSeconds: 0,
      waitingSeconds: 0,
    });

    addEvent(db, runId, {
      kind: "intercept",
      actor: "ambit:control_plane",
      capabilityId,
      action: "block",
      detail: `AMBIT_BLOCKED_UNAUTHORIZED: ${blockedReason}`,
    });

    endRun(db, runId, "blocked_unauthorized");

    spanEvents.push({
      name: "AMBIT_BLOCKED_UNAUTHORIZED",
      timestamp: new Date().toISOString(),
      attributes: {
        reason: blockedReason,
        missing_authorization_node: missingAuthorizationNode,
        capability_path: JSON.stringify(capabilityPath),
        hmac_challenge: challengeHash,
        remediation_proposal_id: proposalId,
      },
    });

    const postState = readMockEnvironment(envDir);
    const stateUnchanged = postState.immutable_hash === preHash;

    const span: OpenTelemetrySpan = {
      trace_id: traceId,
      span_id: spanId,
      name: `AmbitControlPlane.intercept:${request.tool}`,
      start_time: startTime,
      end_time: new Date().toISOString(),
      attributes: {
        "ambit.decision": "DENY",
        "ambit.status_code": "AMBIT_BLOCKED_UNAUTHORIZED",
        "ambit.capability_id": capabilityId,
        "ambit.missing_authorization_node": missingAuthorizationNode,
        "ambit.capability_path": JSON.stringify(capabilityPath),
        "ambit.hmac_challenge": challengeHash,
        "ambit.state_unchanged": stateUnchanged,
      },
      events: spanEvents,
      status: {
        code: "ERROR",
        description: `AMBIT_BLOCKED_UNAUTHORIZED: ${blockedReason}`,
      },
    };

    const auditSummary = auditFor(db, runId);

    return {
      ok: false,
      status_code: "AMBIT_BLOCKED_UNAUTHORIZED",
      exit_code: 2, // Exit code indicating control plane block
      trace: span,
      intercept_reason: blockedReason,
      remediation_proposal_id: proposalId,
      remediation_payload: {
        proposal_id: proposalId,
        challenge: challengeHash,
        missing_node: missingAuthorizationNode,
        required_approver: "human:security-lead",
        command_to_remediate: `ambit approve ${proposalId} human:security-lead`,
      },
      hmac_challenge: challengeHash,
      audit_summary: auditSummary,
      state_unchanged: stateUnchanged,
      pre_state: preState,
      post_state: postState,
    };
  }

  // 3. Execution (Authorized with valid HMAC artifact and verified prerequisites)
  recordUse(db, runId, capabilityId, { durationSeconds: 1.2 });
  addEvent(db, runId, {
    kind: "execute",
    actor: request.agent_id,
    capabilityId,
    action,
    detail: "Execution permitted via valid human HMAC approval artifact",
  });

  // Perform Mock Production Transition Safely
  const updatedState: MockEnvironmentState = {
    ...preState,
    production_version: request.payload?.target_version || "v2.0.0",
    last_deployed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    last_deployed_by: `agent:${request.agent_id} [authorized-by:human:security-lead]`,
    active_containers: ["web-prod-v2-1", "web-prod-v2-2"],
  };
  writeMockEnvironment(envDir, updatedState);
  const postState = readMockEnvironment(envDir);

  endRun(db, runId, "completed", 50000);

  spanEvents.push({
    name: "execution_success",
    timestamp: new Date().toISOString(),
    attributes: {
      new_version: postState.production_version,
      deployed_by: postState.last_deployed_by,
    },
  });

  const span: OpenTelemetrySpan = {
    trace_id: traceId,
    span_id: spanId,
    name: `AmbitControlPlane.execute:${request.tool}`,
    start_time: startTime,
    end_time: new Date().toISOString(),
    attributes: {
      "ambit.decision": "ALLOW",
      "ambit.status_code": "AMBIT_EXECUTION_AUTHORIZED",
      "ambit.capability_id": capabilityId,
      "ambit.applied_version": postState.production_version,
    },
    events: spanEvents,
    status: {
      code: "OK",
    },
  };

  const auditSummary = auditFor(db, runId);

  return {
    ok: true,
    status_code: "AMBIT_EXECUTION_AUTHORIZED",
    exit_code: 0,
    trace: span,
    audit_summary: auditSummary,
    state_unchanged: false,
    pre_state: preState,
    post_state: postState,
  };
}
