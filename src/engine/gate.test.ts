/**
 * The gate a Claude Code hook puts on every tool call.
 *
 * It can only narrow: forbidden is a deny, asking first or having no grant is
 * a question for the person, and allowed or unknown is no answer, so the
 * runtime's own settings decide. It never answers "allow", and a call it
 * cannot read is no answer either.
 */
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { capture } from './cli.ts';
import { claudeHookOutput, claudeHookSnippet, gateToolCall } from './gate.ts';
import { cli, dir, ENGINE, getDb, join, seed } from './testing/cli.ts';

const WRAPPER = join(import.meta.dirname, '..', '..', 'cli.js');

const WITH_GITHUB = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { github: { type: 'local', command: ['github-mcp-server'] } },
};

const decide = (tool: string) => {
  const db = getDb(join(dir, 'graph.db'));
  try {
    return gateToolCall(db, { tool_name: tool, tool_input: {} });
  } finally {
    db.close();
  }
};

test('a tool the graph does not know gets no answer, so the runtime decides', () => {
  seed(WITH_GITHUB).close();
  const answer = decide('SomeToolNobodyMapped');
  expect(answer.decision).toBeNull();
  expect(claudeHookOutput(answer)).toBe('');
});

test('an MCP tool is decided by what its server supplies, and the narrowest answer wins', () => {
  seed(WITH_GITHUB).close();
  const before = decide('mcp__github__create_issue');
  expect(before.capabilities.length).toBeGreaterThan(0);
  // Nothing is granted yet: a question for the person, not a refusal.
  expect(before.decision).toBe('ask');

  const target = before.capabilities[0].replace(/^combo:/, '');
  expect(cli('authority', 'grant', target, 'forbidden', '--by=kanav').error).toBeUndefined();
  const after = decide('mcp__github__create_issue');
  expect(after.decision).toBe('deny');
  expect(after.reason).toMatch(/^Ambit: .*forbidden/);
});

test('the gate never answers allow, even for a capability that may run unattended', () => {
  // A server matched by no node of the tree supplies only Tool Protocol, so the
  // grant set here is the only one that governs it.
  seed({
    ...WITH_GITHUB,
    mcp: { ...WITH_GITHUB.mcp, zzlocal: { type: 'local', command: ['zz'] } },
  }).close();
  expect(decide('mcp__zzlocal__run').capabilities).toEqual(['combo:tool-protocol']);
  cli('authority', 'grant', 'tool-protocol', 'autonomous', '--by=kanav');
  const answer = decide('mcp__zzlocal__run');
  expect(answer.decision).toBeNull();
  expect(claudeHookOutput(answer)).toBe('');
  // Where two grants tie, the narrower governs (AGENTS.md rule 9): GitHub also
  // supplies Version Control, which the curated model has asking first.
  expect(decide('mcp__github__create_issue').decision).toBe('ask');
});

test('a failing check is put to the person, and a recovering one is decided by its grant', () => {
  seed({
    ...WITH_GITHUB,
    mcp: { ...WITH_GITHUB.mcp, zzlocal: { type: 'local', command: ['zz'] } },
  }).close();
  cli('authority', 'grant', 'tool-protocol', 'autonomous', '--by=kanav');
  const set = (lifecycle: string) => {
    const db = getDb(join(dir, 'graph.db'));
    db.prepare("UPDATE capabilities SET lifecycle = ? WHERE id = 'combo:tool-protocol'").run(
      lifecycle
    );
    db.close();
  };

  set('broken');
  const failing = decide('mcp__zzlocal__run');
  expect(failing.decision).toBe('ask');
  expect(failing.reason).toMatch(/broken/);

  // The last check passed after one that failed: the latest check decides,
  // so the grant answers, and an unattended grant is no answer from the gate.
  set('degraded');
  expect(decide('mcp__zzlocal__run').decision).toBeNull();
});

test('the hook output is the shape Claude Code reads, and the snippet registers it on every tool', () => {
  const out = JSON.parse(
    claudeHookOutput({ decision: 'deny', reason: 'Ambit: no', capabilities: ['combo:x'] })
  );
  expect(out).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Ambit: no',
    },
  });
  const snippet = JSON.parse(claudeHookSnippet());
  expect(snippet.hooks.PreToolUse[0].matcher).toBe('*');
  expect(snippet.hooks.PreToolUse[0].hooks[0].command).toBe('ambit gate');
});

test('asked from a terminal, ambit gate prints the entry to paste', () => {
  seed(WITH_GITHUB).close();
  const r = capture(getDb(join(dir, 'graph.db')), ['gate', '--snippet']);
  expect(JSON.parse(r.snippet).hooks.PreToolUse).toHaveLength(1);
  expect(r.note).toMatch(/never allows/);
});

/**
 * Run as the hook runs it: a process, the call on stdin, stdout read as the
 * answer. A graph the gate cannot open printed a stack trace and exited 1, and
 * an empty one was seeded with the report on the stdout the hook reads.
 */
