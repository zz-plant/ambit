import { test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGraph } from './testing/graph.ts';
import type { Db } from './db.ts';
import { carryById, carryReport, launchOf, toolServers, weigh } from './weight.ts';
import { tokensOf } from './vocabulary.ts';
import { captureAsync } from './cli.ts';
import { techTreeView } from './views.ts';

/**
 * A tool server small enough to read: it answers `initialize` and `tools/list`,
 * and its flags make it misbehave the ways real ones do.
 */
const FAKE_SERVER = `
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
const flag = n => args.find(a => a === '--' + n || a.startsWith('--' + n + '='));
const num = (n, d) => Number((flag(n) ?? '').split('=')[1]) || d;
const count = num('tools', 3);
const size = num('page', count);
if (flag('die')) { process.stderr.write('starting\\nGITHUB_TOKEN is not set\\n'); process.exit(1); }
const needs = flag('needs-env');
if (needs && process.env[needs.split('=')[1]] !== 'opened') { process.stderr.write('wrong secret\\n'); process.exit(2); }
if (flag('noise')) process.stdout.write('fake server listening on stdio\\n');
const tools = Array.from({ length: count }, (_, i) => ({
  name: 'tool_' + i,
  description: 'x'.repeat(10 * (i + 1)),
  inputSchema: { type: 'object', properties: {} },
}));
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (flag('hang')) return;
  if (m.method === 'initialize') {
    if (flag('ask')) out({ jsonrpc: '2.0', id: 'from-server', method: 'roots/list' });
    out({ jsonrpc: '2.0', id: m.id, result: {
      protocolVersion: m.params.protocolVersion,
      capabilities: flag('no-tools') ? {} : { tools: {} },
      serverInfo: { name: 'fake', version: '1' },
    } });
  } else if (m.method === 'tools/list') {
    if (flag('error')) return out({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'boom' } });
    const start = Number(m.params?.cursor ?? 0);
    const next = start + size < tools.length ? String(start + size) : undefined;
    out({ jsonrpc: '2.0', id: m.id, result: { tools: tools.slice(start, start + size), ...(next ? { nextCursor: next } : {}) } });
  }
});
`;

let dir: string;
let server: string;
let db: Db | undefined;
const saved = { ...process.env };

/** What the fake server's listing should weigh, computed the way a model is sent it. */
function expectedChars(count: number) {
  let chars = 0;
  for (let i = 0; i < count; i++) {
    chars += JSON.stringify({
      name: `tool_${i}`,
      description: 'x'.repeat(10 * (i + 1)),
      inputSchema: { type: 'object', properties: {} },
    }).length;
  }
  return chars;
}

const local = (...args: string[]) => ({ command: process.execPath, args: [server, ...args] });

function configs(opts: { claude?: unknown; opencode?: unknown; cursor?: unknown } = {}) {
  const claude = join(dir, 'claude.json');
  const opencode = join(dir, '.config', 'opencode');
  mkdirSync(opencode, { recursive: true });
  writeFileSync(claude, JSON.stringify(opts.claude ?? {}));
  writeFileSync(join(opencode, 'opencode.json'), JSON.stringify(opts.opencode ?? {}));
  process.env.CLAUDE_CONFIG = claude;
  if (opts.cursor) {
    const cursor = join(dir, 'cursor.json');
    writeFileSync(cursor, JSON.stringify(opts.cursor));
    process.env.CURSOR_MCP_CONFIG = cursor;
  }
}

