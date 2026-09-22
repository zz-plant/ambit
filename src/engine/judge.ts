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

/**
 * Where to ask, or why not. The URL is parsed, never prefix-matched: a prefix
 * test passes `http://127.0.0.1:1@host`, which every HTTP client reads as a
 * request to `host` with credentials, and `http://127.0.0.1.example.com`.
 */
function judgeUrl(named?: string): { url: string } | { error: string } {
  const raw = named || process.env.AMBIT_JUDGE_URL || DEFAULT_JUDGE;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: `not a URL: ${raw}` };
  }
  if (u.username || u.password)
    return { error: `refused ${raw}: a judge URL carries no credentials` };
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname))
    return {
      error: `refused ${raw}: the judge must run on this machine (http://127.0.0.1, localhost or [::1])`,
    };
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

interface Judged {
  asked: string;
  model?: string;
  suggested?: { id: string; name: string; probability: number };
  considered: Array<{ id: string; name: string; probability: number }>;
  confidence?: number;
  note: string;
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
): Promise<Judged | { error: string }> {
  const where = judgeUrl(opts.url);
  if ('error' in where) return where;

  const nodes: Array<{ id: string; name: string; description?: string }> =
    loadTechTree()?.nodes || [];
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
    return {
      error: `no judgment model answered at ${where.url} (${(e as Error).message}). Serve a local clone such as Kev, or pass --judge=<url on this machine>.`,
    };
  }
  if (!res.ok) return { error: `the judge at ${where.url} answered ${res.status}` };

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { error: `the judge at ${where.url} did not answer in JSON` };
  }
  const answer = data?.answers?.capability;
  const probabilities: Record<string, number> = answer?.probabilities ?? {};
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
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(suggested ? { suggested } : {}),
    considered,
    ...(typeof answer.confidence === 'number' ? { confidence: answer.confidence } : {}),
    note: suggested
      ? `a suggestion from a judgment model on this machine, not a match in the vocabulary. Plan it with ambit goal ${suggested.id}`
      : 'the judgment model gave no capability even odds, so nothing is suggested; the likeliest are listed',
  };
}

export { judgeGoal, judgeUrl, SUGGEST_AT };
