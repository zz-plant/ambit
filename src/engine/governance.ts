import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { configDefault } from './paths.ts';
import { getDb, type Db } from './db.ts';
import { runVerification } from './assurance.ts';
import { canExecute } from './assurance.ts';
import { seedFromConfig } from './discovery.ts';
import { mintApproval, verifyApproval } from './approval.ts';
import { pendingDrafts } from './attention.ts';

/**
 * The inverse of a declarative config patch: remove exactly what it adds.
 *
 * This is the gate for ever applying anything. A step may only run if its undo
 * is computed and stored *before* execution — not "we could probably reverse
 * this", but written down first or refused. Only additive patches over known
 * keys qualify, which is why an acquisition needing an installer or a running
 * service gets no inverse and is therefore not a candidate.
 *
 * Returns null when no inverse can be derived, and null is a refusal.
 */
function inverseOf(patch: any, currentConfig: any): any | null {
  if (!patch || typeof patch !== 'object') return null;
  const remove: string[] = [];
  const restore: Record<string, unknown> = {};

  for (const [section, entries] of Object.entries<any>(patch)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null;
    for (const key of Object.keys(entries)) {
      const existing = currentConfig?.[section]?.[key];
      // Overwriting something means the inverse must put the old value back,
      // and guessing at that is exactly the kind of "probably reversible" this
      // is meant to exclude.
      if (existing !== undefined) restore[`${section}.${key}`] = existing;
      else remove.push(`${section}.${key}`);
    }
  }
  return { remove, restore: Object.keys(restore).length ? restore : undefined };
}

/**
 * Records that a person approved a proposal.
 *
 * The approval is an edge from a `human:` node, so it is evidence in the graph
 * rather than a flag on a row — which means the ledger can later answer who
 * authorised a given expansion of the frontier. Approving changes nothing
 * about the world; it changes what is permitted to change it.
 */
/**
 * Approves several proposals in one act.
 *
 * Not a convenience. Every acquisition costs one interruption, and a person who
 * has to be interrupted once per proposal will approve fewer of them than a
 * person who reads a week's drafts together — so the batch is the difference
 * between an environment that grows and one that accumulates a backlog of
 * unread documents. Each is still approved individually underneath, with its
 * own artifact and its own recorded evidence; what is shared is the sitting
 * down.
 */
function approveProposals(db: Db, ids: string[], who?: string) {
  if (!ids.length) return { error: 'Usage: ambit approve <proposal-id> [<proposal-id>…] <person>' };
  if (ids.length === 1) return approveProposal(db, ids[0], who);
  const results = ids.map(id => ({ id, ...(approveProposal(db, id, who) as any) }));
  const approved = results.filter(r => !r.error);
  return {
    approved: approved.length,
    refused: results.length - approved.length,
    results,
    note: approved.length
      ? 'Each carries its own signed artifact. Apply them one at a time — apply verifies, and rolls back the one that fails rather than the batch.'
      : undefined,
  };
}

/**
 * Records that a person turned a proposal down, and why.
 *
 * Approval was recordable from the first version and refusal was not, which
 * made the graph's memory of decisions one-sided: it could say what someone had
 * agreed to and never what they had declined, so nothing could learn the shape
 * of a no. The reason is optional and is the most valuable part of the row.
 */
