import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb } from '../engine/db.ts';
import { ledgerSince, recordFrontier } from '../engine/ledger.ts';
import { migrate } from '../engine/migrate.ts';

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
function rpc(requests: object[], db = join(dir, 'graph.db')): any[] {
  const out = execFileSync('node', ['--experimental-sqlite', SERVER], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n',
    env: { ...process.env, TOOLCHAIN_DB: db },
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

test('a tool answers with data, not only a string the agent must parse', () => {
  // Every tool used to return its answer solely as content[0].text — a JSON
  // document stringified into a text block, which the caller had to re-parse
  // with no declared shape to check it against.
  const [reply] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ambit_stats', arguments: {} } },
  ]);
  const result = reply.result;

  expect(result.structuredContent).toBeDefined();
  expect(result.structuredContent.stats.total).toBeGreaterThan(0);

  // content stays: a client predating structured output still reads it, and a
  // person tailing the transcript can read JSON.
  expect(result.content[0].type).toBe('text');
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
});

test('structuredContent is always an object, even when the answer is a list', () => {
  // The field is specified as an object; a tool whose answer is an array or a
  // scalar has to be wrapped rather than omitted, or a client cannot rely on
  // the field being there at all.
  const [reply] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ambit_spof', arguments: {} },
    },
  ]);
  const structured = reply.result.structuredContent;
  expect(structured).toBeDefined();
  expect(Array.isArray(structured)).toBe(false);
  expect(typeof structured).toBe('object');
});

// ── §12.1: the briefing an agent gets without asking ─────────────────────────

test('the server offers the briefing as a resource, not only as a tool', () => {
  // A tool has to be thought of. A resource is what a runtime reads on
  // connect, which is the only way it reaches the agent that does not know
  // Ambit is there — the one that most needs to know what is broken.
  const [init, list, read] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ambit://briefing' } },
  ]);

  expect(init.result.capabilities.resources).toBeDefined();
  expect(list.result.resources.map((r: any) => r.uri)).toEqual(['ambit://briefing']);

  const text = read.result.contents[0].text;
  expect(text).toContain('Ambit ·');
  expect(text).toContain('ambit_can');
  expect(text.length).toBeLessThanOrEqual(1200 * 4);
});

test('an unknown resource is refused rather than answered with the briefing', () => {
  const [reply] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ambit://everything' } },
  ]);
  expect(reply.error.code).toBe(-32602);
});

test('asking and being refused records the deficit in the same call', () => {
  // The habit only survives if it costs one round trip. An agent that has to
  // make a second call to record the wall it just hit will stop recording.
  const [reply] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'ambit_can',
        arguments: { capability: 'combo:secret-management', tool: 'op read' },
      },
    },
  ]);
  const answer = reply.result.structuredContent;
  expect(answer.verdict).toBe('no');
  expect(answer.recorded_deficit).toBeTruthy();
});

test('usage answers what was used and is not on the map when asked', () => {
  // A new tool would have cost the listing's byte budget; the question is a
  // view of the same ledger `usage` reads, so it is a flag on that tool.
  const [reply] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ambit_usage', arguments: { unmapped: true } },
    },
  ]);
  const answer = JSON.parse(reply.result.content[0].text);
  expect(answer.days).toBe(30);
  expect(answer.unmapped).toEqual([]);
  expect(answer.note).toContain('ambit-telemetry.js');
});

test('ambit_goal routes goals and accepts judge option', () => {
  const [replyStandard] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ambit_goal', arguments: { goal: 'run offline without third party APIs' } },
    },
  ]);
  const standardAnswer = replyStandard.result.structuredContent;
  expect(standardAnswer).toBeDefined();

  const [replyJudged] = rpc([
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'ambit_goal',
        arguments: { goal: 'unmatched unusual requirement', judge: true },
      },
    },
  ]);
  const judgedAnswer = replyJudged.result.structuredContent;
  expect(judgedAnswer).toBeDefined();
  expect(judgedAnswer.judged).toBeDefined();
});

test('a step between two observations reads over MCP as the terminal prints it', () => {
  // The map's timeline, `ambit history since <from> <until>` and this tool
  // are one comparison, so one pair of snapshots is one sentence everywhere.
  const path = join(dir, 'week.db');
  const db = getDb(path);
  migrate(db);
  db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
     VALUES ('combo:vc', 'Version Control', 'devops', '', 'skill', 'locked', 'capability', 'detected')`
  ).run();
  recordFrontier(db, '2026-09-21 09:00:00');
  db.prepare("UPDATE capabilities SET state = 'unlocked', lifecycle = 'verified'").run();
  recordFrontier(db, '2026-09-25 17:00:00');
  const terminal = (ledgerSince(db, '2026-09-21 09:00:00', '2026-09-25 17:00:00') as any).moved;
  db.close();

  const [reply] = rpc(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'ambit_since',
          arguments: { when: '2026-09-21T09:00:00Z', until: '2026-09-25T17:00:00Z' },
        },
      },
    ],
    path
  );
  const step = JSON.parse(reply.result.content[0].text);
  expect(step.until).toBe('2026-09-25 17:00:00');
  expect(step.moved).toBe('reached 0 to 1, verified 0 to 1');
  expect(step.moved).toBe(terminal);
});

test('the tool refuses an until it cannot place, and one before the first observation', () => {
  // A bare time parsed as a moment in the year 2000, and an `until` with no
  // observation at or before it fell back to the earliest one after it, so
  // both were answered about some other moment and said nothing about it.
  const path = join(dir, 'until.db');
  const db = getDb(path);
  migrate(db);
  db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
     VALUES ('combo:vc', 'Version Control', 'devops', '', 'skill', 'locked', 'capability', 'detected')`
  ).run();
  recordFrontier(db, '2026-09-21 09:00:00');
  db.close();

  const replies = rpc(
    [
      { until: '10:00:00' },
      { when: '2026-09-01T00:00:00Z', until: '2026-09-02T00:00:00Z' },
      { when: '2026-09-01T00:00:00Z', until: '2026-09-21T09:00:00Z' },
    ].map((args, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: { name: 'ambit_since', arguments: args },
    })),
    path
  );
  const [bare, before, from] = replies.map(r => JSON.parse(r.result.content[0].text));
  expect(bare.error).toMatch(/^Not a timestamp: 10:00:00/);
  expect(before.error).toContain('2026-09-21 09:00:00');
  // The earliest observation itself is in effect at its own second.
  expect(from.error).toBeUndefined();
  expect(from.until).toBe('2026-09-21 09:00:00');
});
