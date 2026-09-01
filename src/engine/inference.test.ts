/**
 * The graph-reading half of the engine. Every assertion here used to require
 * seeding a database through a subprocess, so in practice these functions were
 * only ever checked through whatever the CLI happened to print.
 */
import { test, expect } from 'vitest';
import {
  computeDecay,
  singlePointsOfFailure,
  findBottlenecks,
  domainHealth,
  providersOf,
  sharedCredentials,
  analyzeImpact,
  affordanceDomains,
} from './inference.ts';
import { makeGraph, daysAgo } from './testing/graph.ts';

test('decay is measured from the last change, and stops at the floor', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'tool:fresh', maturity: 0.8, updatedAt: daysAgo(1) },
      { id: 'tool:stale', maturity: 0.8, updatedAt: daysAgo(20) },
      { id: 'tool:ancient', maturity: 0.2, updatedAt: daysAgo(400) },
    ],
  });
  const byId = new Map(computeDecay(db).map(d => [d.capability_id, d]));

  expect(byId.get('tool:fresh')!.decayed).toBe(false);
  expect(byId.get('tool:stale')!.decayed).toBe(true);
  expect(byId.get('tool:stale')!.new_maturity).toBe(0.6);
  // Decay is capped at 0.3 and maturity floors at 0.1, so age cannot run away.
  expect(byId.get('tool:ancient')!.new_maturity).toBe(0.1);
  db.close();
});

test('decay ignores a capability that was never reached', () => {
  // Nothing decays that was never in use; the report is about what you have.
  const db = makeGraph({
    capabilities: [
      { id: 'tool:locked', state: 'locked', updatedAt: daysAgo(90) },
      { id: 'tool:active', state: 'active', updatedAt: daysAgo(90) },
    ],
  });
  const ids = computeDecay(db).map(d => d.capability_id);
  expect(ids).not.toContain('tool:locked');
  expect(ids).toContain('tool:active');
  db.close();
});

test('the most-recently-changed capability sorts last', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'tool:new', updatedAt: daysAgo(2) },
      { id: 'tool:old', updatedAt: daysAgo(90) },
    ],
  });
  expect(computeDecay(db)[0].capability_id).toBe('tool:old');
  db.close();
});

test('a lone provider is a single point of failure; two are not', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:deploy', name: 'Deploy' },
      { id: 'combo:search', name: 'Search' },
      { id: 'mcp:only', name: 'Only' },
      { id: 'mcp:one', name: 'One' },
      { id: 'mcp:two', name: 'Two' },
    ],
    dependencies: [
      { from: 'mcp:only', to: 'combo:deploy', kind: 'provides' },
      { from: 'mcp:one', to: 'combo:search', kind: 'provides' },
      { from: 'mcp:two', to: 'combo:search', kind: 'provides' },
    ],
  });
  const found = singlePointsOfFailure(db) as any[];
  const ids = found.map(f => f.id);

  expect(ids).toContain('combo:deploy');
  expect(ids).not.toContain('combo:search');
  expect(found.find(f => f.id === 'combo:deploy').sole_provider).toBe('Only');
  db.close();
});

test('a locked or broken capability is not reported as fragile', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:locked', state: 'locked' },
      { id: 'combo:broken', lifecycle: 'broken' },
      { id: 'mcp:p' },
    ],
    dependencies: [
      { from: 'mcp:p', to: 'combo:locked', kind: 'provides' },
      { from: 'mcp:p', to: 'combo:broken', kind: 'provides' },
    ],
  });
  // Nothing is available, so there is nothing whose loss would cost anything.
  // With no findings the report says so in words rather than returning a list.
  expect(singlePointsOfFailure(db)).toHaveProperty('note');
  db.close();
});

test('sharedCredentials is what every provider has in common, not any of them', () => {
  const credsOf = new Map([
    ['mcp:a', ['cred:shared', 'cred:only-a']],
    ['mcp:b', ['cred:shared']],
  ]);
  expect(sharedCredentials(['mcp:a', 'mcp:b'], credsOf)).toEqual(['cred:shared']);
  expect(sharedCredentials(['mcp:a'], credsOf)).toEqual(['cred:shared', 'cred:only-a']);
  expect(sharedCredentials([], credsOf)).toEqual([]);
});

test('redundant providers presenting one credential are still a single point', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:search', name: 'Search' },
      { id: 'mcp:a', name: 'A' },
      { id: 'mcp:b', name: 'B' },
      { id: 'cred:shared', name: 'Shared key', kind: 'credential', category: 'credential' },
    ],
    dependencies: [
      { from: 'mcp:a', to: 'combo:search', kind: 'provides' },
      { from: 'mcp:b', to: 'combo:search', kind: 'provides' },
      { from: 'mcp:a', to: 'cred:shared', kind: 'uses' },
      { from: 'mcp:b', to: 'cred:shared', kind: 'uses' },
    ],
  });
  // Two providers, one key: the count says redundant and the graph says not.
  const found = singlePointsOfFailure(db) as any[];
  expect(found.map(f => f.id)).toContain('combo:search');
  expect(found.find(f => f.id === 'combo:search').credential_id).toBe('cred:shared');
  db.close();
});

test('providersOf maps a target to everything that provides it', () => {
  const db = makeGraph({
    capabilities: [{ id: 'combo:x' }, { id: 'mcp:a' }, { id: 'mcp:b' }],
    dependencies: [
      { from: 'mcp:a', to: 'combo:x', kind: 'provides' },
      { from: 'mcp:b', to: 'combo:x', kind: 'provides' },
    ],
  });
  expect(providersOf(db).get('combo:x')!.sort()).toEqual(['mcp:a', 'mcp:b']);
  db.close();
});

test('a bottleneck is what the most things depend on', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'tool:base', name: 'Base' },
      { id: 'tool:leaf', name: 'Leaf' },
      { id: 'combo:a' },
      { id: 'combo:b' },
      { id: 'combo:c' },
    ],
    dependencies: [
      { from: 'tool:base', to: 'combo:a' },
      { from: 'tool:base', to: 'combo:b' },
      { from: 'tool:base', to: 'combo:c' },
      { from: 'tool:leaf', to: 'combo:a' },
    ],
  });
  expect(findBottlenecks(db)[0].capability_id).toBe('tool:base');
  db.close();
});

test('removing a capability reports what it takes with it', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'tool:base', name: 'Base' },
      { id: 'combo:downstream', name: 'Downstream' },
    ],
    dependencies: [{ from: 'tool:base', to: 'combo:downstream', hard: true }],
  });
  const impact = analyzeImpact(db, 'tool:base') as any;
  expect(impact.capability).toBe('Base');
  expect(impact.combos_at_risk.map((c: any) => c.name)).toContain('Downstream');
  db.close();
});

test('domain health and affordance domains only count what exists', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'a:1', domain: 'infra' },
      { id: 'a:2', domain: 'infra', state: 'locked' },
      { id: 'b:1', domain: 'sec' },
    ],
  });
  const domains = domainHealth(db).map((d: any) => d.domain);
  expect(domains).toContain('infra');
  expect(domains).toContain('sec');
  expect(affordanceDomains(db).domains).toContain('infra');
  db.close();
});
