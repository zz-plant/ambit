import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cli, seed, LOCAL_ONLY } from './testing/cli.ts';
import { makeGraph } from './testing/graph.ts';
import { runDoctor } from './doctor.ts';
import { runConnect } from './connect.ts';
import { runInitRules } from './init-rules.ts';
import { runReceipt } from './receipt.ts';
import { runCiCheck } from './ci-check.ts';
import { loopView } from './views.ts';

let testDir: string;
const origEnv = { ...process.env };

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'ambit-growth-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  process.env = { ...origEnv };
});

describe('ambit doctor', () => {
  test('evaluates graph health, grade, SPOFs, and context-thrash risk', () => {
    const db = seed(LOCAL_ONLY);
    const doc = cli('doctor');
    expect(doc.score).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(doc.grade);
    expect(doc.capabilities.total).toBeGreaterThan(0);
    expect(doc.capabilities.reached).toBeGreaterThan(0);
    expect(doc.context_thrash).toBeDefined();
    expect(doc.context_thrash.prevented_tokens).toBeGreaterThanOrEqual(0);
    expect(doc.recommendations.length).toBeGreaterThan(0);
    db.close();
  });

  test('penalizes failing checks and warns about token thrash', () => {
    const db = makeGraph({
      capabilities: [
        { id: 'tool:browser', name: 'Browser Automation', lifecycle: 'broken' },
        { id: 'combo:deploy', name: 'Production Deployment', lifecycle: 'verified' },
      ],
    });
    const doc = runDoctor(db, testDir);
    expect(doc.capabilities.failing).toBe(1);
    expect(doc.context_thrash.at_risk_tokens).toBe(32000);
    expect(doc.context_thrash.estimated_risk_dollars).toBe(0.1);
    expect(doc.recommendations.some(r => r.includes('Fix 1 degraded'))).toBe(true);
    db.close();
  });
});

describe('ambit connect', () => {
  test('auto-configures Ambit MCP server in Cursor, Claude Code, and OpenCode', () => {
    const claudeJson = join(testDir, '.claude.json');
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));

    const cursorJson = join(testDir, '.cursor', 'mcp.json');
    const openCodeJson = join(testDir, '.config', 'opencode', 'opencode.json');

    // Run connect targeting claude-code
    const res1 = runConnect('claude-code', { home: testDir });
    expect(res1.ok).toBe(true);
    expect(res1.configured.length).toBe(1);
    expect(res1.configured[0].action).toBe('added');

    const claudeParsed = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(claudeParsed.mcpServers.ambit).toEqual({
      command: 'ambit',
      args: ['mcp'],
    });
    expect(claudeParsed.mcpServers.other).toBeDefined();

    // Idempotent re-run
    const res2 = runConnect('claude-code', { home: testDir });
    expect(res2.configured[0].action).toBe('already_configured');

    // Force create for cursor
    const resCursor = runConnect('cursor', { home: testDir, force: true });
    expect(resCursor.ok).toBe(true);
    expect(existsSync(cursorJson)).toBe(true);

    // Connect to OpenCode
    const resOpenCode = runConnect('opencode', { home: testDir, force: true });
    expect(resOpenCode.ok).toBe(true);
    const openCodeParsed = JSON.parse(readFileSync(openCodeJson, 'utf8'));
    expect(openCodeParsed.mcp.ambit.command).toEqual(['ambit', 'mcp']);
    expect(openCodeParsed.mcp.ambit.enabled).toBe(true);
  });

  test('respects --dry-run without creating files', () => {
    const cursorJson = join(testDir, '.cursor', 'mcp.json');
    const res = runConnect('cursor', { home: testDir, dryRun: true, force: true });
    expect(res.dry_run).toBe(true);
    expect(existsSync(cursorJson)).toBe(false);
  });
});

describe('ambit connect on OpenCode 2', () => {
  test('adds ambit under mcp.servers, in V2 words, to a V2 config', () => {
    const path = join(testDir, '.config', 'opencode', 'opencode.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ mcp: { servers: { git: { type: 'local', command: ['git-mcp'] } } } })
    );
    expect(runConnect('opencode', { home: testDir }).configured[0].action).toBe('added');
    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.mcp.servers.ambit).toEqual({
      type: 'local',
      command: ['ambit', 'mcp'],
      disabled: false,
    });
    expect(after.mcp.ambit).toBeUndefined();
    expect(after.mcp.servers.git).toBeDefined();
    expect(runConnect('opencode', { home: testDir }).configured[0].action).toBe(
      'already_configured'
    );
  });

  test('leaves a file it cannot write faithfully as it was', () => {
    const path = join(testDir, '.config', 'opencode', 'opencode.jsonc');
    mkdirSync(dirname(path), { recursive: true });
    const commented = '{\n  // mine\n  "mcp": {}\n}\n';
    writeFileSync(path, commented);
    const res = runConnect('opencode', { home: testDir });
    expect(res.configured).toEqual([]);
    expect(res.skipped[0].reason).toMatch(/has comments/);
    expect(readFileSync(path, 'utf8')).toBe(commented);
  });
});

