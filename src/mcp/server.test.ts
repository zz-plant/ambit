import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ENGINE = join(import.meta.dirname, '..', 'engine', 'engine.ts');
const SERVER = join(import.meta.dirname, 'server.ts');
let dir: string;

// Seeded once for the file rather than per test. Every test here is
// read-only, and spawning a full seed four times took long enough on a cold CI
// runner to exceed the default hook timeout — a failure a fast machine hides.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-mcp-'));
  const config = join(dir, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({ provider: { ollama: { models: { 'qwen3-coder': {} } } } })
  );
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: config,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      CONFIG_MAPPING: JSON.stringify({
        config_keys: { provider: { type: 'provider', domain: 'ai-ml' } },
        skill_dirs: [],
      }),
    },
    stdio: 'ignore',
  });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Drive the server over stdio the way a client does. */
function rpc(requests: object[]): any[] {
  const out = execFileSync('node', ['--experimental-sqlite', SERVER], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n',
    env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') },
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

test('every request in a batch is answered', () => {
  // The per-line handler used to `return` out of the whole stdin listener, so
  // only the first message in a chunk was answered and a client that batched
  // initialize with tools/list would hang.
  const replies = rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'tt_authority', arguments: {} },
    },
  ]);
  expect(replies.map(r => r.id)).toEqual([1, 2, 3]);
});

test('the capability lifecycle is reachable by an agent, not only the CLI', () => {
  const [list] = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const names = list.result.tools.map((t: any) => t.name);
  for (const tool of [
    'ambit_verify',
    'ambit_evidence',
    'ambit_authority',
    'ambit_actions',
    'ambit_plan',
    'ambit_since',
    'ambit_ledger',
  ]) {
    expect(names).toContain(tool);
  }
});

test('each tool is advertised once, under the product name', () => {
  // Every tool was listed twice, as ambit_* and as the legacy tt_*, so
  // tools/list returned 96 entries for 48 tools — about 3,600 tokens of pure
  // duplication in the context of every agent that connects.
  const [list] = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const names: string[] = list.result.tools.map((t: any) => t.name);

  expect(new Set(names).size).toBe(names.length);
  expect(names.filter(n => !n.startsWith('ambit_'))).toEqual([]);

  // The listing is what costs context, so its size is the thing to hold.
  const bytes = Buffer.byteLength(JSON.stringify(list.result.tools));
  expect(bytes).toBeLessThan(20_000);
});

test('a tt_ name written before the rename still dispatches', () => {
  // The alias is unadvertised, not removed: an existing config must not break.
  const [reply] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'tt_authority', arguments: {} },
    },
  ]);
  expect(reply.error).toBeUndefined();
  expect(reply.result.content[0].text.length).toBeGreaterThan(0);
});

test('the advertised name and the legacy alias return the same answer', () => {
  const [replyTt, replyAmbit] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'tt_plan', arguments: { capId: 'offline-capable' } },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'ambit_plan', arguments: { capabilityId: 'offline-capable' } },
    },
  ]);
  const planTt = JSON.parse(replyTt.result.content[0].text);
  const planAmbit = JSON.parse(replyAmbit.result.content[0].text);
  expect(planTt.goal).toBe('Offline Capable');
  expect(planAmbit.goal).toBe('Offline Capable');
  expect(planTt.order).toEqual(planAmbit.order);
});

test('an unknown tool is an error, not a silent success', () => {
  const [reply] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'tt_nonexistent', arguments: {} },
    },
  ]);
  expect(reply.error?.code).toBe(-32601);
});
