/**
 * Asking a judgment model on this machine which capability a goal means.
 *
 * `ambit goal` routes a sentence by the words the curated tree authors for each
 * capability, and a goal that names none of them has no route in. A typed
 * decision model (TypeSafe's Jev, or an open clone serving the same
 * `/v1/systemone` API) can answer that as a Choice over the tree with a
 * calibrated probability, which is the shape of the question exactly.
 *
 * Three rules hold it, each for a reason stated where it is enforced:
 *
 *   It asks only a model on this machine. The goal a person typed is theirs,
 *   and the hosted API may retain requests; a check that the host is loopback
 *   is the difference between a local question and egress nobody typed.
 *
 *   It suggests and never writes. A probability is not a plan, and nothing in
 *   the graph changes because a model thought something likely.
 *
 *   It asks only when the vocabulary could not recommend. A goal the curated
 *   words already cover is answered the way it always was, with no socket.
 *
 * Cloudflare's Clef models answer in the same wire format, so a Clef server on
 * this machine is a judge like any clone. When no judge answers at all, the
 * question goes once more to an embedding model on this machine (Ollama's
 * `/api/embed`, or the OpenAI-style `/v1/embeddings` that llama-server and LM
 * Studio serve), and the answer is the nodes nearest in meaning with their
 * similarity. A cosine is not a probability, so that answer is listed, and
 * suggested only past a floor measured for that model on this tree.
 */
import { loadTechTree } from './paths.ts';

/** Kev's default, the clone with pretrained weights and TypeSafe's wire format. */
const DEFAULT_JUDGE = 'http://127.0.0.1:8009';

/** How long a local model gets to answer one question. Clones quote 70 to 500 ms. */
const TIMEOUT_MS = 10_000;

/**
 * Below this, the top answer is listed and not suggested. A choice over thirty
 * options that the model gives less than even odds is a guess it is telling
 * you it is making.
 */
const SUGGEST_AT = 0.5;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Ollama's default, where an embedding model on this machine usually is. */
const DEFAULT_EMBED = 'http://127.0.0.1:11434';

/**
 * A URL on this machine, or why not. Parsed, never prefix-matched: a prefix
 * test passes `http://127.0.0.1:1@host`, which every HTTP client reads as a
 * request to `host` with credentials, and `http://127.0.0.1.example.com`.
 */
function loopbackUrl(raw: string, what: string): { url: URL } | { error: string } {
  const the = what.replace(/^an? /, 'the ');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: `not a URL: ${raw}` };
  }
  if (u.username || u.password)
    return { error: `refused ${raw}: ${what} URL carries no credentials` };
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname))
    return {
      error: `refused ${raw}: ${the} must run on this machine (http://127.0.0.1, localhost or [::1])`,
    };
  return { url: u };
}

/** Where to ask the judge, or why not. */
function judgeUrl(named?: string): { url: string } | { error: string } {
  const raw = named || process.env.AMBIT_JUDGE_URL || sdkBaseUrl() || DEFAULT_JUDGE;
  const parsed = loopbackUrl(raw, 'a judge');
  if ('error' in parsed) return parsed;
  const u = parsed.url;
  // TypeSafe's base URLs name the host and the SDK adds `/v1`, but a clone's
  // README may quote it with the version on; either way the path is added once.
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}` };
}

/**
 * Where to ask the embedding model, or why not: `AMBIT_EMBED_URL`, else
 * Ollama's default. An OpenAI-style base URL is often quoted with `/v1` on,
 * and the path is added once either way.
 */
function embedUrl(): { url: string } | { error: string } {
  const parsed = loopbackUrl(process.env.AMBIT_EMBED_URL || DEFAULT_EMBED, 'an embedding model');
  if ('error' in parsed) return parsed;
  const u = parsed.url;
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}` };
}