describe('ambit init-rules', () => {
  test('creates new AGENTS.md when none exists and avoids duplication', () => {
    const res = runInitRules('AGENTS.md', { cwd: testDir });
    expect(res.ok).toBe(true);
    expect(res.action).toBe('created');

    const content = readFileSync(join(testDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('ambit://briefing');
    expect(content).toContain('Ambit Capability Protocol');
    // The habit itself, for a client that does not pass the server's
    // `instructions` on and for an agent with a shell and no MCP.
    expect(content).toContain('`ambit_can`');
    expect(content).toContain('ambit can <capability> --exit-code');

    // Second run should be idempotent
    const res2 = runInitRules('AGENTS.md', { cwd: testDir });
    expect(res2.action).toBe('already_present');
  });

  test('appends to existing CLAUDE.md cleanly', () => {
    const claudeMd = join(testDir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Project Instructions\nAlways write tests.\n');

    const res = runInitRules('CLAUDE.md', { cwd: testDir });
    expect(res.action).toBe('appended');

    const content = readFileSync(claudeMd, 'utf8');
    expect(content).toContain('Always write tests.');
    expect(content).toContain('ambit://briefing');
  });
});

describe('ambit receipt', () => {
  test('generates micro-receipt with token savings metrics', () => {
    const db = seed(LOCAL_ONLY);
    const receipt = cli('receipt');
    expect(receipt.summary).toContain('Ambit Session Receipt');
    expect(receipt.tokens_saved).toBeGreaterThanOrEqual(0);
    expect(receipt.dollars_saved).toBeGreaterThanOrEqual(0);
    expect(receipt.verified_ratio).toBeDefined();

    const directReceipt = runReceipt(db, 2);
    expect(directReceipt.summary).toContain('Ambit Session Receipt');
    db.close();
  });
});

describe('ambit check --ci', () => {
  test('passes on healthy environment', () => {
    const db = makeGraph({
      capabilities: [
        { id: 'combo:test', name: 'Tests', lifecycle: 'verified' },
        { id: 'combo:lint', name: 'Linter', lifecycle: 'verified' },
      ],
    });
    const res = runCiCheck(db, { strict: false });
    expect(res.ok).toBe(true);
    expect(res.exit_code).toBe(0);
    expect(res.markdown).toContain('Ambit Capability Guard: PASSED');
    db.close();
  });

  test('fails and generates markdown summary when capabilities are degraded', () => {
    const db = makeGraph({
      capabilities: [
        { id: 'tool:docker', name: 'Docker Daemon', lifecycle: 'broken' },
        { id: 'combo:deploy', name: 'Deploy', lifecycle: 'verified' },
      ],
    });
    const res = runCiCheck(db, { strict: false });
    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(1);
    expect(res.failures.length).toBeGreaterThan(0);
    expect(res.markdown).toContain('Ambit Capability Guard: FAILED');
    db.close();
  });

  test('enforces strict mode on unproven capabilities', () => {
    const db = makeGraph({
      capabilities: [{ id: 'tool:git', name: 'Git Tools', lifecycle: 'configured' }],
    });
    const res = runCiCheck(db, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.failures.some(f => f.includes('Strict mode violation'))).toBe(true);
    db.close();
  });
});

describe('Loop view context-burn metrics', () => {
  test('computes context_burn tokens and dollars prevented', () => {
    const db = makeGraph({
      capabilities: [{ id: 'tool:failing', name: 'Failing Tool', lifecycle: 'broken' }],
    });
    const loop = loopView(db);
    expect(loop.context_burn).toBeDefined();
    expect(loop.context_burn?.loops_intercepted).toBeGreaterThan(0);
    expect(loop.context_burn?.tokens_prevented).toBeGreaterThan(0);
    expect(loop.context_burn?.dollars_prevented).toBeGreaterThan(0);
    db.close();
  });
});
