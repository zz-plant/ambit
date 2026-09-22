/**
 * The published docs: every internal link lands on a page that exists, at an
 * anchor that exists, and the sitemap lists exactly the pages that are built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { BASE, ORIGIN, PAGES, buildDocs, pagePath, rewriteHref, slugger } from './build-docs.ts';

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
      if (/^https?:/.test(link) || link === `${BASE}?demo=1` || link === BASE) continue;
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