/**
 * Where TypeSafe's own SDKs are pointed, when that is this machine.
 *
 * A local clone is served by setting `TYPESAFE_BASE_URL` (or the older
 * `JEV_BASE_URL`) and the curated tree says to, so a person who did exactly
 * that should not have to say it to Ambit a second time. Only a loopback value
 * is taken: the same variable usually names the hosted API, which a person set
 * for their SDK and never typed as a place for Ambit to send a goal. A hosted
 * value is passed over as though it were unset, never refused, because it was
 * not addressed to this command.
 */
function sdkBaseUrl(): string | undefined {
  for (const raw of [process.env.TYPESAFE_BASE_URL, process.env.JEV_BASE_URL]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !u.username && !u.password)
        return raw;
    } catch {}
  }
  return undefined;
}

interface Judged {
  asked: string;
  /** What answered: a decision model's Choice, or an embedding model's nearest nodes. */
  by: 'judgment' | 'embedding';
  model?: string;
  suggested?: { id: string; name: string; probability: number };
  considered: Array<{ id: string; name: string; probability: number }>;
  confidence?: number;
  note: string;
}

interface Neared {
  asked: string;
  by: 'embedding';
  model: string;
  suggested?: { id: string; name: string; similarity: number };
  nearest: Array<{ id: string; name: string; similarity: number }>;
  note: string;
}

type TreeNode = { id: string; name: string; description?: string; goal?: string[] };

/**
 * Below its floor, the nearest node is listed and not suggested. Cosines from
 * different models are on different scales, so a floor holds only for the
 * model it was measured on, and a model with none suggests nothing.
 *
 * EmbeddingGemma 2's was measured on 48 sentences written for this tree and
 * kept out of it, and 16 that mean nothing in it. The nearest node was right
 * for 34 of the 48 and among the nearest three for 43. Every sentence that
 * meant nothing scored below 0.61, and 45 of the 48 scored 0.65 or more. So
 * the floor tells a sentence the tree has no place for from one it has, and
 * above it about one suggestion in four is still the wrong node: a
 * suggestion, as the note says. nomic-embed-text placed 21 of the 48.
 */
const NEAR_FLOORS: Array<{ model: RegExp; floor: number }> = [
  { model: /embeddinggemma-?2/i, floor: 0.65 },
];

function nearFloor(model: string): number | undefined {
  return NEAR_FLOORS.find(f => f.model.test(model))?.floor;
}

/**
 * How long an embedding model gets. Longer than a judge: the first question
 * embeds every node of the tree, and Ollama's EmbeddingGemma 2 build took
 * about 20 seconds for that on an M1 Max, where nomic-embed took under two.
 */
const EMBED_TIMEOUT_MS = 60_000;

/**
 * How each model family wants a query and a document written. EmbeddingGemma
 * and nomic-embed were trained with these prefixes and rank worse without
 * them; any other model gets the plain text.
 */
function prompts(model: string) {
  if (/embeddinggemma/i.test(model))
    return {
      query: (q: string) => `task: search result | query: ${q}`,
      doc: (title: string, text: string) => `title: ${title} | text: ${text}`,
    };
  if (/nomic-embed/i.test(model))
    return {
      query: (q: string) => `search_query: ${q}`,
      doc: (title: string, text: string) => `search_document: ${title}. ${text}`,
    };
  return { query: (q: string) => q, doc: (title: string, text: string) => `${title}. ${text}` };
}

