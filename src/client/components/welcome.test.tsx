/**
 * The front door opens on a question, and one thing to watch.
 *
 * The landing used to open on the product's name, a sentence about joint
 * capability and two charts of example data a visitor had to read a caption
 * to understand. It now opens on the afternoon everyone has had, one number
 * from the sample setup with a button that shows it happening, and a place to
 * paste a config. These pin that: if the number stops being the one the demo
 * draws, or the paste box goes, the first screen is a pitch again.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { mergeGraphs } from '../store/ambitStore';
import { coldOpen, demoConfigGraph, demoTreeGraph } from '../store/demo';
import WelcomeScreen from './WelcomeScreen';

const html = renderToStaticMarkup(<WelcomeScreen onExploreDemo={() => {}} onViewLoop={() => {}} />);

test('the headline is a question the visitor already has, not the product name', () => {
  expect(html).toMatch(/<h1[^>]*>When one piece of your agent setup breaks/);
});

test('the one number on the page is what stops in the demo, counting only what worked', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const cold = coldOpen(items, connections);
  // The first choice cut off twelve things and none had been reached; a
  // headline number of things that "stopped" has to be things that ran.
  expect(cold?.stopped.length).toBeGreaterThanOrEqual(3);
  for (const item of cold?.stopped ?? []) {
    expect(item.status).toBe('built');
    expect(['degraded', 'broken']).not.toContain(item.meta?.lifecycle);
  }
  expect(html).toContain(`<span class="app-welcome-fact-figure">${cold?.stopped.length}</span>`);
  expect(html).toContain('Watch it happen');
});

test('the landing offers to map a config by pasting it, with nothing installed', () => {
  // The files live in hidden directories a picker does not show, so the paste
  // box comes first and the paths are one click away.
  expect(html).toContain('Paste an agent config');
  expect(html).toContain('Where is mine?');
  expect(html).toContain('~/.cursor/mcp.json');
  expect(html).toContain('never uploaded');
});

test('the landing names the runtimes it reads, so a visitor can tell it reads theirs', () => {
  for (const runtime of ['Claude Code', 'Cursor', 'OpenCode', 'Codex CLI']) {
    expect(html).toContain(runtime);
  }
});

test('the demo comes before the paste box, so a phone shows it on its first screen', () => {
  expect(html.indexOf('Watch it happen')).toBeLessThan(html.indexOf('Paste an agent config'));
});

test('a convinced visitor finds the install line and the docs without leaving for GitHub', () => {
  expect(html).toContain('brew install zz-plant/tap/ambit');
  expect(html).toMatch(/href="[^"]*docs\/guide\/"/);
  expect(html).toMatch(/href="[^"]*docs\/faq\/"/);
});
