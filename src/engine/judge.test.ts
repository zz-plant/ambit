/**
 * `ambit goal --judge`: a goal the vocabulary cannot route, put to a judgment
 * model on this machine as a Choice over the curated tree.
 *
 * What these hold is where the question may go and what the answer may do. It
 * goes to loopback or nowhere, only when the words found nothing to recommend,
 * and the answer is a suggestion with its probability that changes no row.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { judgeGoal, judgeUrl } from './judge.ts';
import { loadTechTree } from './paths.ts';
import { cli, cliAsync, LOCAL_ONLY, seed } from './testing/cli.ts';

/** Words that match no goal phrase in the tree, so the vocabulary has nothing to say. */
const UNMATCHED = 'juggle flaming torches';

type Hit = { path: string; body: any };

/** A stand-in for Kev that answers one Choice and records every request. */
function fakeJudge(probabilities: Record<string, number>, status = 200) {
  const hits: Hit[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
    });
    req.on('end', () => {
      hits.push({ path: req.url || '', body: raw ? JSON.parse(raw) : null });
      const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'kev-latest',
          answers: {
            capability: { type: 'choice', choice: top, confidence: 0.7, probabilities },
          },
        })
      );
    });
  });
  return new Promise<{ url: string; hits: Hit[]; close: () => void }>(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        hits,
        close: () => server.close(),
      })
    )
  );
}

const open: Array<() => void> = [];
afterEach(() => {
  while (open.length) open.pop()?.();
  delete process.env.AMBIT_JUDGE_URL;
});

async function judge(probabilities: Record<string, number>, status = 200) {
  const j = await fakeJudge(probabilities, status);
  open.push(j.close);
  return j;
}

test('only a judge on this machine is accepted, by host and never by prefix', () => {
  expect(judgeUrl('http://127.0.0.1:8009')).toEqual({ url: 'http://127.0.0.1:8009' });
  expect(judgeUrl('http://localhost:8009/')).toEqual({ url: 'http://localhost:8009' });
  expect(judgeUrl('http://[::1]:8009')).toEqual({ url: 'http://[::1]:8009' });
  // Kev is the default when nothing is named.
  expect(judgeUrl()).toEqual({ url: 'http://127.0.0.1:8009' });

  for (const refused of [
    'https://api.typesafe.ai',
    'http://0.0.0.0:8009',
    'http://127.0.0.1.example.com:8009',
    // Everything before @ is credentials; the host is what follows it.
    'http://127.0.0.1:1@example.com',
    'http://user:pass@127.0.0.1:8009',
    'not a url',
  ])
    expect('error' in judgeUrl(refused), refused).toBe(true);
});

test('the question is a Choice over every node in the curated tree', async () => {
  const j = await judge({ 'typed-judgment': 0.8 });
  await judgeGoal(UNMATCHED, { url: j.url });

  expect(j.hits).toHaveLength(1);
  expect(j.hits[0].path).toBe('/v1/systemone');
  const q = j.hits[0].body.questions.capability;
  expect(q.type).toBe('choice');
  expect(Object.keys(q.criteria).sort()).toEqual(
    loadTechTree()
      .nodes.map((n: { id: string }) => n.id)
      .sort()
  );
  expect(j.hits[0].body.state).toBe(UNMATCHED);
});

test('an answer with even odds or better is suggested, with its probability', async () => {
  const j = await judge({ 'web-research': 0.72, 'browser-automation': 0.2, 'data-access': 0.08 });
  const out = (await judgeGoal(UNMATCHED, { url: j.url })) as any;

  expect(out.suggested).toEqual({
    id: 'combo:web-research',
    name: 'Web Research',
    probability: 0.72,
  });
  expect(out.considered.map((c: any) => c.id)).toEqual([
    'combo:web-research',
    'combo:browser-automation',
    'combo:data-access',
  ]);
  expect(out.note).toMatch(/not a match in the vocabulary/);
});

test('below even odds nothing is suggested, and the likeliest are still listed', async () => {
  const j = await judge({ 'web-research': 0.34, 'browser-automation': 0.33, 'data-access': 0.33 });
  const out = (await judgeGoal(UNMATCHED, { url: j.url })) as any;

  expect(out.suggested).toBeUndefined();
  expect(out.considered).toHaveLength(3);
});

test('an answer naming nothing in the tree is not an answer', async () => {
  const j = await judge({ 'launch-rockets': 0.99 });
  const out = (await judgeGoal(UNMATCHED, { url: j.url })) as any;
  expect(out.error).toMatch(/no capability in the tree/);
});

test('a judge that refuses or is not there reports why, and does not throw', async () => {
  const down = await judge({ 'web-research': 0.9 }, 500);
  expect(((await judgeGoal(UNMATCHED, { url: down.url })) as any).error).toMatch(/answered 500/);

  const refused = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as unknown as typeof fetch;
  const out = (await judgeGoal(UNMATCHED, {
    url: 'http://127.0.0.1:1',
    fetchImpl: refused,
  })) as any;
  expect(out.error).toMatch(/no judgment model answered/);
});

test('ambit goal --judge suggests for an unmatched goal and writes nothing', async () => {
  seed(LOCAL_ONLY).close();
  const j = await judge({ 'local-embeddings': 0.81 });
  const before = cli('status');

  const out = await cliAsync('goal', UNMATCHED, `--judge=${j.url}`);
  expect(out.candidates).toEqual([]);
  expect(out.judged.suggested.id).toBe('combo:local-embeddings');
  expect(j.hits).toHaveLength(1);

  // A probability is not a plan: nothing about the graph moved.
  expect(cli('status')).toEqual(before);
});

test('a goal the vocabulary can recommend never reaches the judge', async () => {
  seed(LOCAL_ONLY).close();
  const j = await judge({ 'web-research': 0.99 });

  const out = await cliAsync('goal', 'run commands', `--judge=${j.url}`);
  expect(out.recommended).toBeDefined();
  expect(out.judged).toBeUndefined();
  expect(j.hits).toHaveLength(0);
});

test('without --judge an unmatched goal opens no socket, whatever is configured', async () => {
  seed(LOCAL_ONLY).close();
  const j = await judge({ 'web-research': 0.99 });
  process.env.AMBIT_JUDGE_URL = j.url;

  const out = cli('goal', UNMATCHED);
  expect(out.judged).toBeUndefined();
  expect(j.hits).toHaveLength(0);
});

test('a judge URL off this machine is refused before anything is sent', async () => {
  seed(LOCAL_ONLY).close();
  const j = await judge({ 'web-research': 0.99 });
  const port = new URL(j.url).port;

  // 0.0.0.0 reaches this machine on Linux, so letting it through would hit the fake.
  const out = await cliAsync('goal', UNMATCHED, `--judge=http://0.0.0.0:${port}`);
  expect(out.judged.error).toMatch(/must run on this machine/);
  expect(j.hits).toHaveLength(0);
});
