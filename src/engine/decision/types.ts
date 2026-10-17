/** Typed System One questions. A rubric is supplied data, never a command. */
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  images?: string[];
  audio?: string[];
  videos?: string[];
}

export type DecisionProvider = 'local' | 'cloudflare';

export interface DecisionOptions {
  provider?: DecisionProvider;
  url?: string;
  model?: string;
  accountId?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type DecisionAnswer =
  | {
      type: 'choice';
      choice: string;
      /** The selected option's probability, distinct from model confidence. */
      probability: number;
      probabilities: Record<string, number>;
      confidence?: number;
    }
  | { type: 'noul'; probability: number; confidence?: number }
  | {
      type: 'score';
      /** Expected rubric level: sum(level index * probability). */
      score: number;
      probabilities: Record<string, number>;
      confidence?: number;
    };

export interface DecisionResult {
  provider: DecisionProvider;
  endpoint: string;
  /** The model selector sent in the request; untrusted response names are omitted. */
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage?: { input_tokens: number };
  elapsed_ms: number;
  request_hash: string;
  rubric_hash: string;
  provenance: {
    schema_version: 1;
    recorded_at: string;
    question_types: Record<string, DecisionQuestion['type']>;
    media: { images: number; audio: number; videos: number };
  };
}

export interface DecisionError {
  error: string;
  errorKind:
    | 'configuration'
    | 'invalid-request'
    | 'transport-unavailable'
    | 'http'
    | 'invalid-response';
}

/** References carry a digest and a bounded kind, never a local path or input. */
export interface DecisionEvidenceReference {
  kind: string;
  hash: string;
}

export interface DecisionRecord {
  id: string;
  kind: string;
  recorded_at: string;
  result: DecisionResult;
  evidence: DecisionEvidenceReference[];
  summary: { hash: string; [key: string]: number | boolean | string };
  review?: {
    disposition: 'accepted' | 'rejected';
    reviewed_at: string;
    note_hash?: string;
  };
}
