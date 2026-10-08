/**
 * The council on the Time & cost page: five seats on one step, and the verdict
 * line that says when they disagree. The sample's seats are split on purpose,
 * the frontier for Embeddings and fragility against it, so the panel's one job
 * is to show both and name them. A seat with nothing to read is drawn as
 * silent, with its sentence and no stance chip pretending otherwise.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { LoopCouncil } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';

/** `renderToStaticMarkup` reads zustand's initial state, so both halves are set. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({ loop: null, loopSource: null, loopEmpty: false });
});

/** The page with this council, as the ledger served it. */
function page(council: LoopCouncil) {
  seed({ loop: { ...demoSnapshot(), council }, loopSource: 'ledger', loopEmpty: false });
  return renderToStaticMarkup(<LoopDashboard />);
}

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

test('the sample is split, and the panel names who is for it and who against', () => {
  const html = page(demoSnapshot().council);
  const words = text(html);

  expect(words).toContain('The council');
  expect(words).toContain('on Embeddings, the first step to reach');
  expect(words).toContain('Split. Science and Treasury for, Defence against.');
  for (const seat of ['Science', 'Defence', 'Treasury', 'Justice', 'Interior']) {
    expect(words).toContain(seat);
  }
  // Each seat's command is offered to copy and never run.
  expect(html).toContain('title="ambit propose embeddings"');
  expect(html).toContain('title="ambit impact combo:hosted-inference"');
  expect(html).not.toContain('Nothing to read');
});

test('a silent seat says what it has not got, and no seat is for nothing', () => {
  const council: LoopCouncil = {
    motion: null,
    split: false,
    advisors: [
      {
        seat: 'science',
        reads: 'the frontier',
        says: 'Nothing is one step away: every capability the model knows is reached.',
        stance: 'silent',
      },
      {
        seat: 'treasury',
        reads: 'the ledger',
        says: 'No interventions recorded in the last 30 days, so nothing is priced.',
        stance: 'silent',
      },
    ],
  };
  const html = page(council);
  const words = text(html);

  expect(words).toContain('there is no next step');
  expect(words).not.toContain('Split.');
  expect(words).not.toContain('No seat is against it');
  expect(html).toContain('council-seat is-silent');
  expect(words).toContain('Silent');
  expect(words).not.toContain('For ');
});

test('a council with no seats draws nothing', () => {
  const html = page({ motion: null, advisors: [], split: false });
  expect(text(html)).not.toContain('The council');
});
