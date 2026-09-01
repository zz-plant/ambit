/**
 * What the engine proposes and what it says a change would buy. These decide
 * what a person is asked to do next, so a wrong answer here is expensive and
 * silent.
 */
import { test, expect } from 'vitest';
import { deficits, simulateFrontier } from './planning.ts';
import { economicsReport, attentionValueCentsPerHour, valueCents } from './economics.ts';
import { makeGraph, learn } from './testing/graph.ts';

// ── Deficits ─────────────────────────────────────────────────────────────────

test('with nothing recorded, deficits says so instead of returning an empty list', () => {
  const db = makeGraph({ capabilities: [{ id: 'combo:x' }] });
  expect(deficits(db)).toHaveProperty('note');
  db.close();
});

test('deficits rank by how often something actually blocked work', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:often', name: 'Often' },
      { id: 'combo:once', name: 'Once' },
    ],
  });
  for (let i = 0; i < 3; i++) learn(db, 'combo:often', 'blocked');
  learn(db, 'combo:once', 'blocked');

  const rows = deficits(db) as any[];
  expect(rows[0].id).toBe('combo:often');
  expect(rows[0].times_blocked).toBe(3);
  expect(rows[1].id).toBe('combo:once');
  db.close();
});

test('a block class is carried through so the reason survives the count', () => {
  const db = makeGraph({ capabilities: [{ id: 'combo:x', name: 'X' }] });
  learn(db, 'combo:x', 'blocked:credential');
  learn(db, 'combo:x', 'blocked:credential');

  const rows = deficits(db) as any[];
  expect(JSON.stringify(rows[0])).toContain('credential');
  db.close();
});

// ── The frontier ─────────────────────────────────────────────────────────────

/** One locked combo behind one hard prerequisite. */
const gated = {
  capabilities: [
    { id: 'combo:prereq', name: 'Prereq', category: 'combo', state: 'locked' as const },
    { id: 'combo:goal', name: 'Goal', category: 'combo', state: 'locked' as const },
    { id: 'combo:reached', name: 'Reached', category: 'combo', state: 'unlocked' as const },
  ],
  // A combo only joins the frontier if something actually provides it; the
  // prerequisite is what holds it back, not the absence of an implementation.
  dependencies: [
    { from: 'combo:prereq', to: 'combo:goal', hard: true },
    { from: 'mcp:impl', to: 'combo:goal', kind: 'provides' as const },
  ],
};
gated.capabilities.push({
  id: 'mcp:impl',
  name: 'Impl',
  category: 'skill',
  state: 'unlocked' as const,
});

test('acquiring a prerequisite unblocks what sits behind it', () => {
  const db = makeGraph(gated);
  const sim = simulateFrontier(db, ['combo:prereq']) as any;

  expect(sim.frontier_after).toBeGreaterThan(sim.frontier_before);
  expect(JSON.stringify(sim.unblocked ?? sim)).toContain('Goal');
  db.close();
});

test('assuming nothing changes nothing', () => {
  const db = makeGraph(gated);
  const sim = simulateFrontier(db, []) as any;
  expect(sim.frontier_after).toBe(sim.frontier_before);
  db.close();
});

test('a degraded capability is not counted as reached', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:ok', category: 'combo', state: 'unlocked', lifecycle: 'verified' },
      { id: 'combo:sick', category: 'combo', state: 'unlocked', lifecycle: 'degraded' },
    ],
  });
  // Configured but failing verification is not a capability you have.
  expect((simulateFrontier(db, []) as any).frontier_before).toBe(1);
  db.close();
});

test('a failing prerequisite does not unblock what depends on it', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:prereq', category: 'combo', state: 'unlocked', lifecycle: 'broken' },
      { id: 'combo:goal', category: 'combo', state: 'locked' },
    ],
    dependencies: [{ from: 'combo:prereq', to: 'combo:goal', hard: true }],
  });
  expect((simulateFrontier(db, []) as any).frontier_before).toBe(0);
  db.close();
});

// ── Economics ────────────────────────────────────────────────────────────────

test('an undeclared value is null, not a guess', () => {
  const db = makeGraph({});
  expect(valueCents(db, 'actor', 'human:alice', 'attention_value_per_hour')).toBe(null);
  db.close();
});

test('a declared attention value replaces the default; the default is used otherwise', () => {
  const db = makeGraph({});
  const fallback = attentionValueCentsPerHour(db, 'human:alice');
  expect(fallback).toBeGreaterThan(0);

  db.prepare(
    "INSERT INTO economics (entity_type, entity_id, metric, value_cents, source) VALUES (?,?,?,?,'declared')"
  ).run('actor', 'human:alice', 'attention_value_per_hour', 25_000);

  expect(attentionValueCentsPerHour(db, 'human:alice')).toBe(25_000);
  expect(attentionValueCentsPerHour(db, 'human:bob')).toBe(fallback);
  db.close();
});

test('one declared value per metric, so a restatement replaces rather than stacks', () => {
  const db = makeGraph({});
  const declare = db.prepare(
    'INSERT OR REPLACE INTO economics (entity_type, entity_id, metric, value_cents, source)' +
      " VALUES (?,?,?,?,'declared')"
  );
  declare.run('actor', 'human:alice', 'attention_value_per_hour', 10_000);
  declare.run('actor', 'human:alice', 'attention_value_per_hour', 20_000);

  const rows = db
    .prepare("SELECT value_cents FROM economics WHERE entity_id = 'human:alice'")
    .all();
  expect(rows).toHaveLength(1);
  expect(attentionValueCentsPerHour(db, 'human:alice')).toBe(20_000);
  db.close();
});

test('the economics report names where each number came from', () => {
  const db = makeGraph({});
  db.prepare(
    "INSERT INTO economics (entity_type, entity_id, metric, value_cents, source) VALUES (?,?,?,?,'declared')"
  ).run('actor', 'human:alice', 'attention_value_per_hour', 25_000);

  // The report is read as a basis for spending decisions, so a figure without
  // a stated source is worse than no figure.
  expect(JSON.stringify(economicsReport(db))).toContain('declared');
  db.close();
});
