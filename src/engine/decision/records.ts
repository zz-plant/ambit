import { randomUUID } from 'node:crypto';
import type { Migratable } from '../migrate.ts';
import type { DecisionRecordRow } from '../rows.ts';
import type {
  DecisionEvidenceReference,
  DecisionQuestion,
  DecisionRecord,
  DecisionResult,
} from './types.ts';
import {
  decisionHash,
  DECISION_MEDIA_LIMITS,
  hashString,
  identifier,
  normalizeAnswers,
  object,
  probability,
  questionId,
  RESPONSE_LIMIT,
} from './validation.ts';

const SUMMARY_METRICS = new Set([
  'threshold',
  'candidate_count',
  'question_count',
  'abstained',
  'matched',
  'total',
  'omitted',
  'selected_count',
  'input_count',
]);

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function safeEndpoint(provider: unknown, endpoint: unknown, model: string): boolean {
  if (typeof endpoint !== 'string') return false;
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) return false;
    if (provider === 'local')
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
        url.pathname === '/v1/systemone'
      );
    return (
      provider === 'cloudflare' &&
      ['clef', 'clef-flash', 'clef-omni'].includes(model) &&
      url.protocol === 'https:' &&
      url.hostname === 'api.cloudflare.com' &&
      !url.port &&
      new RegExp(`^/client/v4/accounts/[a-f0-9]{32}/ai/run/@cf/cloudflare/${model}$`, 'i').test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function decisionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^decision:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  );
}

/** Rebuild the allow-listed result. No caller-supplied object is persisted by spreading it. */
function safeResult(value: unknown): DecisionResult | undefined {
  if (
    !object(value) ||
    !keys(value, [
      'provider',
      'endpoint',
      'model',
      'answers',
      'usage',
      'elapsed_ms',
      'request_hash',
      'rubric_hash',
      'provenance',
    ])
  )
    return;
  if (
    typeof value.model !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(value.model) ||
    !safeEndpoint(value.provider, value.endpoint, value.model)
  )
    return;
  if (
    typeof value.elapsed_ms !== 'number' ||
    !Number.isFinite(value.elapsed_ms) ||
    value.elapsed_ms < 0 ||
    !hashString(value.request_hash) ||
    !hashString(value.rubric_hash)
  )
    return;
  const provenance = value.provenance;
  if (
    !object(provenance) ||
    !keys(provenance, ['schema_version', 'recorded_at', 'question_types', 'media']) ||
    provenance.schema_version !== 1 ||
    !timestamp(provenance.recorded_at) ||
    !object(provenance.question_types) ||
    !object(provenance.media) ||
    !keys(provenance.media, ['images', 'audio', 'videos'])
  )
    return;
  const media = provenance.media;
  if (
    ![media.images, media.audio, media.videos].every(
      count => Number.isSafeInteger(count) && (count as number) >= 0
    ) ||
    (media.images as number) > DECISION_MEDIA_LIMITS.images.count ||
    (media.audio as number) > DECISION_MEDIA_LIMITS.audio.count ||
    (media.videos as number) > DECISION_MEDIA_LIMITS.videos.count
  )
    return;
  if (((media.audio as number) > 0 || (media.videos as number) > 0) && value.model !== 'clef-omni')
    return;
  if ((media.images as number) > 0 && !['clef', 'clef-flash', 'clef-omni'].includes(value.model))
    return;
  if (
    !object(value.answers) ||
    !Object.keys(value.answers).length ||
    Object.keys(value.answers).length > 64 ||
    Object.keys(provenance.question_types).length !== Object.keys(value.answers).length
  )
    return;
  const questions: Record<string, DecisionQuestion> = {};
  const wire: Record<string, unknown> = {};
  for (const [id, answer] of Object.entries(value.answers)) {
    if (!questionId(id) || !object(answer) || provenance.question_types[id] !== answer.type) return;
    if (answer.type === 'noul') {
      if (!keys(answer, ['type', 'probability', 'confidence']) || !probability(answer.probability))
        return;
      questions[id] = { type: 'noul', instructions: 'receipt' };
      wire[id] = { type: 'noul', noul: answer.probability, confidence: answer.confidence };
    } else if (answer.type === 'choice') {
      if (
        !keys(answer, ['type', 'choice', 'probability', 'probabilities', 'confidence']) ||
        !object(answer.probabilities) ||
        !probability(answer.probability) ||
        typeof answer.choice !== 'string' ||
        answer.probabilities[answer.choice] !== answer.probability
      )
        return;
      const labels = Object.keys(answer.probabilities);
      if (labels.length < 2 || labels.length > 255 || !labels.every(identifier)) return;
      questions[id] = {
        type: 'choice',
        instructions: 'receipt',
        criteria: Object.fromEntries(labels.map(label => [label, 'receipt'])),
      };
      wire[id] = answer;
    } else if (answer.type === 'score') {
      if (
        !keys(answer, ['type', 'score', 'probabilities', 'confidence']) ||
        !object(answer.probabilities)
      )
        return;
      const levels = Object.keys(answer.probabilities).length;
      if (levels < 2 || levels > 10) return;
      questions[id] = {
        type: 'score',
        instructions: 'receipt',
        criteria: Array(levels).fill('receipt'),
      };
      wire[id] = answer;
    } else return;
  }
  const answers = normalizeAnswers(questions, wire);
  if (!answers) return;
  let usage: DecisionResult['usage'];
  if (value.usage !== undefined) {
    if (
      !object(value.usage) ||
      !keys(value.usage, ['input_tokens']) ||
      !Number.isSafeInteger(value.usage.input_tokens) ||
      (value.usage.input_tokens as number) < 0
    )
      return;
    usage = { input_tokens: value.usage.input_tokens as number };
  }
  return {
    provider: value.provider as DecisionResult['provider'],
    endpoint: value.endpoint as string,
    model: value.model,
    answers,
    ...(usage ? { usage } : {}),
    elapsed_ms: value.elapsed_ms,
    request_hash: value.request_hash,
    rubric_hash: value.rubric_hash,
    provenance: {
      schema_version: 1,
      recorded_at: provenance.recorded_at,
      question_types: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [id, question.type])
      ),
      media: {
        images: media.images as number,
        audio: media.audio as number,
        videos: media.videos as number,
      },
    },
  };
}

