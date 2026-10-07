/**
 * The published docs: every internal link lands on a page that exists, at an
 * anchor that exists, and the sitemap lists exactly the pages that are built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { readLinkState } from '../src/client/linkState.ts';
import {
  BASE,
  ORIGIN,
  PAGES,
  buildDocs,
  faqEntries,
  pagePath,
  rewriteHref,
  slugger,
} from './build-docs.ts';

const out = mkdtempSync(join(tmpdir(), 'ambit-docs-'));
buildDocs(out);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const html = (p: string) => readFileSync(join(out, p.replace(BASE, ''), 'index.html'), 'utf8');

test('heading anchors follow the rule GitHub uses, repeats numbered', () => {
  const slug = slugger();
  expect(slug('I use Jev. Where does it fit?')).toBe('i-use-jev-where-does-it-fit');
  expect(slug('`ambit share` — what may leave the graph, and what may not')).toBe(
    'ambit-share--what-may-leave-the-graph-and-what-may-not'
  );
  expect(slug('5. Goal → capability delta — partly built')).toBe(
    '5-goal--capability-delta--partly-built'
  );
  expect(slug('Claude Code')).toBe('claude-code');
  expect(slug('Claude Code')).toBe('claude-code-1');
});

test('a link becomes a page, a copied image, or the file on GitHub', () => {
  expect(rewriteHref('./faq.md#i-use-jev-where-does-it-fit', 'docs/jev.md')).toBe(
    '/ambit/docs/faq/#i-use-jev-where-does-it-fit'
  );
  expect(rewriteHref('../README.md', 'docs/faq.md')).toBe('/ambit/docs/guide/');
  expect(rewriteHref('./docs/', 'README.md')).toBe('/ambit/docs/');
  expect(rewriteHref('docs/assets/screenshot-tree.png', 'README.md')).toBe(
    '/ambit/docs/assets/screenshot-tree.png'
  );
  expect(rewriteHref('./AGENTS.md#rules', 'README.md')).toBe(
    'https://github.com/zz-plant/ambit/blob/main/AGENTS.md#rules'
  );
  expect(rewriteHref('https://ethotechnics.org', 'README.md')).toBe('https://ethotechnics.org');
  expect(rewriteHref('#get-started', 'README.md')).toBe('#get-started');
});

test('every internal link resolves to a built page and an anchor on it', () => {
  const ids = new Map(
    PAGES.map(p => [
      pagePath(p),
      new Set([...html(pagePath(p)).matchAll(/ id="([^"]+)"/g)].map(m => m[1])),
    ])
  );
  const broken: string[] = [];
  for (const p of PAGES) {
    const page = pagePath(p);
    for (const [, href] of html(page).matchAll(/ (?:href|src)="([^"]+)"/g)) {
      const link = href.replace(/&amp;/g, '&');
      if (/^https?:/.test(link) || link === BASE) continue;
      // A link into the demo is to the app, and holds if the app reads every
      // parameter it carries: a tour step it does not know opens the tour's
      // first card, which is the mismatch the link was written to avoid.
      if (link.startsWith(`${BASE}?`)) {
        const query = link.slice(BASE.length);
        const state = readLinkState(query);
        if (!state.demo || (new URLSearchParams(query).has('tour') && !state.tour))
          broken.push(`${page}: ${link}`);
        continue;
      }
      const [path, anchor] = link.split('#');
      const target = path || page;
      // The site's own root files, such as the favicon, are Vite's public
      // directory and not this build's output.
      if (!target.endsWith('/') && !target.includes('/docs/')) {
        if (!existsSync(join('src/client/public', target.replace(BASE, ''))))
          broken.push(`${page}: ${link}`);
        continue;
      }
      if (target.startsWith(`${BASE}docs/assets/`)) {
        if (!existsSync(join(out, target.replace(BASE, '')))) broken.push(`${page}: ${link}`);
        continue;
      }
      if (!target.startsWith(BASE) || !target.endsWith('/') || !ids.has(target)) {
        broken.push(`${page}: ${link}`);
        continue;
      }
      if (anchor && !ids.get(target)?.has(anchor)) broken.push(`${page}: ${link}`);
    }
  }
  expect(broken).toEqual([]);
});

test('each page carries its own title, description and canonical URL', () => {
  for (const p of PAGES) {
    const page = html(pagePath(p));
    expect(p.description.length, p.src).toBeLessThanOrEqual(160);
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}${pagePath(p)}" />`);
    expect(page).toMatch(/<title>[^<]+<\/title>/);
  }
});

test('the sitemap lists the home page and the built pages, each its own canonical', () => {
  const locs = [
    ...readFileSync(join(out, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g),
  ].map(m => m[1]);
  expect(locs).toEqual([ORIGIN + BASE, ...PAGES.map(p => ORIGIN + pagePath(p))]);
  expect(locs.some(l => l.includes('?'))).toBe(false);
});

/** The page's structured data, as the one graph it is written as. */
const graphOf = (path: string) =>
  JSON.parse(html(path).match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1])[
    '@graph'
  ] as Array<Record<string, any>>;

