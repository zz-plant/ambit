import { test, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ENGINE = join(import.meta.dir, '..', 'engine', 'engine.ts');
const SERVER = join(import.meta.dir, 'server.ts');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-mcp-'));
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ provider: { ollama: { models: { 'qwen3-coder': {} } } } }));
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: config,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      CONFIG_MAPPING: JSON.stringify({ config_keys: { provider: { type: 'provider', domain: 'ai-ml' } }, skill_dirs: [] }),
    },
    stdio: 'ignore',
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Drive the server over stdio the way a client does. */
function rpc(requests: object[]): any[] {
  const out = execFileSync('node', ['--experimental-sqlite', SERVER], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n',
    env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') },
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).map(l => JSON.parse(l));
}

test('every request in a batch is answered', () => {
  // The per-line handler used to `return` out of the whole stdin listener, so
  // only the first message in a chunk was answered and a client that batched
  // initialize with tools/list would hang.
  const replies = rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tt_authority', arguments: {} } },
  ]);
  expect(replies.map(r => r.id)).toEqual([1, 2, 3]);
});

test('the capability lifecycle is reachable by an agent, not only the CLI', () => {
  const [list] = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const names = list.result.tools.map((t: any) => t.name);
  for (const tool of ['tt_verify', 'tt_evidence', 'tt_authority', 'tt_plan', 'tt_since', 'tt_ledger']) {
    expect(names).toContain(tool);
  }
});

test('tt_plan returns an ordered gap through MCP', () => {
  const [reply] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tt_plan', arguments: { capId: 'offline-capable' } } },
  ]);
  const plan = JSON.parse(reply.result.content[0].text);
  expect(plan.goal).toBe('Offline Capable');
  expect(plan.order.length).toBeGreaterThan(0);
});

test('an unknown tool is an error, not a silent success', () => {
  const [reply] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tt_nonexistent', arguments: {} } },
  ]);
  expect(reply.error?.code).toBe(-32601);
});
