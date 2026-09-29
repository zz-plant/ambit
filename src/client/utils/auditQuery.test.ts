/**
 * The trail's query bar, as a pure function.
 *
 * An actor id is `human:web`, so a qualifier split on every colon would read
 * `actor:human:web` as a key `actor:human` and a value `web`, and match
 * nothing. These hold the first-colon split, the exact match, and text that
 * is not a qualifier being looked for everywhere.
 */
import { expect, test } from 'vitest';
import type { AuditEvent } from '../../shared/api';
import { matchesAudit, parseAuditQuery } from './auditQuery';

const events: AuditEvent[] = [
  {
    id: 'prop-a#approved',
    at: '2026-09-26T05:00:00.000Z',
    actor: 'human:web',
    action: 'approved',
    target: 'prop-a',
    summary: 'reach the shell',
    outcome: { word: 'signed', tone: 'good' },
  },
  {
    id: 'act:2',
    at: '2026-09-26T04:00:00.000Z',
    actor: 'human:webmaster',
    action: 'rejected',
    target: 'prop-b',
  },
  {
    id: 'act:3',
    at: '2026-09-26T03:00:00.000Z',
    action: 'blocked:tool',
    target: 'combo:shell-execution',
    outcome: { word: 'check failed', tone: 'bad' },
  },
];

const ids = (query: string) =>
  events.filter(e => matchesAudit(e, parseAuditQuery(query))).map(e => e.id);

test('a qualifier splits on its first colon, so an id keeps its own', () => {
  expect(parseAuditQuery('actor:human:web')).toEqual({
    qualified: [{ key: 'actor', value: 'human:web' }],
    text: [],
  });
  expect(ids('actor:human:web')).toEqual(['prop-a#approved']);
  expect(ids('target:combo:shell-execution')).toEqual(['act:3']);
  expect(ids('action:blocked:tool')).toEqual(['act:3']);
});

test('a qualifier matches exactly, ignoring case, and every term has to hold', () => {
  // human:webmaster is not human:web.
  expect(ids('Actor:HUMAN:WEB')).toEqual(['prop-a#approved']);
  expect(ids('actor:human:web action:rejected')).toEqual([]);
  expect(ids('action:approved target:prop-a')).toEqual(['prop-a#approved']);
});

test('text that is not a qualifier is looked for in every field a line shows', () => {
  expect(ids('shell')).toEqual(['prop-a#approved', 'act:3']);
  expect(ids('signed')).toEqual(['prop-a#approved']);
  // A key the bar does not know is text, colon and all.
  expect(parseAuditQuery('human:web').text).toEqual(['human:web']);
  expect(ids('human:web')).toEqual(['prop-a#approved', 'act:2']);
  expect(ids('nothing-says-this')).toEqual([]);
});

test('an empty query, or a qualifier still being typed, narrows nothing', () => {
  expect(ids('')).toHaveLength(3);
  expect(ids('   ')).toHaveLength(3);
  expect(ids('actor:')).toHaveLength(3);
});
