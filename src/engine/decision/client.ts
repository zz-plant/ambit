import type { DecisionError, DecisionOptions, DecisionRequest, DecisionResult } from './types.ts';
import {
  decisionHash,
  normalizeAnswers,
  object,
  RESPONSE_LIMIT,
  validRequest,
} from './validation.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MODELS = new Set(['clef', 'clef-flash', 'clef-omni']);
const DEFAULT_URL = 'http://127.0.0.1:8009';

function error(errorKind: DecisionError['errorKind'], message: string): DecisionError {
  return { error: message, errorKind };
}

function localEndpoint(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'http:' ||
      !LOOPBACK.has(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    const path = url.pathname.replace(/\/+$/, '').replace(/(?:\/v1)+$/, '');
    // A path could itself contain private configuration; only the version root is supported.
    if (path) return;
    return `${url.origin}/v1/systemone`;
  } catch {
    return;
  }
}

function sdkUrl(): string | undefined {
  return [process.env.TYPESAFE_BASE_URL, process.env.JEV_BASE_URL].find(
    raw => raw && localEndpoint(raw)
  );
}

type Destination = {
  provider: 'local' | 'cloudflare';
  endpoint: string;
  model: string;
  headers: Record<string, string>;
};

function destination(options: DecisionOptions): Destination | DecisionError {
  const provider = options.provider ?? 'local';
  const model = options.model ?? process.env.AMBIT_JUDGE_MODEL ?? 'clef-flash';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(model))
    return error('configuration', 'Invalid decision model selector');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider === 'local') {
    const endpoint = localEndpoint(
      options.url ?? (process.env.AMBIT_JUDGE_URL || sdkUrl() || DEFAULT_URL)
    );
    return endpoint
      ? { provider, endpoint, model, headers }
      : error(
          'configuration',
          'The local decision endpoint must be an HTTP loopback URL without credentials, query or fragment'
        );
  }
  if (provider !== 'cloudflare') return error('configuration', 'Unknown decision provider');
  if (options.url !== undefined || !MODELS.has(model))
    return error(
      'configuration',
      'Cloudflare decisions require a supported Clef model and the canonical endpoint'
    );
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const token =
    options.token ?? process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId) || !token || /[\r\n]/.test(token))
    return error('configuration', 'Cloudflare decisions require a valid account id and API token');
  headers.authorization = `Bearer ${token}`;
  return {
    provider,
    model,
    headers,
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${model}`,
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT || !response.body)
    throw new Error('invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > RESPONSE_LIMIT) throw new Error('invalid');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Explicit calls only. No provider fallback, output text, or input persistence. */
export async function askDecision(
  request: DecisionRequest,
  options: DecisionOptions = {}
): Promise<DecisionResult | DecisionError> {
  const where = destination(options);
  if ('error' in where) return where;
  // Caller-owned objects can change during serialization. Validate only the
  // JSON snapshot that will supply the body, answer schema, and provenance.
  let input: unknown;
  try {
    input = JSON.parse(JSON.stringify(request));
  } catch {
    return error('invalid-request', 'Invalid decision questions, state size or media');
  }
  if (!validRequest(input, where.model))
    return error('invalid-request', 'Invalid decision questions, state size or media');
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000)
    return error('configuration', 'Decision timeout must be between 1 and 60000 milliseconds');
  const body = JSON.stringify({ ...input, model: where.model });
  const start = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<DecisionError>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(
        error('transport-unavailable', 'Decision provider did not answer within the timeout')
      );
    }, timeout);
  });
  const operation = async (): Promise<DecisionResult | DecisionError> => {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(where.endpoint, {
        method: 'POST',
        headers: where.headers,
        body,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      return error('transport-unavailable', 'Decision provider could not be reached');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return error('http', 'Decision provider returned an unsuccessful HTTP status');
    }
    let data: unknown;
    try {
      data = await readJson(response);
    } catch {
      return error('invalid-response', 'Decision provider returned invalid or oversized JSON');
    }
    if (where.provider === 'cloudflare') {
      if (!object(data) || data.success !== true || !object(data.result))
        return error(
          'invalid-response',
          'Cloudflare decision response was unsuccessful or malformed'
        );
      data = data.result;
    }
    if (!object(data))
      return error('invalid-response', 'Decision provider returned an invalid answer');
    const answers = normalizeAnswers(input.questions, data.answers);
    if (!answers)
      return error(
        'invalid-response',
        'Decision provider returned incomplete or invalid probabilities'
      );
    let usage: DecisionResult['usage'];
    if (object(data.usage) && data.usage.input_tokens !== undefined) {
      if (!Number.isSafeInteger(data.usage.input_tokens) || (data.usage.input_tokens as number) < 0)
        return error('invalid-response', 'Decision provider returned invalid usage');
      usage = { input_tokens: data.usage.input_tokens as number };
    }
    return {
      provider: where.provider,
      endpoint: where.endpoint,
      model: where.model,
      answers,
      ...(usage ? { usage } : {}),
      elapsed_ms: Math.max(0, Math.round(performance.now() - start)),
      request_hash: decisionHash(input),
      rubric_hash: decisionHash(input.questions),
      provenance: {
        schema_version: 1,
        recorded_at: new Date().toISOString(),
        question_types: Object.fromEntries(
          Object.entries(input.questions).map(([id, question]) => [id, question.type])
        ),
        media: {
          images: input.images?.length ?? 0,
          audio: input.audio?.length ?? 0,
          videos: input.videos?.length ?? 0,
        },
      },
    };
  };
  try {
    return await Promise.race([operation(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export { decisionHash } from './validation.ts';
