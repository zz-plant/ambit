import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDb, migrate } from '../db.ts';
import { makeGraph } from '../testing/graph.ts';
import { exportSync } from '../sync.ts';
import type { DecisionResult } from './types.ts';

const hash = 'a'.repeat(64);
const result: DecisionResult = {
  provider: 'local',
  endpoint: 'http://127.0.0.1:8009/v1/systemone',
  model: 'clef-flash',
  answers: {
    capability: {
      type: 'choice',
      choice: 'combo:web-research',
      probability: 0.8,
      probabilities: { 'combo:web-research': 0.8, 'none-of-these': 0.2 },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 17 },
  elapsed_ms: 20,
  request_hash: hash,
  rubric_hash: hash,
  provenance: {
    schema_version: 1,
    recorded_at: '2026-10-16T10:00:00.000Z',
    question_types: { capability: 'choice' },
    media: { images: 0, audio: 0, videos: 0 },
  },
};

async function records() {
  expect(
    existsSync(new URL('./records.ts', import.meta.url)),
    'decision receipt storage exists'
  ).toBe(true);
  return import('./records.ts');
}

describe('local decision provenance', () => {
  it('stores safe answer metadata and hashes evidence without retaining input or notes', async () => {
    const { saveDecision, getDecision, decisionHistory, reviewDecision } = await records();
    const db = makeGraph();
    try {
      const id = saveDecision(db, 'goal', result, [{ kind: 'goal', hash }], {
        threshold: 0.7,
        candidate_count: 2,
        abstained: false,
        state: 'SECRET STATE',
        media: 'data:image/png;base64,SECRET',
      });
      expect(id).toMatch(/^decision:[a-f0-9-]+$/);
      expect(getDecision(db, id)).toMatchObject({
        id,
        kind: 'goal',
        result,
        evidence: [{ kind: 'goal', hash }],
        summary: {
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          threshold: 0.7,
          candidate_count: 2,
          abstained: false,
        },
      });
      expect(reviewDecision(db, id, 'accepted', 'SECRET NOTE')).toMatchObject({
        id,
        disposition: 'accepted',
        note_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const history = decisionHistory(db);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ review: { disposition: 'accepted' } });
      expect(JSON.stringify(db.prepare('SELECT * FROM decision_records').all())).not.toMatch(
        /SECRET|data:image|"state"|instructions|"token"/
      );
      expect(db.prepare('SELECT * FROM capabilities').all()).toHaveLength(0);
      expect(db.prepare('SELECT * FROM authority').all()).toHaveLength(0);
      expect(db.prepare('SELECT * FROM session_learning').all()).toHaveLength(0);
      expect(db.prepare('SELECT * FROM declared_checks').all()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('creates receipts on fresh and existing graphs without replacing historical data', async () => {
    const { saveDecision, decisionHistory } = await records();
    const db = getDb(':memory:');
    try {
      // Simulate an installation made before the table existed.
      migrate(db);
      db.exec('DROP TABLE decision_records');
      db.prepare(
        "INSERT INTO capabilities (id,name,domain,description) VALUES ('kept','Kept','meta','')"
      ).run();
      migrate(db);
      const id = saveDecision(db, 'goal', result, [], {});
      migrate(db);
      expect(decisionHistory(db)[0].id).toBe(id);
      expect(db.prepare("SELECT name FROM capabilities WHERE id='kept'").get()).toMatchObject({
        name: 'Kept',
      });
    } finally {
      db.close();
    }
  });

  it('requires an explicit existing record and never overwrites a conflicting review', async () => {
    const { saveDecision, getDecision, reviewDecision } = await records();
    const db = makeGraph();
    try {
      expect(getDecision(db, 'decision:missing')).toHaveProperty('error');
      expect(reviewDecision(db, 'decision:missing', 'accepted')).toHaveProperty('error');
      const id = saveDecision(db, 'goal', result, [], {});
      const accepted = reviewDecision(db, id, 'accepted', 'first note');
      expect(reviewDecision(db, id, 'accepted', 'first note')).toEqual(accepted);
      expect(reviewDecision(db, id, 'rejected')).toHaveProperty('error');
      expect(reviewDecision(db, id, 'accepted', 'changed note')).toHaveProperty('error');
      expect(getDecision(db, id)).toMatchObject({ review: { disposition: 'accepted' } });
    } finally {
      db.close();
    }
  });

  it.each([
    { ...result, token: 'SECRET' },
    { ...result, request_hash: 'bad' },
    { ...result, endpoint: 'https://evil.test/SECRET' },
    { ...result, endpoint: 'http://token:SECRET@localhost:8009/v1/systemone' },
    { ...result, elapsed_ms: -1 },
    { ...result, usage: { input_tokens: -1 } },
    {
      ...result,
      answers: {
        capability: {
          type: 'choice',
          choice: 'x',
          probability: 0.8,
          probabilities: { x: 0.2, y: 0.8 },
        },
      },
    },
    { ...result, answers: { capability: { ...result.answers.capability, probability: 0.5 } } },
    { ...result, answers: { capability: { type: 'noul', probability: Infinity } } },
    { ...result, provenance: { ...result.provenance, state: 'SECRET' } },
  ])('refuses malformed or expanded persisted results', async invalid => {
    const { saveDecision, decisionHistory } = await records();
    const db = makeGraph();
    try {
      expect(() => saveDecision(db, 'goal', invalid as DecisionResult, [], {})).toThrow(
        'Invalid decision receipt'
      );
      expect(decisionHistory(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('refuses unsafe evidence and records only bounded summary metrics', async () => {
    const { saveDecision, decisionHistory } = await records();
    const db = makeGraph();
    try {
      expect(() =>
        saveDecision(db, 'goal', result, [{ kind: 'goal', hash, path: 'SECRET' } as never], {})
      ).toThrow();
      expect(() => saveDecision(db, 'SECRET LONG KIND', result, [], {})).toThrow();
      saveDecision(db, 'goal', result, [], {
        threshold: 'SECRET',
        total: Infinity,
        omitted: 3,
        arbitrary: 'SECRET',
      });
      expect(decisionHistory(db)[0].summary).toEqual({ hash: expect.any(String), omitted: 3 });
    } finally {
      db.close();
    }
  });

  it('bounds history and omits decision receipts from ordinary sync exports', async () => {
    const { saveDecision, decisionHistory } = await records();
    const db = makeGraph();
    const directory = mkdtempSync(join(tmpdir(), 'ambit-decision-sync-'));
    try {
      saveDecision(db, 'goal', result, [], {});
      const newest = saveDecision(db, 'spec', result, [], {});
      expect(decisionHistory(db, 1).map(record => record.id)).toEqual([newest]);
      expect(decisionHistory(db, 0)).toEqual([]);
      const path = join(directory, 'sync.json');
      exportSync(db, path);
      const exported = readFileSync(path, 'utf8');
      expect(exported).not.toContain('decision_records');
      expect(exported).not.toContain(newest);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { field: 'id', corrupted: 'SECRET-RECORD-ID' },
    { field: 'id', corrupted: `decision:${'-'.repeat(36)}` },
    { field: 'recorded_at', corrupted: 'SECRET-TIMESTAMP' },
    { field: 'recorded_at', corrupted: '2026-02-30T10:00:00.000Z' },
  ])(
    'refuses corrupted receipt metadata from history and direct reads',
    async ({ field, corrupted }) => {
      const { saveDecision, getDecision, decisionHistory } = await records();
      const db = makeGraph();
      try {
        const id = saveDecision(db, 'goal', result, [], {});
        if (field === 'id')
          db.prepare('UPDATE decision_records SET id=? WHERE id=?').run(corrupted, id);
        else db.prepare('UPDATE decision_records SET recorded_at=? WHERE id=?').run(corrupted, id);
        expect(decisionHistory(db)).toEqual([]);
        expect(getDecision(db, field === 'id' ? corrupted : id)).toHaveProperty('error');
      } finally {
        db.close();
      }
    }
  );
});