const servers = (...names: string[]) =>
  names.map(name => ({ id: `mcp:${name}`, name, category: 'mcp', state: 'unlocked' as const }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-weight-test-'));
  server = join(dir, 'fake-server.mjs');
  writeFileSync(server, FAKE_SERVER);
  process.env.HOME = dir;
  delete process.env.OPENCODE_CONFIG;
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

test('every config shape says how its server starts', () => {
  expect(launchOf({ command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } })).toEqual({
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { A: '1' },
    remote: false,
    enabled: true,
  });
  // OpenCode: the command is an array, and its environment block is `environment`.
  expect(
    launchOf({ type: 'local', command: ['bunx', 'srv'], environment: { B: '2' }, enabled: false })
  ).toMatchObject({ command: 'bunx', args: ['srv'], env: { B: '2' }, enabled: false });
  // Zed's older shape holds the path, args and env inside `command`.
  expect(launchOf({ command: { path: '/bin/srv', args: ['--x'], env: { C: '3' } } })).toMatchObject(
    { command: '/bin/srv', args: ['--x'], env: { C: '3' } }
  );
  expect(launchOf({ url: 'https://example.com/mcp' }).remote).toBe(true);
  expect(launchOf({ type: 'http' }).remote).toBe(true);
  expect(launchOf({ command: 'srv', disabled: true }).enabled).toBe(false);
});

test('one server per name, carried by every runtime that declares it on', () => {
  configs({
    claude: {
      mcpServers: { git: { command: 'git-mcp' } },
      projects: { '/work/site': { mcpServers: { db: { command: 'db-mcp' } } } },
    },
    opencode: { mcp: { git: { type: 'local', command: ['git-mcp'] }, off: { enabled: false } } },
    cursor: { mcpServers: { git: { command: 'git-mcp' }, api: { url: 'https://x.test/mcp' } } },
  });
  const found = toolServers(dir);
  expect(found.map(s => s.name)).toEqual(['api', 'db', 'git', 'off']);
  expect(found.find(s => s.name === 'git')?.runtimes.sort()).toEqual([
    'claude-code',
    'cursor',
    'opencode',
  ]);
  // A local-scope server starts in the project it belongs to.
  expect(found.find(s => s.name === 'db')?.cwd).toBe('/work/site');
  expect(found.find(s => s.name === 'off')?.runtimes).toEqual([]);
  expect(found.find(s => s.name === 'api')?.remote).toBe(true);
});

test('OPENCODE_CONFIG names the one config read, as it does for the seed', () => {
  const only = join(dir, 'only.json');
  writeFileSync(only, JSON.stringify({ mcp: { git: { type: 'local', command: ['git-mcp'] } } }));
  configs({ claude: { mcpServers: { slack: { command: 'slack-mcp' } } } });
  process.env.OPENCODE_CONFIG = only;
  expect(toolServers(dir).map(s => s.name)).toEqual(['git']);
});

test('weighs a server by asking it for its tools, and records the listing', async () => {
  configs({
    claude: { mcpServers: { fake: local('--tools=5', '--page=2', '--noise', '--ask') } },
  });
  db = makeGraph({ capabilities: servers('fake') });
  const report: any = await weigh(db, { timeoutSeconds: 10 });

  expect(report.weighed_now).toEqual(['fake']);
  expect(report.not_weighed).toEqual([]);
  const [fake] = report.servers;
  // Every page was followed, past the line of log output and the server's own request.
  expect(fake.tools).toBe(5);
  expect(fake.tokens).toBe(tokensOf(expectedChars(5)));
  expect(fake.heaviest.map((t: any) => t.name)).toEqual(['tool_4', 'tool_3', 'tool_2']);
  expect(fake.runtimes).toEqual(['Claude Code']);
  expect(report.runtimes).toEqual([{ runtime: 'Claude Code', tokens: fake.tokens, servers: 1 }]);
  expect(carryById(db).get('mcp:fake')?.tools).toBe(5);
});

test('a server that offers no tools weighs nothing, without being asked for any', async () => {
  configs({ claude: { mcpServers: { quiet: local('--no-tools', '--error') } } });
  db = makeGraph({ capabilities: servers('quiet') });
  const report: any = await weigh(db, { timeoutSeconds: 10 });
  expect(report.servers[0]).toMatchObject({ name: 'quiet', tools: 0, tokens: 0 });
});

test('the config environment reaches the server, with variables expanded', async () => {
  process.env.AMBIT_WEIGH_SECRET = 'opened';
  configs({
    claude: {
      mcpServers: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the config's own syntax, expanded by weigh
        fake: { ...local('--needs-env=TOKEN'), env: { TOKEN: '${AMBIT_WEIGH_SECRET}' } },
      },
    },
  });
  db = makeGraph({ capabilities: servers('fake') });
  const report: any = await weigh(db, { timeoutSeconds: 10 });
  expect(report.weighed_now).toEqual(['fake']);
});

