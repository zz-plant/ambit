/**
 * The whole map as a file. It has to hold every node and edge of the tree
 * whatever the page was showing, stand alone (no custom property left for a
 * stylesheet it does not carry, the faces inside it), and carry what the map
 * draws and nothing a person would not want to travel: no address, no path,
 * no command, no description, no name of a person.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { columnLabel, outageSplit, visibleItems, wrapLabel } from '../components/civ/layout';
import { MapStill, stillLayout } from '../components/civ/MapScene';
import { embeddedFontCss, FACES } from '../fonts';
import { mergeGraphs } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import type { Item } from './configImporter';
import { SITE_HOST } from './copy';
import { mapFileName, pngScale, resolveVars, standalone } from './saveImage';
import type { Showing } from './shareCard';

/** The page's `:root` tokens, read from the stylesheet the page loads. */
const ROOT = (() => {
  const css = readFileSync(join(import.meta.dirname, '../App.css'), 'utf8');
  const start = css.indexOf(':root {');
  const block = css.slice(start, css.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
})();
const token = (name: string) => ROOT.get(name);

const merged = mergeGraphs(demoTreeGraph(), demoConfigGraph());
// A person and a description the graph knows and the map never draws.
const items: Item[] = merged.items.map(i =>
  i.id === 'combo:tool-protocol'
    ? {
        ...i,
        description: 'Reads ~/work/secrets.env through https://internal.example',
        meta: { ...i.meta, structure: ['institutional'], people: ['Dana Q. Reviewer'] },
      }
    : i
);
const { connections } = merged;
const resting: Showing = { mode: 'none', rootId: null, cascade: new Set() };

const fakeFonts = async () => {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3])));
  return embeddedFontCss(FACES.filter(f => f.family !== 'Monaspace Neon'));
};
afterEach(() => vi.unstubAllGlobals());

const save = (showing = resting, fonts = '', scale = 1) => {
  const layout = stillLayout(items, connections);
  const markup = renderToStaticMarkup(
    <MapStill
      items={items}
      connections={connections}
      layout={layout}
      simulation={showing}
      scale={scale}
    />
  );
  return { svg: standalone(markup, token, fonts), layout };
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('every node of the tree and every edge between two of them is in the file', () => {
  const { svg, layout } = save();
  const drawn = visibleItems(items);
  expect(drawn.length).toBeGreaterThan(30);
  // A name is the lines of its label, as the page wraps it.
  const names = [...svg.matchAll(/<text[^>]*>((?:<tspan[^>]*>[^<]*<\/tspan>)+)<\/text>/g)].map(m =>
    [...m[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(t => t[1]).join('')
  );
  expect(names.sort()).toEqual(drawn.map(i => wrapLabel(i.name).map(esc).join(' ')).sort());
  // One circle of the node's own radius a node: badges and marks are smaller.
  expect(svg.match(/<circle r="22"/g)?.length).toBe(drawn.length);
  const ids = new Set(drawn.map(i => i.id));
  const edges = connections.filter(c => ids.has(c.from) && ids.has(c.to));
  expect(edges.length).toBeGreaterThan(20);
  expect(svg.match(/ d="M-?[\d.]+,-?[\d.]+ C/g)?.length).toBe(edges.length);
  // Every era, named in the capitals the page sets it in.
  expect(layout.colOrder.length).toBeGreaterThan(6);
  for (const column of layout.colOrder) {
    expect(svg).toContain(`>${esc(columnLabel(column, layout.cols[column]).toUpperCase())}<`);
  }
  expect(svg).toMatch(
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/
  );
});

test('it stands alone: no custom property is left, and the faces are inside it', async () => {
  const fonts = await fakeFonts();
  const { svg } = save(resting, fonts);
  expect(svg).not.toContain('var(--');
  expect(svg).toContain("<defs><style>@font-face{font-family:'Hubot Sans'");
  expect(svg).toContain("@font-face{font-family:'Mona Sans'");
  expect(svg).not.toContain('Monaspace');
  // The colours are the page's, written out.
  expect(svg).toContain(`fill="${token('--node-reached')}"`);
  expect(svg).toContain(`stroke="${token('--accent')}"`);
  // The text face for names, the readout face for the era heads.
  expect(svg).toContain(`font-family="${esc(token('--font-sans')!)}"`);
  expect(svg).toContain(`font-family="${esc(token('--font-display')!)}"`);
  expect(svg).toContain('font-stretch:87.5%');
});

test('it carries what the map draws and nothing else: no address, path, command or person', () => {
  const { svg } = save();
  const body = svg.replace(' xmlns="http://www.w3.org/2000/svg"', '');
  expect(body).not.toMatch(/https?:|:\/\/|www\.|~\/|\/Users|\.env|ambit /);
  expect(body).not.toContain(SITE_HOST);
  expect(body).not.toContain('Dana Q. Reviewer');
  expect(body).not.toContain('secrets');
  // Nothing to press, focus or hover: a file, not the page.
  expect(body).not.toMatch(/role=|tabindex|aria-|data-node|class=/);
  expect(body.match(/<title>/g)?.length).toBe(1);
  // The person mark is drawn; who it is stays on the page.
  expect(body).toContain('M-3 3.2 C-3 0.6 3 0.6 3 3.2 Z');
});

test('a running simulation is drawn as the page draws it', () => {
  const root = 'combo:tool-protocol';
  const { stops, weakened } = outageSplit(items, connections, root);
  const { svg } = save({ mode: 'outage', rootId: root, cascade: stops, weakened });
  expect(svg).toMatch(/>DOWN · STOPS \d+</);
  expect(svg).toContain(`fill="${token('--error-deep')}"`);
  expect(svg).not.toContain('var(--');
});

test('a PNG is drawn at twice the size, from the same coordinates', () => {
  const { svg, layout } = save(resting, '', 2);
  expect(svg).toContain(
    `width="${layout.width * 2}" height="${layout.height * 2}" viewBox="0 0 ${layout.width} ${layout.height}"`
  );
  expect(pngScale(layout.width, layout.height)).toBe(2);
  // A drawing too large for a canvas at twice its size is made smaller, never refused.
  const scale = pngScale(4000, 6000);
  expect(scale).toBeLessThan(2);
  expect(4000 * scale * 6000 * scale).toBeLessThanOrEqual(16_777_216);
  expect(pngScale(20_000, 100) * 20_000).toBeLessThanOrEqual(16_384);
});

test('a var() resolves through fallbacks and nesting, and a cycle ends', () => {
  const look = (n: string) =>
    ({ '--a': 'var(--b)', '--b': '#123', '--loop': 'var(--loop)' })[n] as string | undefined;
  expect(resolveVars('fill="var(--a)"', look)).toBe('fill="#123"');
  expect(resolveVars('var(--none, rgba(1, 2, 3, 0.5))', look)).toBe('rgba(1, 2, 3, 0.5)');
  expect(resolveVars('var(--none, var(--a))', look)).toBe('#123');
  expect(resolveVars('var(--loop)', look)).toBe('');
  expect(resolveVars('no tokens', look)).toBe('no tokens');
});

test('the file is named for what it is and the day it was saved', () => {
  const day = new Date(2026, 9, 6, 23, 30);
  expect(mapFileName('svg', day)).toBe('ambit-map-2026-10-06.svg');
  expect(mapFileName('png', day)).toBe('ambit-map-2026-10-06.png');
});
