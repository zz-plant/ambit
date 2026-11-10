import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderBrief, renderConnect, statusReport } from './cli/reports.ts';
import { PLAIN } from './cli/output.ts';
import { runConnect } from './connect.ts';
import { detectRuntimes, runDoctor, setupGaps } from './doctor.ts';
import { makeGraph } from './testing/graph.ts';
import { claudePluginEnabled, gateInstalled, gateNote, setupSteps } from './wiring.ts';

let home: string;
const write = (path: string, value: unknown) => {
  const full = join(home, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
};
const settings = () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ambit-wiring-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('whether the gate is on', () => {
  test('nothing in place is off', () => {
    expect(gateInstalled(home)).toBe(false);
  });

  test('the plugin turns it on, and a plugin switched off does not', () => {
    write('.claude/settings.json', { enabledPlugins: { 'ambit-gate@ambit': false } });
    expect(gateInstalled(home)).toBe(false);
    write('.claude/settings.json', { enabledPlugins: { 'ambit-gate@ambit': true } });
    expect(gateInstalled(home)).toBe(true);
  });

  test("a hook that runs it turns it on, and someone else's hook does not", () => {
    const hook = (command: string) => ({
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command }] }] },
    });
    write('.claude/settings.json', hook('my-linter --gate'));
    expect(gateInstalled(home)).toBe(false);
    write('.claude/settings.json', hook("sh -c 'exec ambit gate'"));
    expect(gateInstalled(home)).toBe(true);
    write('.claude/settings.json', hook('node /opt/x/cli.js gate'));
    expect(gateInstalled(home)).toBe(true);
  });

  test('a hook that covers some tools is not the gate on every call', () => {
    const on = (matcher?: string) => ({
      hooks: {
        PreToolUse: [
          { ...(matcher === undefined ? {} : { matcher }), hooks: [{ command: 'ambit gate' }] },
        ],
      },
    });
    for (const some of ['Read', 'Bash|Write']) {
      write('.claude/settings.json', on(some));
      expect(gateInstalled(home)).toBe(false);
    }
    for (const every of [undefined, '', '*', '.*']) {
      write('.claude/settings.json', on(every));
      expect(gateInstalled(home)).toBe(true);
    }
  });

  test('a settings file it cannot parse says nothing and does not throw', () => {
    write('.claude/settings.json', '{ not json');
    expect(gateInstalled(home)).toBe(false);
  });
});

describe('what a refusal says it reaches', () => {
  test('names the command where Claude Code is here, and the limit where it is not', () => {
    expect(gateNote(home, 'forbidden')).toContain('Claude Code is the one runtime');
    write('.claude.json', {});
    expect(gateNote(home, 'forbidden')).toContain('ambit connect claude-code --gate');
    expect(gateNote(home, 'confirm')).toContain('still runs');
  });

  test('says nothing of a grant that asks the gate for nothing, or once the gate is on', () => {
    write('.claude.json', {});
    expect(gateNote(home, 'autonomous')).toBeUndefined();
    write('.claude/settings.json', { enabledPlugins: { 'ambit-gate@ambit': true } });
    expect(gateNote(home, 'forbidden')).toBeUndefined();
  });
});

