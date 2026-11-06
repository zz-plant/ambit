import { describe, expect, test } from 'vitest';
import { kindOf } from './ontology.ts';
import {
  CHECK_RUN_SQL,
  COMPENSATORY_FRICTION_KINDS,
  MIDDLEWARE_KINDS,
  SOVEREIGN_DISCRETION_KINDS,
  KEEPER_KINDS,
} from './vocabulary.ts';
import { usable } from './assure/lifecycle.ts';

describe('Ontological rationalization', () => {
  test('kindOf resolves normalized prefixes to canonical kinds', () => {
    expect(kindOf('combo:shell-execution')).toBe('capability');
    expect(kindOf('act:version-control/commit')).toBe('action');
    expect(kindOf('human:alice')).toBe('actor');
    expect(kindOf('runtime:opencode')).toBe('runtime');
    expect(kindOf('cred:github-pat')).toBe('credential');

    // Rationalized prefixes
    expect(kindOf('upstream:anthropic')).toBe('resource');
    expect(kindOf('endpoint:ollama')).toBe('resource');
    expect(kindOf('substrate:mac-studio')).toBe('resource');
    expect(kindOf('host:docker-daemon')).toBe('resource');
    expect(kindOf('model:claude-3-7-sonnet')).toBe('resource');
    expect(kindOf('adapter:github-mcp')).toBe('provider');
    expect(kindOf('mcp:git')).toBe('provider');
    expect(kindOf('skill:pr-review')).toBe('provider');
    expect(kindOf('tool:bash')).toBe('provider');
  });

  test('usable() correctly classifies recovering vs failing states', () => {
    expect(usable('verified')).toBe(true);
    expect(usable('reliable')).toBe(true);
    expect(usable('configured')).toBe(true);
    expect(usable('degraded')).toBe(true);
    expect(usable('recovering')).toBe(true);
    expect(usable('broken')).toBe(false);
  });

  test('CHECK_RUN_SQL matches both passed and verified', () => {
    expect(CHECK_RUN_SQL).toContain("'passed'");
    expect(CHECK_RUN_SQL).toContain("'verified'");
    expect(CHECK_RUN_SQL).toContain("'failed'");
  });

  test('Labor accounting classifications alias cleanly', () => {
    expect(COMPENSATORY_FRICTION_KINDS).toBe(MIDDLEWARE_KINDS);
    expect(SOVEREIGN_DISCRETION_KINDS).toBe(KEEPER_KINDS);
    expect(COMPENSATORY_FRICTION_KINDS.has('clerical')).toBe(true);
    expect(SOVEREIGN_DISCRETION_KINDS.has('judgment')).toBe(true);
  });
});