function rejectProposal(db: Db, proposalId?: string, who?: string, reason?: string) {
  if (!proposalId) return { error: 'Usage: ambit reject <proposal-id> <person> ["why"]' };
  const row = db.prepare('SELECT id, goal, status FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status === 'applied') {
    return {
      error: `${proposalId} has already been applied. ambit rollback ${proposalId} undoes it.`,
    };
  }
  const humanId = who ? (who.startsWith('human:') ? who : `human:${who}`) : null;
  if (!humanId) return { error: 'Name the person deciding: ambit reject <proposal-id> <person>' };
  const person = db
    .prepare("SELECT id, name FROM capabilities WHERE id = ? AND category = 'human'")
    .get(humanId);
  if (!person) {
    return {
      error: `${humanId} is not a person in the graph. Declare them in the actors block first.`,
    };
  }
  db.prepare(
    `INSERT INTO proposal_rejections (proposal_id, rejected_by, reason) VALUES (?, ?, ?)
     ON CONFLICT(proposal_id) DO UPDATE SET rejected_by = excluded.rejected_by, reason = excluded.reason`
  ).run(proposalId, humanId, reason ?? null);
  db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ?").run(proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('approval', ?, 'rejected', 0, ?)"
  ).run(humanId, `${proposalId}: ${row.goal}${reason ? ` — ${reason}` : ''}`);
  return {
    proposal: proposalId,
    goal: row.goal,
    rejected_by: person.name,
    reason,
    note: 'Recorded. A refusal teaches the next draft as much as an approval does — see ambit preferences --observed.',
  };
}

function approveProposal(db: Db, proposalId?: string, who?: string) {
  if (!proposalId) return { error: 'Usage: ambit approve <proposal-id> <person>' };
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status === 'approved')
    return { error: `${proposalId} is already approved by ${row.approved_by}.` };
  if (row.status === 'rejected')
    return {
      error: `${proposalId} was turned down. Draft a new one rather than re-approving this.`,
    };

  const humanId = who ? (who.startsWith('human:') ? who : `human:${who}`) : null;
  if (!humanId) return { error: 'Name the person approving: ambit approve <proposal-id> <person>' };
  const person = db
    .prepare("SELECT id, name FROM capabilities WHERE id = ? AND category = 'human'")
    .get(humanId);
  if (!person) {
    return {
      error: `${humanId} is not a person in the graph. Declare them in the actors block first — an approval has to come from someone accountable.`,
    };
  }

  const steps = JSON.parse(row.steps);
  const blocking = steps.filter((s: any) => !s.inverse);
  db.prepare(
    "UPDATE proposals SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?"
  ).run(humanId, proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('approval', ?, 'approved', 1, ?)"
  ).run(humanId, `${proposalId}: ${row.goal}`);

  // The approval broker mints the signed artifact the executor will verify:
  // proposal hash, actor, budget, scope, expiry, timestamp. Approving is
  // permission; the artifact is what makes it spendable, and only by apply.
  const minted = mintApproval(db, proposalId, { actor: humanId });

  return {
    proposal: proposalId,
    goal: row.goal,
    approved_by: person.name,
    applicable: blocking.length === 0,
    artifact: minted.artifact,
    steps_without_inverse: blocking.length ? blocking.map((s: any) => s.name) : undefined,
    note: blocking.length
      ? 'Approved, and still not applicable: these steps have no computed inverse, and nothing runs without one.'
      : 'Approved. Every step has an inverse. The approval artifact is signed and expires in 24 hours.',
  };
}

function listProposals(db: Db) {
  const rows = db
    .prepare('SELECT id, created_at, goal, status FROM proposals ORDER BY created_at DESC')
    .all();
  return rows.length ? rows : { note: 'No proposals. Create one with ambit propose <capability>.' };
}

/**
 * The drafts waiting on a person, with what each would cost and buy.
 *
 * `listProposals` answers what exists. This answers what a person has to decide,
 * which is a different list and a shorter one: an approval that needs the reader
 * to open each proposal in turn is an approval that waits a week.
 */
function pendingProposals(db: Db) {
  const drafts = pendingDrafts(db) as any[];
  if (!drafts.length) {
    return { note: 'Nothing waiting on you. ambit next suggests what is worth proposing.' };
  }
  return {
    waiting: drafts.length,
    drafts,
    approve_all: `ambit approve ${drafts.map(d => d.id).join(' ')} <your name>`,
    note: 'Approving several at once is one sitting rather than several interruptions; each still gets its own signed artifact. `ambit reject <id> <person> "why"` records a no, which teaches the next draft.',
  };
}