/** A node as a document: its name, what it is, and the phrases authored to reach it. */
function nodeText(n: TreeNode): string {
  return [n.description, ...(n.goal || [])].filter(Boolean).join('; ') || n.name;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/**
 * The tree's vectors, per server and model, for as long as the process runs:
 * a spec with twenty unrouted tasks embeds the tree once, not twenty times.
 */
const treeVectors = new Map<string, number[][]>();

/**
 * Servers that answered Ollama's embed path with a 404, so the OpenAI-style
 * `/v1/embeddings` is asked instead. llama-server, LM Studio and vLLM serve
 * only that one, and a newer model often reaches llama.cpp before Ollama.
 */
const openAiStyle = new Set<string>();

/** The names a server lists: Ollama's `/api/tags`, else the OpenAI-style `/v1/models`. */
async function listModels(url: string, f: typeof fetch): Promise<string[]> {
  for (const [path, read] of [
    ['/api/tags', (d: any) => (Array.isArray(d?.models) ? d.models.map((m: any) => m?.name) : [])],
    ['/v1/models', (d: any) => (Array.isArray(d?.data) ? d.data.map((m: any) => m?.id) : [])],
  ] as const) {
    try {
      const res = await f(`${url}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) continue;
      const names = read(await res.json()).filter((n: unknown) => typeof n === 'string');
      if (path === '/v1/models') openAiStyle.add(url);
      return names;
    } catch {}
  }
  return [];
}

/**
 * The embedding model the server has, when none is named: EmbeddingGemma
 * first, then any model whose name says it embeds. A chat model is never
 * picked, since its vectors are not trained to be compared.
 */
async function pickEmbedModel(url: string, f: typeof fetch): Promise<string | undefined> {
  const names = await listModels(url, f);
  return names.find(n => /^embeddinggemma/i.test(n)) ?? names.find(n => /embed/i.test(n));
}

async function embed(
  url: string,
  model: string,
  input: string[],
  f: typeof fetch
): Promise<number[][] | { error: string }> {
  const post = (path: string) =>
    f(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  let res: Response;
  try {
    res = await post(openAiStyle.has(url) ? '/v1/embeddings' : '/api/embed');
    if (res.status === 404 && !openAiStyle.has(url)) {
      openAiStyle.add(url);
      res = await post('/v1/embeddings');
    }
  } catch (e) {
    return { error: `no embedding model answered at ${url} (${(e as Error).message})` };
  }
  if (!res.ok) return { error: `the embedding model at ${url} answered ${res.status}` };
  let data: any;
  try {
    data = await res.json();
  } catch {
    return { error: `the embedding model at ${url} did not answer in JSON` };
  }
  // Ollama answers `embeddings`; the OpenAI shape is `data`, each with its index.
  const vectors = Array.isArray(data?.data)
    ? [...data.data]
        .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
        .map((d: any) => d?.embedding)
    : data?.embeddings;
  if (
    !Array.isArray(vectors) ||
    vectors.length !== input.length ||
    !vectors.every(
      (v: unknown) => Array.isArray(v) && v.length && v.every(x => typeof x === 'number')
    )
  )
    return { error: `the embedding model at ${url} returned no vectors for ${model}` };
  return vectors;
}

/**
 * The nodes nearest a goal in meaning, asked of an embedding model on this
 * machine. Only reached when no judge answered, and it reports that too, so a
 * person reading a similarity knows no decision model was asked.
 */
async function nearestByMeaning(
  sentence: string,
  nodes: TreeNode[],
  judgeError: string,
  f: typeof fetch
): Promise<Neared | { error: string }> {
  const where = embedUrl();
  if ('error' in where) return { error: `${judgeError}; ${where.error}` };
  const model = process.env.AMBIT_EMBED_MODEL || (await pickEmbedModel(where.url, f));
  if (!model)
    return {
      error: `${judgeError}. No embedding model answered at ${where.url} either: ollama pull embeddinggemma-2:270m, or set AMBIT_EMBED_MODEL.`,
    };
  const p = prompts(model);
  const key = `${where.url}|${model}`;
  let docs = treeVectors.get(key);
  const input = [p.query(sentence), ...(docs ? [] : nodes.map(n => p.doc(n.name, nodeText(n))))];
  const vectors = await embed(where.url, model, input, f);
  if ('error' in vectors) return { error: `${judgeError}; ${vectors.error}` };
  if (!docs) {
    docs = vectors.slice(1);
    treeVectors.set(key, docs);
  }
  const query = vectors[0];
  const nearest = nodes
    .map((n, i) => ({
      id: `combo:${n.id}`,
      name: n.name,
      similarity: Math.round(cosine(query, docs[i]) * 1000) / 1000,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
  const top = nearest[0];
  const floor = nearFloor(model);
  const suggested = top && floor !== undefined && top.similarity >= floor ? top : undefined;
  return {
    asked: where.url,
    by: 'embedding',
    model,
    ...(suggested ? { suggested } : {}),
    nearest,
    note: suggested
      ? `no judgment model answered, so this is the nearest node in meaning by an embedding model on this machine, a similarity and not a probability. Plan it with ambit goal ${suggested.id}`
      : floor === undefined
        ? `no judgment model answered, and no floor has been measured for ${model}, so nothing is suggested; the nearest are listed`
        : 'no judgment model answered, and nothing in the tree is near enough in meaning to suggest; the nearest are listed',
  };
}

/**
 * Asks the judge which curated capability a goal is for.
 *
 * `fetchImpl` is a parameter so a test can answer for the model; nothing else
 * passes one.
 */
async function judgeGoal(
  sentence: string,
  opts: { url?: string; fetchImpl?: typeof fetch } = {}
): Promise<Judged | Neared | { error: string }> {
  const where = judgeUrl(opts.url);
  if ('error' in where) return where;

  const nodes: TreeNode[] = loadTechTree()?.nodes || [];
  const criteria = Object.fromEntries(
    nodes.map(n => [n.id, n.description ? `${n.name}: ${n.description}` : n.name])
  );
  const body = {
    state: sentence,
    ...(process.env.AMBIT_JUDGE_MODEL ? { model: process.env.AMBIT_JUDGE_MODEL } : {}),
    questions: {
      capability: {
        type: 'choice',
        instructions:
          'Which capability would let an agent do what the person asks for? The request is the state.',
        criteria,
      },
    },
  };

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${where.url}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Nothing listening is not a refusal: the person asked a model on this
    // machine, and an embedding model is one. A judge that answered with an
    // error, or a URL refused above, never falls through to it.
    return nearestByMeaning(
      sentence,
      nodes,
      `no judgment model answered at ${where.url} (${(e as Error).message}). Serve Kev, Clef or another clone of the same API and point TYPESAFE_BASE_URL at it, or pass --judge=<url on this machine>`,
      opts.fetchImpl ?? fetch
    );
  }
  if (!res.ok) return { error: `the judge at ${where.url} answered ${res.status}` };

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { error: `the judge at ${where.url} did not answer in JSON` };
  }
  const answer = data?.answers?.capability;
  // Jev returns `choice` beside the distribution. A server that sends only the
  // choice has given one answer at its stated confidence, and is read as that.
  const probabilities: Record<string, number> =
    answer?.probabilities ??
    (typeof answer?.choice === 'string' && typeof answer?.confidence === 'number'
      ? { [answer.choice]: answer.confidence }
      : {});
  // Only an id the tree has counts. A model that returns something else has
  // not answered this question, whatever it is confident about.
  const byName = new Map(nodes.map(n => [n.id, n.name]));
  const considered = Object.entries(probabilities)
    .filter(([id, p]) => byName.has(id) && typeof p === 'number')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, p]) => ({ id: `combo:${id}`, name: byName.get(id) as string, probability: p }));
  if (!considered.length)
    return { error: `the judge at ${where.url} named no capability in the tree` };

  const top = considered[0];
  const suggested = top.probability >= SUGGEST_AT ? top : undefined;
  return {
    asked: where.url,
    by: 'judgment',
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(suggested ? { suggested } : {}),
    considered,
    ...(typeof answer?.confidence === 'number' ? { confidence: answer.confidence } : {}),
    note: suggested
      ? `a suggestion from a judgment model on this machine, not a match in the vocabulary. Plan it with ambit goal ${suggested.id}`
      : 'the judgment model gave no capability even odds, so nothing is suggested; the likeliest are listed',
  };
}

export { embedUrl, judgeGoal, judgeUrl, nearFloor, SUGGEST_AT };
