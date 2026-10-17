import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { makeGraph } from '../testing/graph.ts';

async function evaluation() {
  expect(existsSync(new URL('./evaluate.ts', import.meta.url)), 'evaluation harness exists').toBe(
    true
  );
  return import('./evaluate.ts');
}
test('evaluation reports errors, abstentions, calibration and accepted precision separately', async () => {
  const { scoreEvaluation } = await evaluation();
  const cases = [
    { id: 'one', task: 'A', expected: 'a' },
    { id: 'two', task: 'B', expected: 'a' },
    { id: 'three', task: 'C', expected: null },
    { id: 'four', task: 'D', expected: 'b' },
  ];
  const result = scoreEvaluation(
    cases,
    [
      {
        id: 'one',
        probabilities: { a: 0.9, 'none-of-these': 0.1 },
        elapsed_ms: 10,
        input_tokens: 100,
      },
      { id: 'two', probabilities: { b: 0.8, a: 0.2 }, elapsed_ms: 20, input_tokens: 200 },
      {
        id: 'three',
        probabilities: { 'none-of-these': 0.95, a: 0.05 },
        elapsed_ms: 30,
        input_tokens: 100,
      },
      { id: 'four', error: 'unavailable' },
    ],
    { threshold: 0.8, pricePerMillion: 0.038 }
  );
  if ('error' in result) throw new Error(result.error);
  expect(result).toMatchObject({
    total: 4,
    answered: 3,
    errors: 1,
    abstentions: 1,
    accuracy: 0.5,
    coverage: 0.5,
    accepted_precision: 0.5,
    p95_ms: 30,
    input_tokens: 400,
  });
  expect(result.brier).toBeCloseTo(0.435);
  expect(result.ece).toBeCloseTo(0.95 / 3);
  expect(result.estimated_dollars).toBeCloseTo(0.0000152);
});
test('invalid evaluation rows fail rather than silently improving the denominator', async () => {
  const { scoreEvaluation } = await evaluation();
  const cases = [{ id: 'one', task: 'A', expected: 'a' }];
  expect(scoreEvaluation(cases, [], {})).toHaveProperty('error');
  expect(scoreEvaluation(cases, [{ id: 'one', probabilities: { a: 1.5 } }], {})).toHaveProperty(
    'error'
  );
  expect(
    scoreEvaluation(
      cases,
      [
        { id: 'one', probabilities: { a: 1 } },
        { id: 'one', probabilities: { a: 1 } },
      ],
      {}
    )
  ).toHaveProperty('error');
});
test('the vocabulary baseline runs offline and makes no probability or latency claims', async () => {
  const { evaluateGoals } = await evaluation();
  const db = makeGraph();
  try {
    const out = await evaluateGoals(db, [
      { id: 'known', task: 'run commands', expected: 'shell-execution' },
      { id: 'outside', task: 'juggle flaming torches', expected: null },
    ]);
    if ('error' in out) throw new Error(out.error);
    expect(out).toMatchObject({ mode: 'vocabulary', total: 2, accuracy: 1 });
    expect(out).not.toHaveProperty('brier');
    expect(out).not.toHaveProperty('p95_ms');
    expect(db.prepare('SELECT COUNT(*) n FROM decision_records').get()?.n).toBe(0);
  } finally {
    db.close();
  }
});
