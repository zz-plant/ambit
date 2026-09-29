import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
function rpc(
  requests: object[],
  db = join(dir, 'graph.db'),
  options: { args?: string[]; env?: Record<string, string> } = {}
): any[] {
  const out = execFileSync('node', ['--experimental-sqlite', SERVER, ...(options.args ?? [])], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n',
    env: { ...process.env, TOOLCHAIN_DB: db, ...options.env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/** One tools/call, answered. */
function call(name: string, args: object = {}, db = join(dir, 'graph.db')): any {
  return rpc(
    [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }],
    db
  )[0];
}

/** A copy of the seeded graph, for a test that writes. */
function copyOfGraph(name: string): string {
  const path = join(dir, name);
  copyFileSync(join(dir, 'graph.db'), path);
  return path;
}

/** A digest of every table, so "changed nothing" can be asserted and not assumed. */
function digest(path: string): Record<string, string> {
  const db = getDb(path);
  const out: Record<string, string> = {};
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]) {
    out[name] = JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all());
  }
  db.close();
  return out;
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

test('the agent profile lists ten tools in under five kilobytes, and the rest still answer', () => {
  // Sixty descriptions in the context of a session that only asks ambit_can is
  // most of the cost of connecting. The profile is a shorter listing, and no
  // more: nothing is hidden, so a tool the listing left out still answers.
  const [list, unlisted] = rpc(
    [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ambit_stats', arguments: {} },
      },
    ],
    join(dir, 'graph.db'),
    { args: ['--profile=agent'] }
  );
  const names: string[] = list.result.tools.map((t: any) => t.name);
  expect(names).toEqual([
    'ambit_briefing',
    'ambit_can',
    'ambit_next',
    'ambit_impact',
    'ambit_plan',
    'ambit_goal',
    'ambit_verify',
    'ambit_record_failure',
    'ambit_propose',
    'ambit_register_skill',
  ]);
  expect(Buffer.byteLength(JSON.stringify(list.result.tools))).toBeLessThan(5_000);
  expect(unlisted.result.structuredContent.stats.total).toBeGreaterThan(0);
});

