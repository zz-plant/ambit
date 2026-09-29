/**
 * The queue: several waiting drafts, ticked, and decided each on its own.
 *
 * Reading a week's drafts together is one sitting where one at a time is
 * several interruptions, and the engine could approve several from the CLI
 * only. These hold the sheet: a box per draft, a draft the record leans
 * against starting unticked, no comment box an approval has nowhere to keep,
 * and the demo marking its own cards without a network.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { ProposalDecision, ProposalRow } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { demoProposals } from '../store/demo';
import ApprovalModal from './ApprovalModal';

/** Both halves of the store, since a server render reads the initial state. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => seed({ proposals: [], demo: false }));

const decision = (precedent: ProposalDecision['precedent'] = []): ProposalDecision => ({
  setup_hours: 0.5,
  reversible: true,
  applicable: true,
  requires_person: false,
  forecast: null,
  unlocks: [],
  precedent,
});

const draft = (id: string, precedent?: ProposalDecision['precedent']): ProposalRow => ({
  id,
  goal: `reach what ${id} names`,
  status: 'draft',
  steps: '[]',
  created_at: '2026-09-28 10:00:00',
  proposal_hash: `hash-${id}`,
  decision: decision(precedent),
});

const render = () => renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />);

/** The checkbox markup for one draft, found by the label it carries. */
const boxFor = (html: string, id: string) =>
  html.match(new RegExp(`<input[^>]*aria-label="Include ${id}"[^>]*>`))?.[0] ?? '';

test('waiting drafts are a queue, and one the record leans against starts unticked', () => {
  seed({
    proposals: [
      draft('prop-a'),
      draft('prop-b'),
      draft('prop-c', [{ trait: 'cost:recurring', leans: 'refused', approved: 0, rejected: 3 }]),
    ],
  });
  const html = render();

  expect(html).toContain('Approve 2 and sign');
  expect(html).toContain('Turn down 2');
  expect(boxFor(html, 'prop-a')).toContain('checked');
  expect(boxFor(html, 'prop-b')).toContain('checked');
  expect(boxFor(html, 'prop-c')).not.toContain('checked');
  expect(html).toContain('unticked to start: your record leans against it');
  // An approval has no field for a comment, so the sheet offers none.
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('type="text"');
});

test('one waiting draft is not a queue', () => {
  seed({ proposals: demoProposals() });
  const html = render();
  expect(html).not.toContain('gov-queue');
  expect(html).not.toContain('and sign');
});

test('the demo decides its queue locally, each draft on its own', async () => {
  seed({ demo: true, proposals: [draft('prop-a'), draft('prop-b'), draft('prop-c')] });
  const result = await useAmbitStore.getState().decideQueue('approve', ['prop-a', 'prop-c']);

  expect(result.results).toEqual([
    { id: 'prop-a', decided: true },
    { id: 'prop-c', decided: true },
  ]);
  const status = new Map(useAmbitStore.getState().proposals.map(p => [p.id, p.status]));
  expect(status.get('prop-a')).toBe('approved');
  expect(status.get('prop-b')).toBe('draft');
  expect(status.get('prop-c')).toBe('approved');
});
