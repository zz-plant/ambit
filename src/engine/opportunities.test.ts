/**
 * Whose attention a burden is priced at, and an opportunity id that is not
 * on the list.
 */
import { expect, test } from 'vitest';
import { attentionOwner } from './economics.ts';
import { opportunityFor } from './opportunities.ts';
import { makeGraph } from './testing/graph.ts';

const declare = (db: ReturnType<typeof makeGraph>, actor: string, cents: number) =>
  db
    .prepare(
      `INSERT INTO economics (entity_type, entity_id, metric, value_cents, source)
       VALUES ('actor', ?, 'attention_value_per_hour', ?, 'declared')`
    )
    .run(actor, cents);

test('the burden is priced at the attention of whoever declared it, not a named maintainer', () => {
  const db = makeGraph();
  expect(attentionOwner(db)).toBeNull();
  declare(db, 'human:sam', 9000);
  expect(attentionOwner(db)).toBe('human:sam');
  db.close();
});

test('among several who declared, the one who stepped in most is the owner', () => {
  const db = makeGraph();
  declare(db, 'human:sam', 9000);
  declare(db, 'human:ari', 12000);
  const step = db.prepare("INSERT INTO human_intervention (actor_id, kind) VALUES (?, 'approval')");
  step.run('human:ari');
  step.run('human:ari');
  step.run('human:sam');
  expect(attentionOwner(db)).toBe('human:ari');
  db.close();
});

test('an opportunity id past the end of the list is not found, and nothing throws', () => {
  const db = makeGraph();
  expect(opportunityFor(db, 'opp-999')).toEqual({
    error: 'opp-999 not found. Run ambit opportunities to see the list.',
  });
  db.close();
});