test('the ambit command passes its profile on to the server', () => {
  // `claude mcp add ambit -- ambit mcp --profile=agent` is how anyone reaches
  // the flag, and the wrapper used to start the server with no arguments at all.
  const CLI = join(import.meta.dirname, '..', '..', 'cli.js');
  const out = execFileSync('node', [CLI, 'mcp', '--profile=agent'], {
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`,
    env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  expect(JSON.parse(out.trim()).result.tools).toHaveLength(10);

  let failure: any;
  try {
    execFileSync('node', [CLI, 'mcp', '--profile=agnet'], {
      input: '',
      env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') },
      stdio: 'pipe',
    });
  } catch (e) {
    failure = e;
  }
  expect(failure?.status).toBe(2);
});

test('a profile can be chosen by environment as well as by flag, and a wrong one refuses to start', () => {
  const [byEnv] = rpc(
    [{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }],
    join(dir, 'graph.db'),
    {
      env: { AMBIT_MCP_PROFILE: 'agent' },
    }
  );
  expect(byEnv.result.tools).toHaveLength(10);

  // The flag wins over the environment, and the two-word spelling works.
  const [byFlag] = rpc(
    [{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }],
    join(dir, 'graph.db'),
    {
      args: ['--profile', 'full'],
      env: { AMBIT_MCP_PROFILE: 'agent' },
    }
  );
  expect(byFlag.result.tools.length).toBeGreaterThan(50);

  // A typo is not answered with sixty tools that look like a working server.
  let failure: any;
  try {
    rpc([], join(dir, 'graph.db'), { args: ['--profile=agnet'] });
  } catch (e) {
    failure = e;
  }
  expect(failure?.status).toBe(2);
  expect(String(failure?.stderr)).toContain('unknown profile "agnet"');
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
  // -32602, the spec's own code for a tool name it does not know. -32601 is
  // for a method, and `tools/call` is the method that was found.
  expect(reply.error?.code).toBe(-32602);
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

// ── The handshake ────────────────────────────────────────────────────────────

test('connecting tells the client the one habit, so nobody has to paste it', () => {
  // The README asked the user to add a line to their agent's instructions. A
  // client that reads `instructions` puts it in front of the model unasked,
  // which is the only way it reaches the agent nobody configured.
  const [init] = rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
  const text: string = init.result.instructions;
  expect(text).toContain('ambit_can');
  expect(text).toContain('ambit_briefing');
  expect(text).toContain('never grant');
  // It is in the context of every session, so it is held short.
  expect(text.length).toBeLessThan(1_200);
});

test('the agent profile does not send an agent to a tool it was not shown', () => {
  const [full, agent] = [
    rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }])[0],
    rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }], join(dir, 'graph.db'), {
      args: ['--profile=agent'],
    })[0],
  ];
  expect(full.result.instructions).toContain('ambit_cap');
  expect(agent.result.instructions).not.toContain('ambit_cap');
});

test('the server answers with the version the client asked for when it speaks it', () => {
  // It answered 2024-11-05 to everyone, while sending `structuredContent`, a
  // field only 2025-06-18 defines.
  const versions = ['2025-06-18', '2024-11-05', '2025-11-25', '2025-03-26', '2024-10-07'];
  const replies = rpc(
    versions.map((protocolVersion, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'initialize',
      params: { protocolVersion },
    }))
  );
  expect(replies.map(r => r.result.protocolVersion)).toEqual([
    '2025-06-18', // spoken
    '2024-11-05', // spoken
    '2025-06-18', // newer than any: the newest we speak
    '2024-11-05', // between two: the newest that is not newer than the request
    '2024-11-05', // older than any: the oldest we speak
  ]);
  // A client that sends none keeps what it always got.
  const [bare] = rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
  expect(bare.result.protocolVersion).toBe('2024-11-05');
});

test('ping is answered, and a notification is never replied to', () => {
  // "Unknown: ping" read to a client as a broken server. And a reply to a
  // notification is an error line with no request to match it to.
  const replies = rpc([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'no/such/method' },
  ]);
  expect(replies).toHaveLength(2);
  expect(replies[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  expect(replies[1].id).toBe(2);
  expect(replies[1].error.code).toBe(-32601);
});

test('a message the server cannot use is answered, not swallowed', () => {
  // The handler's outer catch was empty, so each of these left the client
  // waiting for a reply that was never going to be written.
  const out = execFileSync('node', ['--experimental-sqlite', SERVER], {
    input:
      [
        'this is not json',
        '[1, 2]',
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call' }),
        JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { arguments: {} } }),
      ].join('\n') + '\n',
    env: { ...process.env, TOOLCHAIN_DB: join(dir, 'graph.db') },
    encoding: 'utf8',
  });
  const replies = out
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  expect(replies.map(r => [r.id ?? null, r.error?.code])).toEqual([
    [null, -32700],
    [null, -32600],
    [3, -32602],
    [4, -32602],
  ]);
});

// ── What a client may assume before it calls ────────────────────────────────

test('every tool says whether it changes anything, and the readers were measured', () => {
  const [list] = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const tools: any[] = list.result.tools;
  for (const t of tools) expect(typeof t.annotations?.readOnlyHint).toBe('boolean');

  const byName = new Map(tools.map(t => [t.name, t.annotations]));
  expect(byName.get('ambit_plan')).toEqual({ readOnlyHint: true });
  expect(byName.get('ambit_record_failure')).toEqual({
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  });
  // It runs a command a person or agent declared, so it claims no safety.
  expect(byName.get('ambit_verify')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  // The ones an agent calls most write a row of Ambit's own bookkeeping, and
  // are listed honestly as writes.
  for (const name of ['ambit_can', 'ambit_briefing', 'ambit_context']) {
    expect(byName.get(name)?.readOnlyHint).toBe(false);
  }

  // The claim is checked against the database, not against this file: every
  // tool that says it only reads is called, and no table may differ after.
  const path = copyOfGraph('readers.db');
  const before = digest(path);
  const sample: Record<string, string> = {
    capId: 'combo:shell-execution',
    query: 'shell',
    goal: 'run offline without third party APIs',
    target: 'repo:acme/app',
    id: 'combo:shell-execution',
    proposalId: 'prop-none',
  };
  const readers = tools.filter(t => t.annotations.readOnlyHint);
  expect(readers.length).toBeGreaterThan(40);
  const replies = rpc(
    readers.map((t, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: {
        name: t.name,
        arguments: Object.fromEntries(
          (t.inputSchema.required ?? []).map((k: string) => [k, sample[k]])
        ),
      },
    })),
    path
  );
  expect(replies.every(r => r.error === undefined)).toBe(true);
  const after = digest(path);
  const changed = Object.keys(after).filter(t => after[t] !== before[t]);
  expect(changed).toEqual([]);
});

test('every listed tool has a handler, and takes what its own schema says it takes', () => {
  // The dispatch is a switch keyed by name, separate from the catalogue that
  // advertises it, so a tool can be listed and unanswerable. This calls each
  // one with what its schema requires and asks only that the server answers.
  const [list] = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const sample: Record<string, string> = {
    capId: 'combo:shell-execution',
    capability: 'combo:shell-execution',
    query: 'shell',
    goal: 'run offline without third party APIs',
    target: 'repo:acme/app',
    id: 'skill:smoke',
    runId: 'run-none',
    kind: 'event',
    outcome: 'ok',
    proposalId: 'prop-none',
    service: 'svc:none',
    verify: 'true',
  };
  const tools: any[] = list.result.tools;
  const path = copyOfGraph('smoke.db');
  const replies = rpc(
    tools.map((t, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: {
        name: t.name,
        arguments: Object.fromEntries(
          (t.inputSchema.required ?? []).map((k: string) => {
            if (!(k in sample))
              throw new Error(`no sample for required argument ${k} of ${t.name}`);
            return [k, sample[k]];
          })
        ),
      },
    })),
    path
  );
  expect(replies).toHaveLength(tools.length);
  const protocolErrors = replies
    .map((r, i) => ({ name: tools[i].name, error: r.error }))
    .filter(r => r.error);
  expect(protocolErrors).toEqual([]);
});

test('a slow incident probe does not hold up a ping queued behind it', async () => {
  // The probe waits up to three seconds per service. Answered from the handler
  // it blocked every request behind it, a ping among them, which a client reads
  // as a dead server; answered from its own callback it does not.
  const silent = createServer(() => {}); // accepts the connection and never answers
  await new Promise<void>(done => silent.listen(0, '127.0.0.1', done));
  const { port } = silent.address() as AddressInfo;
  const manifest = join(dir, 'slow-manifest.json');
  writeFileSync(
    manifest,
    JSON.stringify({ services: [{ key: 'slow', url: `http://127.0.0.1:${port}/` }] })
  );
  try {
    const replies = rpc(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'ambit_incidents', arguments: {} },
        },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ],
      copyOfGraph('incidents.db'),
      { env: { INFRA_MANIFEST: manifest } }
    );
    expect(replies.map(r => r.id)).toEqual([2, 1]);
    // And the answer still arrives once the probe gives up, although the
    // client closed its side as soon as it had sent both.
    expect(replies[1].result.structuredContent).toMatchObject({ probed: 1, online: 0 });
    expect(replies[1].result.structuredContent.incidents[0]).toMatchObject({
      service: 'svc:slow',
      status: 'down',
    });
  } finally {
    silent.close();
  }
});

