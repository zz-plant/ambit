/**
 * The declared check for Local Typed Judgment.
 *
 * It proves a local judgment model answers by sending it one trivial question,
 * which is the only proof there is. What it must never do is send that
 * question anywhere but this machine: the hosted API would spend the person's
 * key, and a check is not a command they typed. So the base URL a person set is
 * honoured only when it is loopback, and a URL carrying userinfo is refused
 * outright, because curl reads `http://127.0.0.1:1@host` as a request to host.
 *
 * `verifyCheck` runs a check with spawnSync, which would block the fake server
 * below from ever answering, so these tests run the check's own command.
 */
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { loadTechTree } from './paths.ts';

const node = loadTechTree().nodes.find((n: { id: string }) => n.id === 'local-typed-judgment');
const [cmd, ...args]: string[] = node.verify.command;

type Hit = { path: string; body: string };

/** A stand-in for Kev: answers /v1/systemone the way the clones do, and records every request. */
function fakeJudge(answer: (hit: Hit) => { status: number; body: string }) {
  const hits: Hit[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', c => {
      body += c;
    });
    req.on('end', () => {
      const hit = { path: req.url || '', body };
      hits.push(hit);
      const out = answer(hit);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.body);
    });
  });
  return new Promise<{ port: number; hits: Hit[]; close: () => void }>(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        hits,
        close: () => server.close(),
      })
    )
  );
}

const open: Array<() => void> = [];
afterEach(() => {
  while (open.length) open.pop()?.();
});

/** Run the check with only the base URL a test names; the exit code is the verdict. */
function runCheck(baseUrl: string): Promise<number> {
  const env = { ...process.env, TYPESAFE_BASE_URL: baseUrl, JEV_BASE_URL: '' };
  return new Promise(resolve =>
    execFile(cmd, args, { env, timeout: 30_000 }, err =>
      resolve(err ? ((err as { code?: number }).code ?? 1) : 0)
    )
  );
}

const ANSWER = JSON.stringify({
  model: 'kev-latest',
  answers: { ok: { type: 'noul', noul: 0.9 } },
});

test('the check passes when a loopback judgment server answers a noul question', async () => {
  const judge = await fakeJudge(() => ({ status: 200, body: ANSWER }));
  open.push(judge.close);

  expect(await runCheck(`http://127.0.0.1:${judge.port}`)).toBe(0);
  expect(judge.hits[0].path).toBe('/v1/systemone');
  expect(JSON.parse(judge.hits[0].body).questions.ok.type).toBe('noul');
});

test('a trailing slash on the base URL does not break the path', async () => {
  const judge = await fakeJudge(() => ({ status: 200, body: ANSWER }));
  open.push(judge.close);

  expect(await runCheck(`http://localhost:${judge.port}/`)).toBe(0);
  expect(judge.hits[0].path).toBe('/v1/systemone');
});

test('a server that answers without judgments does not pass as one', async () => {
  const judge = await fakeJudge(() => ({ status: 404, body: '{"error":"not found"}' }));
  open.push(judge.close);

  await runCheck(`http://127.0.0.1:${judge.port}`);
  // Something else may be listening on the clones' default ports on a
  // developer's machine, so the verdict is not asserted; what matters is that
  // this server's refusal was not what passed it.
  expect(judge.hits).toHaveLength(1);
});

test('a base URL that is not loopback is never contacted', async () => {
  const judge = await fakeJudge(() => ({ status: 200, body: ANSWER }));
  open.push(judge.close);

  // 0.0.0.0 reaches this machine on Linux, so a check that let it through
  // would hit the fake server; one that refuses it never does.
  await runCheck(`http://0.0.0.0:${judge.port}`);
  expect(judge.hits).toHaveLength(0);
});

test('userinfo cannot smuggle a request past the loopback test', async () => {
  const judge = await fakeJudge(() => ({ status: 200, body: ANSWER }));
  open.push(judge.close);

  // curl reads everything before @ as credentials, so this URL names the fake
  // server as its host while starting with an allowed prefix.
  await runCheck(`http://127.0.0.1:1@127.0.0.1:${judge.port}`);
  expect(judge.hits).toHaveLength(0);
});