function safeEvidence(value: unknown): DecisionEvidenceReference[] | undefined {
  if (!Array.isArray(value) || value.length > 256) return;
  const references: DecisionEvidenceReference[] = [];
  for (const reference of value) {
    if (
      !object(reference) ||
      !keys(reference, ['kind', 'hash']) ||
      !identifier(reference.kind) ||
      !hashString(reference.hash)
    )
      return;
    references.push({ kind: reference.kind, hash: reference.hash });
  }
  return references;
}

function metrics(value: unknown): Record<string, number | boolean> {
  if (!object(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, metric]) =>
        SUMMARY_METRICS.has(key) &&
        (typeof metric === 'boolean' || (typeof metric === 'number' && Number.isFinite(metric)))
    )
  ) as Record<string, number | boolean>;
}

function parseRow(row: DecisionRecordRow): DecisionRecord | undefined {
  try {
    if (!decisionId(row.id) || !timestamp(row.recorded_at)) return;
    const result = safeResult(JSON.parse(row.result_json));
    const evidence = safeEvidence(JSON.parse(row.evidence_json));
    const summary: unknown = JSON.parse(row.summary_json);
    if (
      !identifier(row.kind) ||
      !result ||
      !evidence ||
      !object(summary) ||
      !hashString(summary.hash)
    )
      return;
    if (
      row.disposition !== null &&
      row.disposition !== 'accepted' &&
      row.disposition !== 'rejected'
    )
      return;
    if (
      row.disposition &&
      (!timestamp(row.reviewed_at) || (row.note_hash !== null && !hashString(row.note_hash)))
    )
      return;
    return {
      id: row.id,
      kind: row.kind,
      recorded_at: row.recorded_at,
      result,
      evidence,
      summary: { hash: summary.hash, ...metrics(summary) },
      ...(row.disposition
        ? {
            review: {
              disposition: row.disposition,
              reviewed_at: row.reviewed_at!,
              ...(row.note_hash ? { note_hash: row.note_hash } : {}),
            },
          }
        : {}),
    };
  } catch {
    return;
  }
}

/** Local receipt only: no checks, grants, learning rows, or capability updates. */
export function saveDecision(
  db: Migratable,
  kind: string,
  result: DecisionResult,
  evidence: DecisionEvidenceReference[] = [],
  summary: unknown = {}
): string {
  try {
    const safe = safeResult(result);
    const references = safeEvidence(evidence);
    if (!identifier(kind) || !safe || !references) throw new Error('invalid');
    const keptSummary = { hash: decisionHash(summary), ...metrics(summary) };
    const serialized = JSON.stringify(safe);
    if (Buffer.byteLength(serialized) > RESPONSE_LIMIT) throw new Error('invalid');
    const id = `decision:${randomUUID()}`;
    db.prepare(
      'INSERT INTO decision_records (id,kind,recorded_at,result_json,evidence_json,summary_json) VALUES (?,?,?,?,?,?)'
    ).run(
      id,
      kind,
      new Date().toISOString(),
      serialized,
      JSON.stringify(references),
      JSON.stringify(keptSummary)
    );
    return id;
  } catch {
    throw new Error('Invalid decision receipt');
  }
}

export function getDecision(db: Migratable, id: string): DecisionRecord | { error: string } {
  if (!decisionId(id)) return { error: 'Decision receipt not found' };
  const row = db.prepare('SELECT * FROM decision_records WHERE id=?').get<DecisionRecordRow>(id);
  return (row && parseRow(row)) || { error: 'Decision receipt not found or invalid' };
}

export function decisionHistory(db: Migratable, limit = 50): DecisionRecord[] {
  const bounded = Number.isFinite(limit) ? Math.max(0, Math.min(500, Math.floor(limit))) : 50;
  return db
    .prepare('SELECT * FROM decision_records ORDER BY recorded_at DESC,rowid DESC LIMIT ?')
    .all<DecisionRecordRow>(bounded)
    .flatMap(row => {
      const record = parseRow(row);
      return record ? [record] : [];
    });
}

/** The first review is immutable. An identical retry returns its existing receipt. */
export function reviewDecision(
  db: Migratable,
  id: string,
  disposition: 'accepted' | 'rejected',
  note?: string
): ({ id: string } & NonNullable<DecisionRecord['review']>) | { error: string } {
  if (disposition !== 'accepted' && disposition !== 'rejected')
    return { error: 'Invalid decision review disposition' };
  if (note !== undefined && (typeof note !== 'string' || Buffer.byteLength(note) > 4096))
    return { error: 'Invalid decision review note' };
  const before = getDecision(db, id);
  if ('error' in before) return before;
  const note_hash = note === undefined ? undefined : decisionHash(note);
  db.prepare(
    'UPDATE decision_records SET disposition=?,reviewed_at=?,note_hash=? WHERE id=? AND disposition IS NULL'
  ).run(disposition, new Date().toISOString(), note_hash ?? null, id);
  const after = getDecision(db, id);
  if ('error' in after) return after;
  if (after.review?.disposition !== disposition || after.review.note_hash !== note_hash)
    return { error: 'Decision receipt already has a different review' };
  return { id, ...after.review };
}

export type { DecisionRecord, DecisionEvidenceReference } from './types.ts';