// ── A call that cannot work says so, in a form the model can act on ─────────

test('a call missing what it needs comes back as a failed call that says what to send', () => {
  // Most answered with "Provided value cannot be bound to SQLite parameter 1",
  // a CLI usage line, or a TypeError from inside a string method. None of them
  // said which argument was missing.
  for (const [name, missing] of [
    ['ambit_cap', 'query'],
    ['ambit_plan', 'capId'],
    ['ambit_can', 'capability'],
    ['ambit_run_end', 'runId'],
    ['ambit_goal', 'goal'],
  ]) {
    const reply = call(name, {});
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).toBe(true);
    const answer = reply.result.structuredContent;
    expect(answer.error).toContain(`${missing} is required`);
    expect(answer.takes).toContain(`${missing}*`);
    expect(answer.error).not.toContain('ambit goal');
  }
});

test('an argument the tool does not take is refused, and nothing runs', () => {
  // `ambit_verify` with a misspelt name ran every declared check, because "no
  // capId" is how one asks for all of them.
  const path = copyOfGraph('unknown-arg.db');
  const before = digest(path);
  const reply = call('ambit_verify', { cap: 'shell-execution' }, path);
  expect(reply.result.isError).toBe(true);
  expect(reply.result.structuredContent.error).toContain('no argument named cap');
  expect(digest(path)).toEqual(before);
});

test('a name a model spells its own way is understood when the meaning is not in doubt', () => {
  const answers = [
    call('ambit_plan', { capId: 'offline-capable' }),
    call('ambit_plan', { capability_id: 'offline-capable' }),
    call('ambit_plan', { capabilityId: 'combo:offline-capable' }),
    call('ambit_plan', { capability: 'offline-capable', judge: null }),
  ].map(r => r.result);
  // `judge` is not a plan argument, and null says "I have no value for it".
  expect(answers.every(a => a.isError === undefined)).toBe(true);
  expect(new Set(answers.map(a => a.structuredContent.goal))).toEqual(new Set(['Offline Capable']));
});

test('a number sent as a string is a number, and one that is not a number is refused', () => {
  const coerced = call('ambit_digest', { days: '14' });
  expect(coerced.result.isError).toBeUndefined();
  expect(
    coerced.result.structuredContent.days ?? coerced.result.structuredContent.window_days
  ).toBeDefined();

  const refused = call('ambit_digest', { days: 'soon' });
  expect(refused.result.isError).toBe(true);
  expect(refused.result.structuredContent.error).toContain('days must be a number, got "soon"');
});

