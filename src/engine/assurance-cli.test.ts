/**
 * Verification and authority, driven through the CLI the way a person drives them.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import {
  LOCAL_ONLY,
  PLUS_EMBEDDINGS,
  cli,
  dir,
  getDb,
  join,
  recordVerification,
  rows,
  seed,
} from './testing/cli.ts';

// ── Verification, authority, planning ───────────────────────────────────────
test('verification records evidence rather than trusting configuration', () => {
  seed(LOCAL_ONLY).close();
  // shell-execution's declared check is `echo`, so this is deterministic.
  const first = cli('verify', 'shell-execution');
  expect(first.results[0].status).toBe('verified');
  expect(first.results[0].reliability).toBe('1/1');

  // Evidence accumulates: one success is a weaker claim than several.
  cli('verify', 'shell-execution');
  const evidence = cli('verify', 'shell-execution', '--history');
  expect(evidence.length).toBe(2);
  expect(evidence.every((e: any) => e.action === 'verified')).toBe(true);
});

test('a capability with no declared check is not reported as verified', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('verify', 'retrieval');
  expect(r.results[0].status).toBe('unverifiable');
  // And it leaves no evidence, so nothing later mistakes it for a passing run.
  expect(cli('verify', 'retrieval', '--history').length).toBe(0);
});

test('authority is tracked apart from whether a capability is reached', () => {
  seed(LOCAL_ONLY).close();
  const a = cli('authority');
  // Reached and permitted are different claims: shell execution is available
  // on any machine and still should not run unattended.
  expect(a.needs_approval).toContain('Shell Execution');
  expect(a.forbidden).toContain('Secret Management');
  expect(a.autonomous).not.toContain('Shell Execution');
});

test('a runtime that tightens its permissions is not still reported as loose', () => {
  const runtime = (mode: string, note: string) => ({
    mcp: { git: { type: 'local' } },
    authority: { runtime: { execute: mode, note } },
  });
  seed(runtime('autonomous', 'first')).close();
  seed(runtime('forbidden', 'second')).close();

  // `mode` is not part of the authority row's uniqueness key, so an insert that
  // ignores conflicts kept the old one — and the stale direction was the
  // permissive one, which is what this code is meant to rule out by
  // construction: never describe a system as freer to act than the runtime in
  // front of it permits.
  const db = getDb(join(dir, 'graph.db'));
  const grants = rows(db, "SELECT mode, note FROM authority WHERE source LIKE 'runtime:%'");
  expect(grants).toEqual([{ mode: 'forbidden', note: 'second' }]);

  // And a grant the runtime has stopped making disappears rather than lingering.
  db.close();
  seed({ mcp: { git: { type: 'local' } } }).close();
  const after = getDb(join(dir, 'graph.db'));
  expect(rows(after, "SELECT mode FROM authority WHERE source LIKE 'runtime:%'")).toEqual([]);
  // The curated model's grants survive; only the source that re-ran is replaced.
  expect(
    rows(after, "SELECT COUNT(*) n FROM authority WHERE source = 'techtree'")[0].n
  ).toBeGreaterThan(0);
});

test('a runtime narrows what the model says an action is like in general', () => {
  // File editing is autonomous in the curated model. A runtime that requires
  // approval for everything it executes overrides that, because the runtime is
  // the thing that would actually perform the step.
  seed({
    ...LOCAL_ONLY,
    authority: {
      runtime: { execute: 'confirm', note: 'approvals: manual' },
      scoped: { execute: { mode: 'forbidden', scope: 'scheduled', note: 'cron_mode: deny' } },
    },
  }).close();

  const a = cli('authority');
  const entry = a.detail.find(
    (d: any) => d.id === 'combo:local-runtime' && d.action === 'execute' && !d.scope
  );
  expect(entry.mode).toBe('confirm');
  expect(entry.sources).toContain('runtime:opencode');
  expect(a.forbidden.some((f: string) => f.endsWith('· scheduled'))).toBe(true);
});

test('the narrower of two disagreeing sources wins', () => {
  seed({
    ...LOCAL_ONLY,
    authority: { capabilities: { 'combo:file-editing': { execute: 'forbidden' } } },
  }).close();

  const a = cli('authority');
  const entry = a.detail.find((d: any) => d.id === 'combo:file-editing' && d.action === 'execute');
  expect(entry.mode).toBe('forbidden'); // not the model's 'autonomous'
  expect(entry.sources).toContain('techtree');
  expect(entry.narrowed_by).toBe('runtime:opencode');
});

test('a capability confers actions, and authority is per action', () => {
  seed({ mcp: { git: { type: 'local' } } }).close();

  const a = cli('authority', 'version-control');
  expect(a.actions).toBe(4);
  // The distinction the coarse node cannot make: reading a repository is not
  // merging to its default branch, and both belong to one reached capability.
  expect(a.exercisable).toContain('act:version-control/read_repository');
  expect(a.needs_approval).toContain('act:version-control/merge_to_default');
  expect(a.exercisable).not.toContain('act:version-control/merge_to_default');
});

test('an action is forbidden even when the capability conferring it is reached', () => {
  const db = seed({ mcp: { postgres: { type: 'local' } } });
  expect(
    rows(db, "SELECT state FROM capabilities WHERE id = 'combo:data-access'")[0].state
  ).not.toBe('locked');
  db.close();

  const a = cli('authority', 'data-access');
  expect(a.exercisable).toContain('act:data-access/query');
  expect(a.forbidden).toContain('act:data-access/drop_table');
});

test('an action can be planned for, and resolves to the capability conferring it', () => {
  seed({ provider: { acme: { models: { 'fast-1': {} } } } }).close();

  const plan = cli('goal', 'act:data-access/query');
  expect(plan.error).toBeUndefined();
  expect(plan.order.map((o: any) => o.id)).toContain('combo:data-access');
  expect(plan.reachable).toBe(true);

  // Simulating the action moves the frontier by the capability, not by the
  // action — an action is conferred, never separately acquired.
  const sim = cli('goal', 'act:data-access/query', '--simulate');
  expect(sim.acquired.map((c: any) => c.id)).toEqual(['combo:data-access']);
});

test('scope is checked, not just recorded', () => {
  seed({
    provider: { ollama: { models: { 'qwen3-coder': {} } } },
    authority: {
      capabilities: {
        'combo:version-control': { execute: { mode: 'confirm', scope: 'repo:owner/name' } },
      },
      scoped: { execute: { mode: 'forbidden', scope: 'repo:other/thing' } },
    },
  }).close();

  // The grant scoped to repo:owner/name covers that repo...
  const covered = cli('authority', 'scope', 'repo:owner/name');
  const vc = covered.grants.find(
    (g: any) => g.name === 'Version Control' && g.scope === 'repo:owner/name'
  );
  expect(vc.covers).toBe(true);

  // ...and the grant scoped elsewhere does not cover a different target.
  const other = cli('authority', 'scope', 'repo:someone/else');
  const scoped = other.grants.find((g: any) => g.scope === 'repo:other/thing');
  expect(scoped.covers).toBe(false);
  expect(other.excluded).toBeGreaterThan(0);

  // Scope is a prefix claim: a branch under the repo is covered by it.
  const branch = cli('authority', 'scope', 'repo:owner/name/feature');
  const vcBranch = branch.grants.find(
    (g: any) => g.name === 'Version Control' && g.scope === 'repo:owner/name'
  );
  expect(vcBranch.covers).toBe(true);
});

test('actions do not inflate leverage or fragility', () => {
  seed({ mcp: { git: { type: 'local' } } }).close();

  // An action has exactly one provider by definition. Reporting each as a
  // single point of failure would bury the ones that are.
  const spof = cli('status').spofs;
  expect(spof.some((s: any) => s.id.startsWith('act:version-control/'))).toBe(false);

  // And a capability must not climb the bottleneck ranking because someone
  // wrote more verbs into its contract.
  const bottlenecks = cli('status').bottlenecks;
  const versionControl = bottlenecks.find((b: any) => b.capability_id === 'combo:version-control');
  if (versionControl) expect(versionControl.unlocks_count).toBeLessThan(4);
});

test('the tree does not detect itself on a re-seed', () => {
  // Contract actions are created by the tree from its own nodes, so leaving
  // them in the pool detection matches against makes a node its own evidence:
  // `act:web-research/search` matches web-research's `search` pattern, and a
  // capability nothing supplies would come up reached on the second run.
  const config = { provider: { acme: { models: { 'fast-1': {} } } } };
  seed(config).close();
  const db = seed(config);

  const selfProved = rows(
    db,
    `
    SELECT d.from_capability f, d.to_capability t FROM dependencies d
    JOIN capabilities c ON c.id = d.from_capability
    WHERE c.kind = 'action' AND d.to_capability LIKE 'combo:%'`
  );
  expect(selfProved).toEqual([]);
  expect(rows(db, "SELECT state FROM capabilities WHERE id = 'combo:web-research'")[0].state).toBe(
    'locked'
  );
});

test('an action a person supplies is still a single point of failure', () => {
  // One provider is definitional for a conferred action and a real finding for
  // a supplied one: only that person can do it.
  seed({
    mcp: { git: { type: 'local' } },
    actors: { kanav: { name: 'Kanav', provides: ['physical-access'] } },
  }).close();

  const spof = cli('status').spofs;
  expect(spof.some((s: any) => s.id === 'act:physical-access')).toBe(true);
});

test('lifecycle separates configured from verified from reliable', () => {
  seed(LOCAL_ONLY).close();
  const lifecycle = (id: string) => {
    const db = getDb(join(dir, 'graph.db'));
    const row = rows(db, `SELECT lifecycle FROM capabilities WHERE id = 'combo:${id}'`)[0];
    db.close();
    return row?.lifecycle;
  };

  // Reached, with nothing run against it. Configured is not working.
  expect(lifecycle('shell-execution')).toBe('configured');

  cli('verify', 'shell-execution');
  expect(lifecycle('shell-execution')).toBe('verified');

  // Five passing runs is a different claim from one.
  for (let i = 0; i < 4; i++) cli('verify', 'shell-execution');
  expect(lifecycle('shell-execution')).toBe('reliable');

  // Nothing supplies it and it is not reachable — not the same as untested.
  expect(lifecycle('secret-management')).toBe('unknown');
});

test('a failing check breaks the capability rather than being reported alongside it', () => {
  seed(LOCAL_ONLY).close();
  cli('verify', 'shell-execution');

  // Stand in for a check that has started failing.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare(`INSERT INTO session_learning (session_id, capability_id, action, outcome_score)
              VALUES ('verify', 'combo:shell-execution', 'failed', 0)`).run();
  db.close();

  // Verifying something else recomputes every lifecycle without adding a run
  // to this one — retrieval declares no check, so it records nothing.
  cli('verify', 'retrieval');
  const after = getDb(join(dir, 'graph.db'));
  expect(
    rows(after, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0]
      .lifecycle
  ).toBe('broken');
  // And the frontier still has it: reachable and broken are different columns.
  expect(
    rows(after, "SELECT state FROM capabilities WHERE id = 'combo:shell-execution'")[0].state
  ).not.toBe('locked');
});

test('a broken capability stops reading as available', () => {
  seed(LOCAL_ONLY).close();
  // Shell Execution was reachable. Its check now fails, and the lifecycle gate
  // must stop every decision surface from relying on it — configured is not
  // working, and this is the case the model previously misrepresented.
  recordVerification('combo:shell-execution', 'failed');
  seed(LOCAL_ONLY).close(); // same config; the gate reads the recorded evidence

  const db = getDb(join(dir, 'graph.db'));
  expect(
    rows(db, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle
  ).toBe('broken');
  db.close();

  // A plan refuses to treat it as an acquisition.
  const p = cli('goal', 'shell-execution');
  expect(p.degraded).toBe(true);
  expect(p.reachable).toBe(false);
  expect(p.note).toContain('re-verify');

  // Authority: it is not in the available half of the report whatever its
  // permission says — permission and a broken implementation are two different
  // reasons it cannot run.
  const a = cli('authority');
  expect(a.detail.find((r: any) => r.name === 'Shell Execution')?.reached).toBe(false);
  expect(a.needs_approval).not.toContain('Shell Execution');

  // A simulation of something built on it says why it will not cascade.
  const sim = cli('goal', 'version-control', '--simulate');
  expect(sim.blocked_by_degraded.map((b: any) => b.id)).toContain('combo:version-control');
});

test('a re-passing verification releases the gate', () => {
  seed(LOCAL_ONLY).close();
  recordVerification('combo:shell-execution', 'failed');
  recordVerification('combo:shell-execution', 'verified');
  seed(LOCAL_ONLY).close();

  // One pass after a failure is a weaker claim than a clean record: the
  // lifecycle moves broken → degraded, and the gate stays closed.
  const db = getDb(join(dir, 'graph.db'));
  expect(
    rows(db, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0].lifecycle
  ).toBe('degraded');
  db.close();
  expect(cli('goal', 'shell-execution').reachable).toBe(false);

  // Five consecutive passes are a different claim, and the gate opens.
  for (let i = 0; i < 4; i++) recordVerification('combo:shell-execution', 'verified');
  seed(LOCAL_ONLY).close();

  const after = getDb(join(dir, 'graph.db'));
  expect(
    rows(after, "SELECT lifecycle FROM capabilities WHERE id = 'combo:shell-execution'")[0]
      .lifecycle
  ).toBe('reliable');
  after.close();
  const p = cli('goal', 'shell-execution');
  expect(p.reachable).toBe(true);
  expect(p.degraded).toBeUndefined();
});

test('a plan names a degraded prerequisite as broken, not missing', () => {
  seed(LOCAL_ONLY).close();
  // Local Embeddings is still locked (Embeddings is missing) and requires
  // Local Runtime, which declares a check. Break the prerequisite: the plan
  // must say "re-verify this", not "add this".
  recordVerification('combo:local-runtime', 'failed');
  seed(LOCAL_ONLY).close();

  const p = cli('goal', 'local-embeddings');
  expect(p.degraded.map((d: any) => d.name)).toContain('Local Runtime');
  expect(p.order.map((o: any) => o.id)).not.toContain('combo:local-runtime'); // not something to acquire
  expect(p.note).toContain('failing verification');
});

test('the ledger records demonstrated reliability beside reach', () => {
  seed(LOCAL_ONLY).close();
  // One passing run makes shell-execution verified — a different claim from
  // merely reachable, and the ledger has to be able to show that over time.
  cli('verify', 'shell-execution');
  seed(PLUS_EMBEDDINGS).close(); // a state change forces the next observation

  const ledger = cli('history');
  expect(ledger.length).toBe(2);
  expect(ledger[0].verified).toBe(0); // before anything had passed a check
  expect(ledger[1].verified).toBe(1); // shell-execution is now demonstrated
});

test('since reports a capability that stopped working', () => {
  seed(LOCAL_ONLY).close();
  recordVerification('combo:shell-execution', 'failed');
  seed(LOCAL_ONLY).close();

  const since = cli('history', 'since');
  // Structural reach did not move — nothing was removed — but the capability
  // stopped being usable, and the ledger has to say so.
  expect(since.frontier_now).toBe(since.frontier_then);
  expect(since.diminished.map((d: any) => d.id)).toContain('combo:shell-execution');
  expect(since.diminished.find((d: any) => d.id === 'combo:shell-execution').reason).toContain(
    'verification'
  );
  expect(since.verified_now).toBe(0);
});

test('planning orders the prerequisites of an unreached capability', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('goal', 'offline-capable');
  expect(p.steps).toBeGreaterThan(0);
  const order = p.order.map((o: any) => o.id);
  // Embeddings gates Local Embeddings, so it has to come first.
  expect(order.indexOf('combo:embeddings')).toBeLessThan(order.indexOf('combo:local-embeddings'));
  expect(p.estimated_setup).toMatch(/\d+(m|\.\dh)/);
});

test('planning a capability already reached says so instead of inventing steps', () => {
  seed(LOCAL_ONLY).close();
  const p = cli('goal', 'shell-execution');
  expect(p.reachable).toBe(true);
  expect(p.missing).toEqual([]);
});

test('a flag is not mistaken for a command argument', () => {
  // `tt verify --json` looked for a capability named "--json"; every command
  // taking both an argument and a flag inherited that.
  seed(LOCAL_ONLY).close();
  const all = cli('verify');
  expect(all.checked).toBeGreaterThan(1);
  expect(all.error).toBeUndefined();
});

// ── Per-action verification (§3) ─────────────────────────────────────────────
test('a contract action can declare a check of its own', () => {
  seed(LOCAL_ONLY).close();
  // commit_changes declares a check in the curated model. Verifying it runs
  // that check against the action node, not the capability's — a different
  // claim at a different granularity. (This test runs in a non-repo temp dir,
  // so the check fails honestly; what is being asserted is that it ran.)
  const r = cli('verify', 'act:version-control/commit_changes');
  expect(r.checked).toBe(1);
  expect(r.results[0].id).toBe('act:version-control/commit_changes');
  expect(r.results[0].status).toMatch(/verified|failed/);

  // Evidence landed against the action, reachable by its own id.
  const evidence = cli('verify', 'act:version-control/commit_changes', '--history');
  expect(evidence.length).toBe(1);
  expect(evidence[0].action).toMatch(/verified|failed/);
});
