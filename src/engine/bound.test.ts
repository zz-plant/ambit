/**
 * Bound affordances: action × target × scope with a condition. Roadmap §13.9.
 *
 * The motivating case: a grant says "autonomous on this repo, but not on
 * main". A scope says which repo; a condition says which branch is excluded.
 */
import { test, expect } from 'vitest';
import { canExecute, conditionHolds } from './assure/decide.ts';
import { grantAuthority } from './assure/promote.ts';
import { makeGraph } from './testing/graph.ts';

const repo = {
  capabilities: [
    { id: 'combo:version-control', name: 'Version Control', lifecycle: 'verified' as const },
  ],
};

test('a bound grant allows the repo but not main', () => {
  const db = makeGraph(repo);
  grantAuthority(db, {
    capability: 'combo:version-control',
    mode: 'autonomous',
    scope: 'repo:ambit',
    condition: 'branch!=main',
  });

  const onMain = canExecute(db, {
    capability: 'combo:version-control',
    target: 'repo:ambit/main',
  });
  // The condition excludes main, so the bound grant does not cover it; nothing
  // else covers the action, so it is not permitted.
  expect(onMain.decision).toBe('DENY');

  const onDev = canExecute(db, {
    capability: 'combo:version-control',
    target: 'repo:ambit/dev',
  });
  expect(onDev.decision).toBe('ALLOW');
  expect(onDev.verdict).toBe('yes');
  expect(onDev.bound?.condition).toBe('branch!=main');
  db.close();
});

test('a condition must hold even when the grant is scoped', () => {
  const db = makeGraph(repo);
  grantAuthority(db, {
    capability: 'combo:version-control',
    mode: 'autonomous',
    scope: 'repo:ambit',
    condition: 'branch=main',
  });
  const onMain = canExecute(db, {
    capability: 'combo:version-control',
    target: 'repo:ambit/main',
  });
  expect(onMain.decision).toBe('ALLOW');
  const onDev = canExecute(db, {
    capability: 'combo:version-control',
    target: 'repo:ambit/dev',
  });
  expect(onDev.decision).toBe('DENY');
  db.close();
});

test('an un-scoped grant is untouched by a condition it never had', () => {
  const db = makeGraph(repo);
  grantAuthority(db, { capability: 'combo:version-control', mode: 'autonomous' });
  expect(
    canExecute(db, { capability: 'combo:version-control', target: 'repo:anything/main' }).decision
  ).toBe('ALLOW');
  db.close();
});

test('conditionHolds parses the = and != DSL', () => {
  expect(conditionHolds('branch!=main', 'repo:ambit/dev')).toBe(true);
  expect(conditionHolds('branch!=main', 'repo:ambit/main')).toBe(false);
  expect(conditionHolds('branch=main', 'repo:ambit/main')).toBe(true);
  expect(conditionHolds('branch=main', 'repo:ambit/dev')).toBe(false);
  // Unrecognized conditions are not a narrowing.
  expect(conditionHolds('weird syntax', 'repo:ambit/main')).toBe(true);
});

test('a condition without a scope is refused, not silently ignored', () => {
  const db = makeGraph(repo);
  const res = grantAuthority(db, {
    capability: 'combo:version-control',
    mode: 'autonomous',
    condition: 'branch!=main',
  });
  expect(res.error).toContain('--scope');
  // Nothing was written.
  expect(canExecute(db, { capability: 'combo:version-control' }).decision).toBe('DENY');
  db.close();
});