test('what the engine could not answer is flagged, and a report with a failing part is not', () => {
  // The engine has always said `{ error }` for a call it could not answer. Over
  // MCP that arrived as an ordinary success, so a client had no field to
  // branch on. The rule is the CLI's: a top-level string `error`.
  const failed = call('ambit_scope', { target: '' });
  expect(failed.result.isError).toBe(true);

  const fine = call('ambit_stats', {});
  expect(fine.result.isError).toBeUndefined();
});

test('an unknown tool names the one that was probably meant', () => {
  const [near, legacy, far] = rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ambit_simulat', arguments: {} },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tt_plna', arguments: {} } },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ambit_zzzzzzzz', arguments: {} },
    },
  ]);
  expect(near.error.message).toContain('Did you mean ambit_simulate');
  expect(legacy.error.message).toContain('ambit_plan');
  expect(far.error.message).toContain('tools/list');
});

// ── One answer to "which capability did you mean" ───────────────────────────

test('a slightly wrong id is answered the same way by every tool that takes one', () => {
  // impact said "did you mean", verify said "No capability nope in the model",
  // evidence answered an empty list, actions said the capability declared no
  // contract, and simulate reported a larger frontier for acquiring it.
  for (const tool of [
    'impact',
    'evidence',
    'actions',
    'plan',
    'paths',
    'simulate',
    'propose',
    'catalog',
    'verify',
  ]) {
    const reply = call(`ambit_${tool}`, { capId: 'shell-exection' });
    expect(reply.result.isError, tool).toBe(true);
    const answer = reply.result.structuredContent;
    expect(answer.error, tool).toContain('No capability "shell-exection"');
    expect(answer.did_you_mean, tool).toContain('combo:shell-execution');
    // Nothing was made up on the way.
    expect(answer.acquired, tool).toBeUndefined();
    expect(answer.frontier_after, tool).toBeUndefined();
  }
});

test('a display name and a bare word reach the same node as its id', () => {
  const ids = ['combo:shell-execution', 'shell-execution', 'Shell Execution', 'SHELL_EXECUTION'];
  const answers = ids.map(capId => call('ambit_simulate', { capId }).result.structuredContent);
  for (const a of answers) expect(a.frontier_before).toBeDefined();
  expect(answers.map(a => a.frontier_after)).toEqual(
    Array(ids.length).fill(answers[0].frontier_after)
  );
});

test('a word that resembles nothing says how to find an id', () => {
  const reply = call('ambit_plan', { capId: 'quantum-teleportation' });
  expect(reply.result.isError).toBe(true);
  expect(reply.result.structuredContent.hint).toContain('ambit_cap');
});

test('asking about a slip is not a refusal, and files nothing', () => {
  // "no" for `shell-exection` reads as "you may not run a shell", and filing it
  // counts a typo as a deficit. A slip is answered as one, and the graph is
  // left as it was.
  const path = copyOfGraph('can-slip.db');
  const before = digest(path);
  const reply = call('ambit_can', { capability: 'shell-exection', tool: 'bash' }, path);
  expect(reply.result.isError).toBe(true);
  expect(reply.result.structuredContent.did_you_mean).toContain('combo:shell-execution');
  expect(reply.result.structuredContent.verdict).toBeUndefined();
  expect(digest(path)).toEqual(before);
});

test('asking about a wall that resembles no node is still filed, which is the point', () => {
  const path = copyOfGraph('can-wall.db');
  const reply = call('ambit_can', { capability: 'quantum-teleportation', tool: 'qtp' }, path);
  const answer = reply.result.structuredContent;
  expect(answer.verdict).toBe('no');
  expect(answer.recorded_deficit).toBeDefined();
});

// ── What comes back, and how much of it ─────────────────────────────────────

test('the text half of a result is compact, since a client may send both halves to a model', () => {
  // Indenting spent about a quarter of a typical result on whitespace, and the
  // same answer was in `structuredContent` beside it.
  const reply = call('ambit_stats', {});
  const text: string = reply.result.content[0].text;
  expect(text).toBe(JSON.stringify(reply.result.structuredContent));
  expect(text).not.toContain('\n');
});

test('the authority answer is the short one unless the rows are asked for', () => {
  // The rows were about 10KB of an 11KB answer, and they answer a question
  // nobody asked when the call is "what may I do".
  const short = call('ambit_authority', {}).result.structuredContent;
  const long = call('ambit_authority', { detail: true }).result.structuredContent;

  for (const key of ['autonomous', 'needs_approval', 'forbidden']) {
    expect(short[key]).toEqual(long[key]);
  }
  expect(short.detail).toBeUndefined();
  expect(short.detail_omitted).toBeGreaterThan(0);
  expect(short.hint).toContain('detail: true');
  expect(long.detail).toBeDefined();
  expect(JSON.stringify(short).length).toBeLessThan(JSON.stringify(long).length / 4);
});
