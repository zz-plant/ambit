import json
import os
import subprocess
import tempfile
import pytest
from pathlib import Path

CLI_PATH = Path(__file__).parent.parent.parent / "src" / "control_plane" / "cli.ts"


@pytest.fixture
def test_env():
    """Create an isolated test directory with mock environment and Ambit SQLite database."""
    with tempfile.TemporaryDirectory(prefix="ambit-incident-test-") as tmpdir:
        tmp_path = Path(tmpdir)
        env_dir = tmp_path / "mock_prod"
        db_path = tmp_path / "graph.db"
        approval_key_path = tmp_path / "ambit-approval.key"

        # Initialize mock environment and Ambit control plane graph
        setup_cmd = [
            "node",
            "--experimental-sqlite",
            str(CLI_PATH),
            "setup-env",
            str(env_dir),
            str(db_path),
        ]
        env_vars = {
            **os.environ,
            "TOOLCHAIN_DB": str(db_path),
            "AMBIT_DB": str(db_path),
            "AMBIT_APPROVAL_KEY": "test-secret-hmac-key-for-ambit-safety-control-plane-32chars",
        }
        res = subprocess.run(setup_cmd, capture_output=True, text=True, env=env_vars, check=True)
        setup_data = json.loads(res.stdout)

        yield {
            "tmp_path": tmp_path,
            "env_dir": env_dir,
            "db_path": db_path,
            "env_vars": env_vars,
            "initial_state": setup_data["env"],
        }


def test_agent_unauthorized_deploy_intercepted(test_env):
    """
    TDD Test 1: Simulates an autonomous agent attempting an unauthorized,
    out-of-order execution of `deploy_to_production` when staging is degraded
    and human HMAC approval is missing.
    """
    env_dir = test_env["env_dir"]
    db_path = test_env["db_path"]
    env_vars = test_env["env_vars"]

    # Read state before execution
    state_file = env_dir / "environment_state.json"
    with open(state_file, "r") as f:
        pre_state = json.load(f)

    # Agent prompt / payload attempting destructive deploy
    agent_request = {
        "agent_id": "agent:deployer",
        "intent": "Deploy release v2.0.0 to production immediately",
        "tool": "deploy_to_production",
        "capability_id": "combo:deploy-to-production",
        "action": "execute",
        "target": "env:production",
        "payload": {
            "target_version": "v2.0.0",
            "image": "registry.internal/app:v2.0.0",
            "force": True,
        },
        "hmac_approval_token": None,  # No HMAC token provided
    }

    # Execute through Ambit Control Plane
    cmd = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "exec",
        str(env_dir),
        str(db_path),
        json.dumps(agent_request),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, env=env_vars)

    # 1. Asserts execution terminates with exit code indicating control plane block
    assert proc.returncode == 2, f"Expected exit code 2 (AMBIT_BLOCKED_UNAUTHORIZED), got {proc.returncode}"

    output = json.loads(proc.stdout)
    assert output["ok"] is False
    assert output["status_code"] == "AMBIT_BLOCKED_UNAUTHORIZED"

    # 2. Asserts state of simulated environment remains untouched (pre_state == post_state)
    with open(state_file, "r") as f:
        post_state = json.load(f)

    assert pre_state == post_state, "Environment state was modified despite control plane block!"
    assert output["state_unchanged"] is True
    assert output["pre_state"]["immutable_hash"] == output["post_state"]["immutable_hash"]
    assert post_state["production_version"] == "v1.4.2"

    # 3. Asserts trace and audit log include valid capability path, missing authorization node, and HMAC challenge
    trace = output["trace"]
    assert trace["status"]["code"] == "ERROR"
    assert "AMBIT_BLOCKED_UNAUTHORIZED" in trace["status"]["description"]

    # Capability path validation
    cap_path_attr = trace["attributes"]["ambit.capability_path"]
    cap_path = json.loads(cap_path_attr) if isinstance(cap_path_attr, str) else cap_path_attr
    assert "combo:db-migration" in cap_path
    assert "combo:staging-healthcheck" in cap_path
    assert "combo:deploy-to-production" in cap_path

    # Missing authorization node & HMAC challenge
    missing_node = trace["attributes"]["ambit.missing_authorization_node"]
    assert missing_node in ["combo:staging-healthcheck", "human:security-lead"]

    hmac_challenge = trace["attributes"]["ambit.hmac_challenge"]
    assert hmac_challenge is not None
    assert len(hmac_challenge) > 10

    # Remediation proposal created in graph
    proposal_id = output["remediation_proposal_id"]
    assert proposal_id.startswith("prop-")


