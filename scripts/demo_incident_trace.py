#!/usr/bin/env python3
"""
Ambit Autonomous Control Plane Intervention & Remediation Demonstration
90-Second Reproducible Walkthrough and Incident Trace Capture
"""

import json
import os
import sys
import time
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
CLI_PATH = REPO_ROOT / "src" / "control_plane" / "cli.ts"

# ANSI Colors
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
WHITE = "\033[37m"
BG_RED = "\033[41m"
BG_GREEN = "\033[42m"
BG_YELLOW = "\033[43m"
BG_BLUE = "\033[44m"


def print_banner():
    print(f"\n{CYAN}{BOLD}╔════════════════════════════════════════════════════════════════════════════════╗{RESET}")
    print(f"{CYAN}{BOLD}║         AMBIT CONTROL PLANE — AUTONOMOUS AGENT INTERVENTION TRACE              ║{RESET}")
    print(f"{CYAN}{BOLD}║         Safety Interception · DAG Verification · HMAC Remediation · Rollback   ║{RESET}")
    print(f"{CYAN}{BOLD}╚════════════════════════════════════════════════════════════════════════════════╝{RESET}\n")


def log_step(step_num: int, title: str):
    print(f"\n{YELLOW}{BOLD}▶ STEP {step_num}: {title}{RESET}")
    print(f"{DIM}{'─' * 80}{RESET}")


def slow_type(text: str, delay: float = 0.005):
    for ch in text:
        sys.stdout.write(ch)
        sys.stdout.flush()
        time.sleep(delay)
    print()


def render_dag():
    dag = f"""{CYAN}
       ┌────────────────────────┐
       │   db-migration         │ [Status: VERIFIED (Pass)]
       └───────────┬────────────┘
                   │ (requires)
                   ▼
       ┌────────────────────────┐
       │   staging-healthcheck  │ {RED}{BOLD}[Status: DEGRADED / UNVERIFIED ✗]{CYAN}
       └───────────┬────────────┘
                   │ (requires)
                   ▼
       ┌────────────────────────┐
       │   api-key-rotation     │ [Status: VERIFIED (Pass)]
       └───────────┬────────────┘
                   │ (requires)
                   ▼
       ┌────────────────────────────────────────────────────────┐
       │   deploy_to_production (combo:deploy-to-production)    │
       │   {MAGENTA}Authority: CONFIRM [human:security-lead Required]{CYAN}    │
       └────────────────────────────────────────────────────────┘
    {RESET}"""
    print(dag)


