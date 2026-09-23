#!/usr/bin/env node
/**
 * The documentation, published as pages on the hosted site.
 *
 * The site was one URL: the map, rendered by JavaScript, with about two
 * hundred words on it. Everything a search engine or an agent could quote
 * lived on GitHub, whose pages rank for GitHub. Each document below becomes a
 * static page under /ambit/docs/, with its own title, description and
 * canonical URL, and the sitemap is written from the same list, so a page
 * cannot be published without being listed or listed without being published.
 *
 * Links are rewritten once, on the rendered HTML, so a markdown link and a raw
 * `<img>` in the README take the same path: a published document becomes its
 * page, an image under docs/assets is copied beside the pages, and anything
 * else points at the file on GitHub. Heading ids follow GitHub's rule, so an
 * anchor that works in the repository works here.
 *
 *   node --experimental-strip-types scripts/build-docs.ts [outDir]
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, type Tokens } from 'marked';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGIN = 'https://zz-plant.github.io';
export const BASE = '/ambit/';
const REPO = 'https://github.com/zz-plant/ambit/blob/main/';

export interface Page {
  /** The markdown file, relative to the repository root. */
  src: string;
  /** Where it is published under /ambit/docs/; '' is the docs index. */
  slug: string;
  title: string;
  /** At most about 155 characters, which is what a result snippet shows. */
  description: string;
  /**
   * The line the page's link card leads with, drawn by generate-scenes.ts.
   * Not the title: a title is written for a results page, which already shows
   * the site, and a card is seen in a feed beside nothing, where "Ambit FAQ"
   * says which page it is and not why to open it.
   */
  card: string;
}

export const PAGES: Page[] = [
  {
    src: 'docs/README.md',
    slug: '',
    title: 'Ambit documentation',
    description:
      'Every Ambit document in one place: the guide, the FAQ, the reference, the argument for it, the roadmap, the changelog, and how to contribute.',
    card: 'Every Ambit document, in one place',
  },
  {
    src: 'README.md',
    slug: 'guide',
    title: 'Ambit guide: install, CLI and MCP setup',
    description:
      'Install Ambit, map your AI agent setup, and ask what works, what breaks and what to set up next, from the terminal or over MCP in Claude Code and OpenCode.',
    card: 'Map what your AI agent setup can do, in one command',
  },
  {
    src: 'docs/faq.md',
    slug: 'faq',
    title: 'Ambit FAQ',
    description:
      'Short answers about Ambit: which agent runtimes it reads, what leaves your machine, how an agent changes config, Jev, and why attention reports start empty.',
    card: 'What it reads, and what never leaves your machine',
  },
  {
    src: 'docs/jev.md',
    slug: 'jev',
    title: 'Ambit and Jev: typed judgment on the capability map',
    description:
      "How Ambit maps TypeSafe's Jev and its local clones, proves a local model answers, routes goals through it, and keeps its probabilities off the authority path.",
    card: 'A judgment model on the map, kept off the authority path',
  },
  {
    src: 'docs/deep-dive.md',
    slug: 'deep-dive',
    title: 'Ambit reference: nodes, authority, ledgers and every MCP tool',
    description:
      'The Ambit reference: what a node is, capability versus authority, the frontier and work ledgers, delegation records, and the full CLI and MCP surfaces.',
    card: 'Every node, grant, ledger and MCP tool, explained',
  },
  {
    src: 'docs/why-ambit.md',
    slug: 'why-ambit',
    title: 'Why Ambit: effective agency as a governed object',
    description:
      'Why Ambit exists: agent stacks become capable through composition, and effective agency should be a governed, verified and legible object.',
    card: 'Agents get capable by composition. Who governs that?',
  },
  {
    src: 'docs/affordance-frontier.md',
    slug: 'affordance-frontier',
    title: 'The affordance frontier · Ambit',
    description:
      'The theory under Ambit: the affordance frontier of human-machine systems, and how robots and brain-computer interfaces test it.',
    card: 'What a human-machine system can reach, and what limits it',
  },
  {
    src: 'docs/roadmap.md',
    slug: 'roadmap',
    title: 'Ambit roadmap and design rationale',
    description:
      "Ambit's design rationale, section by section: what each part decided, what is built, and what it still lacks.",
    card: 'What is built, what is missing, and why',
  },
  {
    src: 'SECURITY.md',
    slug: 'security',
    title: 'Ambit security invariants',
    description:
      "Ambit's security invariants: loopback only, an origin allowlist, no config entry created over HTTP, and no network traffic you did not type.",
    card: 'Loopback only, and no traffic you did not type',
  },
  {
    src: 'CONTRIBUTING.md',
    slug: 'contributing',
    title: 'Contributing to Ambit',
    description:
      'How to go from a clone of Ambit to a passing pull request: setup, the checks CI runs, and the contributions worth the most.',
    card: 'From a fresh clone to a merged pull request',
  },
  {
    src: 'CHANGELOG.md',
    slug: 'changelog',
    title: 'Ambit changelog',
    description: 'What changed in each Ambit release and why, newest first.',
    card: 'What changed in each release, and why',
  },
];

