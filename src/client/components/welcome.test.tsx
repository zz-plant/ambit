/**
 * The front door shows measurements, not a cartoon.
 *
 * The landing used to draw four labelled circles for a product whose claim is
 * that it measures things. It now draws the two measurements the demo makes,
 * from the same example data the demo runs on, and says so. This pins that: if
 * the figures stop rendering, or the disclosure goes, the first screen is a
 * pitch again.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import WelcomeScreen from './WelcomeScreen';

const html = renderToStaticMarkup(<WelcomeScreen onExploreDemo={() => {}} onViewLoop={() => {}} />);

test('the landing draws the year of hours with its acquisitions named', () => {
  expect(html).toContain('Hours a person spent stepping in');
  expect(html).toContain('Apr · Automated Tests');
  expect(html).toContain('Oct · Scheduled Work');
});

test('the landing draws one bar per era on a shared scale, with the fraction beside it', () => {
  expect(html).toContain('How much of each era is reached');
  const bars = html.match(/class="fig-eras-track"/g) || [];
  expect(bars.length).toBe(7);
  expect(html).toMatch(/of 35 on the tree/);
});

test('both figures are labelled as example data', () => {
  expect(html).toContain('Both figures are example data');
});

test('the landing offers to map a config with nothing installed', () => {
  // `loadFromJSON` sat in the store with no drop target and no picker, so the
  // answer to "what does this look like for my setup" was "clone the repo".
  expect(html).toContain('Map your own config');
  expect(html).toContain('never uploaded');
});

test('the landing names the runtimes it reads, so a visitor can tell it reads theirs', () => {
  // The tagline says what Ambit is for and names no tool. A visitor deciding
  // whether to stay is asking whether it reads the one they use.
  for (const runtime of ['Claude Code', 'Cursor', 'OpenCode', 'Codex CLI']) {
    expect(html).toContain(runtime);
  }
});

test('the ways in come before the figures, so a phone shows one on its first screen', () => {
  // Below two charts, the demo button sat under the fold at phone width.
  expect(html.indexOf('Open the demo')).toBeGreaterThan(-1);
  expect(html.indexOf('Open the demo')).toBeLessThan(html.indexOf('app-welcome-figures'));
});

test('a convinced visitor finds the install line and the docs without leaving for GitHub', () => {
  expect(html).toContain('brew install zz-plant/tap/ambit');
  expect(html).toMatch(/href="[^"]*docs\/guide\/"/);
  expect(html).toMatch(/href="[^"]*docs\/faq\/"/);
});
