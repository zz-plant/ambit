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
  /**
   * How the page is built when it is not a markdown document: the glossary is
   * written from the concepts file, so the page and the app cannot define a
   * term two ways.
   */
  render?: 'glossary';
}

export const PAGES: Page[] = [
  {
    src: 'docs/README.md',
    slug: '',
    title: 'Ambit documentation: map, audit and govern an AI agent setup',
    description:
      'Every Ambit document in one place: the guide, the FAQ, where each agent keeps its MCP config, the reference, the roadmap, the changelog, and how to contribute.',
    card: 'Every Ambit document, in one place',
  },
  {
    src: 'README.md',
    slug: 'guide',
    title: 'Ambit guide: install, CLI and MCP setup',
    description:
      'Install Ambit, map your AI agent setup, and ask what it can do, what to set up next and what breaks, from the terminal or over MCP in Claude Code and OpenCode.',
    card: 'Map what your AI agent setup can do, in one command',
  },
  {
    src: 'docs/faq.md',
    slug: 'faq',
    title: 'Ambit FAQ: MCP servers, agent permissions, and what stays local',
    description:
      'Short answers about Ambit: which agent runtimes it reads, what leaves your machine, how an agent changes config, Jev, and why attention reports start empty.',
    card: 'What it reads, and what never leaves your machine',
  },
  {
    src: 'docs/loadout.md',
    slug: 'loadout',
    title: 'Your loadout, from A to B: what Ambit makes possible, leg by leg',
    description:
      'One person, their agents and their machines, from a pile of configs to work done without them: seven legs, the command for each, and what the demo shows.',
    card: 'Step into your loadout',
  },
  {
    src: 'docs/solo.md',
    slug: 'solo',
    title: 'Building alone: a launch checklist and production guardrails for your agents',
    description:
      'For a one-person company: what to set up before real users arrive, what an agent may do to production without asking, and how you hear when it breaks.',
    card: 'What a CTO would ask, answered from your agent setup',
  },
  {
    src: 'docs/ideas.md',
    slug: 'ideas',
    title: 'The ideas behind Ambit: what is new, and where it comes from',
    description:
      "An agent setup's reach is composed, has to be proven, and differs from permission. What is new in Ambit, its nearest prior work, and what it does not claim.",
    card: 'Reach is composed, proven, and not the same as permission',
  },
  {
    src: 'docs/mcp-config-locations.md',
    slug: 'mcp-config-locations',
    title: 'Where each AI agent keeps its MCP config: Claude Code, Cursor, Codex and more',
    description:
      'The MCP config file and key for Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, Codex CLI, OpenCode, Cline, Roo Code, Continue, Zed and VS Code.',
    card: 'Twelve agents, twelve config files, one table',
  },
  {
    src: 'docs/mcp-outage.md',
    slug: 'mcp-outage',
    title: 'What breaks if an MCP server goes down: blast radius for AI agents',
    description:
      'Find the single points of failure in an AI agent setup: what stops, what only weakens, and what was already broken if one MCP server, model or token goes.',
    card: 'One server goes down. What else stops?',
  },
  {
    src: 'docs/audit-mcp-servers.md',
    slug: 'audit-mcp-servers',
    title: 'How to audit which MCP servers your coding agent has',
    description:
      'Audit an AI coding agent four ways: every MCP server declared, which ones work, what each may do without asking, and what was used but never declared.',
    card: 'Audit every MCP server your agent can reach',
  },
  {
    src: 'docs/compare.md',
    slug: 'compare',
    title: 'Ambit and MCP gateways: which one answers which question',
    description:
      'MCP gateways decide each tool call as it happens. Ambit maps what an agent setup can do, whether it works, and what breaks if a piece goes.',
    card: 'A gateway decides calls. A map shows the setup.',
  },
  {
    src: 'src/shared/concepts.json',
    slug: 'glossary',
    title: 'Ambit glossary: capability graph, frontier, keystone and more',
    description:
      'Every word Ambit uses, defined once: capabilities, reached and next steps, keystones, evidence, authority modes, the frontier and the work ledger.',
    card: 'Every word on the map, defined once',
    render: 'glossary',
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
    title: 'Ambit changelog: what changed in each release',
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
  ['Glossary', `${BASE}docs/glossary/`],
  ['All docs', `${BASE}docs/`],
  ['GitHub', 'https://github.com/zz-plant/ambit'],
];

/** Markdown inline syntax dropped, for text a search engine shows as an answer. */
const plain = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The FAQ's questions and answers as FAQPage data: each `###` heading is a
 * question, and what follows it up to the next heading is its answer. Read
 * from the same markdown the page renders, so the two cannot disagree.
 */
export function faqEntries(markdown: string): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  let current: { q: string; lines: string[] } | null = null;
  for (const line of markdown.split('\n')) {
    if (/^#{1,6} /.test(line)) {
      if (current) out.push({ q: plain(current.q), a: plain(current.lines.join(' ')) });
      current = line.startsWith('### ') ? { q: line.slice(4), lines: [] } : null;
    } else if (current) current.lines.push(line);
  }
  if (current) out.push({ q: plain(current.q), a: plain(current.lines.join(' ')) });
  return out.filter(e => e.q && e.a);
}

interface Concept {
  key: string;
  term: string;
  short: string;
  long: string;
}