describe('connect --gate', () => {
  test('adds the hook beside any already there, keeps the file, and runs once', () => {
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter' }] };
    write('.claude/settings.json', { theme: 'dark', hooks: { PreToolUse: [theirs] } });

    const first = runConnect('claude-code', { home, gate: true });
    const row = first.configured.find(c => c.label === 'Claude Code gate');
    expect(row?.action).toBe('added');
    expect(row?.backup).toBeDefined();

    const after = settings();
    expect(after.theme).toBe('dark');
    expect(after.hooks.PreToolUse[0]).toEqual(theirs);
    expect(after.hooks.PreToolUse[1].matcher).toBe('*');
    expect(after.hooks.PreToolUse[1].hooks[0].command).toMatch(/gate$/);
    expect(gateInstalled(home)).toBe(true);

    const again = runConnect('claude-code', { home, gate: true });
    expect(again.configured.find(c => c.label === 'Claude Code gate')?.action).toBe(
      'already_configured'
    );
    expect(settings().hooks.PreToolUse).toHaveLength(2);
  });

  test('adds the full hook where the gate only covers some tools', () => {
    const partial = { matcher: 'Read', hooks: [{ type: 'command', command: 'ambit gate' }] };
    write('.claude/settings.json', { hooks: { PreToolUse: [partial] } });
    const result = runConnect('claude-code', { home, gate: true });
    expect(result.configured.find(c => c.label === 'Claude Code gate')?.action).toBe('added');
    expect(settings().hooks.PreToolUse[0]).toEqual(partial);
    expect(settings().hooks.PreToolUse[1].matcher).toBe('*');
    expect(gateInstalled(home)).toBe(true);
  });

  test('adds nothing where the plugin already has the gate on', () => {
    write('.claude/settings.json', { enabledPlugins: { 'ambit-gate@ambit': true } });
    runConnect('claude-code', { home, gate: true });
    expect(settings().hooks).toBeUndefined();
  });

  test('a dry run writes nothing', () => {
    write('.claude/settings.json', {});
    runConnect('claude-code', { home, gate: true, dryRun: true });
    expect(settings().hooks).toBeUndefined();
  });

  test('leaves a settings file alone when its hooks are not the shape it expects', () => {
    write('.claude/settings.json', { hooks: { PreToolUse: 'no' } });
    const result = runConnect('claude-code', { home, gate: true });
    expect(result.skipped.some(s => s.reason.includes('not a list'))).toBe(true);
    expect(settings().hooks.PreToolUse).toBe('no');
  });

  test('is refused for a runtime with no such hook', () => {
    const result = runConnect('cursor', { home, gate: true, force: true });
    expect(result.skipped.find(s => s.label === 'Claude Code gate')?.reason).toContain('--gate');
  });
});

describe('what is still missing', () => {
  test('nothing, where no agent was found', () => {
    expect(setupGaps(home)).toEqual([]);
  });

  test('Claude Code alone is one step for the server and the ledger, then the gate', () => {
    write('.claude.json', {});
    const steps = setupGaps(home);
    expect(steps.map(s => s.kind)).toEqual(['connect', 'gate']);
    expect(steps[0].command).toContain('claude plugin install ambit@ambit');
  });

  test('the plugin counts as connected and recording', () => {
    write('.claude.json', {});
    write('.claude/settings.json', { enabledPlugins: { 'ambit@ambit': true } });
    expect(claudePluginEnabled(home, 'ambit@ambit')).toBe(true);
    expect(detectRuntimes(home).find(r => r.runtime === 'claude-code')?.has_ambit).toBe(true);
    expect(setupGaps(home).map(s => s.kind)).toEqual(['gate']);
  });

  test("several agents: connect, then each one's own bridge", () => {
    const steps = setupSteps(
      [
        { runtime: 'opencode', has_ambit: false },
        { runtime: 'cursor', has_ambit: false },
      ],
      home
    );
    expect(steps[0].command).toBe('ambit connect');
    expect(steps.map(s => s.command)).toContain('ambit connect cursor --ledger');
    expect(steps.some(s => s.command.includes('ambit-telemetry.js'))).toBe(true);
    expect(steps.some(s => s.kind === 'gate')).toBe(false);
  });

  test('a bridge in place is not asked for again', () => {
    write('.config/opencode/plugins/ambit-telemetry.js', '');
    write('.cursor/hooks.json', {
      hooks: { sessionEnd: [{ command: 'node x/ambit-ledger.mjs' }] },
    });
    const steps = setupSteps(
      [
        { runtime: 'opencode', has_ambit: true },
        { runtime: 'cursor', has_ambit: true },
      ],
      home
    );
    expect(steps).toEqual([]);
  });

  test('doctor lists the gate, and status and the brief leave it to doctor', () => {
    write('.claude.json', {});
    write('.claude/settings.json', { enabledPlugins: { 'ambit@ambit': true } });
    const db = makeGraph({ capabilities: [] });
    try {
      expect(runDoctor(db, home).recommendations.join('\n')).toContain(
        'ambit connect claude-code --gate'
      );
      expect(statusReport(db, { home }).next?.command ?? '').not.toContain('--gate');
    } finally {
      db.close();
    }
  });

  test('status names the next wiring step once nothing outranks it', () => {
    write('.claude.json', {});
    const db = makeGraph({ capabilities: [] });
    try {
      expect(statusReport(db, { home }).next?.command).toContain('claude plugin install');
    } finally {
      db.close();
    }
  });
});