function showProposal(db: Db, id?: string) {
  if (!id) return { error: 'Usage: ambit proposal <id>' };
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
  if (!row) return { error: `No proposal ${id}. See ambit proposals.` };
  return {
    ...row,
    steps: JSON.parse(row.steps),
    simulated: JSON.parse(row.simulated),
    economic_case: row.economic_case ? JSON.parse(row.economic_case) : undefined,
  };
}

/**
 * Applies an approved proposal to the configuration, and only to it.
 *
 * The scope is a deliberate structural limit rather than a starting point. A
 * step carries a declarative patch or it carries nothing — there is no field
 * that holds a command, so no data file in this repository can cause something
 * to be executed. That is the same failure `addMcp` over HTTP was, and the
 * shape is worth refusing permanently rather than gating.
 *
 * Refusals come first and are all hard:
 *   not approved            → a person must have authorised it
 *   any step without an inverse → nothing runs that cannot be undone
 *   any step without a patch    → nothing else is applicable
 *   already applied         → not idempotent by accident
 *
 * The file is backed up before it is touched, the inverse is stored before the
 * write rather than after, and a failed verification rolls back automatically.
 */
function applyProposal(db: Db, proposalId?: string) {
  if (!proposalId) return { error: 'Usage: ambit apply <proposal-id>' };
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status === 'applied') return { error: `${proposalId} is already applied.` };
  if (row.status !== 'approved') {
    return {
      error: `${proposalId} is ${row.status}. A person has to approve it first: ambit approve ${proposalId} <person>`,
    };
  }

  // The approval broker's signed artifact is what makes an approval spendable.
  // An expired, forged, or mutated approval is refused before any step runs.
  const checked = verifyApproval(db, proposalId, row.approved_by);
  if (!checked.ok) {
    return { error: `Refused. ${checked.reason}. Re-approve to mint a fresh artifact.` };
  }

  const steps = JSON.parse(row.steps);

  const noInverse = steps.filter((s: any) => !s.inverse).map((s: any) => s.name);
  if (noInverse.length) {
    return {
      error: `Refused. No inverse for: ${noInverse.join(', ')}. Nothing runs that cannot be undone.`,
    };
  }
  const noPatch = steps.filter((s: any) => !s.config_patch).map((s: any) => s.name);
  if (noPatch.length) {
    return {
      error: `Refused. These are not configuration changes: ${noPatch.join(', ')}. Apply only edits configuration.`,
    };
  }

  // Authority, enforced: every step must be permitted for its capability, or
  // the apply is refused even with a valid approval. CONFIRM is satisfied by
  // the approval; DENY is a hard no.
  for (const step of steps) {
    const decision = canExecute(db, {
      actor: row.approved_by,
      capability: step.id,
      action: 'execute',
    });
    if (decision.decision === 'DENY') {
      return { error: `Refused. ${step.name} is not permitted: ${decision.reason}.` };
    }
  }

  const configPath = configDefault();
  let config: any = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { error: `Cannot read ${configPath}.` };
  }

  // Backup before the first byte changes, so a rollback has something to fall
  // back on even if this process dies midway.
  const backup = `${configPath}.ambit-${proposalId}.bak`;
  writeFileSync(backup, JSON.stringify(config, null, 2) + '\n');

  const applied: string[] = [];
  for (const step of steps) {
    for (const [section, entries] of Object.entries<any>(step.config_patch)) {
      config[section] = config[section] || {};
      for (const [key, value] of Object.entries<any>(entries)) {
        config[section][key] = value;
        applied.push(`${section}.${key}`);
      }
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  db.prepare(
    "UPDATE proposals SET status = 'applied', applied_at = datetime('now'), backup_path = ? WHERE id = ?"
  ).run(backup, proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('apply', ?, 'applied', 1, ?)"
  ).run(row.approved_by, `${proposalId}: ${applied.join(', ')}`);

  // Verify the goal if it declares a check. An unverified apply is reported as
  // such rather than counted as a success.
  const goalId = steps[steps.length - 1]?.id;
  const verification = goalId ? (runVerification(db, goalId.replace('combo:', '')) as any) : null;
  const failed = verification?.results?.some((r: any) => r.status === 'failed');

  if (failed) {
    const undo = rollbackProposal(db, proposalId) as any;
    // The rollback changed the config back; re-seed so the graph reflects the
    // reverted state rather than waiting for the next manual seed.
    seedFromConfig(db);
    return {
      proposal: proposalId,
      applied: false,
      rolled_back: true,
      keys: applied,
      reason: 'Verification failed after applying, so the change was reversed.',
      rollback: undo,
    };
  }

  // The graph should reflect the change now, not whenever someone next runs
  // bootstrap. Re-seeding folds the applied configuration (and the verification
  // evidence just recorded) into the graph immediately.
  const seeded = seedFromConfig(db);

  return {
    proposal: proposalId,
    applied: true,
    keys: applied,
    backup,
    verified: verification?.verified ? true : undefined,
    unverified:
      verification && !verification.verified ? 'no check declared for this capability' : undefined,
    seeded,
    note: 'Applied and re-seeded — the graph reflects this change now.',
  };
}

/**
 * Reverses an applied proposal using the inverse stored before it ran.
 *
 * Uses the recorded inverse rather than the backup file where it can, because
 * the inverse describes only what this proposal changed — restoring a whole
 * backup would also discard anything edited since.
 */
function rollbackProposal(db: Db, proposalId?: string) {
  if (!proposalId) return { error: 'Usage: ambit rollback <proposal-id>' };
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!row) return { error: `No proposal ${proposalId}.` };
  if (row.status !== 'applied')
    return { error: `${proposalId} is ${row.status}; nothing to reverse.` };

  const steps = JSON.parse(row.steps);
  const configPath = configDefault();
  let config: any = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { error: `Cannot read ${configPath}.` };
  }

  const removed: string[] = [];
  const restored: string[] = [];
  for (const step of steps) {
    const inv = step.inverse || {};
    for (const path of inv.remove || []) {
      const [section, key] = path.split('.');
      if (config[section] && key in config[section]) {
        delete config[section][key];
        removed.push(path);
      }
    }
    for (const [path, value] of Object.entries<any>(inv.restore || {})) {
      const [section, key] = path.split('.');
      config[section] = config[section] || {};
      config[section][key] = value;
      restored.push(path);
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  db.prepare("UPDATE proposals SET status = 'rolled_back' WHERE id = ?").run(proposalId);
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('apply', ?, 'rolled_back', 0, ?)"
  ).run(row.approved_by || 'human:unknown', `${proposalId}`);

  return {
    proposal: proposalId,
    rolled_back: true,
    removed,
    restored,
    backup_kept: row.backup_path || undefined,
  };
}

