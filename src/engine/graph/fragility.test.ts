import { describe, expect, test } from 'vitest';
import { outageCascade, sharedCredentials, type Edge } from './fragility.ts';

describe('outageCascade: boolean AND/OR graph redundancy logic', () => {
  test('a node with one provider stops when that provider stops', () => {
    const edges: Edge[] = [
      {
        from_capability: 'prov:github',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'provides',
      },
    ];
    const providers = new Map([['skill:vcs', ['prov:github']]]);

    const cascade = outageCascade(edges, providers, 'prov:github');
    expect([...cascade]).toEqual(['skill:vcs']);
  });

  test('a node with two providers survives losing one, but stops if both stop', () => {
    const edges: Edge[] = [
      {
        from_capability: 'prov:github',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'provides',
      },
      {
        from_capability: 'prov:gitlab',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'provides',
      },
    ];
    const providers = new Map([['skill:vcs', ['prov:github', 'prov:gitlab']]]);

    // Losing github alone does not stop vcs
    const singleLoss = outageCascade(edges, providers, 'prov:github');
    expect(singleLoss.size).toBe(0);

    // If gitlab is also lost (e.g. through a shared dependency), vcs stops
    const edgesWithCommonDep: Edge[] = [
      {
        from_capability: 'infra:network',
        to_capability: 'prov:github',
        is_hard_requisite: 1,
        kind: 'requires',
      },
      {
        from_capability: 'infra:network',
        to_capability: 'prov:gitlab',
        is_hard_requisite: 1,
        kind: 'requires',
      },
      ...edges,
    ];
    const netLoss = outageCascade(edgesWithCommonDep, providers, 'infra:network');
    expect([...netLoss].sort()).toEqual(['prov:github', 'prov:gitlab', 'skill:vcs']);
  });

  test('a hard prerequisite stops the dependent regardless of provider redundancy', () => {
    const edges: Edge[] = [
      {
        from_capability: 'skill:shell',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'requires',
      },
      {
        from_capability: 'prov:github',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'provides',
      },
      {
        from_capability: 'prov:gitlab',
        to_capability: 'skill:vcs',
        is_hard_requisite: 1,
        kind: 'provides',
      },
    ];
    const providers = new Map([['skill:vcs', ['prov:github', 'prov:gitlab']]]);

    // Shell is a hard requisite for VCS: losing shell stops VCS even though GitHub & GitLab are up
    const cascade = outageCascade(edges, providers, 'skill:shell');
    expect([...cascade]).toEqual(['skill:vcs']);
  });

  test('an optional dependency never cascades', () => {
    const edges: Edge[] = [
      {
        from_capability: 'skill:linter',
        to_capability: 'skill:ide',
        is_hard_requisite: 0,
        kind: 'enhances',
      },
    ];
    const providers = new Map();

    const cascade = outageCascade(edges, providers, 'skill:linter');
    expect(cascade.size).toBe(0);
  });

  test('a cyclic graph terminates without infinite loops', () => {
    const edges: Edge[] = [
      { from_capability: 'a', to_capability: 'b', is_hard_requisite: 1, kind: 'requires' },
      { from_capability: 'b', to_capability: 'c', is_hard_requisite: 1, kind: 'requires' },
      { from_capability: 'c', to_capability: 'a', is_hard_requisite: 1, kind: 'requires' },
    ];
    const providers = new Map();

    const cascade = outageCascade(edges, providers, 'a');
    expect([...cascade].sort()).toEqual(['b', 'c']);
  });
});

describe('sharedCredentials: SPOf detection', () => {
  test('only a credential common to ALL providers is a single point of failure', () => {
    const credsOf = new Map([
      ['prov:p1', ['cred:tokenA', 'cred:tokenB']],
      ['prov:p2', ['cred:tokenB', 'cred:tokenC']],
      ['prov:p3', ['cred:tokenB']],
    ]);

    // tokenB is shared across all 3 providers -> SPOf
    expect(sharedCredentials(['prov:p1', 'prov:p2', 'prov:p3'], credsOf)).toEqual(['cred:tokenB']);

    // tokenA is only held by p1 -> not a SPOf for the whole set
    expect(sharedCredentials(['prov:p1', 'prov:p2'], credsOf)).toEqual(['cred:tokenB']);
  });

  test('empty providers returns no shared credentials', () => {
    expect(sharedCredentials([], new Map())).toEqual([]);
  });
});