def test_remediation_workflow_and_safe_state_transition(test_env):
    """
    TDD Test 2: Simulates the complete human-in-the-loop remediation flow:
    1. Agent blocked on unauthorized deploy attempt
    2. Staging health check is verified
    3. Human Security Lead reviews proposal and signs HMAC approval challenge
    4. Re-execution with valid HMAC token succeeds
    5. Environment state transitions safely to v2.0.0
    6. Audit trail contains end-to-end records of interception and authorized execution
    """
    env_dir = test_env["env_dir"]
    db_path = test_env["db_path"]
    env_vars = test_env["env_vars"]

    # Step 1: Initial blocked attempt
    agent_request = {
        "agent_id": "agent:deployer",
        "intent": "Deploy release v2.0.0 to production",
        "tool": "deploy_to_production",
        "capability_id": "combo:deploy-to-production",
        "action": "execute",
        "target": "env:production",
        "payload": {"target_version": "v2.0.0"},
        "hmac_approval_token": None,
    }

    cmd_block = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "exec",
        str(env_dir),
        str(db_path),
        json.dumps(agent_request),
    ]
    proc_block = subprocess.run(cmd_block, capture_output=True, text=True, env=env_vars)
    assert proc_block.returncode == 2
    block_output = json.loads(proc_block.stdout)
    proposal_id = block_output["remediation_proposal_id"]

    # Step 2: Remediate staging healthcheck prerequisite
    cmd_verify = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "verify-node",
        str(db_path),
        "combo:staging-healthcheck",
        "verified",
    ]
    subprocess.run(cmd_verify, capture_output=True, text=True, env=env_vars, check=True)

    # Step 3: Human Security Lead approves proposal, minting cryptographic HMAC artifact
    cmd_approve = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "approve",
        str(db_path),
        proposal_id,
        "human:security-lead",
    ]
    res_approve = subprocess.run(cmd_approve, capture_output=True, text=True, env=env_vars, check=True)
    approval_data = json.loads(res_approve.stdout)
    assert approval_data["proposal"] == proposal_id
    assert approval_data["approved_by"] == "Alice Security Lead"
    assert "artifact" in approval_data
    assert "sig" in approval_data["artifact"]

    # Step 4: Re-execute tool with valid HMAC approval token
    authorized_request = {
        **agent_request,
        "hmac_approval_token": proposal_id,
    }
    cmd_exec = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "exec",
        str(env_dir),
        str(db_path),
        json.dumps(authorized_request),
    ]
    proc_exec = subprocess.run(cmd_exec, capture_output=True, text=True, env=env_vars)
    assert proc_exec.returncode == 0, f"Expected 0, got {proc_exec.returncode}: {proc_exec.stderr}"

    exec_output = json.loads(proc_exec.stdout)
    assert exec_output["ok"] is True
    assert exec_output["status_code"] == "AMBIT_EXECUTION_AUTHORIZED"
    assert exec_output["trace"]["status"]["code"] == "OK"

    # Step 5: Assert state safely transitioned
    state_file = env_dir / "environment_state.json"
    with open(state_file, "r") as f:
        final_state = json.load(f)

    assert final_state["production_version"] == "v2.0.0"
    assert "authorized-by:human:security-lead" in final_state["last_deployed_by"]

    # Step 6: Verify full audit trail in Ambit ledger
    cmd_audit = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "audit",
        str(db_path),
        proposal_id,
    ]
    res_audit = subprocess.run(cmd_audit, capture_output=True, text=True, env=env_vars, check=True)
    audit_data = json.loads(res_audit.stdout)
    assert audit_data["proposal"] == proposal_id
    assert audit_data["status"] == "approved"
    assert audit_data["approval"]["by"] == "human:security-lead"
    assert audit_data["approval"]["artifact"]["signed"] is True


def test_tampered_hmac_approval_rejected_and_state_protected(test_env):
    """
    TDD Test 3: Asserts that tampered, corrupted, or forged HMAC tokens are rejected,
    preventing unauthorized state transitions.
    """
    env_dir = test_env["env_dir"]
    db_path = test_env["db_path"]
    env_vars = test_env["env_vars"]

    state_file = env_dir / "environment_state.json"
    with open(state_file, "r") as f:
        pre_state = json.load(f)

    # Attempt execution with invalid / forged token
    forged_request = {
        "agent_id": "agent:deployer",
        "intent": "Deploy release v2.0.0 using forged approval",
        "tool": "deploy_to_production",
        "capability_id": "combo:deploy-to-production",
        "action": "execute",
        "target": "env:production",
        "payload": {"target_version": "v2.0.0"},
        "hmac_approval_token": "prop-forged-fake-123456",
    }

    cmd = [
        "node",
        "--experimental-sqlite",
        str(CLI_PATH),
        "exec",
        str(env_dir),
        str(db_path),
        json.dumps(forged_request),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env_vars)
    assert proc.returncode == 2

    out = json.loads(proc.stdout)
    assert out["ok"] is False
    assert out["status_code"] == "AMBIT_BLOCKED_UNAUTHORIZED"
    assert out["state_unchanged"] is True

    with open(state_file, "r") as f:
        post_state = json.load(f)

    assert pre_state == post_state, "State was compromised by forged token!"

