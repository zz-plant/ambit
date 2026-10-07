/**
 * The Tokens figure on Time & cost: what sessions used, per model, with cache
 * reads apart, written the way a person reads a count. It is drawn only when
 * something was recorded, and says where the counts came from and what they
 * cost where a price was declared, and undeclared, never $0, where none was.
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
  expect(said).toContain(
    '46 sessions, last 30 days · counts from Claude Code (38), OpenCode (8) session logs, $29.66 at declared prices'
  );
  expect(said).toContain('45.6M tokens');
  // Two models, so each bar is named, with what it cost or that it has no price.
  expect(said).toContain('claude-sonnet-5-5 · Claude Code · $29.66 at the declared price');
  expect(said).toContain('qwen3-coder · OpenCode · price undeclared');
  // Compact counts, never nine digits.
  expect(said).toContain('41.3M cache reads');
  expect(said).toContain('655K output');
  expect(said).not.toContain('41300000');
  // A model with no cache reads draws no empty segment for them.
  expect(said).toContain('910K input');
});

test('with nothing recorded there is no figure, not a row of zeroes', () => {
  seed({ loop: { ...demoSnapshot(), tokens: undefined }, loopSource: 'sample', loopEmpty: false });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).not.toContain('session logs');
});

test('with no price declared the figure says so, and draws no dollar figure', () => {
  const sample = demoSnapshot();
  const models = sample.tokens?.models.map(m => ({
    ...m,
    spend_dollars: undefined,
    unpriced: true as const,
  }));
  seed({
    loop: { ...sample, tokens: sample.tokens && { ...sample.tokens, models: models ?? [] } },
    loopSource: 'sample',
    loopEmpty: false,
  });
  const html = renderToStaticMarkup(<LoopDashboard />);
  const figure = text(
    html.slice(html.indexOf('Tokens'), html.indexOf('</figure>', html.indexOf('Tokens')))
  );
  expect(figure).toContain('session logs, no price declared');
  expect(figure).not.toContain('$');
  expect(figure).not.toContain('price undeclared');
});

test('one model priced for only part of its sessions says the rest have none', () => {
  const sample = demoSnapshot();
  const [hosted] = sample.tokens?.models ?? [];
  seed({
    loop: {
      ...sample,
      tokens: sample.tokens && { ...sample.tokens, models: [{ ...hosted, unpriced: true }] },
    },
    loopSource: 'sample',
    loopEmpty: false,
  });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).toContain('$29.66 at the declared price; some tokens have none');
});

test('one runtime is named once, and reasoning counted apart gets its own segment', () => {
  seed({
    loop: {
      ...demoSnapshot(),
      tokens: {
        days: 30,
        sessions: 3,
        runtimes: [{ runtime: 'OpenCode', sessions: 3 }],
        models: [
          {
            model: 'anthropic/claude-sonnet-5-5',
            input: 1_200,
            cached: 30_000,
            output: 800,
            reasoning: 400,
            runtimes: ['OpenCode'],
            unpriced: true,
          },
        ],
      },
    },
    loopSource: 'sample',
    loopEmpty: false,
  });
  const said = text(renderToStaticMarkup(<LoopDashboard />));
  expect(said).toContain('3 sessions, last 30 days · counts from OpenCode session logs');
  expect(said).toContain('32.4K tokens');
  expect(said).toContain('400 reasoning');
  // One runtime: the caption names it, so no model's line repeats it.
  expect(said).not.toContain('OpenCode ·');
});