test('a graph the gate cannot open, or one never seeded, is no answer and exit 0', () => {
  const hook = (db: string) =>
    spawnSync('node', ['--experimental-sqlite', ENGINE, 'gate'], {
      input: JSON.stringify({ tool_name: 'mcp__github__create_issue', tool_input: {} }),
      encoding: 'utf8',
      env: {
        ...process.env,
        AMBIT_DB: db,
        TOOLCHAIN_DB: db,
        OPENCODE_CONFIG: join(dir, 'missing.json'),
        NODE_NO_WARNINGS: '1',
      },
    });

  const unopenable = hook(join(dir, 'no', 'such', 'dir', 'graph.db'));
  expect([unopenable.status, unopenable.stdout]).toEqual([0, '']);

  const empty = join(dir, 'empty.db');
  const unseeded = hook(empty);
  expect([unseeded.status, unseeded.stdout]).toEqual([0, '']);
  const db = getDb(empty);
  try {
    expect(db.prepare('SELECT COUNT(*) AS n FROM capabilities').get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

/**
 * cli.js answers the hook in its own process, without starting the engine.
 * The two must give one answer: a deny, a question, nothing for a call the
 * gate cannot read, and nothing for a graph it cannot open, each with exit 0.
 */
test('the wrapper answers the hook as the engine does, in its own process', () => {
  seed(WITH_GITHUB).close();
  const graph = join(dir, 'graph.db');
  const run = (input: string, args: string[], db = graph) =>
    spawnSync(process.execPath, args, {
      input,
      encoding: 'utf8',
      env: { ...process.env, AMBIT_DB: db, TOOLCHAIN_DB: db, NODE_NO_WARNINGS: '1' },
    });
  const wrapper = (input: string, db?: string) => run(input, [WRAPPER, 'gate'], db);
  const engine = (input: string) => run(input, ['--experimental-sqlite', ENGINE, 'gate']);
  const call = JSON.stringify({ tool_name: 'mcp__github__create_issue', tool_input: {} });

  // Nothing granted: a question, the same from both.
  const asked = wrapper(call);
  expect([asked.status, JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision]).toEqual([
    0,
    'ask',
  ]);
  expect(asked.stdout).toBe(engine(call).stdout);

  const target = decide('mcp__github__create_issue').capabilities[0].replace(/^combo:/, '');
  cli('authority', 'grant', target, 'forbidden', '--by=kanav');
  const denied = wrapper(call);
  expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  expect(denied.stdout).toBe(engine(call).stdout);

  expect([wrapper('not json').status, wrapper('not json').stdout]).toEqual([0, '']);
  const nowhere = wrapper(call, join(dir, 'no', 'such', 'dir', 'graph.db'));
  expect([nowhere.status, nowhere.stdout]).toEqual([0, '']);
});

const decideCall = (tool_name: string, tool_input: unknown = {}) => {
  const db = getDb(join(dir, 'graph.db'));
  try {
    return gateToolCall(db, { tool_name, tool_input });
  } finally {
    db.close();
  }
};

test("a runtime's own tool is asked about as what it does: reads observed, writes as Edit is", () => {
  seed(WITH_GITHUB).close();
  cli('authority', 'grant', 'file-editing', 'confirm', '--by=kanav');
  // `Write` said nothing while `Edit` asked; both change a file.
  expect(decideCall('Edit').decision).toBe('ask');
  expect(decideCall('Write')).toMatchObject({
    decision: 'ask',
    capabilities: ['combo:file-editing'],
  });
  // Reading is observed, which the tree lets run unasked, so the runtime decides.
  for (const read of ['Read', 'Grep', 'grep_search']) {
    expect(decideCall(read)).toMatchObject({
      decision: null,
      capabilities: ['combo:file-editing'],
    });
  }
  // A subagent's own calls come through the gate; launching one is not asked about.
  expect(decideCall('Task')).toEqual({ decision: null, capabilities: [] });
});

test('a shell call is asked about as each program its command runs', () => {
  seed(WITH_GITHUB).close();
  cli('authority', 'grant', 'version-control', 'forbidden', '--by=kanav');

  const push = decideCall('Bash', { command: 'cd app && git push origin main' });
  expect(push.capabilities).toEqual(['combo:shell-execution', 'combo:version-control']);
  expect(push.decision).toBe('deny');
  expect(push.reason).toMatch(/Version Control is forbidden/);

  // The forbidden grant is on acting; a read of the repository is Shell Execution's to answer.
  const status = decideCall('Bash', { command: 'git status' });
  expect(status.decision).toBe('ask');
  expect(status.reason).toMatch(/^Ambit: Shell Execution/);
  // A word that only mentions git runs nothing, and a call with no command is the shell alone.
  expect(decideCall('Bash', { command: 'echo "git push"' }).decision).toBe('ask');
  expect(decideCall('Bash').capabilities).toEqual(['combo:shell-execution']);

  // The tree forbids reading a secret; through the CLI as through the 1Password server.
  const secret = decideCall('Bash', { command: 'op read op://private/github/token' });
  expect(secret.capabilities).toContain('combo:secret-management');
  expect(secret.decision).toBe('deny');
  // The command is read only for a shell call: an edit's input names no program.
  expect(decideCall('Edit', { command: 'op read x' }).capabilities).toEqual(['combo:file-editing']);
});
