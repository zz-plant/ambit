/**
 * The trail, drawn.
 *
 * `ambit audit` was the only reader of who approved what and what ran, and
 * no page had a way in. These hold the way in, the outcome drawn as a shape
 * and a word and never as a colour alone, no outcome where none was
 * recorded, and the query bar narrowing to one actor.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { AuditEvent, AuditResponse } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { demoAudit } from '../store/demo';
import AppDeck from './AppDeck';
import AuditView, { AuditTrail } from './AuditView';

/** Both halves of the store, since a server render reads the initial state. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => seed({ audit: null, demo: false, backend: 'unknown' }));

const PLACEHOLDERS = ['undefined', 'NaN', 'Invalid Date', '[object Object]'];

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
    id: 'act:7',
    at: '2026-09-26T04:00:00.000Z',
    action: 'failed',
    target: 'combo:shell',
    outcome: { word: 'check failed', tone: 'bad' },
  },
  { id: 'prop-a#proposed', at: '2026-09-26T03:00:00.000Z', action: 'proposed', target: 'prop-a' },
  { id: 'act:9', at: '2026-09-26T02:00:00.000Z', actor: 'human:kanav', action: 'rejected' },
];

const response = (over: Partial<AuditResponse> = {}): AuditResponse => ({
  days: 30,
  limit: 200,
  events,
  truncated: false,
  ...over,
});

const rows = (html: string) => html.split('<li class="audit-row">').slice(1);

test('the trail is a view the header offers', () => {
  const html = renderToStaticMarkup(
    <AppDeck
      view="audit"
      counts={null}
      entries={null}
      connected={false}
      draftCount={0}
      spotlight={null}
      onSpotlight={() => {}}
      onSearch={() => {}}
      onShowView={() => {}}
      onShare={() => {}}
      onShowProposals={() => {}}
      onShowDocs={() => {}}
    />
  );
  // The active tab is the one whose label is Audit, within one button.
  expect(html).toMatch(
    /<button[^>]*app-deck-tab--active[^>]*>(?:(?!<\/button>)[\s\S])*<span>Audit<\/span>/
  );
});

test('an outcome is a shape and a word, and an event that recorded none draws none', () => {
  const html = renderToStaticMarkup(<AuditTrail events={events} query="" />);
  const [approved, failed, proposed, rejected] = rows(html);

  expect(approved).toContain('audit-outcome--good');
  expect(approved).toContain('✓');
  expect(approved).toContain('signed');
  expect(failed).toContain('audit-outcome--bad');
  expect(failed).toContain('✕');
  expect(failed).toContain('check failed');
  expect(proposed).not.toContain('audit-outcome');
  expect(rejected).not.toContain('audit-outcome');
  for (const marker of PLACEHOLDERS) expect(html).not.toContain(marker);
});

test('actor:human:web leaves only that actor’s lines', () => {
  const html = renderToStaticMarkup(<AuditTrail events={events} query="actor:human:web" />);
  expect(rows(html)).toHaveLength(1);
  expect(html).toContain('prop-a');
  expect(html).not.toContain('human:kanav');

  const none = renderToStaticMarkup(<AuditTrail events={events} query="actor:human:nobody" />);
  expect(none).toContain('Nothing on the trail matches that.');
});

test('the view counts what it shows, and says when the window held more', () => {
  seed({ audit: response() });
  expect(renderToStaticMarkup(<AuditView />)).toContain('4 events in the last 30 days');

  seed({ audit: response({ truncated: true, limit: 4 }) });
  expect(renderToStaticMarkup(<AuditView />)).toContain(
    'The window held more than 4; the oldest are not shown.'
  );
});

test('an empty ledger says what writes to the trail, not a list of nothing', () => {
  seed({ audit: response({ events: [] }) });
  const html = renderToStaticMarkup(<AuditView />);
  expect(html).toContain('Nothing recorded in the last 30 days');
  expect(html).not.toContain('audit-list');
});

test('the demo’s trail is labelled a sample, and runs newest first', () => {
  const demo = demoAudit();
  const times = demo.events.map(e => Date.parse(e.at));
  expect(times).toEqual([...times].sort((a, b) => b - a));

  seed({ audit: demo, demo: true });
  const html = renderToStaticMarkup(<AuditView />);
  expect(html).toContain('This is sample data.');
  expect(html).toContain('grant narrowed');
});