test('the FAQ is marked up as questions and answers, read from the page it renders', () => {
  const faq = PAGES.find(p => p.slug === 'faq')!;
  const data = graphOf(pagePath(faq)).find(n => n['@type'] === 'FAQPage')!;
  const md = readFileSync(join(import.meta.dirname, '..', faq.src), 'utf8');
  const asked = md.split('\n').filter(l => l.startsWith('### '));
  expect(data.mainEntity).toHaveLength(asked.length);
  expect(faqEntries(md).every(e => e.q.length > 0 && e.a.length > 20)).toBe(true);
  // Markdown syntax is gone from what a search engine would show.
  expect(JSON.stringify(data)).not.toMatch(/\]\(|`/);
});

test('the glossary defines every concept the app does, and every page says where it sits', () => {
  const glossary = PAGES.find(p => p.slug === 'glossary')!;
  const terms = graphOf(pagePath(glossary)).find(n => n['@type'] === 'DefinedTermSet')!;
  const concepts = JSON.parse(readFileSync(join(import.meta.dirname, '..', glossary.src), 'utf8'))
    .concepts as Array<{ key: string }>;
  expect(terms.hasDefinedTerm).toHaveLength(concepts.length);
  for (const c of concepts) expect(html(pagePath(glossary))).toContain(`id="${c.key}"`);
  for (const p of PAGES) {
    const crumbs = graphOf(pagePath(p)).find(n => n['@type'] === 'BreadcrumbList')!;
    expect(crumbs.itemListElement.at(-1).item, p.src).toBe(ORIGIN + pagePath(p));
  }
});

test('a page reached by a search question says what Ambit does about it before the answer', () => {
  const pitched = PAGES.filter(p => p.pitch);
  expect(pitched.map(p => p.slug)).toEqual([
    'mcp-config-locations',
    'mcp-outage',
    'audit-mcp-servers',
  ]);
  for (const p of pitched) {
    const page = html(pagePath(p));
    const box = page.indexOf('<aside class="pitch"');
    expect(box, p.slug).toBeGreaterThan(page.indexOf('<h1'));
    // Before the first section, so it is on the first screen, after the
    // paragraph that answers the question the reader typed.
    expect(box, p.slug).toBeLessThan(page.indexOf('<h2'));
    expect(page.slice(box), p.slug).toContain(`href="${BASE}?demo=1&amp;tour=`);
  }
});

test('every page ends on the way to try it, except the one written for contributors', () => {
  for (const p of PAGES) {
    const page = html(pagePath(p));
    const card = page.indexOf('<section class="try"');
    if (p.slug === 'contributing') {
      expect(card).toBe(-1);
      continue;
    }
    expect(card, p.slug).toBeGreaterThan(0);
    expect(page.slice(card), p.slug).toContain('npx ambit-cli');
  }
  expect(existsSync(join(out, 'docs/assets/screenshot-tree.png'))).toBe(true);
});
