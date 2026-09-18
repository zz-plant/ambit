/**
 * Time-bounded authority elevation (TTL) tests.
 * Roadmap §13.10 / Issue #22: temporary autonomous grants that relax confirmation
 * and expire automatically back to confirmation mode.
 */
import { test, expect } from 'vitest';
import { canExecute, grantAuthority, parseDuration } from './assurance.ts';
import { makeGraph } from './testing/graph.ts';

test('parseDuration parses standard time units', () => {
  expect(parseDuration('30s')).toBe(30 * 1000);
  expect(parseDuration('15m')).toBe(15 * 60 * 1000);
  expect(parseDuration('2h')).toBe(2 * 3600 * 1000);
  expect(parseDuration('1d')).toBe(86400 * 1000);
  expect(parseDuration('invalid')).toBeNull();
});

const deployable = {
  capabilities: [{ id: 'combo:deploy', name: 'Deploy', lifecycle: 'verified' as const }],
};

test('grantAuthority grants autonomous mode with TTL and canExecute permits it while valid', () => {
  const db = makeGraph(deployable);

  // Grant autonomous with 30-minute TTL
  const res = grantAuthority(db, {
    capability: 'combo:deploy',
    mode: 'autonomous',
    ttl: '30m',
  });
  expect(res.mode).toBe('autonomous');
  expect(res.expires_at).toBeDefined();

  // Active grant -> ALLOW
  const decision = canExecute(db, { capability: 'combo:deploy' });
  expect(decision.decision).toBe('ALLOW');
  expect(decision.verdict).toBe('yes');

  db.close();
});

test('an expired elevation with nothing under it is a refusal, not a confirm', () => {
  const db = makeGraph(deployable);

  // The only grant there ever was: autonomous, and it ran out 5 minutes ago.
  const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO authority (capability_id, action, mode, holder, scope, source, expires_at)
    VALUES ('combo:deploy', 'execute', 'autonomous', '', '', 'human', ?)
  `).run(expiredAt);

  const decision = canExecute(db, { capability: 'combo:deploy' });
  // Before the elevation nothing covered this, so after it nothing does. An
  // expired row that still bought confirmation would be a permanent widening.
  expect(decision.decision).toBe('DENY');
  expect(decision.verdict).toBe('no');
  expect(decision.reason).toContain(expiredAt);
  expect(decision.narrowed_by?.[0]?.lifecycle).toBe('expired');
  expect(decision.governing_grant).toBeUndefined();

  db.close();
});

test('an expired grant does not touch a grant that still holds', () => {
  const db = makeGraph(deployable);

  const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO authority (capability_id, action, mode, holder, scope, source, expires_at)
    VALUES ('combo:deploy', 'execute', 'autonomous', '', '', 'human', ?)
  `).run(expiredAt);
  grantAuthority(db, { capability: 'combo:deploy', mode: 'autonomous', ttl: '1h', by: 'kanav' });

  const decision = canExecute(db, { capability: 'combo:deploy' });
  expect(decision.decision).toBe('ALLOW');
  expect(decision.narrowed_by).toBeUndefined();

  db.close();
});

test('standing confirm grant remains active when temporary autonomous grant expires', () => {
  const db = makeGraph(deployable);

  // Standing confirm grant from policy
  db.prepare(`
    INSERT INTO authority (capability_id, action, mode, holder, scope, source)
    VALUES ('combo:deploy', 'execute', 'confirm', '', '', 'policy')
  `).run();

  // Temporary autonomous grant with expired TTL
  const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO authority (capability_id, action, mode, holder, scope, source, expires_at)
    VALUES ('combo:deploy', 'execute', 'autonomous', '', '', 'human', ?)
  `).run(expiredAt);

  const decision = canExecute(db, { capability: 'combo:deploy' });
  expect(decision.decision).toBe('CONFIRM');
  expect(decision.verdict).toBe('ask');
  expect(decision.narrowed_by).toBeDefined();

  db.close();
});

test('--by records who declared the grant and does not bind it to them', () => {
  const db = makeGraph(deployable);
  const res = grantAuthority(db, {
    capability: 'combo:deploy',
    mode: 'autonomous',
    ttl: '1h',
    by: 'kanav',
  });
  expect(res.declared_by).toBe('human:kanav');
  expect(res.holder).toBeUndefined();

  // The ordinary case: a person grants, an agent acts.
  const decision = canExecute(db, { capability: 'combo:deploy', actor: 'agent:claude' });
  expect(decision.decision).toBe('ALLOW');

  const row = db
    .prepare('SELECT holder, promote_set_by, note FROM authority WHERE capability_id = ?')
    .get<any>('combo:deploy');
  expect(row.holder).toBe('');
  expect(row.promote_set_by).toBe('human:kanav');
  expect(row.note).toContain('declared by human:kanav');
  db.close();
});

test('a forbidden grant takes no TTL', () => {
  const db = makeGraph(deployable);
  const res = grantAuthority(db, { capability: 'combo:deploy', mode: 'forbidden', ttl: '1h' });
  expect(res.error).toContain('no TTL');
  expect(db.prepare('SELECT COUNT(*) AS n FROM authority').get<any>().n).toBe(0);
  db.close();
});
