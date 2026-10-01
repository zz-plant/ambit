/**
 * The front door opens on what the product is for, and one thing to watch.
 *
 * The landing used to open on the product's name, then on an outage, which
 * sold the guardrail as the product. It now opens on what you and your agents
 * can do and what one more step would open, defines the word *ambit* where a
 * visitor first meets it, shows one number from the sample setup with a
 * button that plays it, and offers a place to paste a config. These pin that:
 * if the number stops being the one the demo draws, or the paste box goes, the
 * first screen is a pitch again.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { mergeGraphs } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import { mapFindings } from './civ/layout';
import WelcomeScreen from './WelcomeScreen';

const html = renderToStaticMarkup(<WelcomeScreen onExploreDemo={() => {}} onViewLoop={() => {}} />);

test('the headline asks what you can do and what one step would open, and the word is defined', () => {
  expect(html).toMatch(/<h1[^>]*>What can you and your agents do/);
  // Breakage is in the lede, after reach, as the half that makes widening safe.
  expect(html).not.toMatch(/<h1[^>]*>[^<]*break/i);
  expect(html).toContain('That reach is your <em>ambit</em>');
  expect(html.indexOf('next step would open')).toBeLessThan(html.indexOf('stops if a piece goes'));
});

test("the one number on the page is what the demo's best next step would open", () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const { best } = mapFindings(items, connections);
  expect(best?.reaches).toBeGreaterThan(0);
  expect(best?.item.status).not.toBe('built');
  expect(html).toContain(`<span class="app-welcome-fact-figure">${best?.reaches}</span>`);
  expect(html).toContain(best!.item.name);
  expect(html).toContain('Watch it open');
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
  expect(html.indexOf('Watch it open')).toBeLessThan(html.indexOf('Paste an agent config'));
});

test('a convinced visitor finds the install line and the docs without leaving for GitHub', () => {
  expect(html).toContain('npx ambit-cli');
  expect(html).toMatch(/href="[^"]*docs\/guide\/"/);
  expect(html).toMatch(/href="[^"]*docs\/faq\/"/);
});
