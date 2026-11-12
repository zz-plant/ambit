/**
 * A proposal read as a plan before it is approved.
 *
 * The panel said whether a proposal could be undone and never which step was
 * the reason: the step type dropped the stored inverse. And it said
 * "reversible" for a draft `ambit apply` refuses, because apply also wants a
 * config patch per step, and the control plane's drafts carry an inverse and
 * no patch. These hold the tally, the marks, the two facts, and the demo's
 * hand-written rows agreeing with what they claim.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { ProposalDecision, ProposalRow } from '../../shared/api';
import { demoProposals } from '../store/demo';
import ApprovalModal from './ApprovalModal';
import { seed } from '../testing/page';

afterEach(() => seed({ proposals: [] }));

const render = () => renderToStaticMarkup(<ApprovalModal isOpen onClose={() => {}} />);
const text = (html: string) => html.replace(/<[^>]+>/g, '');

/** The markup of one step, found by the name it shows. */
const stepNamed = (html: string, name: string) =>
  html.split('class="gov-step"').find(part => part.startsWith(`><code>${name}</code>`)) ?? '';

const decision = (d: Partial<ProposalDecision>): ProposalDecision => ({
  setup_hours: 0.5,
  reversible: true,
  applicable: true,
  requires_person: false,
  forecast: null,
  unlocks: [],
  precedent: [],
  ...d,
});

const row = (p: Partial<ProposalRow> & Pick<ProposalRow, 'id' | 'steps'>): ProposalRow => ({
  goal: 'reach something',
  status: 'draft',
  created_at: '2026-09-28 10:00:00',
  ...p,
});

test('a step with no inverse is marked, and the Revert row says the plan has no way back', () => {
  seed({
    proposals: [
      row({
        id: 'prop-mixed',
        steps: JSON.stringify([
          { id: 'combo:a', name: 'A', config_patch: { mcp: { a: {} } }, inverse: { remove: [] } },
          { id: 'combo:c', name: 'C', inverse: null },
        ]),
        decision: decision({ reversible: false, applicable: false }),
      }),
    ],
  });
  const html = render();

  expect(text(html)).toContain('2 steps · 30m of setup');
  expect(text(html)).toContain('Ambit cannot undo it: one step has no known way back');
  expect(html.match(/gov-step-mark/g)).toHaveLength(1);
  expect(stepNamed(html, 'C')).toContain('cannot be undone');
  expect(stepNamed(html, 'A')).not.toContain('cannot be undone');
});

test('reversible and not a config change says apply refuses it, and offers no apply command', () => {
  // The control plane's shape: every step undoable, none a config patch.
  seed({
    proposals: [
      row({
        id: 'prop-remediate-1',
        status: 'approved',
        approved_by: 'human:web',
        steps: JSON.stringify([{ id: 'combo:deploy', name: 'Deploy', inverse: { remove: [] } }]),
        decision: decision({ reversible: true, applicable: false }),
      }),
    ],
  });
  const plain = text(render());

  expect(plain).toContain('every step can be undone');
  expect(plain).toContain('ambit apply will not run it: a step is not a config change');
  expect(plain).not.toContain('Copy: ambit apply');
});

test('a plan apply can run keeps the command to run it', () => {
  seed({ proposals: demoProposals().filter(p => p.status === 'approved') });
  const plain = text(render());

  expect(plain).toContain('1 step · 30m of setup');
  expect(plain).toContain('ambit apply can make every change');
  expect(plain).toContain('Copy: ambit apply prop-offline-semantic-search');
});

test("the demo's proposals agree with their marks", () => {
  // They claimed reversible over steps that carried no inverse.
  const demo = demoProposals();
  let withoutInverse = 0;
  for (const p of demo) {
    const steps = JSON.parse(p.steps) as Record<string, unknown>[];
    withoutInverse += steps.filter(s => !s.inverse).length;
    expect(p.decision?.reversible, p.id).toBe(steps.every(s => Boolean(s.inverse)));
    expect(p.decision?.applicable, p.id).toBe(
      steps.every(s => Boolean(s.inverse) && Boolean(s.config_patch))
    );
    expect(p.decision?.requires_person, p.id).toBe(steps.some(s => Boolean(s.requires_person)));
  }

  seed({ proposals: demo });
  const html = render();
  expect(html.match(/gov-step-mark/g) ?? []).toHaveLength(withoutInverse);
  expect(text(html)).toContain('3 steps · 30m of setup');
  expect(text(html)).toContain('Ambit cannot undo it: a person does one of the steps');
});

test('the forecast is the hours before and after, and the button names its proposal', () => {
  seed({ proposals: demoProposals() });
  const html = render();

  expect(text(html)).toContain('0.7h a month now, 0.1h after · saves $150 a month');
  expect(html).toContain('aria-label="Approve this proposal, prop-deploy-staging-42"');
  expect(text(html)).toContain('Approve this proposal');
});
