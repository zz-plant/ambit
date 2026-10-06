/**
 * Proposing, approving, applying and rolling back a change to the environment.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { writeFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { parseJsonc } from '../shared/opencode.ts';
import { auditStream } from './audit.ts';
import {
  APPLIABLE,
  LOCAL_ONLY,
  WITH_PEOPLE,
  cli,
  cliAsync,
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

test('a proposal records who drafted it only when someone said', () => {
  seed(LOCAL_ONLY).close();
  // A terminal could be a person or an agent's shell, so a bare propose
  // records nobody; --by says who, as it says who declared a grant.
  const bare = cli('propose', 'retrieval');
  const named = cli('propose', 'embeddings', '--by=human:kanav');
  const db = getDb(join(dir, 'graph.db'));
  const by = (id: string) =>
    db
      .prepare('SELECT proposed_by FROM proposals WHERE id = ?')
      .get<{ proposed_by: string | null }>(id)?.proposed_by;
  expect(by(bare.proposal)).toBeNull();
  expect(by(named.proposal)).toBe('human:kanav');
  // The trail names the drafter on the proposed line, and nobody where none was said.
  const trail = auditStream(db, { days: 1 }).events.filter(e => e.action === 'proposed');
  db.close();
  expect(trail.find(e => e.target === named.proposal)?.actor).toBe('human:kanav');
  expect(trail.find(e => e.target === bare.proposal)?.actor).toBeUndefined();
});

test('a proposal records the work it is for, and its approval binds that purpose', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research', '--for=Research a vendor before a call');
  const read = () => {
    const db = getDb(join(dir, 'graph.db'));
    try {
      return db
        .prepare('SELECT purpose FROM proposals WHERE id = ?')
        .get<{ purpose: string | null }>(p.proposal)?.purpose;
    } finally {
      db.close();
    }
  };
  expect(read()).toBe('Research a vendor before a call');
  expect(cli('approve', p.proposal, 'kanav').error).toBeUndefined();
  // A purpose changed after the approval is a different proposal from the
  // one that was signed, and the signature no longer covers it.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare('UPDATE proposals SET purpose = ? WHERE id = ?').run('Anything at all', p.proposal);
  db.close();
  const applied = cli('apply', p.proposal);
  expect(applied.applied).not.toBe(true);
  expect(JSON.stringify(applied)).toMatch(/hash|changed|approv/i);
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

/**
 * The row's status holds only the latest word, so a proposal applied and then
 * rolled back was audited as one where nothing executed.
 */