/** The glossary's body, one section per concept, in the order a reader meets them. */
export function glossaryBody(concepts: Concept[]): string {
  return [
    '<h1 id="glossary">Ambit glossary</h1>',
    '<p>Every word the map, the CLI and the MCP server use, defined once. The same file is what the app\u2019s Docs overlay, its term popovers and <code>ambit help &lt;term&gt;</code> read, so a definition here is the one the interface shows.</p>',
    ...concepts.map(
      c =>
        `<h2 id="${escapeHtml(c.key)}"><a class="anchor" href="#${escapeHtml(c.key)}" aria-hidden="true" tabindex="-1">#</a>${escapeHtml(c.term)}</h2>\n<p><strong>${escapeHtml(c.short)}.</strong> ${escapeHtml(c.long)}</p>`
    ),
  ].join('\n');
}

/**
 * The app's faces, copied beside the pages: Hubot Sans for the headings and
 * the wordmark, Mona Sans for the text, Monaspace Neon for code
 * (src/client/fonts.ts says why each). Latin files only, and swapped in when
 * they arrive, so a page still paints at once in the system face.
 */
const FONTS: [file: string, from: string][] = [
  ['hubot-sans.woff2', '@fontsource-variable/hubot-sans/files/hubot-sans-latin-wdth-normal.woff2'],
  ['mona-sans.woff2', '@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2'],
  [
    'monaspace-neon.woff2',
    '@fontsource/monaspace-neon/files/monaspace-neon-latin-400-normal.woff2',
  ],
];

const FONT_FACES = [
  `@font-face{font-family:"Hubot Sans";font-weight:200 900;font-stretch:75% 125%;font-display:swap;src:url(${BASE}docs/fonts/hubot-sans.woff2) format("woff2")}`,
  `@font-face{font-family:"Mona Sans";font-weight:200 900;font-display:swap;src:url(${BASE}docs/fonts/mona-sans.woff2) format("woff2")}`,
  `@font-face{font-family:"Monaspace Neon";font-weight:400;font-display:swap;src:url(${BASE}docs/fonts/monaspace-neon.woff2) format("woff2")}`,
].join('');

/** One published page, whole. */
export function renderPage(
  page: Page,
  body: string,
  extra: { modified?: string; data?: object[] } = {}
): string {
  const url = ORIGIN + pagePath(page);
  const docs = ORIGIN + pagePath(PAGES[0]);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: page.title,
        description: page.description,
        url,
        ...(extra.modified ? { dateModified: extra.modified } : {}),
        author: { '@type': 'Person', name: 'Kanav Jain' },
        isPartOf: { '@type': 'WebSite', name: 'Ambit', url: ORIGIN + BASE },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ambit', item: ORIGIN + BASE },
          { '@type': 'ListItem', position: 2, name: 'Docs', item: docs },
          ...(page.slug ? [{ '@type': 'ListItem', position: 3, name: page.title, item: url }] : []),
        ],
      },
      ...(extra.data ?? []),
    ],
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
<meta name="theme-color" content="#0f1013" />
<link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
${FONT_FACES}
:root{color-scheme:dark;--bg:#0f1013;--fg:#e8e8ea;--muted:#a4a7ae;--link:#7aa2f7;--line:#26282d;--code:#16171b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 "Mona Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header,main,footer{max-width:820px;margin:0 auto;padding:0 20px}
header{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;padding-top:18px;padding-bottom:14px;border-bottom:1px solid var(--line)}
header a{color:var(--muted);text-decoration:none;font-size:14px}header a:hover{color:var(--fg)}header .brand{color:var(--fg);font-family:"Hubot Sans","Mona Sans",sans-serif;font-stretch:112.5%;font-weight:750;font-size:17px;margin-right:auto}
main{padding-top:8px;padding-bottom:48px}a{color:var(--link)}h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .5em}h1,h2{font-family:"Hubot Sans","Mona Sans",sans-serif;font-stretch:112.5%;font-weight:750;letter-spacing:-.01em}h1{font-size:2em}
.anchor{float:left;margin-left:-1em;padding-right:.25em;color:var(--muted);text-decoration:none;opacity:0}h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
code{font:.88em/1.5 "Monaspace Neon",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.1em .35em;border-radius:4px}
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
    const source = readFileSync(join(ROOT, page.src), 'utf8');
    const modified = lastModified(page.src);
    let html: string;
    const data: object[] = [];
    if (page.render === 'glossary') {
      const concepts: Concept[] = JSON.parse(source).concepts;
      html = glossaryBody(concepts);
      data.push({
        '@type': 'DefinedTermSet',
        name: 'Ambit glossary',
        url: ORIGIN + pagePath(page),
        hasDefinedTerm: concepts.map(c => ({
          '@type': 'DefinedTerm',
          name: c.term,
          description: `${c.short}. ${c.long}`,
          url: `${ORIGIN}${pagePath(page)}#${c.key}`,
        })),
      });
    } else {
      const rendered = renderBody(page.src, source);
      html = rendered.html;
      for (const a of rendered.assets) assets.add(a);
      if (page.slug === 'faq') {
        data.push({
          '@type': 'FAQPage',
          mainEntity: faqEntries(source).map(e => ({
            '@type': 'Question',
            name: e.q,
            acceptedAnswer: { '@type': 'Answer', text: e.a },
          })),
        });
      }
    }
    const dir = join(out, 'docs', page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderPage(page, html, { modified, data }));
  }
  mkdirSync(join(out, 'docs', 'assets'), { recursive: true });
  for (const a of assets) copyFileSync(join(ROOT, a), join(out, 'docs', 'assets', basename(a)));
  mkdirSync(join(out, 'docs', 'fonts'), { recursive: true });
  for (const [file, from] of FONTS) {
    copyFileSync(join(ROOT, 'node_modules', from), join(out, 'docs', 'fonts', file));
  }
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
