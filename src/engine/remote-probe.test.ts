/**
 * A remote MCP server, asked whether it answers.
 *
 * Most servers a plugin brings are remote, and what breaks one is rarely in
 * the config: the endpoint moved, the host is gone, the server errors. The
 * probe sends one unsigned request, and the verdict keeps a server that asks
 * for a sign-in apart from one that works, since the runtime's own sign-in is
 * never sent and so never tested.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyProbe } from './failures.ts';
import { probeServer, probeTarget } from './remote-probe.ts';

let server: Server;
let base: string;
const seen: { method?: string; path?: string; auth?: string; query?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    seen.push({
      method: req.method,
      path: url.pathname,
      auth: req.headers.authorization,
      query: url.search,
    });
    const reply = (status: number, type: string, body: string, headers = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    switch (url.pathname) {
      case '/mcp':
        return reply(200, 'application/json', '{"jsonrpc":"2.0","id":1,"result":{}}');
      case '/stateless':
        return reply(
          400,
          'application/json',
          '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}'
        );
      case '/stream':
        return reply(200, 'text/event-stream', 'event: message\ndata: {}\n\n');
      case '/sse':
        if (req.method === 'POST') return reply(405, 'text/plain', 'no');
        return reply(200, 'text/event-stream', 'event: endpoint\ndata: /messages\n\n');
      case '/signin':
        return reply(401, 'application/json', '{"error":"unauthorized"}', {
          'www-authenticate': 'Bearer',
        });
      case '/moved':
        return reply(308, 'text/plain', '', { location: 'https://elsewhere.example/mcp' });
      case '/page':
        return reply(200, 'text/html', '<html></html>');
      case '/broken':
        return reply(502, 'text/plain', 'bad gateway');
      default:
        return reply(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

async function verdictAt(path: string) {
  const target = probeTarget(`${base}${path}`);
  if ('refused' in target) throw new Error(target.refused);
  return probeServer(target.url, 5000);
}

test('a server that answers in JSON-RPC, or with a stream, passes', async () => {
  expect((await verdictAt('/mcp')).verdict).toMatchObject({ outcome: 'answered', passes: true });
  expect((await verdictAt('/stream')).verdict.passes).toBe(true);
});

test('a stateless server that refuses initialize in JSON-RPC still answers', async () => {
  expect((await verdictAt('/stateless')).verdict).toMatchObject({
    outcome: 'answered',
    passes: true,
  });
});

test('an older SSE endpoint is asked again with a GET for its stream', async () => {
  const { verdict, ran } = await verdictAt('/sse');
  expect(verdict.passes).toBe(true);
  expect(ran).toMatch(/^GET /);
});

test('a server that asks for a sign-in is no pass and no failure', async () => {
  expect((await verdictAt('/signin')).verdict).toMatchObject({
    outcome: 'asks-sign-in',
    passes: null,
  });
});

test('a moved, missing, broken or non-MCP endpoint says so', async () => {
  expect((await verdictAt('/moved')).verdict).toMatchObject({
    outcome: 'redirects',
    passes: null,
    says: 'redirects to elsewhere.example',
  });
  expect((await verdictAt('/gone')).verdict).toMatchObject({ outcome: 'not-found', passes: false });
  expect((await verdictAt('/broken')).verdict).toMatchObject({
    outcome: 'server-error',
    passes: false,
  });
  expect((await verdictAt('/page')).verdict).toMatchObject({ outcome: 'not-mcp', passes: false });
});

test('the request carries no sign-in and no query string', async () => {
  seen.length = 0;
  const target = probeTarget(`${base}/mcp?api_key=secret#frag`);
  if ('refused' in target) throw new Error(target.refused);
  expect(target.dropped).toBe(true);
  await probeServer(target.url, 5000);
  expect(seen).toEqual([{ method: 'POST', path: '/mcp', auth: undefined, query: '' }]);
});

test('a URL with a credential, a variable or another scheme is not contacted', () => {
  expect(probeTarget('https://user:pass@example.com/mcp')).toEqual({
    refused: 'its URL carries a credential',
  });
  // A variable a runtime fills in, written as the configs write it.
  const variable = ['https://example.com/', '$', '{TOKEN}'].join('');
  expect(probeTarget(variable)).toEqual({
    refused: 'its URL names a variable its runtime fills in',
  });
  expect(probeTarget('file:///etc/passwd')).toEqual({ refused: 'file: is not http or https' });
});

test('a connection that fails is classified by the code it failed with, and never guessed', () => {
  expect(classifyProbe({ errorCode: 'ENOTFOUND' })).toMatchObject({
    outcome: 'unreachable',
    passes: false,
  });
  expect(classifyProbe({ timedOut: true })).toMatchObject({ outcome: 'timed-out', passes: false });
  expect(classifyProbe({ errorCode: 'EWEIRD' })).toMatchObject({
    outcome: 'unclassified',
    passes: null,
  });
});

test('verify --mcp names remote servers it did not contact, and --remote records what answered', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { makeGraph } = await import('./testing/graph.ts');
  const { verifyMcpServers } = await import('./assure/verify.ts');
  const home = mkdtempSync(join(tmpdir(), 'ambit-remote-verify-'));
  const saved = { ...process.env };
  try {
    process.env.HOME = home;
    delete process.env.OPENCODE_CONFIG;
    process.env.CLAUDE_HOME = join(home, '.claude');
    process.env.CLAUDE_CONFIG = join(home, '.claude.json');
    writeFileSync(
      process.env.CLAUDE_CONFIG,
      JSON.stringify({
        mcpServers: {
          works: { type: 'http', url: `${base}/mcp` },
          gone: { type: 'http', url: `${base}/gone` },
          signin: { type: 'http', url: `${base}/signin` },
        },
      })
    );
    const db = makeGraph({
      capabilities: [{ id: 'mcp:works' }, { id: 'mcp:gone' }, { id: 'mcp:signin' }],
    });

    const quiet = await verifyMcpServers(db, undefined, 5000);
    expect('error' in quiet && quiet.error).toMatch(/3 remote servers were not contacted/);

    seen.length = 0;
    const ran = await verifyMcpServers(db, undefined, 5000, { remote: true });
    if ('error' in ran) throw new Error(ran.error);
    const byName = Object.fromEntries(ran.results.map((r: any) => [r.name, r.status]));
    expect(byName).toEqual({ works: 'verified', gone: 'failed', signin: 'unverifiable' });
    const runs = db
      .prepare(
        "SELECT capability_id, action FROM session_learning WHERE session_id = 'verify' ORDER BY capability_id"
      )
      .all();
    expect(runs).toEqual([
      { capability_id: 'mcp:gone', action: 'failed' },
      { capability_id: 'mcp:works', action: 'passed' },
    ]);
  } finally {
    process.env = saved;
    rmSync(home, { recursive: true, force: true });
  }
});