test('the audit of a rolled-back proposal shows the apply and the rollback', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  expect(cli('audit', p.proposal).note).toMatch(/nothing executed/);

  cli('apply', p.proposal);
  cli('rollback', p.proposal);
  const audit = cli('audit', p.proposal);
  expect(audit.status).toBe('rolled_back');
  expect(audit.executed.map((e: any) => e.action)).toEqual(['applied', 'rolled_back']);
  expect(audit.executed[0].keys).toEqual(['mcp.fetch']);
  expect(audit.note).not.toMatch(/nothing executed/);
  expect(audit.note).toMatch(/rolled back/);
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

test('an approval written across a second boundary is still one line on the trail', () => {
  // The row and the act are two statements, each reading the clock. A second
  // that turned between them listed the approval twice.
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  expect(cli('approve', p.proposal, 'kanav').error).toBeUndefined();
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(
    `UPDATE session_learning SET timestamp = datetime(timestamp, '+1 seconds')
     WHERE session_id = 'approval' AND action = 'approved'`
  ).run();
  const approved = auditStream(db).events.filter(
    e => e.target === p.proposal && e.action === 'approved'
  );
  db.close();
  expect(approved).toHaveLength(1);
  expect(approved[0].outcome?.word).toBe('signed');
});

test('the trail keeps an approval and an apply that a later approval replaced on the row', () => {
  // A rolled-back proposal can be approved again, and the second approval
  // overwrites `approved_by` and `approved_at`. The trail dropped every
  // approval and apply act as a copy of the row, so Kanav's signed approval
  // and the first apply vanished from it. The sequence runs inside a second
  // or two, so acts that share one with the row must still be told apart.
  seed({ ...APPLIABLE, actors: { kanav: { name: 'Kanav' }, ana: { name: 'Ana' } } }).close();
  const p = cli('propose', 'web-research');
  expect(cli('approve', p.proposal, 'kanav').error).toBeUndefined();
  expect(cli('apply', p.proposal).applied).toBe(true);
  expect(cli('rollback', p.proposal).rolled_back).toBe(true);
  expect(cli('approve', p.proposal, 'ana').error).toBeUndefined();
  expect(cli('apply', p.proposal).applied).toBe(true);

  const db = getDb(join(dir, 'graph.db'));
  const events = auditStream(db).events.filter(e => e.target === p.proposal);
  db.close();
  const said = (action: string) =>
    events
      .filter(e => e.action === action)
      .map(e => e.actor ?? '')
      .sort();

  // Every act once: two approvals by two people, two applies, one rollback.
  expect(said('approved')).toEqual(['human:ana', 'human:kanav']);
  expect(said('applied')).toHaveLength(2);
  expect(said('rolled_back')).toEqual(['human:kanav']);
  expect(said('proposed')).toEqual(['']);
  // The row still speaks for the approval it holds, with its signature.
  expect(events.find(e => e.action === 'approved' && e.actor === 'human:ana')?.outcome?.word).toBe(
    'signed'
  );
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

test('notify-approvals lists approved proposals awaiting apply', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');

  const r = await cliAsync('notify-approvals');
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
  expect(deny.verdict).toBe('no');
  expect(deny.reason).toContain('No grant covers');
  expect(deny.reason).toContain('device:nuc');

  // Without a target, both grants cover and the narrowest (confirm) wins.
  const mixed = cli('can', 'offline-capable');
  expect(mixed.decision).toBe('CONFIRM');
});

test('asking about a slip is not a refusal on the command line either, and files nothing', () => {
  // `ambit can shell-exection` answered DENY and filed the typo as a deficit,
  // which reads as "you may not run a shell". A slip is answered as one.
  seed(LOCAL_ONLY).close();
  const count = () => {
    const db = getDb(join(dir, 'graph.db'));
    const n = rows(db, 'SELECT COUNT(*) AS n FROM failure_signals')[0].n;
    db.close();
    return n;
  };
  const before = count();
  const slip = cli('can', 'shell-exection', '--tool=bash');
  expect(slip.error).toContain('No capability "shell-exection"');
  expect(slip.did_you_mean).toContain('combo:shell-execution');
  expect(slip.decision).toBeUndefined();
  expect(count()).toBe(before);

  // A wall that resembles nothing is still a wall, and is still filed.
  const wall = cli('can', 'quantum-teleportation', '--tool=qtp');
  expect(wall.decision).toBe('DENY');
  expect(wall.recorded_deficit).toBeDefined();
  expect(count()).toBeGreaterThan(before);

  // A name is the id it names, and no capability is a usage error and not a stack trace.
  expect(cli('can', 'Shell Execution', '--no-record').capability).toBe('combo:shell-execution');
  expect(cli('can').error).toContain('Usage: ambit can <capability>');
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

  // A spend is typed in dollars, as `budget set --amount` is.
  const ok = cli('can', 'offline-capable', '--spend=50');
  expect(ok.decision).toBe('ALLOW');
  expect(ok.remaining_budget_cents).toBe(6000);

  const over = cli('can', 'offline-capable', '--spend=$70');
  expect(over.decision).toBe('DENY');
  expect(over.reason).toContain('exceeds');
  expect(cli('can', 'offline-capable', '--spend=7000c').decision).toBe('DENY');

  // A spend nobody can read is refused, never treated as no spend: this one
  // used to become NaN and pass.
  for (const unread of ['--spend=twenty', '--spend=', '--spend', '--spend=-5']) {
    const r = cli('can', 'offline-capable', unread);
    expect(r.error).toMatch(/--spend takes an amount in dollars/);
    expect(r.decision).toBeUndefined();
  }
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

test('apply and rollback edit a commented config in place, and give back its bytes', () => {
  // Apply read the config with JSON.parse, so a commented file `seed` maps was
  // refused, and a plain one was rewritten whole: the backup and the rolled
  // back file had the content and not the bytes, comments and layout gone.
  seed(APPLIABLE).close();
  const path = join(dir, 'config.json');
  const original = `{
  // the person's own note
  "provider": { "ollama": { "models": { "qwen3-coder": {} } } },
  "mcp": {
    "git": {}, // kept
  },
  "actors": { "kanav": { "name": "Kanav" } }
}
`;
  writeFileSync(path, original);
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const applied = cli('apply', p.proposal);
  expect(applied.applied).toBe(true);

  const after = readFileSync(path, 'utf8');
  expect(after).toContain("// the person's own note");
  expect(after).toContain('"git": {}, // kept');
  expect(parseJsonc(after).mcp).toHaveProperty('fetch');
  expect(readFileSync(applied.backup, 'utf8')).toBe(original);

  cli('rollback', p.proposal);
  expect(readFileSync(path, 'utf8')).toBe(original);
  // And the graph followed the config back, without a manual seed.
  const db = getDb(join(dir, 'graph.db'));
  expect(rows(db, "SELECT state FROM capabilities WHERE id = 'mcp:fetch'")[0].state).toBe('locked');
  db.close();
});
