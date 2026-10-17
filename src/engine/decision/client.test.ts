import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionOptions, DecisionRequest } from './types.ts';

const request: DecisionRequest = {
  state: { text: 'PRIVATE-STATE' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'PRIVATE-RUBRIC',
      criteria: { yes: 'Match', no: 'None' },
    },
    enough: { type: 'noul', instructions: 'Enough evidence?' },
    quality: { type: 'score', instructions: 'Quality?', criteria: ['Low', 'Medium', 'High'] },
  },
};
const answer = {
  model: 'untrusted-server-name',
  answers: {
    route: { type: 'choice', choice: 'yes', probabilities: { yes: 0.7, no: 0.3 }, confidence: 0.4 },
    enough: { type: 'noul', noul: 0.9 },
    quality: { type: 'score', score: 1.4, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 } },
  },
  usage: { input_tokens: 123, secret: 'PRIVATE-STATE' },
};

async function ask(input: DecisionRequest = request, options: DecisionOptions = {}) {
  expect(existsSync(new URL('./client.ts', import.meta.url)), 'shared decision client exists').toBe(
    true
  );
  const { askDecision } = await import('./client.ts');
  return askDecision(input, options);
}

function responder(data: unknown = answer, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(data), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => vi.unstubAllEnvs());

describe('typed decision transport', () => {
  it('normalizes all three answers without confusing confidence and probability', async () => {
    const fake = responder();
    const out = await ask(request, { url: 'http://127.0.0.1:8009/v1/', fetchImpl: fake.fetchImpl });
    expect(out).toMatchObject({
      provider: 'local',
      endpoint: 'http://127.0.0.1:8009/v1/systemone',
      model: 'clef-flash',
      answers: {
        route: { type: 'choice', choice: 'yes', probability: 0.7, confidence: 0.4 },
        enough: { type: 'noul', probability: 0.9 },
        quality: { type: 'score', score: 1.4 },
      },
      usage: { input_tokens: 123 },
      request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rubric_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      elapsed_ms: expect.any(Number),
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].init.redirect).toBe('error');
    expect(JSON.parse(String(fake.calls[0].init.body))).toMatchObject({
      ...request,
      model: 'clef-flash',
    });
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE|untrusted-server/);
  });

  it.each([
    'https://api.typesafe.ai',
    'http://127.0.0.1.evil.test',
    'http://127.0.0.1:1@evil.test',
    'http://user:SECRET@127.0.0.1:8009',
    'http://localhost:8009?token=SECRET',
    'http://localhost:8009#SECRET',
    'http://0.0.0.0:8009',
    'not-SECRET-a-url',
  ])('refuses unsafe local destinations before fetch: %s', async url => {
    const fake = responder();
    expect(await ask(request, { url, fetchImpl: fake.fetchImpl })).toMatchObject({
      errorKind: 'configuration',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('uses only local SDK environment URLs and never switches providers from the environment', async () => {
    vi.stubEnv('AMBIT_JUDGE_URL', '');
    vi.stubEnv('TYPESAFE_BASE_URL', 'https://hosted.example/SECRET');
    vi.stubEnv('JEV_BASE_URL', 'http://[::1]:8010/v1');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'a'.repeat(32));
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'SECRET');
    const fake = responder();
    const out = await ask(request, { fetchImpl: fake.fetchImpl });
    expect(out).toMatchObject({ provider: 'local' });
    expect(fake.calls[0].url).toBe('http://[::1]:8010/v1/systemone');
    expect(JSON.stringify(fake.calls[0].init.headers)).not.toContain('SECRET');
  });

  it('uses explicit Cloudflare authorization with the canonical model path and body selector', async () => {
    const fake = responder({ success: true, result: answer });
    const out = await ask(request, {
      provider: 'cloudflare',
      accountId: 'a'.repeat(32),
      token: 'SECRET',
      model: 'clef',
      fetchImpl: fake.fetchImpl,
    });
    expect(out).toMatchObject({ provider: 'cloudflare', model: 'clef' });
    expect(fake.calls[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/cloudflare/clef`
    );
    expect(fake.calls[0].init.headers).toMatchObject({ authorization: 'Bearer SECRET' });
    expect(JSON.parse(String(fake.calls[0].init.body)).model).toBe('clef');
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it.each([
    { accountId: '../other', token: 'SECRET' },
    { accountId: 'a'.repeat(32), token: '' },
    { accountId: 'a'.repeat(32), token: 'SECRET', model: 'arbitrary-model' },
    { accountId: 'a'.repeat(32), token: 'SECRET', url: 'https://evil.test' },
  ])('refuses invalid Cloudflare configuration before fetch', async options => {
    const fake = responder();
    expect(
      await ask(request, { ...options, provider: 'cloudflare', fetchImpl: fake.fetchImpl })
    ).toHaveProperty('error');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects unsuccessful wrappers without retaining their errors', async () => {
    const fake = responder({ success: false, result: answer, errors: [{ message: 'SECRET' }] });
    const out = await ask(request, {
      provider: 'cloudflare',
      accountId: 'a'.repeat(32),
      token: 'SECRET',
      fetchImpl: fake.fetchImpl,
    });
    expect(out).toMatchObject({ errorKind: 'invalid-response' });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('does not fall back after transport failures or expose exceptions and response bodies', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error('SECRET PRIVATE-STATE');
    }) as typeof fetch;
    const out = await ask(request, { fetchImpl });
    expect(out).toMatchObject({ errorKind: 'transport-unavailable' });
    expect(calls).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/SECRET|PRIVATE/);
    const failed = await ask(request, { fetchImpl: responder({ error: 'SECRET' }, 401).fetchImpl });
    expect(failed).toMatchObject({ errorKind: 'http' });
    expect(JSON.stringify(failed)).not.toContain('SECRET');
  });

  it('refuses a real redirect instead of sending state to its target', async () => {
    let targetHits = 0;
    const server = createServer((req, res) => {
      if (req.url === '/v1/systemone') res.writeHead(307, { location: '/target' }).end();
      else {
        targetHits++;
        res.end(JSON.stringify(answer));
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect(await ask(request, { url })).toHaveProperty('error');
      expect(targetHits).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('bounds the timeout even when an injected transport ignores abort', async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;
    const started = Date.now();
    expect(await ask(request, { fetchImpl, timeoutMs: 10 })).toMatchObject({
      errorKind: 'transport-unavailable',
    });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('decision validation before network', () => {
  it.each(['q:invalid', 'q/invalid', 'q'.repeat(101)])(
    'rejects question ids outside the documented alphabet and length',
    async id => {
      const fake = responder();
      expect(
        await ask(
          { state: 'x', questions: { [id]: request.questions.enough } },
          { fetchImpl: fake.fetchImpl }
        )
      ).toMatchObject({ errorKind: 'invalid-request' });
      expect(fake.calls).toHaveLength(0);
    }
  );

  it.each([
    { images: Array(5).fill('data:image/png;base64,AAAA') },
    { images: ['data:image/gif;base64,AAAA'] },
    { images: [`data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`] },
    {
      images: Array(3).fill(
        `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString('base64')}`
      ),
    },
    { audio: Array(5).fill('data:audio/wav;base64,AAAA') },
    { audio: ['data:audio/ogg;base64,AAAA'] },
    { audio: [`data:audio/wav;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')}`] },
    { videos: Array(3).fill('data:video/mp4;base64,AAAA') },
    { videos: ['data:video/quicktime;base64,AAAA'] },
    { videos: [`data:video/mp4;base64,${Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64')}`] },
    {
      audio: Array(3).fill(
        `data:audio/wav;base64,${Buffer.alloc(6 * 1024 * 1024).toString('base64')}`
      ),
    },
  ])('enforces documented media counts, formats and decoded byte limits', async media => {
    const fake = responder();
    expect(
      await ask({ ...request, ...media }, { model: 'clef-omni', fetchImpl: fake.fetchImpl })
    ).toMatchObject({ errorKind: 'invalid-request' });
    expect(fake.calls).toHaveLength(0);
  });

  it('accepts four small audio clips and two small videos on Omni', async () => {
    expect(
      await ask(
        {
          ...request,
          audio: Array(4).fill('data:audio/wav;base64,AAAA'),
          videos: Array(2).fill('data:video/mp4;base64,AAAA'),
        },
        { model: 'clef-omni', fetchImpl: responder().fetchImpl }
      )
    ).toHaveProperty('answers');
  });

  it.each([
    { state: 'x', questions: {} },
    { ...request, state: 'x'.repeat(49 * 1024) },
    { ...request, questions: { 'bad id': request.questions.enough } },
    { ...request, questions: { x: { type: 'choice', instructions: 'x', criteria: {} } } },
    { ...request, questions: { x: { type: 'choice', instructions: 'x', criteria: { yes: 1 } } } },
    { ...request, questions: { x: { type: 'score', instructions: 'x', criteria: ['One'] } } },
    { ...request, questions: { x: { type: 'text', instructions: 'x' } } },
    {
      ...request,
      questions: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`q${i}`, request.questions.enough])
      ),
    },
    { ...request, images: ['https://example.com/private.png'] },
    { ...request, audio: ['data:audio/wav;base64,AAAA'] },
    { ...request, videos: ['data:video/mp4;base64,AAAA'] },
    { ...request, images: ['data:image/png;base64,not-base64!!!'] },
  ])('rejects malformed, oversized or unsupported inputs', async input => {
    const fake = responder();
    expect(await ask(input as DecisionRequest, { fetchImpl: fake.fetchImpl })).toMatchObject({
      errorKind: 'invalid-request',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('allows bounded inline media only on models that support it', async () => {
    const fake = responder();
    expect(
      await ask(
        {
          ...request,
          audio: ['data:audio/wav;base64,AAAA'],
          videos: ['data:video/mp4;base64,AAAA'],
        },
        { model: 'clef-omni', fetchImpl: fake.fetchImpl }
      )
    ).toHaveProperty('answers');
    const tooMany = await ask(
      { ...request, images: Array(9).fill('data:image/png;base64,AAAA') },
      { fetchImpl: fake.fetchImpl }
    );
    expect(tooMany).toMatchObject({ errorKind: 'invalid-request' });
    const tooBig = await ask(
      {
        ...request,
        images: [`data:image/png;base64,${Buffer.alloc(6 * 1024 * 1024).toString('base64')}`],
      },
      { fetchImpl: fake.fetchImpl }
    );
    expect(tooBig).toMatchObject({ errorKind: 'invalid-request' });
  });

  it.each([
    {
      ...answer,
      answers: { ...answer.answers, route: { type: 'choice', choice: 'yes', confidence: 0.8 } },
    },
    {
      ...answer,
      answers: {
        ...answer.answers,
        route: { type: 'choice', choice: 'no', probabilities: { yes: 0.7, no: 0.3 } },
      },
    },
    {
      ...answer,
      answers: {
        ...answer.answers,
        route: { type: 'choice', choice: 'yes', probabilities: { yes: 0.8 } },
      },
    },
    {
      ...answer,
      answers: {
        ...answer.answers,
        route: { type: 'choice', choice: 'evil', probabilities: { yes: 0.7, no: 0.3, evil: 0 } },
      },
    },
    {
      ...answer,
      answers: {
        ...answer.answers,
        route: { type: 'choice', choice: 'yes', probabilities: { yes: 0.8, no: 0.8 } },
      },
    },
    { ...answer, answers: { ...answer.answers, enough: { type: 'noul', noul: -0.1 } } },
    { ...answer, answers: { ...answer.answers, enough: { type: 'noul', confidence: 0.9 } } },
    {
      ...answer,
      answers: {
        ...answer.answers,
        quality: { type: 'score', score: 2, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 } },
      },
    },
    {
      ...answer,
      answers: {
        ...answer.answers,
        quality: { type: 'score', score: 1, probabilities: { '0': 0.5, '1': 0.5 } },
      },
    },
    { ...answer, answers: { route: answer.answers.route } },
    { ...answer, answers: { ...answer.answers, extra: { type: 'noul', noul: 0.5 } } },
  ])('refuses invalid or incomplete probabilities from a model', async data => {
    expect(await ask(request, { fetchImpl: responder(data).fetchImpl })).toMatchObject({
      errorKind: 'invalid-response',
    });
  });

  it('hashes state and rubrics separately and canonically', async () => {
    const first = await ask(request, { fetchImpl: responder().fetchImpl });
    const second = await ask(
      { ...request, state: 'different state' },
      { fetchImpl: responder().fetchImpl }
    );
    expect(first).toHaveProperty('rubric_hash');
    if (!('error' in first) && !('error' in second)) {
      expect(first.request_hash).not.toBe(second.request_hash);
      expect(first.rubric_hash).toBe(second.rubric_hash);
    }
  });

  it('serializes caller state once so changing toJSON cannot bypass the body limit', async () => {
    let serializations = 0;
    const state = {
      toJSON: () => (++serializations < 3 ? 'validated-state' : 'x'.repeat(14 * 1024 * 1024)),
    };
    const fake = responder();
    const out = await ask({ ...request, state }, { fetchImpl: fake.fetchImpl });
    expect(serializations).toBe(1);
    expect(out).toHaveProperty('answers');
    expect(fake.calls).toHaveLength(1);
    expect(JSON.parse(String(fake.calls[0].init.body)).state).toBe('validated-state');
    expect(Buffer.byteLength(String(fake.calls[0].init.body))).toBeLessThan(13 * 1024 * 1024);
    const { decisionHash } = await import('./client.ts');
    expect(out).toHaveProperty(
      'request_hash',
      decisionHash({ ...request, state: 'validated-state' })
    );
  });

  it('safely refuses a snapshot that cannot be serialized', async () => {
    const fake = responder();
    const state = {
      toJSON: () => {
        throw new Error('PRIVATE-STATE');
      },
    };
    expect(await ask({ ...request, state }, { fetchImpl: fake.fetchImpl })).toMatchObject({
      errorKind: 'invalid-request',
    });
    expect(fake.calls).toHaveLength(0);
  });
});
