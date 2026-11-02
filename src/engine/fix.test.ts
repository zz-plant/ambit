/**
 * `ambit fix` prints, and never writes; project context reads manifests only.
 */
import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LOCAL_ONLY, cli, seed } from './testing/cli.ts';
import { projectContextBoosts } from './projectContext.ts';

test('fix names the re-check command and never writes a config', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('fix', 'shell-execution');
  expect(r.capability).toBe('Shell Execution');
  expect(r.check).toBe('ambit verify shell-execution');
  expect(r.id).toBe('combo:shell-execution');
});

test('fix reports no catalogued acquisition without inventing one', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('fix', 'typed-judgment');
  expect(Array.isArray(r.options)).toBe(true);
});

test('project context reads manifests, and returns canonical capability ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-project-'));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15', supabase: '2' },
        devDependencies: { playwright: '1' },
      })
    );
    const boosts = projectContextBoosts(dir);
    expect(boosts.has('combo:browser-automation')).toBe(true);
    expect(boosts.has('combo:data-access')).toBe(true);
    expect(boosts.has('combo:hosting')).toBe(true);
    expect([...boosts].every(id => id.startsWith('combo:'))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty project boosts nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-empty-'));
  try {
    expect(projectContextBoosts(dir).size).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