/** The page's own link card, rendered by `npm run assets:generate` into the public dir. */
export const cardPath = (p: Page) => `${BASE}og/${p.slug || 'docs'}.png`;

export const pagePath = (p: Page) => `${BASE}docs/${p.slug ? `${p.slug}/` : ''}`;
const bySource = new Map(PAGES.map(p => [p.src, p]));

/**
 * GitHub's heading anchor: lower case, formatting and punctuation dropped,
 * each space a hyphen, repeats numbered. A link text inside a heading counts
 * as its text.
 */
export function slugger() {
  const seen = new Map<string, number>();
  return (heading: string): string => {
    const base = heading
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/ /g, '-');
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

/**
 * Where a link in a published document should point on the site.
 * `assets` collects the images the page uses, so only those are copied.
 */
export function rewriteHref(href: string, from: string, assets?: Set<string>): string {
  if (/^(?:[a-z]+:|#|\/\/)/i.test(href)) return href;
  const [path, anchor] = href.split('#');
  const target = posix.normalize(posix.join(posix.dirname(from), path)).replace(/\/$/, '');
  const hash = anchor ? `#${anchor}` : '';
  const page = bySource.get(target);
  if (page) return pagePath(page) + hash;
  if (target === 'docs') return pagePath(PAGES[0]) + hash;
  if (target.startsWith('docs/assets/')) {
    assets?.add(target);
    return `${BASE}docs/assets/${basename(target)}`;
  }
  return REPO + target + hash;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The markdown of one document as body HTML, with the images it uses. */
export function renderBody(src: string, markdown: string): { html: string; assets: Set<string> } {
  const slug = slugger();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(
        this: { parser: { parseInline(t: Tokens.Generic[]): string } },
        token: Tokens.Heading
      ) {
        const id = slug(token.text);
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
    },
  });
  // GitHub's callouts are a blockquote whose first line names the kind.
  const source = markdown.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gm, (_, k) => {
    return `> **${k[0]}${k.slice(1).toLowerCase()}.**`;
  });
  const assets = new Set<string>();
  const html = (marked.parse(source) as string).replace(
    /\b(href|src)="([^"]*)"/g,
    (_, attr, value) =>
      `${attr}="${escapeHtml(rewriteHref(value.replace(/&amp;/g, '&'), src, assets))}"`
  );
  return { html, assets };
}

const NAV: Array<[string, string]> = [
  ['Live demo', `${BASE}?demo=1`],
  ['Guide', `${BASE}docs/guide/`],
  ['FAQ', `${BASE}docs/faq/`],
  ['Reference', `${BASE}docs/deep-dive/`],
  ['Jev', `${BASE}docs/jev/`],
  ['All docs', `${BASE}docs/`],
  ['GitHub', 'https://github.com/zz-plant/ambit'],
];