test('says why each server was not weighed, and starts none it should not', async () => {
  const touched = join(dir, 'started');
  configs({
    claude: {
      mcpServers: {
        dies: local('--die'),
        hangs: local('--hang'),
        refuses: local('--error'),
        missing: { command: 'ambit-no-such-server-binary' },
        remote: { url: 'https://example.com/mcp' },
        off: { command: 'touch', args: [touched], enabled: false },
      },
    },
  });
  db = makeGraph({ capabilities: servers('dies', 'hangs', 'refuses', 'missing', 'remote', 'off') });
  const report: any = await weigh(db, { timeoutSeconds: 1 });

  const why = Object.fromEntries(report.not_weighed.map((n: any) => [n.name, n.reason]));
  expect(why.dies).toMatch(/before listing its tools: GITHUB_TOKEN is not set/);
  expect(why.hangs).toBe('no answer within 1s');
  expect(why.refuses).toBe('answered tools/list with boom');
  expect(why.missing).toMatch(/not on this machine's PATH/);
  expect(why.remote).toMatch(/^remote, so not contacted/);
  expect(why.off).toBe('switched off in every config');
  expect(existsSync(touched)).toBe(false);
  expect(report.empty).toBe(true);
});

test('a failed attempt keeps the weight the server last had', async () => {
  configs({ claude: { mcpServers: { fake: local('--tools=2') } } });
  db = makeGraph({ capabilities: servers('fake') });
  await weigh(db, { timeoutSeconds: 10 });
  const before = carryById(db).get('mcp:fake');

  configs({ claude: { mcpServers: { fake: local('--die') } } });
  const report: any = await weigh(db, { timeoutSeconds: 10 });
  expect(report.not_weighed.map((n: any) => n.name)).toEqual(['fake']);
  expect(carryById(db).get('mcp:fake')).toEqual(before);
});

test('one server by name, and a near miss is named', async () => {
  configs({ claude: { mcpServers: { github: local(), slack: local('--tools=1') } } });
  db = makeGraph({ capabilities: servers('github', 'slack') });
  const one: any = await weigh(db, { only: 'slack', timeoutSeconds: 10 });
  expect(one.weighed_now).toEqual(['slack']);
  const miss: any = await weigh(db, { only: 'githbu' });
  expect(miss.error).toMatch(/No tool server named githbu.*Did you mean github/);
});

test('the report adds up per runtime, and says what the ledger never saw called', () => {
  db = makeGraph({
    capabilities: [
      ...servers('github', 'notion', 'unweighed'),
      { id: 'mcp:gone', name: 'gone', category: 'mcp', state: 'locked' },
    ],
  });
  const put = db.prepare(
    'INSERT INTO tool_listings (capability_id, tools, chars, per_tool, runtimes) VALUES (?, ?, ?, ?, ?)'
  );
  put.run('mcp:github', 26, 28_000, '[["create_issue", 4000]]', '["claude-code","cursor"]');
  put.run('mcp:notion', 9, 8_000, '[]', '["claude-code"]');
  put.run('mcp:gone', 4, 4_000, '[]', '["claude-code"]');

  const before: any = carryReport(db);
  expect(before.runtimes).toEqual([
    { runtime: 'Claude Code', tokens: 9_000, servers: 2 },
    { runtime: 'Cursor', tokens: 7_000, servers: 1 },
  ]);
  // A server no config declares any more is carried by nobody.
  expect(before.servers.map((s: any) => s.name)).toEqual(['github', 'notion']);
  expect(before.never_weighed).toEqual(['unweighed']);
  // With nothing in the ledger, a zero would say nothing, so nothing is said.
  expect(before.not_called).toBeUndefined();
  expect(before.servers[0].calls).toBeUndefined();

  db.prepare("INSERT INTO work_runs (id) VALUES ('run-1')").run();
  db.prepare(
    "INSERT INTO capability_use (run_id, capability_id) VALUES ('run-1', 'mcp:notion')"
  ).run();
  const after: any = carryReport(db);
  expect(after.not_called).toEqual({ days: 30, servers: ['github'] });
  expect(after.servers.find((s: any) => s.name === 'notion').calls).toBe(1);
});

test('nothing weighed is said as nothing weighed, with the command that weighs', () => {
  db = makeGraph({ capabilities: servers('github') });
  const report: any = carryReport(db);
  expect(report).toMatchObject({ empty: true, next: 'ambit weigh', never_weighed: ['github'] });
});

test('the CLI weighs under check, and --recorded starts nothing', async () => {
  const touched = join(dir, 'started');
  configs({ claude: { mcpServers: { fake: { command: 'touch', args: [touched] } } } });
  db = makeGraph({ capabilities: servers('fake') });
  const recorded = await captureAsync(db, ['check', 'weigh', '--recorded']);
  expect(recorded).toMatchObject({ empty: true, never_weighed: ['fake'] });
  expect(existsSync(touched)).toBe(false);

  configs({ claude: { mcpServers: { fake: local('--tools=2') } } });
  const weighed = await captureAsync(db, ['weigh', '--timeout=10']);
  expect(weighed.weighed_now).toEqual(['fake']);
  expect(weighed.servers[0].tools).toBe(2);
});

test('the tree carries each weighed server, and says nothing for one never weighed', () => {
  db = makeGraph({ capabilities: servers('github', 'notion') });
  db.prepare(
    'INSERT INTO tool_listings (capability_id, tools, chars, per_tool, runtimes) VALUES (?, ?, ?, ?, ?)'
  ).run('mcp:github', 26, 28_000, '[["create_issue", 4000]]', '["claude-code"]');
  const items = techTreeView(db).items;
  expect(items.find(i => i.id === 'mcp:github')?.meta.carry).toMatchObject({
    tokens: 7_000,
    tools: 26,
    runtimes: ['Claude Code'],
    heaviest: [{ name: 'create_issue', tokens: 1_000 }],
  });
  expect(items.find(i => i.id === 'mcp:notion')?.meta.carry).toBeUndefined();
});
