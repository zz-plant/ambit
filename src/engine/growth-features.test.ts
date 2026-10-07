import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  symlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { addEvent, beginRun, cli, dir, getDb, recordUse, seed, LOCAL_ONLY } from './testing/cli.ts';
import { makeGraph } from './testing/graph.ts';
import { captureFailure } from './failures.ts';
import { runDoctor } from './doctor.ts';
import { CURSOR_LEDGER_EVENTS, cursorLedgerHook, runConnect } from './connect.ts';
import { discoverMcpClients } from './mcp-clients.ts';
import { ambitCommand, cursorLedgerScript } from './paths.ts';
import { runInitRules } from './init-rules.ts';
import { runReceipt } from './receipt.ts';
import { runCiCheck } from './ci-check.ts';

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

  /**
   * Run bare, connect rewrites every runtime config it finds with no prompt.
   * It used to keep nothing, so a person could not put back what it replaced.
   */
  test('keeps every file it rewrites in a .bak, and says which and where', () => {
    const claudeJson = join(testDir, '.claude.json');
    const before = '{\n\t"mcpServers": { "other": { "command": "other" } }\n}\n';
    writeFileSync(claudeJson, before);
    const openCodeJson = join(testDir, '.config', 'opencode', 'opencode.json');
    mkdirSync(dirname(openCodeJson), { recursive: true });
    writeFileSync(openCodeJson, '{"mcp":{}}');

    const res = runConnect(undefined, { home: testDir });
    expect(res.configured.map(c => c.backup)).toEqual([`${claudeJson}.bak`, `${openCodeJson}.bak`]);
    // Byte for byte, so the person's own formatting comes back with it.
    expect(readFileSync(`${claudeJson}.bak`, 'utf8')).toBe(before);
    expect(readFileSync(`${openCodeJson}.bak`, 'utf8')).toBe('{"mcp":{}}');
    expect(res.note).toBe(
      'Changed ~/.claude.json, ~/.config/opencode/opencode.json. What each held is in ~/.claude.json.bak, ~/.config/opencode/opencode.json.bak.'
    );

    // Nothing changes on a second run, so nothing is rewritten or kept.
    const again = runConnect(undefined, { home: testDir });
    expect(again.configured.every(c => c.action === 'already_configured' && !c.backup)).toBe(true);
    expect(again.note).toBeUndefined();
    expect(readFileSync(`${claudeJson}.bak`, 'utf8')).toBe(before);
  });

  test('a link planted at the .bak name is replaced and never followed', () => {
    const claudeJson = join(testDir, '.claude.json');
    writeFileSync(claudeJson, '{"mcpServers":{}}');
    const victim = join(testDir, 'victim.txt');
    writeFileSync(victim, 'not the config');
    symlinkSync(victim, `${claudeJson}.bak`);

    expect(runConnect('claude-code', { home: testDir }).configured[0].action).toBe('added');
    expect(readFileSync(victim, 'utf8')).toBe('not the config');
    expect(lstatSync(`${claudeJson}.bak`).isSymbolicLink()).toBe(false);
    expect(readFileSync(`${claudeJson}.bak`, 'utf8')).toBe('{"mcpServers":{}}');
  });

  test('a file it cannot back up is left as it was', () => {
    const claudeJson = join(testDir, '.claude.json');
    writeFileSync(claudeJson, '{"mcpServers":{}}');
    // A directory where the backup belongs fails the copy whoever runs this.
    mkdirSync(`${claudeJson}.bak`);

    const res = runConnect('claude-code', { home: testDir });
    expect(res.configured).toEqual([]);
    expect(res.skipped[0].reason).toBeTruthy();
    expect(readFileSync(claudeJson, 'utf8')).toBe('{"mcpServers":{}}');
  });

  test('a file it creates has nothing to keep, and the note says it was created', () => {
    const res = runConnect('cursor', { home: testDir });
    expect(res.configured[0].backup).toBeUndefined();
    expect(res.note).toBe('Created ~/.cursor/mcp.json, which did not exist.');
  });

  test('respects --dry-run without creating files', () => {
    const cursorJson = join(testDir, '.cursor', 'mcp.json');
    const res = runConnect('cursor', { home: testDir, dryRun: true, force: true });
    expect(res.dry_run).toBe(true);
    expect(existsSync(cursorJson)).toBe(false);
  });
});