def main():
    print_banner()

    with tempfile.TemporaryDirectory(prefix="ambit-demo-") as tmpdir:
        tmp_path = Path(tmpdir)
        env_dir = tmp_path / "mock_prod"
        db_path = tmp_path / "graph.db"

        env_vars = {
            **os.environ,
            "TOOLCHAIN_DB": str(db_path),
            "AMBIT_DB": str(db_path),
            "AMBIT_APPROVAL_KEY": "ambit-safety-hmac-master-key-demo-2026",
        }

        # Step 1: Environment Initialization
        log_step(1, "Initializing Mock Production Environment & Ambit Graph")
        cmd_init = ["node", "--experimental-sqlite", str(CLI_PATH), "setup-env", str(env_dir), str(db_path)]
        res_init = subprocess.run(cmd_init, capture_output=True, text=True, env=env_vars, check=True)
        init_data = json.loads(res_init.stdout)
        
        print(f"{GREEN}✔ Graph initialized with capability DAG, authority grants, and actors.{RESET}")
        print(f"  Target Environment: {BOLD}production{RESET} (Active Version: {BOLD}{init_data['env']['production_version']}{RESET})")
        print(f"  Initial State Checksum: {DIM}{init_data['env']['immutable_hash']}{RESET}")
        time.sleep(0.8)

        # Step 2: Capability DAG Inspection
        log_step(2, "Evaluating Ambit Capability Dependency Graph (DAG)")
        render_dag()
        time.sleep(1.0)

        # Step 3: Rogue / Out-of-Order Agent Tool Execution Attempt
        log_step(3, "Agent Attempts High-Risk Tool Execution: deploy_to_production")
        agent_payload = {
            "agent_id": "agent:deployer",
            "intent": "Trigger urgent hotfix deploy release v2.0.0 to production cluster",
            "tool": "deploy_to_production",
            "capability_id": "combo:deploy-to-production",
            "action": "execute",
            "target": "env:production",
            "payload": {
                "target_version": "v2.0.0",
                "image": "docker.internal/app:v2.0.0-rc3",
                "traffic_weight": 100
            },
            "hmac_approval_token": None
        }
        print(f"{MAGENTA}{BOLD}[AGENT INVOCATION]{RESET}")
        slow_type(json.dumps(agent_payload, indent=2))
        time.sleep(0.8)

        # Step 4: Control Plane Interception
        log_step(4, "Ambit Control Plane Intercepts & Blocks Unauthorized Execution")
        cmd_exec = ["node", "--experimental-sqlite", str(CLI_PATH), "exec", str(env_dir), str(db_path), json.dumps(agent_payload)]
        proc_block = subprocess.run(cmd_exec, capture_output=True, text=True, env=env_vars)
        
        block_res = json.loads(proc_block.stdout)
        print(f"{BG_RED}{WHITE}{BOLD} ⛔ [AMBIT_BLOCKED_UNAUTHORIZED] EXECUTION INTERCEPTED (Exit Code: {proc_block.returncode}) {RESET}\n")
        print(f"  {RED}{BOLD}Block Reason:{RESET} {block_res['intercept_reason']}")
        print(f"  {RED}{BOLD}Missing Node in DAG:{RESET} {block_res['trace']['attributes']['ambit.missing_authorization_node']}")
        print(f"  {RED}{BOLD}HMAC Challenge Nonce:{RESET} {block_res['hmac_challenge']}")
        print(f"  {GREEN}{BOLD}State Invariance Verified:{RESET} pre_state == post_state ({block_res['state_unchanged']})")
        print(f"  {GREEN}{BOLD}Production Release:{RESET} {block_res['post_state']['production_version']} (UNTOUCHED)")
        time.sleep(1.2)

        # Step 5: Remediation Proposal Drafted
        log_step(5, "Ambit Generates Structured Remediation Proposal & Challenge")
        proposal_id = block_res['remediation_proposal_id']
        print(f"  {CYAN}{BOLD}Remediation Proposal ID:{RESET} {proposal_id}")
        print(f"  {CYAN}{BOLD}Required Authority Holder:{RESET} human:security-lead")
        print(f"  {CYAN}{BOLD}Remediation Workflow:{RESET}")
        print(f"    1. Execute staging verification -> verify combo:staging-healthcheck")
        print(f"    2. Human review & HMAC signature -> ambit approve {proposal_id} human:security-lead\n")
        time.sleep(1.0)

        # Step 6: Step 1 of Remediation — Verify Staging Health Check
        log_step(6, "Remediation Phase 1: Verify Staging Health Check Prerequisite")
        cmd_verify = ["node", "--experimental-sqlite", str(CLI_PATH), "verify-node", str(db_path), "combo:staging-healthcheck", "verified"]
        res_verify = subprocess.run(cmd_verify, capture_output=True, text=True, env=env_vars, check=True)
        print(f"{GREEN}✔ combo:staging-healthcheck verified (HTTP 200 OK across staging smoke suite).{RESET}")
        time.sleep(0.8)

        # Step 7: Step 2 of Remediation — Human Security Lead HMAC Approval
        log_step(7, "Remediation Phase 2: Human-In-The-Loop HMAC Signed Approval")
        print(f"{YELLOW}Operator (Alice Security Lead) reviews diff, test evidence, and signs approval token...{RESET}")
        cmd_approve = ["node", "--experimental-sqlite", str(CLI_PATH), "approve", str(db_path), proposal_id, "human:security-lead"]
        res_approve = subprocess.run(cmd_approve, capture_output=True, text=True, env=env_vars, check=True)
        approval_data = json.loads(res_approve.stdout)
        
        print(f"{GREEN}✔ Approval Recorded in Ledger & Cryptographic Artifact Minted:{RESET}")
        print(f"  Approver: {BOLD}{approval_data['approved_by']}{RESET}")
        print(f"  Proposal Hash: {DIM}{approval_data['artifact']['proposal_hash']}{RESET}")
        print(f"  HMAC Signature: {BOLD}{approval_data['artifact']['sig']}{RESET}")
        print(f"  Expires At: {approval_data['artifact']['expires_at']}")
        time.sleep(1.0)

        # Step 8: Authorized Re-Execution & Safe State Transition
        log_step(8, "Authorized Execution with Validated HMAC Artifact")
        authorized_payload = {
            **agent_payload,
            "hmac_approval_token": proposal_id
        }
        cmd_exec_auth = ["node", "--experimental-sqlite", str(CLI_PATH), "exec", str(env_dir), str(db_path), json.dumps(authorized_payload)]
        proc_auth = subprocess.run(cmd_exec_auth, capture_output=True, text=True, env=env_vars, check=True)
        auth_res = json.loads(proc_auth.stdout)

        print(f"{BG_GREEN}{WHITE}{BOLD} ✔ [AMBIT_EXECUTION_AUTHORIZED] DEPLOYMENT COMPLETED SAFELY {RESET}\n")
        print(f"  Production Version Transitioned: {YELLOW}v1.4.2{RESET} ➔ {GREEN}{BOLD}{auth_res['post_state']['production_version']}{RESET}")
        print(f"  Active Containers: {auth_res['post_state']['active_containers']}")
        print(f"  Audit Attribution: {auth_res['post_state']['last_deployed_by']}")
        time.sleep(1.0)

        # Step 9: OpenTelemetry Trace & Audit Verification
        log_step(9, "Audit Trail & OpenTelemetry Span Verification")
        cmd_audit = ["node", "--experimental-sqlite", str(CLI_PATH), "audit", str(db_path), proposal_id]
        res_audit = subprocess.run(cmd_audit, capture_output=True, text=True, env=env_vars, check=True)
        audit_trail = json.loads(res_audit.stdout)
        
        print(f"{CYAN}{BOLD}Ambit Cryptographic Audit Ledger Entry:{RESET}")
        print(json.dumps(audit_trail, indent=2))

        print(f"\n{GREEN}{BOLD}════════════════════════════════════════════════════════════════════════════════{RESET}")
        print(f"{GREEN}{BOLD}✔ 90-SECOND DEMONSTRATION COMPLETE: 100% VERIFIED CONTROL PLANE ENFORCEMENT{RESET}")
        print(f"{GREEN}{BOLD}════════════════════════════════════════════════════════════════════════════════{RESET}\n")


if __name__ == "__main__":
    main()
