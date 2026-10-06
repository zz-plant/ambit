/**
 * The Tokens figure on Time & cost: what sessions used, per model, with cache
 * reads apart, written the way a person reads a count. It is drawn only when
 * something was recorded, and says where the counts came from and that no
 * price was applied.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { useAmbitStore } from '../store/ambitStore';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => seed({ loop: null, loopSource: null, loopEmpty: false }));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the figure gives the total, and each model split into input, cache reads and output', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).toContain('Tokens');
  expect(said).toContain('46 sessions, last 30 days · counts from transcripts, no price stated');
  expect(said).toContain('45.6M tokens');
  // Two models, so each bar is named; compact counts, never nine digits.
  expect(said).toContain('claude-sonnet-5-5');
  expect(said).toContain('41.3M cache reads');
  expect(said).toContain('655K output');
  expect(said).not.toContain('41300000');
  // A model with no cache reads draws no empty segment for them.
  expect(said).toContain('910K input');
});

test('with nothing recorded there is no figure, not a row of zeroes', () => {
  seed({ loop: { ...demoSnapshot(), tokens: undefined }, loopSource: 'sample', loopEmpty: false });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).not.toContain('counts from transcripts');
});
