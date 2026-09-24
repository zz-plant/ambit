/**
 * The authority gate and the evidence that feeds it, called directly.
 *
 * `canExecute` is the function the control plane consults before anything runs.
 * Until the runner moved to Node it could only be reached by spawning the CLI,
 * so in practice it was checked through whatever that happened to print.
 */
import { test, expect } from 'vitest';
import { authorityReport, canExecute, scopeCovers, deriveLifecycles } from './assurance.ts';
import { makeGraph, learn } from './testing/graph.ts';

// ── Scope ────────────────────────────────────────────────────────────────────

test('an unscoped grant is global; a scoped one covers itself and below', () => {
  expect(scopeCovers('', 'env:production')).toBe(true);
  expect(scopeCovers('env:production', 'env:production')).toBe(true);
  expect(scopeCovers('env', 'env:production')).toBe(true);
  expect(scopeCovers('repo/app', 'repo/app/src')).toBe(true);
});

test('a scope does not cover a sibling that merely shares a prefix', () => {
  // 'env:prod' must not authorise 'env:production'.
  expect(scopeCovers('env:prod', 'env:production')).toBe(false);
  expect(scopeCovers('env:production', 'env:staging')).toBe(false);
  expect(scopeCovers('repo/app', 'repo/application')).toBe(false);
});

// ── The decision ─────────────────────────────────────────────────────────────

const deployable = {
  capabilities: [{ id: 'combo:deploy', name: 'Deploy', lifecycle: 'verified' as const }],
};

test('no grant at all is a denial, not a default allow', () => {
  const db = makeGraph(deployable);
  expect(canExecute(db, { capability: 'combo:deploy' }).decision).toBe('DENY');
  db.close();
});

test('an unknown capability is denied by name, and says to record it', () => {
  const db = makeGraph({});
  const d = canExecute(db, { capability: 'combo:nope' });
  expect(d.decision).toBe('DENY');
  expect(d.verdict).toBe('no');
  expect(d.reason).toContain('Nothing in the graph supplies combo:nope');
  expect(d.reason).toContain('deficit');
  db.close();
});

test('autonomous allows, confirm asks, forbidden refuses', () => {
  for (const [mode, decision] of [
    ['autonomous', 'ALLOW'],
    ['confirm', 'CONFIRM'],
    ['forbidden', 'DENY'],
  ] as const) {
    const db = makeGraph(deployable);
    db.prepare(
      'INSERT INTO authority (capability_id, action, mode, holder, scope, source, note)' +
        " VALUES ('combo:deploy','execute',?,'','','policy:test','')"
    ).run(mode);
    expect(canExecute(db, { capability: 'combo:deploy' }).decision).toBe(decision);
    db.close();
  }
});

test('when grants disagree the narrowest one governs', () => {
  const db = makeGraph(deployable);
  const grant = db.prepare(
    'INSERT INTO authority (capability_id, action, mode, holder, scope, source, note)' +
      " VALUES ('combo:deploy','execute',?,'','',?,'')"
  );
  grant.run('autonomous', 'policy:dev');
  grant.run('confirm', 'policy:sec');
  // Two grants, one permissive: the restrictive one has to win, or the policy
  // is decorative.
  expect(canExecute(db, { capability: 'combo:deploy' }).decision).toBe('CONFIRM');
  db.close();
});

test('a grant held by someone else does not cover this actor', () => {
  const db = makeGraph({
    ...deployable,
    authority: [{ capability: 'combo:deploy', mode: 'autonomous', holder: 'human:alice' }],
  });
  expect(canExecute(db, { capability: 'combo:deploy', actor: 'human:alice' }).decision).toBe(
    'ALLOW'
  );
  expect(canExecute(db, { capability: 'combo:deploy', actor: 'agent:bot' }).decision).toBe('DENY');
  db.close();
});

test('a grant scoped to staging does not authorize production', () => {
  const db = makeGraph({
    ...deployable,
    authority: [{ capability: 'combo:deploy', mode: 'autonomous', scope: 'env:staging' }],
  });
  expect(canExecute(db, { capability: 'combo:deploy', target: 'env:staging' }).decision).toBe(
    'ALLOW'
  );
  expect(canExecute(db, { capability: 'combo:deploy', target: 'env:production' }).decision).toBe(
    'DENY'
  );
  db.close();
});

test('permission does not override a failing implementation', () => {
  const db = makeGraph({
    capabilities: [{ id: 'combo:deploy', name: 'Deploy', lifecycle: 'broken' }],
    authority: [{ capability: 'combo:deploy', mode: 'autonomous' }],
  });
  const d = canExecute(db, { capability: 'combo:deploy' });
  expect(d.decision).toBe('DENY');
  expect(d.reason).toContain('broken');
  db.close();
});

test('a spend beyond the remaining budget is refused', () => {
  const db = makeGraph({
    ...deployable,
    authority: [{ capability: 'combo:deploy', mode: 'autonomous' }],
  });
  db.prepare(
    'INSERT INTO budgets (capability_id, action, scope, budget_cents, spent_cents) VALUES (?,?,?,?,?)'
  ).run('combo:deploy', 'execute', '', 1000, 900);

  expect(canExecute(db, { capability: 'combo:deploy', spendCents: 50 }).decision).toBe('ALLOW');
  expect(canExecute(db, { capability: 'combo:deploy', spendCents: 500 }).decision).toBe('DENY');
  db.close();
});

// ── Lifecycle, derived from evidence ─────────────────────────────────────────

