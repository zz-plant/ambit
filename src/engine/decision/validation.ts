import { createHash } from 'node:crypto';
import type { DecisionAnswer, DecisionQuestion, DecisionRequest } from './types.ts';

export const TEXT_LIMIT = 48 * 1024;
export const RESPONSE_LIMIT = 1024 * 1024;
/** Cloudflare Clef schemas; the request cap is also a conservative Omni client budget. */
export const DECISION_MEDIA_LIMITS = {
  images: { count: 4, bytes: 4 * 1024 * 1024, total: 8 * 1024 * 1024 },
  audio: { count: 4, bytes: 8 * 1024 * 1024 },
  videos: { count: 2, bytes: 16 * 1024 * 1024 },
  avTotal: 16 * 1024 * 1024,
  requestBytes: 13 * 1024 * 1024,
} as const;
const DISTRIBUTION_TOLERANCE = 0.01;
const SCORE_TOLERANCE = 0.015;

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value);
}

export function questionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
  );
}

export function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function hashString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])])
    );
  }
  return value;
}

/** A digest is the only representation of input retained by a receipt. */
export function decisionHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function validQuestion(question: unknown): question is DecisionQuestion {
  if (
    !object(question) ||
    typeof question.instructions !== 'string' ||
    !question.instructions.trim()
  )
    return false;
  if (question.type === 'noul') return onlyKeys(question, ['type', 'instructions']);
  if (!onlyKeys(question, ['type', 'instructions', 'criteria'])) return false;
  if (question.type === 'choice') {
    if (!object(question.criteria)) return false;
    const options = Object.entries(question.criteria);
    return (
      options.length >= 2 &&
      options.length <= 255 &&
      options.every(([key, value]) => identifier(key) && typeof value === 'string' && value.trim())
    );
  }
  return (
    question.type === 'score' &&
    Array.isArray(question.criteria) &&
    question.criteria.length >= 2 &&
    question.criteria.length <= 10 &&
    question.criteria.every(value => typeof value === 'string' && value.trim())
  );
}

/** Conservative transport limits; file decoding and duration checks live with media input. */
export function validMedia(request: DecisionRequest, model: string): boolean {
  let imageBytes = 0;
  let avBytes = 0;
  for (const kind of ['images', 'audio', 'videos'] as const) {
    const { count, bytes } = DECISION_MEDIA_LIMITS[kind];
    const items = request[kind];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > count) return false;
    if (
      items.length &&
      !(kind === 'images'
        ? ['clef', 'clef-flash', 'clef-omni'].includes(model)
        : model === 'clef-omni')
    )
      return false;
    for (const item of items) {
      if (typeof item !== 'string' || item.length > Math.ceil(bytes / 3) * 4 + 128) return false;
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(item);
      if (!match?.[2] || match[2].length % 4 !== 0) return false;
      const mimes =
        kind === 'images'
          ? /^image\/(png|jpeg|webp)$/
          : kind === 'audio'
            ? /^audio\/(wav|mpeg|mp3)$/
            : /^video\/(mp4|webm)$/;
      if (!mimes.test(match[1])) return false;
      const decoded = Buffer.from(match[2], 'base64');
      if (decoded.toString('base64') !== match[2] || decoded.byteLength > bytes) return false;
      if (kind === 'images') imageBytes += decoded.byteLength;
      else avBytes += decoded.byteLength;
      if (
        imageBytes > DECISION_MEDIA_LIMITS.images.total ||
        avBytes > DECISION_MEDIA_LIMITS.avTotal
      )
        return false;
    }
  }
  return true;
}

export function validRequest(value: unknown, model: string): value is DecisionRequest {
  if (
    !object(value) ||
    !Object.hasOwn(value, 'state') ||
    value.state === undefined ||
    !object(value.questions) ||
    !onlyKeys(value, ['state', 'questions', 'images', 'audio', 'videos'])
  )
    return false;
  const questions = Object.entries(value.questions);
  if (
    !questions.length ||
    questions.length > 64 ||
    !questions.every(([id, question]) => questionId(id) && validQuestion(question))
  )
    return false;
  try {
    const text = JSON.stringify({ state: value.state, questions: value.questions });
    if (Buffer.byteLength(text) > TEXT_LIMIT) return false;
    if (!validMedia(value as unknown as DecisionRequest, model)) return false;
    return (
      Buffer.byteLength(JSON.stringify({ ...value, model })) <= DECISION_MEDIA_LIMITS.requestBytes
    );
  } catch {
    return false;
  }
}

function distribution(value: unknown, labels: string[]): Record<string, number> | undefined {
  if (
    !object(value) ||
    Object.keys(value).length !== labels.length ||
    !labels.every(label => Object.hasOwn(value, label) && probability(value[label]))
  )
    return;
  const sum = labels.reduce((total, label) => total + (value[label] as number), 0);
  if (Math.abs(sum - 1) > DISTRIBUTION_TOLERANCE) return;
  return Object.fromEntries(labels.map(label => [label, value[label] as number]));
}

/** Unknown output fields (legends, rationale, provider messages) never survive normalization. */
export function normalizeAnswers(
  questions: Record<string, DecisionQuestion>,
  raw: unknown
): Record<string, DecisionAnswer> | undefined {
  if (!object(raw) || Object.keys(raw).length !== Object.keys(questions).length) return;
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw[id];
    if (
      !object(answer) ||
      answer.type !== question.type ||
      (answer.confidence !== undefined && !probability(answer.confidence))
    )
      return;
    const confidence =
      answer.confidence === undefined ? {} : { confidence: answer.confidence as number };
    if (question.type === 'noul') {
      if (!probability(answer.noul)) return;
      answers[id] = { type: 'noul', probability: answer.noul, ...confidence };
      continue;
    }
    const labels =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    const probabilities = distribution(answer.probabilities, labels);
    if (!probabilities) return;
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !Object.hasOwn(probabilities, answer.choice)) return;
      const selected = probabilities[answer.choice];
      if (labels.some(label => probabilities[label] > selected + 1e-9)) return;
      answers[id] = {
        type: 'choice',
        choice: answer.choice,
        probability: selected,
        probabilities,
        ...confidence,
      };
    } else {
      const expected = labels.reduce(
        (total, label) => total + Number(label) * probabilities[label],
        0
      );
      if (
        typeof answer.score !== 'number' ||
        !Number.isFinite(answer.score) ||
        Math.abs(answer.score - expected) > SCORE_TOLERANCE
      )
        return;
      answers[id] = { type: 'score', score: expected, probabilities, ...confidence };
    }
  }
  return answers;
}
