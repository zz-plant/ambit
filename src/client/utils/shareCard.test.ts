/**
 * The image a phone posts. It has to say what the banner says, draw only what
 * that sentence is about, and carry the address the image came from.
 */
import { expect, test } from 'vitest';
import { outageSplit, simulationSentence } from '../components/civ/layout';
import { demoTreeGraph } from '../store/demo';
import { buildCard, CARD_H, CARD_W, cardFileName, cardSvg } from './shareCard';
import { SITE_HOST } from './copy';

const { items, connections } = demoTreeGraph();
const none = { mode: 'none', rootId: null, cascade: new Set<string>() };

test('an outage card counts what stops the way the banner does', () => {
  const { stops, weakened } = outageSplit(items, connections, 'combo:tool-protocol');
  const card = buildCard(items, connections, {
    mode: 'outage',
    rootId: 'combo:tool-protocol',
    cascade: stops,
    weakened,
  })!;
  const banner = simulationSentence('outage', 'Tool Protocol', stops, weakened, items);
  expect(banner).toContain(`${card.count} `);
  expect(banner.endsWith(card.sentence)).toBe(true);
  expect(card.kicker).toBe('If Tool Protocol went down');
});

test('it draws the lit nodes and only the edges between them', () => {
  const { stops, weakened } = outageSplit(items, connections, 'combo:tool-protocol');
  const card = buildCard(items, connections, {
    mode: 'outage',
    rootId: 'combo:tool-protocol',
    cascade: stops,
    weakened,
  })!;
  const lit = new Set(['combo:tool-protocol', ...stops, ...weakened]);
  expect(card.nodes.every(n => lit.has(n.id))).toBe(true);
  expect(card.nodes.filter(n => n.tone === 'root').map(n => n.id)).toEqual(['combo:tool-protocol']);
  const drawn = new Set(card.nodes.map(n => n.id));
  expect(card.edges.every(e => drawn.has(e.from) && drawn.has(e.to))).toBe(true);
});

test('with nothing simulated it plays out the next step, and the loss only when there is none', () => {
  const card = buildCard(items, connections, none);
  expect(card).not.toBeNull();
  expect(card!.nodes.length).toBeGreaterThan(0);
  // Widening is what the product is for; the loss is the guardrail.
  expect(card!.mode).toBe('acquisition');
  expect(card!.kicker).toMatch(/^Adding /);
});

test('the SVG is the portrait size, escapes names, and carries the address', () => {
  const card = buildCard(items, connections, none)!;
  const svg = cardSvg({ ...card, kicker: 'If <A & B> went down' });
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain(`width="${CARD_W}" height="${CARD_H}"`);
  expect(svg).toContain('IF &lt;A &amp; B&gt; WENT DOWN');
  expect(svg).toContain(SITE_HOST);
  expect(cardFileName(card)).toMatch(/^ambit-[a-z0-9-]+\.png$/);
});

test('an empty graph has no card', () => {
  expect(buildCard([], [], none)).toBeNull();
});

test('a number stays on the line with its noun', () => {
  const card = buildCard(items, connections, none)!;
  const svg = cardSvg({
    ...card,
    count: 4,
    sentence:
      'capabilities would stop working. 1 not set up yet would be cut off, and 1 was already failing.',
  });
  expect(svg).not.toMatch(/ \d<\/text>/);
  expect(svg).toContain('1\u00a0not');
});

test('a node that was already failing is labelled on the image, which has no legend', () => {
  const { stops, weakened } = outageSplit(items, connections, 'combo:tool-protocol');
  const card = buildCard(items, connections, {
    mode: 'outage',
    rootId: 'combo:tool-protocol',
    cascade: stops,
    weakened,
  })!;
  const failing = card.nodes.filter(n => n.tone === 'failing');
  expect(failing.length).toBeGreaterThan(0);
  const svg = cardSvg(card);
  expect(svg.match(/CHECK FAILING/g)).toHaveLength(failing.length);
  expect(svg.match(/fill="url\(#hazard\)"/g)).toHaveLength(failing.length);
});