test('lifecycle follows the evidence: unknown, configured, verified, reliable', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:never', state: 'locked', lifecycle: 'unknown' },
      { id: 'combo:untested', state: 'unlocked', lifecycle: 'unknown' },
      { id: 'combo:once', state: 'unlocked', lifecycle: 'unknown' },
      { id: 'combo:always', state: 'unlocked', lifecycle: 'unknown' },
    ],
  });
  learn(db, 'combo:once', 'verified');
  for (let i = 0; i < 5; i++) learn(db, 'combo:always', 'verified');

  deriveLifecycles(db);
  const of = (id: string) =>
    db.prepare('SELECT lifecycle FROM capabilities WHERE id = ?').get(id)!.lifecycle;

  expect(of('combo:never')).toBe('unknown');
  expect(of('combo:untested')).toBe('configured');
  expect(of('combo:once')).toBe('verified');
  expect(of('combo:always')).toBe('reliable');
  db.close();
});

test('the latest failure makes a capability broken, whatever came before', () => {
  const db = makeGraph({ capabilities: [{ id: 'combo:x', state: 'unlocked' }] });
  for (let i = 0; i < 5; i++) learn(db, 'combo:x', 'verified');
  learn(db, 'combo:x', 'failed');

  deriveLifecycles(db);
  expect(
    db.prepare('SELECT lifecycle FROM capabilities WHERE id = ?').get('combo:x')!.lifecycle
  ).toBe('broken');
  db.close();
});

test('a recent failure under a passing head reads as degraded, not reliable', () => {
  const db = makeGraph({ capabilities: [{ id: 'combo:x', state: 'unlocked' }] });
  learn(db, 'combo:x', 'failed');
  learn(db, 'combo:x', 'verified');

  deriveLifecycles(db);
  expect(
    db.prepare('SELECT lifecycle FROM capabilities WHERE id = ?').get('combo:x')!.lifecycle
  ).toBe('degraded');
  db.close();
});

/**
 * A runtime's own approval setting, as `ambit authority` and `ambit can` read
 * it. The report applied a runtime-wide grant to everything the runtime
 * contributes and the gate read only grants stored against the capability, so
 * the report said confirm where the gate said ALLOW, unattended.
 */
function runtimeGraph(runtimeMode: 'autonomous' | 'confirm' | 'forbidden') {
  return makeGraph({
    capabilities: [
      { id: 'runtime:claude-code', kind: 'runtime' },
      { id: 'mcp:git', kind: 'provider' },
      { id: 'combo:version-control', kind: 'capability' },
      { id: 'act:version-control/read_repository', kind: 'action' },
    ],
    dependencies: [
      { from: 'runtime:claude-code', to: 'mcp:git', kind: 'contributes' },
      { from: 'mcp:git', to: 'combo:version-control', kind: 'provides' },
      {
        from: 'combo:version-control',
        to: 'act:version-control/read_repository',
        kind: 'provides',
      },
    ],
    authority: [
      { capability: 'combo:version-control', mode: 'autonomous', source: 'techtree' },
      {
        capability: 'act:version-control/read_repository',
        mode: 'autonomous',
        source: 'techtree',
      },
      {
        capability: 'runtime:claude-code',
        mode: runtimeMode,
        holder: 'runtime:claude-code',
        source: 'runtime:claude-code',
      },
    ],
  });
}

test('the gate and the report agree on an action a runtime narrows', () => {
  const db = runtimeGraph('confirm');
  const reported = (authorityReport(db) as any).detail.find(
    (r: any) => r.id === 'act:version-control/read_repository' && r.action === 'execute'
  );
  expect(reported.mode).toBe('confirm');
  expect(reported.narrowed_by).toBe('runtime:claude-code');

  // Whoever asks: no actor, the approving person governance passes, an agent id.
  for (const actor of [undefined, 'human:web', 'agent-7']) {
    for (const capability of ['act:version-control/read_repository', 'combo:version-control']) {
      const d: any = canExecute(db, { capability, actor });
      expect(d.decision, `${capability} as ${actor}`).toBe('CONFIRM');
    }
  }
  const d: any = canExecute(db, { capability: 'act:version-control/read_repository' });
  expect(d.reason).toContain('runtime:claude-code');
  expect(d.governing_grant.source).toBe('runtime:claude-code');
  db.close();
});

test('a runtime that forbids refuses, and a narrower scope is no way round it', () => {
  const db = runtimeGraph('forbidden');
  // A grant written about one repository cannot reach what the runtime refuses.
  db.prepare(
    `INSERT INTO authority (capability_id, action, mode, holder, scope, source, note)
     VALUES ('act:version-control/read_repository', 'execute', 'autonomous', '', 'repo:me/app', 'test', '')`
  ).run();
  for (const target of [undefined, 'repo:me/app']) {
    const d: any = canExecute(db, { capability: 'act:version-control/read_repository', target });
    expect(d.decision, String(target)).toBe('DENY');
  }
  db.close();
});

test("a runtime that allows leaves the capability's own narrower grant standing", () => {
  const db = runtimeGraph('autonomous');
  db.prepare(
    `UPDATE authority SET mode = 'confirm' WHERE capability_id = 'act:version-control/read_repository'`
  ).run();
  const d: any = canExecute(db, { capability: 'act:version-control/read_repository' });
  expect(d.decision).toBe('CONFIRM');
  // And a runtime that contributes nothing here decides nothing here.
  db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
     VALUES ('runtime:other', 'other', 'meta', '', 'runtime', 'active', 'runtime', 'verified')`
  ).run();
  db.prepare(
    `INSERT INTO authority (capability_id, action, mode, holder, scope, source, note)
     VALUES ('runtime:other', 'execute', 'forbidden', 'runtime:other', '', 'runtime:other', '')`
  ).run();
  expect(
    (canExecute(db, { capability: 'act:version-control/read_repository' }) as any).decision
  ).toBe('CONFIRM');
  db.close();
});
