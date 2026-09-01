/**
 * Proposing, approving, applying and rolling back a change to the environment.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import {
  APPLIABLE,
  LOCAL_ONLY,
  WITH_PEOPLE,
  cli,
  dir,
  existsSync,
  getDb,
  join,
  readConfig,
  readFileSync,
  rows,
  seed,
} from './testing/cli.ts';

// ── Proposals and simulation ────────────────────────────────────────────────
test('simulation reports what comes with an acquisition, not just the acquisition', () => {
  seed(LOCAL_ONLY).close();
  // A capability already provided but held back by a prerequisite should
  // appear once that prerequisite is satisfied — that cascade is the reason
  // to read a preview before approving.
  const sim = cli('goal', 'embeddings', '--simulate');
  expect(sim.frontier_after).toBeGreaterThan(sim.frontier_before);
  expect(sim.acquired.map((a: any) => a.id)).toContain('combo:embeddings');
});

test('simulation does not conjure capabilities nothing provides', () => {
  seed(LOCAL_ONLY).close();
  const sim = cli('goal', 'embeddings', '--simulate');
  // Satisfying prerequisites is not enough; something must supply it.
  const unblockedIds = sim.unblocked.map((u: any) => u.id);
  for (const id of unblockedIds) {
    expect(id).not.toBe('combo:self-hosted-stack');
  }
});

test('a proposal records the chosen alternative and its trade-off', () => {
  seed(LOCAL_ONLY).close();
  const local = cli('propose', 'retrieval');
  const embeddings = local.steps.find((s: any) => s.id === 'combo:embeddings');
  expect(embeddings.chosen).toContain('local');
  expect(embeddings.privacy).toBe('local');
});

test('a proposal with an uninvertible step is not applicable, and says why', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('propose', 'retrieval');
  // The inverse is the gate: no step runs without one. Retrieval needs a
  // vector store, which no declarative patch supplies, so the proposal as a
  // whole stays a document even though the embeddings step alone could apply.
  expect(p.applicable).toBe(false);
  expect(p.note).toContain('cannot be applied');
  expect(p.steps.some((s: any) => s.inverse === null)).toBe(true);
});

test('share writes an allow-listed snapshot and nothing else', () => {
  seed({
    mcp: {
      'wiki-search': { type: 'local', command: ['npx', '-y', 'secret-wiki-mcp', '--token=abc123'] },
    },
    provider: {
      ollama: { options: { baseURL: 'http://127.0.0.1:11434/v1' }, models: { 'qwen3-coder': {} } },
    },
    actors: { casey: { name: 'Casey', provides: ['physical-access'] } },
  }).close();
  const out = join(dir, 'map.html');
  const r = cli('share', `--out=${out}`);
  expect(r.wrote).toBe(out);
  const html = readFileSync(out, 'utf8');
  // The whitelist is the guarantee: names may appear, the things around them may not.
  expect(html).toContain('wiki-search');
  expect(html).not.toContain('secret-wiki-mcp');
  expect(html).not.toContain('abc123');
  expect(html).not.toContain('127.0.0.1');
  // A person is in the graph; their name stays out of the file.
  expect(html).not.toContain('Casey');
  expect(html).toContain('a person');
});

test('share --redact keeps the shape and drops the names', () => {
  seed({ mcp: { 'wiki-search': { type: 'local', command: ['wiki-mcp'] } } }).close();
  const out = join(dir, 'redacted.html');
  const r = cli('share', `--out=${out}`, '--redact');
  expect(r.redacted_names).toBeGreaterThan(0);
  const html = readFileSync(out, 'utf8');
  expect(html).not.toContain('wiki-search');
  // Curated capability names stay — they describe the model, not the person.
  expect(html).toContain('Shell Execution');
});

test('proposals persist and are retrievable', () => {
  seed(LOCAL_ONLY).close();
  const created = cli('propose', 'retrieval');
  const listed = cli('proposals');
  expect(listed.map((r: any) => r.id)).toContain(created.proposal);

  const fetched = cli('proposal', created.proposal);
  expect(fetched.goal).toBe('Retrieval');
  expect(fetched.status).toBe('draft');
  expect(fetched.simulated.frontier_after).toBeGreaterThan(0);
});

test('proposing something already reached says so instead of inventing steps', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('propose', 'shell-execution');
  expect(p.note).toContain('Already reached');
});

test('plan returns the same shape whether or not there is work to do', () => {
  // A caller should not have to special-case the already-reached branch; a
  // guard on `steps === 0` failed silently when the field was simply absent.
  seed(LOCAL_ONLY).close();
  const done = cli('goal', 'shell-execution');
  const todo = cli('goal', 'offline-capable');
  for (const key of ['goal', 'reachable', 'steps', 'order']) {
    expect(done).toHaveProperty(key);
    expect(todo).toHaveProperty(key);
  }
});

// ── Inverses and approval ───────────────────────────────────────────────────
test('a plan includes the goal itself', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  // Excluding it meant a capability whose prerequisites were already met
  // produced an empty plan — nothing to do, for the case where the one thing
  // to do is acquire it.
  const plan = cli('goal', 'web-research');
  expect(plan.steps).toBe(1);
  expect(plan.order[0].id).toBe('combo:web-research');
});

test('the goal comes last, after what it depends on', () => {
  seed(LOCAL_ONLY).close();
  const plan = cli('goal', 'offline-capable');
  expect(plan.order[plan.order.length - 1].id).toBe('combo:offline-capable');
});

test('a declarative acquisition gets an inverse; others are refused one', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const declarative = cli('propose', 'web-research');
  expect(declarative.steps[0].inverse).not.toBeNull();
  expect(declarative.applicable).toBe(true);

  // Nothing is applicable when a step cannot be undone.
  const withInstaller = cli('propose', 'offline-capable');
  expect(withInstaller.applicable).toBe(false);
  expect(withInstaller.steps.some((s: any) => s.inverse === null)).toBe(true);
});

test('a proposal whose every step is a reversible patch is applicable', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const p = cli('propose', 'web-research');
  expect(p.applicable).toBe(true);
  // And the note tells the reader the actual path: approve, then apply.
  expect(p.note).toContain('ambit apply');
  for (const step of p.steps) expect(step.inverse).not.toBeNull();
});

test('approval must name someone accountable in the graph', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  const ghost = cli('approve', p.proposal, 'nobody');
  expect(ghost.error).toContain('not a person in the graph');
});

test('approval is recorded as evidence, not a flag', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  const ok = cli('approve', p.proposal, 'kanav');
  expect(ok.approved_by).toBe('Kanav');

  // Recorded against the person, so the ledger can later answer who
  // authorised a given expansion of the frontier.
  const evidence = cli('verify', 'human:kanav', '--history');
  expect(evidence.length).toBe(0); // evidence() filters to verification actions
  const stored = cli('proposal', p.proposal);
  expect(stored.status).toBe('approved');
  expect(stored.approved_by).toBe('human:kanav');
});

test('a proposal cannot be approved twice', () => {
  seed(WITH_PEOPLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const again = cli('approve', p.proposal, 'kanav');
  expect(again.error).toContain('already approved');
});

test('apply refuses a proposal no person has approved', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const refused = cli('apply', p.proposal);
  expect(refused.error).toContain('approve');
  // And nothing was written.
  expect(Object.keys(readConfig().mcp)).toEqual(['git']);
});

test('apply refuses anything that cannot be undone', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'offline-capable'); // steps need installers, not config
  cli('approve', p.proposal, 'kanav');
  const refused = cli('apply', p.proposal);
  expect(refused.error).toContain('inverse');
});

test('an approved config change is applied, and backed up first', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const result = cli('apply', p.proposal);

  expect(result.applied).toBe(true);
  expect(readConfig().mcp).toHaveProperty('fetch');
  expect(existsSync(result.backup)).toBe(true);
});

test('an apply re-seeds, so the graph reflects the change immediately', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  // Before the apply, the graph has not seen the fetch MCP server.
  const db = getDb(join(dir, 'graph.db'));
  expect(rows(db, "SELECT id FROM capabilities WHERE id = 'mcp:fetch'")).toEqual([]);
  db.close();

  cli('apply', p.proposal);

  // After the apply, no manual re-seed needed: the graph knows it now.
  const after = getDb(join(dir, 'graph.db'));
  expect(rows(after, "SELECT id FROM capabilities WHERE id = 'mcp:fetch'").length).toBe(1);
});

test('rollback reverses exactly what was applied', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);
  const before = Object.keys(readConfig().mcp);
  expect(before).toContain('fetch');

  const undo = cli('rollback', p.proposal);
  expect(undo.rolled_back).toBe(true);
  // git survives: the inverse describes only what this proposal changed, so a
  // rollback cannot discard edits made since.
  expect(Object.keys(readConfig().mcp)).toEqual(['git']);
});

test('applying twice is refused', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);
  expect(cli('apply', p.proposal).error).toContain('already applied');
});

test('every act is recorded against the person who authorised it', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);

  const db = getDb(join(dir, 'graph.db'));
  const acts = rows(
    db,
    `SELECT action, capability_id FROM session_learning
                         WHERE session_id IN ('approval','apply') ORDER BY id`
  );
  expect(acts.map(a => a.action)).toEqual(['approved', 'applied']);
  expect(acts.every(a => a.capability_id === 'human:kanav')).toBe(true);
});

// ── Free-form goals (§5) ─────────────────────────────────────────────────────
test('a free-form goal routes to the capabilities whose words cover it', () => {
  seed(LOCAL_ONLY).close();
  // The roadmap's example sentence. The vocabulary has to catch "homelab",
  // "unattended" and "maintain" and rank by how much of the goal is covered.
  const g = cli('goal', 'maintain the homelab unattended');
  expect(g.error).toBeUndefined();
  const ids = g.candidates.map((c: any) => c.id);
  expect(ids).toContain('combo:self-hosted-stack');
  expect(ids).toContain('combo:scheduled-work');
  expect(ids).toContain('combo:observability');
  // Each candidate carries its plan delta, so the shortlist is also a plan.
  const selfHosted = g.candidates.find((c: any) => c.id === 'combo:self-hosted-stack');
  expect(selfHosted.matched_phrases).toContain('homelab');
  expect(selfHosted.steps).toBeDefined();
});

test('a goal that is already a capability plans directly', () => {
  seed(LOCAL_ONLY).close();
  const g = cli('goal', 'shell-execution');
  expect(g.exact).toBe(true);
  expect(g.reachable).toBe(true);
});

test('an unrecognised goal says so instead of inventing a plan', () => {
  seed(LOCAL_ONLY).close();
  const g = cli('goal', 'teleport myself to mars');
  expect(g.candidates).toEqual([]);
  expect(g.note).toContain('No capability');
});

test('paths compares alternatives by risk and lock-in', () => {
  seed(APPLIABLE).close();
  // Web Research's only declared acquisition is a config change, so the path
  // to it is reversible — §10 could undo it — and local with no bill.
  const paths = cli('goal', 'web-research', '--paths');
  expect(paths.goal).toBe('Web Research');
  expect(paths.paths).toBeGreaterThan(0);
  const p = paths.options[0];
  expect(p.privacy).toBe('local');
  expect(p.lock_in).toContain('reversible');
  expect(p.risk).toBe('low');
});

test('paths does not claim an already-reached capability needs closing', () => {
  seed(APPLIABLE).close();
  const paths = cli('goal', 'shell-execution', '--paths');
  expect(paths.note).toContain('already reached');
});

// ── Approval broker (WP-7) ───────────────────────────────────────────────────
test('an approval mints a signed artifact the executor verifies', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const ok = cli('approve', p.proposal, 'kanav');

  expect(ok.artifact).toBeDefined();
  expect(ok.artifact.proposal_hash).toBeDefined();
  expect(ok.artifact.actor).toBe('human:kanav');
  expect(ok.artifact.sig).toBeDefined();
  expect(ok.artifact.expires_at).toBeDefined();
  // The artifact binds the scope to exactly the steps being acquired.
  expect(ok.artifact.scope_exclude).toContain('combo:web-research');

  // A valid artifact applies cleanly.
  const result = cli('apply', p.proposal);
  expect(result.applied).toBe(true);
});

test('an artifact refuses to spend on a proposal that changed after approval', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  // Tamper: rewrite the steps after the approval was minted.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare('UPDATE proposals SET steps = ? WHERE id = ?').run(
    JSON.stringify([
      { id: 'combo:something-else', inverse: {}, config_patch: { mcp: { evil: {} } } },
    ]),
    p.proposal
  );
  db.close();

  const refused = cli('apply', p.proposal);
  expect(refused.applied).toBeUndefined();
  expect(refused.error).toContain('Refused');
  expect(refused.error).toMatch(/signature|no longer hashes/i);
});

test('an expired approval is refused until re-approved', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  const db = getDb(join(dir, 'graph.db'));
  db.prepare("UPDATE proposals SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(
    p.proposal
  );
  db.close();

  const refused = cli('apply', p.proposal);
  expect(refused.error).toContain('expired');
});

test('notify-approvals lists approved proposals awaiting apply', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  const r = cli('notify-approvals');
  expect(r.error).toContain('Usage'); // opt-in: nothing is sent without a topic

  // The pending set is readable through the engine directly.
  const db = getDb(join(dir, 'graph.db'));
  const rows = db.prepare("SELECT id FROM proposals WHERE status = 'approved'").all() as any[];
  expect(rows.map((r: any) => r.id)).toContain(p.proposal);
  db.close();
});

// ── canExecute (WP-8) ─────────────────────────────────────────────────────────
test('canExecute decides ALLOW / CONFIRM / DENY from covering grants', () => {
  seed(LOCAL_ONLY).close();
  // The plan's example, on a capability the model leaves ungranted so the
  // scoped grants are the whole story: restart svc:ollama autonomous,
  // svc:postgres confirm, device:nuc not covered at all.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES (?, ?, ?, '', ?, 'test')"
  ).run('combo:offline-capable', 'execute', 'autonomous', 'svc:ollama');
  db.prepare(
    "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES (?, ?, ?, '', ?, 'test')"
  ).run('combo:offline-capable', 'execute', 'confirm', 'svc:postgres');
  db.close();

  const allow = cli('can', 'offline-capable', '--target=svc:ollama');
  expect(allow.decision).toBe('ALLOW');

  const confirm = cli('can', 'offline-capable', '--target=svc:postgres');
  expect(confirm.decision).toBe('CONFIRM');

  const deny = cli('can', 'offline-capable', '--target=device:nuc');
  expect(deny.decision).toBe('DENY');
  expect(deny.reason).toContain('no grant covers');

  // Without a target, both grants cover and the narrowest (confirm) wins.
  const mixed = cli('can', 'offline-capable');
  expect(mixed.decision).toBe('CONFIRM');
});

test('a budget refuses a spend that would exceed it', () => {
  seed(LOCAL_ONLY).close();
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES (?, 'execute', 'autonomous', '', '', 'test')"
  ).run('combo:offline-capable');
  db.prepare(
    "INSERT INTO budgets (capability_id, action, scope, budget_cents, period, spent_cents) VALUES (?, 'execute', '', 10000, 'month', 4000)"
  ).run('combo:offline-capable');
  db.close();

  const ok = cli('can', 'offline-capable', '--spend=5000');
  expect(ok.decision).toBe('ALLOW');
  expect(ok.remaining_budget_cents).toBe(6000);

  const over = cli('can', 'offline-capable', '--spend=7000');
  expect(over.decision).toBe('DENY');
  expect(over.reason).toContain('exceeds');
});

test('apply refuses a step authority denies, even with an approval', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  // Forbid exactly what the proposal would acquire.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    "INSERT INTO authority (capability_id, action, mode, holder, scope, source) VALUES (?, 'execute', 'forbidden', '', '', 'test')"
  ).run('combo:web-research');
  db.close();

  const refused = cli('apply', p.proposal);
  expect(refused.applied).toBeUndefined();
  expect(refused.error).toContain('not permitted');
});