describe('ambit connect cursor --ledger', () => {
  const hooksJson = () => join(testDir, '.cursor', 'hooks.json');
  const ours = cursorLedgerHook();
  /** A hooks file someone already has: a formatter, and an audit hook on an event Ambit uses. */
  const theirs = {
    version: 1,
    hooks: {
      afterFileEdit: [{ command: './hooks/format.sh' }],
      afterShellExecution: [{ command: './hooks/audit.sh', timeout: 30 }],
    },
  };
  const existing = `${JSON.stringify(theirs, null, '\t')}\n`;

  test('names the hook this copy ships, by its absolute path, under the four events it records', () => {
    expect(ours.command).toBe(`node ${cursorLedgerScript()}`);
    expect(existsSync(cursorLedgerScript())).toBe(true);
    expect(isAbsolute(cursorLedgerScript())).toBe(true);
    expect(CURSOR_LEDGER_EVENTS).toEqual([
      'afterShellExecution',
      'afterMCPExecution',
      'postToolUseFailure',
      'sessionEnd',
    ]);
  });

  test('--dry-run shows the hooks it would add and writes nothing', () => {
    mkdirSync(dirname(hooksJson()), { recursive: true });
    writeFileSync(hooksJson(), existing);
    // Through the CLI, as a person types it, with HOME pointed at the test's own.
    process.env.HOME = testDir;
    const res = cli('connect', 'cursor', '--ledger', '--dry-run');
    const hooks = res.configured.find((c: any) => c.path === hooksJson());
    expect(hooks).toMatchObject({ runtime: 'cursor', action: 'added' });
    expect(hooks.hook).toBe(ours.command);
    expect(hooks.events).toEqual([...CURSOR_LEDGER_EVENTS]);
    expect(res.note).toBe(
      'Would change ~/.cursor/mcp.json, ~/.cursor/hooks.json, keeping each file that exists in <file>.bak first. Nothing was written.'
    );
    expect(readFileSync(hooksJson(), 'utf8')).toBe(existing);
    expect(existsSync(`${hooksJson()}.bak`)).toBe(false);
    expect(existsSync(join(testDir, '.cursor', 'mcp.json'))).toBe(false);
  });

  test("adds its hooks beside the ones already there, and keeps the file's old bytes in a .bak", () => {
    mkdirSync(dirname(hooksJson()), { recursive: true });
    writeFileSync(hooksJson(), existing);
    const res = runConnect('cursor', { home: testDir, ledger: true });
    const hooks = res.configured.find(c => c.path === hooksJson());
    expect(hooks).toMatchObject({ action: 'added', backup: `${hooksJson()}.bak` });
    expect(readFileSync(`${hooksJson()}.bak`, 'utf8')).toBe(existing);

    const written = JSON.parse(readFileSync(hooksJson(), 'utf8'));
    expect(written.version).toBe(1);
    expect(written.hooks.afterFileEdit).toEqual(theirs.hooks.afterFileEdit);
    expect(written.hooks.afterShellExecution).toEqual([...theirs.hooks.afterShellExecution, ours]);
    for (const e of ['afterMCPExecution', 'postToolUseFailure', 'sessionEnd']) {
      expect(written.hooks[e]).toEqual([ours]);
    }
    expect(res.note).toContain('What each held is in ~/.cursor/hooks.json.bak');

    // A second run finds them and writes nothing.
    const again = runConnect('cursor', { home: testDir, ledger: true });
    expect(again.configured.find(c => c.path === hooksJson())?.action).toBe('already_configured');
    expect(readFileSync(`${hooksJson()}.bak`, 'utf8')).toBe(existing);
  });

  test('replaces a hook an earlier copy left at another path, never running two', () => {
    mkdirSync(dirname(hooksJson()), { recursive: true });
    const old = { command: 'node /old/place/plugins/cursor/ambit-ledger.mjs', timeout: 5 };
    writeFileSync(
      hooksJson(),
      JSON.stringify({ hooks: { sessionEnd: [old, { command: './bye.sh' }] } })
    );
    const res = runConnect('cursor', { home: testDir, ledger: true });
    expect(res.configured.find(c => c.path === hooksJson())?.action).toBe('updated');
    const written = JSON.parse(readFileSync(hooksJson(), 'utf8'));
    // Cursor requires the version, so a file without one is given it.
    expect(written.version).toBe(1);
    expect(written.hooks.sessionEnd).toEqual([{ command: './bye.sh' }, ours]);
  });

  test('a file it cannot read as Cursor documents it is left as it was', () => {
    mkdirSync(dirname(hooksJson()), { recursive: true });
    for (const text of [
      '{ // mine\n "version": 1, "hooks": {} }',
      '{"version":1,"hooks":[]}',
      '{"version":1,"hooks":{"sessionEnd":"x"}}',
      '[]',
    ]) {
      writeFileSync(hooksJson(), text);
      const res = runConnect('cursor', { home: testDir, ledger: true });
      expect(res.skipped.find(s => s.label === 'Cursor ledger hooks')?.reason).toContain(
        hooksJson()
      );
      expect(readFileSync(hooksJson(), 'utf8')).toBe(text);
    }
  });

  test('--ledger on another runtime says where its ledger is and writes no hooks', () => {
    const res = runConnect('claude-code', { home: testDir, ledger: true });
    expect(res.skipped).toEqual([
      expect.objectContaining({ runtime: 'claude-code', label: 'Cursor ledger hooks' }),
    ]);
    expect(existsSync(hooksJson())).toBe(false);
  });

  test('run bare, it adds the hooks only where Cursor is installed', () => {
    expect(runConnect(undefined, { home: testDir, ledger: true }).skipped).toContainEqual({
      runtime: 'cursor',
      label: 'Cursor ledger hooks',
      reason: 'Cursor not found on host',
    });
    mkdirSync(join(testDir, '.cursor'));
    runConnect(undefined, { home: testDir, ledger: true });
    expect(JSON.parse(readFileSync(hooksJson(), 'utf8')).hooks.sessionEnd).toEqual([ours]);
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
  test('a graph with nothing recorded says so, and prices nothing', () => {
    const db = makeGraph({
      capabilities: [{ id: 'tool:browser', name: 'Browser Automation', lifecycle: 'broken' }],
    });
    const receipt = runReceipt(db, 1);
    // A failing check is a fact about the graph, not a loop someone stopped.
    expect(receipt.failing_now).toEqual(['Browser Automation']);
    expect(receipt.intercepted).toBe(0);
    expect(receipt.summary).toBe('Ambit Session Receipt: nothing recorded in the last hour.');
    expect(receipt.note).toMatch(/telemetry bridge/);
    expect(JSON.stringify(receipt)).not.toMatch(/saved|tokens|\$/);
    db.close();
  });

  test('counts what the ledger recorded: use, refusals and blocks, and failures', () => {
    const db = seed(LOCAL_ONLY);
    db.close();
    // Two refusals from the decision API, which file themselves.
    cli('can', 'quantum-teleportation', '--tool=qtp');
    cli('can', 'quantum-teleportation-two', '--tool=qtp2');
    const graph = getDb(join(dir, 'graph.db'));
    const { run } = beginRun(graph, { goal: 'receipt' });
    addEvent(graph, run, { kind: 'intercept', actor: 'ambit:control_plane', action: 'block' });
    captureFailure(graph, { source: 'opencode', tool: 'git', message: 'permission denied' });
    const used = graph
      .prepare("SELECT id FROM capabilities WHERE kind = 'capability' LIMIT 1")
      .get<{
        id: string;
      }>();
    recordUse(graph, run, used!.id);

    const receipt = runReceipt(graph, 2);
    expect(receipt.intercepted).toBe(3);
    expect(receipt.failures_reported).toBe(1);
    expect(receipt.capabilities_used).toBe(1);
    expect(receipt.summary).toBe(
      'Ambit Session Receipt for the last 2 hours: 1 capability used, 3 calls stopped before running, 1 failure reported.'
    );
    expect(receipt.note).toBeUndefined();
    graph.close();
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

describe('ambit connect on the runtimes it only read before', () => {
  test('writes each in the shape its reader reads, where its reader looks', () => {
    const vscode = join(testDir, '.config', 'Code', 'User', 'mcp.json');
    mkdirSync(dirname(vscode), { recursive: true });
    writeFileSync(vscode, JSON.stringify({ inputs: [], servers: { other: { command: 'x' } } }));
    expect(runConnect('vscode', { home: testDir }).configured[0].action).toBe('added');
    const vs = JSON.parse(readFileSync(vscode, 'utf8'));
    expect(vs.servers.ambit).toEqual({ type: 'stdio', command: 'ambit', args: ['mcp'] });
    expect(vs.servers.other).toBeDefined();
    expect(vs.inputs).toEqual([]);

    const zed = join(testDir, '.config', 'zed', 'settings.json');
    mkdirSync(dirname(zed), { recursive: true });
    writeFileSync(zed, JSON.stringify({ theme: 'One Dark' }));
    runConnect('zed', { home: testDir });
    const z = JSON.parse(readFileSync(zed, 'utf8'));
    expect(z.context_servers.ambit).toEqual({ source: 'custom', command: 'ambit', args: ['mcp'] });
    expect(z.theme).toBe('One Dark');

    // Each comes back as already configured, so a second run writes nothing.
    expect(runConnect('vscode', { home: testDir }).configured[0].action).toBe('already_configured');
    expect(runConnect('zed', { home: testDir }).configured[0].action).toBe('already_configured');

    expect(runConnect('gemini-cli', { home: testDir, force: true }).configured[0].path).toBe(
      join(testDir, '.gemini', 'settings.json')
    );
  });

  test('appends a Codex table, keeps the rest of the TOML, and does it once', () => {
    const codex = join(testDir, '.codex', 'config.toml');
    mkdirSync(dirname(codex), { recursive: true });
    writeFileSync(codex, 'model = "o4"\n\n[mcp_servers.git]\ncommand = "git-mcp"\n');
    const first = runConnect('codex', { home: testDir });
    expect(first.configured[0].action).toBe('added');
    expect(first.configured[0].backup).toBeDefined();
    const text = readFileSync(codex, 'utf8');
    expect(text).toContain('model = "o4"');
    expect(text).toContain('[mcp_servers.git]');
    expect(text).toContain('[mcp_servers.ambit]\ncommand = "ambit"\nargs = ["mcp"]\n');
    expect(runConnect('codex', { home: testDir }).configured[0].action).toBe('already_configured');
    // The reader finds what the writer wrote.
    process.env.CODEX_MCP_CONFIG = codex;
    try {
      const found = discoverMcpClients(testDir).find(c => c.runtime === 'codex');
      expect(Object.keys(found?.config.mcp ?? {})).toContain('ambit');
    } finally {
      delete process.env.CODEX_MCP_CONFIG;
    }
  });

  test('a copy npx unpacked writes a command the runtime can find', () => {
    expect(ambitCommand('/Users/x/.npm/_npx/9f2/node_modules/ambit-cli/dist-cli/engine')).toEqual([
      'npx',
      '-y',
      'ambit-cli',
    ]);
    expect(ambitCommand('/opt/homebrew/lib/node_modules/ambit-cli/dist-cli/engine')).toEqual([
      'ambit',
    ]);
  });
});