// ─── Execution Layer ──────────────────────────────────────────────────────────

function applyRemoval(db: Db, capId: string) {
  const configPath =
    process.env.OPENCODE_CONFIG || process.env.HOME + '/.config/opencode/opencode.json';
  if (!existsSync(configPath)) return { error: 'Config not found' };
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const prefix = capId.split(':')[0];
  const key = capId.replace(/^[^:]+:/, '');
  const sectionMap: Record<string, string> = {
    mcp: 'mcp',
    agent: 'agent',
    cmd: 'command',
    provider: 'provider',
  };
  const section = sectionMap[prefix];
  if (!section) return { error: 'Unknown prefix: ' + prefix };
  if (!config[section]?.[key]) return { error: 'Not found: ' + capId };
  writeFileSync(configPath + '.bak', JSON.stringify(config, null, 2));
  delete config[section][key];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const db2 = getDb();
  try {
    db2
      .prepare(
        "INSERT INTO session_learning (session_id, capability_id, action, notes) VALUES ('exec', ?, 'removed', 'Applied removal')"
      )
      .run(capId);
  } catch {}
  db2.close();
  seedFromConfig(db);
  return { removed: capId, section, key, backup: configPath + '.bak' };
}

export {
  inverseOf,
  approveProposal,
  approveProposals,
  rejectProposal,
  listProposals,
  pendingProposals,
  showProposal,
  applyProposal,
  rollbackProposal,
  applyRemoval,
};