/** One published page, whole. System fonts, so nothing blocks the first paint. */
export function renderPage(page: Page, body: string): string {
  const url = ORIGIN + pagePath(page);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: page.title,
    description: page.description,
    url,
    author: { '@type': 'Person', name: 'Kanav Jain' },
    isPartOf: { '@type': 'WebSite', name: 'Ambit', url: ORIGIN + BASE },
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${escapeHtml(page.title)}" />
<meta property="og:description" content="${escapeHtml(page.description)}" />
<meta property="og:image" content="${ORIGIN}${cardPath(page)}" />
<meta property="og:image:width" content="1280" />
<meta property="og:image:height" content="640" />
<meta property="og:image:alt" content="${escapeHtml(page.card)}" />
<meta property="og:site_name" content="Ambit" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(page.title)}" />
<meta name="twitter:description" content="${escapeHtml(page.description)}" />
<meta name="twitter:image" content="${ORIGIN}${cardPath(page)}" />
<meta name="theme-color" content="#090d16" />
<link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{color-scheme:dark;--bg:#090d16;--fg:#e2e8f0;--muted:#94a3b8;--link:#a5b4fc;--line:#1e293b;--code:#111827}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header,main,footer{max-width:820px;margin:0 auto;padding:0 20px}
header{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;padding-top:18px;padding-bottom:14px;border-bottom:1px solid var(--line)}
header a{color:var(--muted);text-decoration:none;font-size:14px}header a:hover{color:var(--fg)}header .brand{color:var(--fg);font-weight:700;font-size:16px;margin-right:auto}
main{padding-top:8px;padding-bottom:48px}a{color:var(--link)}h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .5em}h1{font-size:2em}
.anchor{float:left;margin-left:-1em;padding-right:.25em;color:var(--muted);text-decoration:none;opacity:0}h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
code{font:.88em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.1em .35em;border-radius:4px}
pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto}pre code{padding:0;background:none}
table{border-collapse:collapse;display:block;overflow-x:auto;margin:1em 0}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
img{max-width:100%;height:auto}blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--line);color:var(--muted)}hr{border:0;border-top:1px solid var(--line)}
footer{padding-bottom:32px;color:var(--muted);font-size:14px}
</style>
</head>
<body>
<header><a class="brand" href="${BASE}">Ambit</a>${NAV.map(([t, h]) => `<a href="${h}">${t}</a>`).join('')}</header>
<main>
${body}
</main>
<footer>Ambit is MIT licensed. <a href="${REPO}${page.src}">Edit this page on GitHub</a>.</footer>
</body>
</html>
`;
}

/** The date a source file last changed, when git can say; absent otherwise. */
function lastModified(src: string): string | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', src], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The home page and every published document, and nothing else. Every URL
 * here is its own canonical: the site's other views are `?demo=1` variants of
 * the home page, which names the home page as canonical, so listing them told
 * a crawler two contradictory things.
 */
export function sitemap(entries: Array<{ loc: string; lastmod?: string }>): string {
  const urls = entries
    .map(
      e =>
        `  <url>\n    <loc>${e.loc}</loc>\n${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Writes every page, the images they use, and the sitemap into `out`. */
export function buildDocs(out: string): { pages: number; assets: number } {
  const assets = new Set<string>();
  for (const page of PAGES) {
    const md = readFileSync(join(ROOT, page.src), 'utf8');
    const { html, assets: used } = renderBody(page.src, md);
    for (const a of used) assets.add(a);
    const dir = join(out, 'docs', page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderPage(page, html));
  }
  mkdirSync(join(out, 'docs', 'assets'), { recursive: true });
  for (const a of assets) copyFileSync(join(ROOT, a), join(out, 'docs', 'assets', basename(a)));
  writeFileSync(
    join(out, 'sitemap.xml'),
    sitemap([
      { loc: ORIGIN + BASE, lastmod: lastModified('src/client') },
      ...PAGES.map(p => ({ loc: ORIGIN + pagePath(p), lastmod: lastModified(p.src) })),
    ])
  );
  return { pages: PAGES.length, assets: assets.size };
}

if (process.argv[1] && normalize(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || join(ROOT, 'dist');
  const { pages, assets } = buildDocs(out);
  console.log(`docs: ${pages} pages and ${assets} images written to ${out}, with the sitemap`);
}
