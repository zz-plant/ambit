import { describe, expect, test } from 'vitest';
import { editDistance, nearest, squash } from './nearest.ts';

describe('squash', () => {
  test('makes the spellings an agent uses for one name into one word', () => {
    expect(squash('capId')).toBe('capid');
    expect(squash('cap_id')).toBe('capid');
    expect(squash('Cap-ID')).toBe('capid');
    expect(squash('Shell Execution')).toBe(squash('shell-execution'));
  });
});

describe('editDistance', () => {
  test('counts insertions, deletions and substitutions', () => {
    expect(editDistance('plan', 'plan')).toBe(0);
    expect(editDistance('plan', 'plans')).toBe(1);
    expect(editDistance('simulate', 'simulat')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  test('counts two neighbouring letters swapped as one slip', () => {
    expect(editDistance('plna', 'plan')).toBe(1);
    expect(editDistance('shell', 'sehll')).toBe(1);
    expect(nearest('plna', ['plan', 'paths'])[0]).toBe('plan');
  });

  test('gives up past the limit instead of finishing the table', () => {
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
    // A length gap alone is already past the limit.
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3);
  });
});

describe('nearest', () => {
  const tools = ['plan', 'paths', 'propose', 'simulate', 'stats'];

  test('puts what contains the word ahead of what is merely a few edits away', () => {
    expect(nearest('simulat', tools)[0]).toBe('simulate');
    expect(nearest('plans', tools)[0]).toBe('plan');
  });

  test('finds a word one slip away', () => {
    expect(nearest('simulaet', tools)).toContain('simulate');
    expect(nearest('stat', tools)[0]).toBe('stats');
  });

  test('ignores case and punctuation', () => {
    expect(nearest('PLAN', tools)[0]).toBe('plan');
    expect(nearest('Shell Execution', ['shell-execution'])).toEqual(['shell-execution']);
  });

  test('offers nothing for a word that resembles nothing', () => {
    expect(nearest('zzzzzzzz', tools)).toEqual([]);
    expect(nearest('', tools)).toEqual([]);
  });

  test('does not match on one or two characters, which every word contains', () => {
    expect(nearest('a', tools)).toEqual([]);
    expect(nearest('st', ['stats'])).toEqual([]);
  });

  test('returns no more than asked for, shortest first among equals', () => {
    const names = ['git', 'git-hooks', 'git-lfs', 'git-worktrees'];
    expect(nearest('git', names, 2)).toEqual(['git', 'git-lfs']);
  });
});