describe('how they read', () => {
  const brief = {
    read: [{ label: 'OpenCode', servers: ['a'] }],
    reached: 1,
    total: 2,
    reach: '1 of 2 reached',
    proven: 0,
    unproven: 0,
    no_check: 0,
    failing: [],
    next: [],
  } as any;

  test('the brief names the wiring step and what repo would suggest', () => {
    const text = renderBrief(
      {
        ...brief,
        wiring: { kind: 'connect', says: 'Let your agents ask Ambit', command: 'ambit connect' },
        project: { first: 'Database MCP Server', more: 2 },
      },
      PLAIN
    ).join('\n');
    expect(text).toContain('Before you lean on it');
    expect(text).toContain('Let your agents ask Ambit · ambit connect');
    expect(text).toContain('For this project: Database MCP Server, and 2 more · ambit repo');
  });

  test('neither line appears when there is nothing to say', () => {
    const text = renderBrief(brief, PLAIN).join('\n');
    expect(text).not.toContain('Before you lean on it');
    expect(text).not.toContain('For this project');
  });

  test('connect counts the runtimes it did not find, and ends on what is missing', () => {
    const text = renderConnect(
      {
        ok: true,
        dry_run: false,
        configured: [{ runtime: 'opencode', label: 'OpenCode', path: '/o', action: 'added' }],
        skipped: [
          { runtime: 'a', label: 'A', reason: 'Config path not found on host' },
          { runtime: 'b', label: 'B', reason: 'Config path not found on host' },
          { runtime: 'c', label: 'C', reason: 'it is broken' },
        ],
        still_missing: [{ kind: 'record', says: 'Record it', command: 'ambit x' }],
      } as any,
      PLAIN
    ).join('\n');
    expect(text).toContain('2 other runtimes not found here');
    expect(text).toContain('C  it is broken');
    expect(text).not.toContain('A  Config');
    expect(text.indexOf('Still missing')).toBeGreaterThan(text.indexOf('not found here'));
  });
});

describe('an Ambit entry that cannot start', () => {
  const dead = '/nowhere/toolchain-visualizer/src/mcp/server.ts';

  test('is found under whatever name it was given, and does not count as connected', () => {
    write('.claude.json', {
      mcpServers: {
        'tech-tree': { command: 'node', args: ['--experimental-sqlite', dead] },
        other: { command: 'node', args: ['/nowhere/else/server.js'] },
      },
    });
    const claude = detectRuntimes(home).find(r => r.runtime === 'claude-code');
    expect(claude).toMatchObject({
      has_ambit: false,
      ambit_unreachable: { entry: 'tech-tree', missing: dead },
    });
    const said = runDoctor(makeGraph({ capabilities: [] }), home).recommendations[0];
    expect(said).toContain('"tech-tree"');
    expect(said).toContain(dead);
  });

  test('an entry under another name that can start is connected', () => {
    write('.claude.json', {
      mcpServers: { tree: { command: 'ambit', args: ['mcp', '--profile=agent'] } },
    });
    const claude = detectRuntimes(home).find(r => r.runtime === 'claude-code');
    expect(claude?.has_ambit).toBe(true);
    expect(claude?.ambit_unreachable).toBeUndefined();
  });
});
