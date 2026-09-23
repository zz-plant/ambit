#!/usr/bin/env bun
/**
 * generate-scenes.ts — renders every brand asset from one SVG source.
 *
 *   docs/assets/social-preview.png          1280×640, the card link unfurls show
 *   docs/assets/ambit-favicon.png           64×64, the raster favicon
 *   src/client/public/favicon.svg           the vector the page links
 *   src/client/public/apple-touch-icon.png  180×180, the iOS home screen icon
 *   src/client/public/social-preview.png    the page's own copy, for og:image
 *   src/client/public/og/<page>.png          one card per published docs page
 *
 * The last two are new to this script, and adding them is the point. The touch
 * icon was drawn by hand once and never regenerated, so it had drifted to a
 * cyan diamond while the favicon was an indigo node graph: two identities
 * shipping side by side, one file apart. The page's favicon.svg was a third
 * copy, kept in sync by hand. Everything now comes out of one `mark()`.
 *
 * Fifteen variants used to come out of here — badge, blur, email header,
 * Mastodon, square, touch — and thirteen of them were referenced by nothing.
 *
 * Usage: node --experimental-strip-types scripts/generate-scenes.ts [--dry-run]
 * Needs rsvg-convert (librsvg).
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, type Page } from './build-docs.ts';

const ASSETS_DIR = join(process.cwd(), 'docs', 'assets');
const PUBLIC_DIR = join(process.cwd(), 'src', 'client', 'public');

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** The line the README leads with; index.html, package.json and CITATION.cff quote it too. */
const TAGLINE =
  'What you, your agents, and your machines can jointly do — and where your own time is going.';

// ── The mark ─────────────────────────────────────────────────────────────────
//
// An "A" whose three vertices are graph nodes, so it reads as the letter at a
// glance and as a dependency graph when it is big enough to.
//
// It replaces three thin outlined circles joined by 2.5px lines on a #090d16
// plate, which was drawn at 64px and only ever looked like anything at 64px. A
// browser tab renders 16px: at that size the hairlines fell below a pixel, the
// three accent colours averaged into one grey, and what was left was a dark
// smudge on a dark tab bar. Hence the two rules here. The mark is mass, not
// line art, so it survives being four times smaller than it is drawn; and it
// sits on an indigo plate, so the brand colour is what a tab shows instead of
// a black square that disappears into the browser's own chrome.

/** Vertices of the A. The crossbar meets the legs at 70% of the letter's height. */
const APEX = { x: 32, y: 12 };
const FEET = [
  { x: 13, y: 51 },
  { x: 51, y: 51 },
];
const BAR = { y: 40, x1: 20, x2: 44 };

/**
 * The mark on a 64-unit grid, painted with `paint`.
 *
 * Note that any gradient handed in has to be `gradientUnits="userSpaceOnUse"`.
 * The crossbar is perfectly horizontal, so its bounding box has zero height,
 * and librsvg drops an `objectBoundingBox` gradient stroked onto it — which
 * silently turns the A into a Λ.
 */
function mark(paint: string): string {
  return `
    <g stroke="${paint}" stroke-linecap="round" fill="none">
      <path d="M${FEET[0].x} ${FEET[0].y} L${APEX.x} ${APEX.y}" stroke-width="9.5"/>
      <path d="M${FEET[1].x} ${FEET[1].y} L${APEX.x} ${APEX.y}" stroke-width="9.5"/>
      <path d="M${BAR.x1} ${BAR.y} H${BAR.x2}" stroke-width="8.5"/>
    </g>
    <circle cx="${APEX.x}" cy="${APEX.y}" r="8.5" fill="${paint}"/>
    <circle cx="${FEET[0].x}" cy="${FEET[0].y}" r="7.5" fill="${paint}"/>
    <circle cx="${FEET[1].x}" cy="${FEET[1].y}" r="7.5" fill="${paint}"/>`;
}

/** Indigo to blue, across the plate. */
const PLATE_GRADIENT = `<linearGradient id="plate" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>`;

/** The mark's own gradient, for the times it sits unplated on the dark ground. */
const MARK_GRADIENT = `<linearGradient id="mk" x1="13" y1="51" x2="51" y2="12" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>`;

/**
 * The plated icon. `radius` is the plate's corner rounding: 14 for a favicon,
 * 0 for the iOS touch icon, which iOS masks to its own squircle and which
 * shows a pale seam if it arrives pre-rounded.
 */
function icon(radius: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs>${PLATE_GRADIENT}</defs>
    <rect width="64" height="64" rx="${radius}" fill="url(#plate)"/>
    ${mark('#ffffff')}
  </svg>`;
}

// ── The cards ────────────────────────────────────────────────────────────────
//
// One rule governs these drawings: nothing on them may depend on a detail
// smaller than the smallest size a card is seen at. A timeline unfurl renders
// it about 480px wide, two and a half times down from the 1280 it is drawn at,
// so no text here is under 26px and no node under 17px.
//
// The card before this one led with the tagline, "What you, your agents, and
// your machines can jointly do", beside an abstract graph of coloured dots. It
// named no tool a reader uses and showed nothing happening, and in a feed it
// read as a brand, which is the thing a scrolling reader skips. This one asks
// the question the product answers, names the runtimes it reads so a reader
// can tell it is about theirs, and draws the answer: one node down, and what
// goes with it. The graphic is still honestly abstract. A drawing that imitates
// the product's screenshot at a size where no screenshot is legible is a fake,
// and the real screenshots are in the README where they have room.

const INK = '#f8fafc';
const SUB = '#a8b3c7';
const QUIET = '#6b7a93';
const RED = '#f43f5e';

/** Text is data here: a title with an ampersand would otherwise end the SVG. */
const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Words into lines of at most `width` characters, never more than `max` lines. */
function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length > max ? [...lines.slice(0, max - 1), `${lines[max - 1]}…`] : lines;
}

/**
 * A node of the card's graph. `down` is the one that failed, `lost` what
 * stops with it, and `frontier` is not reached, drawn dashed.
 */
type Node = { x: number; y: number; r: number; down?: boolean; lost?: boolean; frontier?: boolean };

/**
 * Hand-placed, in loose columns with uneven rows: a map is irregular and it
 * runs off the edges of its frame. The failed node sits where the eye lands
 * first on the right half, and what it takes with it fans out to its right.
 */
const NODES: Record<string, Node> = {
  a1: { x: 820, y: 150, r: 22 },
  a2: { x: 800, y: 330, r: 24 },
  a3: { x: 840, y: 520, r: 20 },
  down: { x: 960, y: 270, r: 36, down: true },
  b1: { x: 1070, y: 130, r: 22, lost: true },
  b2: { x: 1100, y: 300, r: 24, lost: true },
  b3: { x: 1010, y: 450, r: 22, lost: true },
  c1: { x: 1210, y: 200, r: 21, lost: true },
  c2: { x: 1230, y: 390, r: 20, lost: true },
  c3: { x: 1150, y: 560, r: 20, lost: true },
  d1: { x: 960, y: 610, r: 18, frontier: true },
  d2: { x: 1260, y: 580, r: 17, frontier: true },
};

const EDGES: [string, string][] = [
  ['a1', 'down'],
  ['a2', 'down'],
  ['a2', 'a3'],
  ['a3', 'd1'],
  ['down', 'b1'],
  ['down', 'b2'],
  ['down', 'b3'],
  ['b1', 'c1'],
  ['b2', 'c1'],
  ['b2', 'c2'],
  ['b3', 'c3'],
  ['c3', 'd2'],
];

function graph(opacity = 1): string {
  const parts: string[] = [];
  for (const [from, to] of EDGES) {
    const f = NODES[from];
    const t = NODES[to];
    const hot = (f.down || f.lost) && t.lost;
    const soft = t.frontier;
    parts.push(
      `<line x1="${f.x}" y1="${f.y}" x2="${t.x}" y2="${t.y}" stroke="${
        hot ? 'rgba(244,63,94,0.70)' : soft ? 'rgba(148,163,184,0.30)' : 'rgba(129,140,248,0.50)'
      }" stroke-width="${hot ? 4 : soft ? 2.5 : 3.5}"${soft ? ' stroke-dasharray="8 7"' : ''} stroke-linecap="round"/>`
    );
  }
  for (const n of Object.values(NODES)) {
    if (n.down) continue;
    parts.push(
      n.frontier
        ? `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="none" stroke="rgba(148,163,184,0.62)" stroke-width="3.2" stroke-dasharray="9 6.5"/>`
        : n.lost
          ? `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#3b1220" stroke="${RED}" stroke-width="4"/>`
          : `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#6366f1"/>`
    );
  }
  // The failed node last, over its own edges: lit red, crossed out.
  const d = NODES.down;
  parts.push(`<circle cx="${d.x}" cy="${d.y}" r="100" fill="url(#downGlow)"/>
    <circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${RED}"/>
    <path d="M${d.x - 13} ${d.y - 13} L${d.x + 13} ${d.y + 13} M${d.x + 13} ${d.y - 13} L${d.x - 13} ${d.y + 13}" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`);
  return `<g opacity="${opacity}">${parts.join('\n    ')}</g>`;
}

/** The ground every card shares: the dark gradient, two glows, and the red one. */
const GROUND = `<defs>
      ${MARK_GRADIENT}
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="640" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#0c1222"/>
        <stop offset="100%" stop-color="#080b13"/>
      </linearGradient>
      <radialGradient id="glowA" cx="0.12" cy="0.08" r="0.62">
        <stop offset="0%" stop-color="rgba(99,102,241,0.20)"/>
        <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
      </radialGradient>
      <radialGradient id="downGlow">
        <stop offset="0%" stop-color="rgba(244,63,94,0.38)"/>
        <stop offset="100%" stop-color="rgba(244,63,94,0)"/>
      </radialGradient>
    </defs>
    <rect width="1280" height="640" fill="url(#bg)"/>
    <rect width="1280" height="640" fill="url(#glowA)"/>`;

/** The mark and the name, small: the card is about the question, not the brand. */
const BRAND = `<g transform="translate(80, 62) scale(0.62)">${mark('url(#mk)')}</g>
    <text x="132" y="96" font-family="${FONT}" font-size="36" font-weight="700" fill="${INK}" letter-spacing="-0.8">Ambit</text>`;

function socialCard(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
    ${GROUND}
    ${graph()}
    <text x="1236" y="70" font-family="${FONT}" font-size="30" font-weight="700" fill="${RED}" text-anchor="end">1 down, ${Object.values(NODES).filter(n => n.lost).length} stop working</text>

    ${BRAND}

    <text font-family="${FONT}" font-size="60" font-weight="750" fill="${INK}" letter-spacing="-1.8">
      <tspan x="80" y="230">What breaks if one</tspan>
      <tspan x="80" y="302">MCP server goes down?</tspan>
    </text>

    <text font-family="${FONT}" font-size="27" font-weight="500" fill="${SUB}">
      <tspan x="80" y="392">Ambit maps Claude Code, Cursor, OpenCode</tspan>
      <tspan x="80" y="428">and four more into one graph of what</tspan>
      <tspan x="80" y="464">your agents can actually do.</tspan>
    </text>

    <rect x="80" y="548" width="352" height="56" rx="28" fill="#4f46e5"/>
    <text x="256" y="585" font-family="${FONT}" font-size="26" font-weight="650" fill="#ffffff" text-anchor="middle">Try the live demo →</text>
    <text x="456" y="585" font-family="${FONT}" font-size="26" font-weight="500" fill="${QUIET}">open source, runs locally</text>
  </svg>`;
}

/**
 * A docs page's card: which page, and why open it.
 *
 * Every page shared the home card, so a link to the security invariants
 * unfurled as "What breaks if one MCP server goes down?", a question that page
 * does not answer. Each now leads with its own `card` line from build-docs.ts,
 * with the page's title under it and the graph faint behind, so the set reads
 * as one site.
 */
function docCard(page: Page): string {
  const lines = wrap(page.card, 24, 3);
  const top = 250 - (lines.length - 2) * 34;
  const titleY = top + lines.length * 76 + 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
    ${GROUND}
    ${graph(0.35)}
    ${BRAND}
    <text x="80" y="${top - 70}" font-family="${FONT}" font-size="26" font-weight="700" fill="#818cf8" letter-spacing="3">DOCS</text>
    <text font-family="${FONT}" font-size="64" font-weight="750" fill="${INK}" letter-spacing="-1.6">
      ${lines.map((l, i) => `<tspan x="80" y="${top + i * 76}">${xml(l)}</tspan>`).join('\n      ')}
    </text>
    <text x="80" y="${titleY}" font-family="${FONT}" font-size="28" font-weight="500" fill="${SUB}">${xml(wrap(page.title, 44, 1)[0])}</text>
    <text x="80" y="586" font-family="${FONT}" font-size="26" font-weight="500" fill="${QUIET}">zz-plant.github.io/ambit/docs/${xml(page.slug ? `${page.slug}/` : '')}</text>
  </svg>`;
}

// ── The reference sheet ──────────────────────────────────────────────────────

/**
 * docs/assets/source.svg, the file a designer opens to see what the mark is.
 *
 * It used to be a 400×200 lockup carrying the old three-circle mark and the
 * subtitle "Capability Graph & Meta-MCP Server for AI Agents", a description
 * the project stopped using. Generating it from `mark()` means it shows
 * whatever actually ships, and the sizes along the bottom are the ones that
 * matter: 16px is a browser tab, 32px a bookmark, 180px an iOS home screen.
 */
function sourceSheet(): string {
  const LADDER_BASE = 520;
  let x = 40;
  const ladder = [16, 32, 64, 180]
    .map(size => {
      const g = `<g transform="translate(${x}, ${LADDER_BASE - size}) scale(${size / 64})">
      <rect width="64" height="64" rx="14" fill="url(#plate)"/>
      ${mark('#ffffff')}
    </g>
    <text x="${x + size / 2}" y="${LADDER_BASE + 22}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#7b8799">${size}px</text>`;
      x += size + 40;
      return g;
    })
    .join('\n    ');

  const swatches = [
    ['#4f46e5', 'plate from'],
    ['#0284c7', 'plate to'],
    ['#818cf8', 'mark from'],
    ['#38bdf8', 'mark to'],
    ['#090d16', 'ground'],
  ]
    .map(
      (
        [hex, label],
        i
      ) => `<rect x="${40 + i * 116}" y="596" width="100" height="34" rx="6" fill="${hex}" stroke="rgba(255,255,255,0.12)"/>
    <text x="${40 + i * 116}" y="648" font-family="${FONT}" font-size="10.5" fill="#94a3b8">${label}</text>
    <text x="${40 + i * 116}" y="664" font-family="${FONT}" font-size="10.5" fill="#61708a">${hex}</text>`
    )
    .join('\n    ');

  const treatment = (tx: number, art: string, title: string, use: string) =>
    `<g transform="translate(${tx}, 112) scale(1.5)">${art}</g>
    <text x="${tx}" y="248" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#cbd5e1">${title}</text>
    <text x="${tx}" y="266" font-family="${FONT}" font-size="11" fill="#61708a">${use}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720" viewBox="0 0 640 720">
    <defs>${PLATE_GRADIENT}${MARK_GRADIENT}</defs>
    <rect width="640" height="720" fill="#090d16"/>

    <text x="40" y="56" font-family="${FONT}" font-size="13" font-weight="600" fill="#f8fafc" letter-spacing="1.4">AMBIT — MARK</text>
    <text x="40" y="80" font-family="${FONT}" font-size="11.5" fill="#7b8799">An A whose three vertices are graph nodes. Mass, not line art, so it holds at 16px.</text>

    ${treatment(40, mark('url(#mk)'), 'unplated', 'on the dark ground: the card, and in-app')}
    ${treatment(
      260,
      `<rect width="64" height="64" rx="14" fill="url(#plate)"/>${mark('#ffffff')}`,
      'plated',
      'favicon and touch icon'
    )}

    <text x="40" y="306" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#cbd5e1">Shipped sizes</text>
    <text x="40" y="324" font-family="${FONT}" font-size="11" fill="#61708a">16px is a browser tab, 32px a bookmark, 180px an iOS home screen.</text>
    ${ladder}

    <text x="40" y="582" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#cbd5e1">Palette</text>
    ${swatches}

    <text x="40" y="700" font-family="${FONT}" font-size="11" fill="#61708a">${TAGLINE}</text>
  </svg>`;
}

// ── Rendering ────────────────────────────────────────────────────────────────

type Scene = {
  width: number;
  height: number;
  /** Below this, the PNG is blank or truncated and the render failed quietly. */
  minBytes: number;
  svg: () => string;
  /** Rendered to the first path, copied to the rest. */
  outputs: string[];
};

const SCENES: Record<string, Scene> = {
  social: {
    width: 1280,
    height: 640,
    minBytes: 15_000,
    svg: socialCard,
    outputs: [join(ASSETS_DIR, 'social-preview.png'), join(PUBLIC_DIR, 'social-preview.png')],
  },
  favicon: {
    width: 64,
    height: 64,
    minBytes: 600,
    svg: () => icon(14),
    outputs: [join(ASSETS_DIR, 'ambit-favicon.png')],
  },
  'apple-touch-icon': {
    width: 180,
    height: 180,
    minBytes: 1_500,
    svg: () => icon(0),
    outputs: [join(PUBLIC_DIR, 'apple-touch-icon.png')],
  },
};

for (const page of PAGES) {
  SCENES[`og:${page.slug || 'docs'}`] = {
    width: 1280,
    height: 640,
    minBytes: 15_000,
    svg: () => docCard(page),
    outputs: [join(PUBLIC_DIR, 'og', `${page.slug || 'docs'}.png`)],
  };
}

/** The vectors that ship as vectors, written from the same `mark()`. */
const VECTORS: Record<string, string> = {
  [join(PUBLIC_DIR, 'favicon.svg')]: icon(14),
  [join(ASSETS_DIR, 'source.svg')]: sourceSheet(),
};

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  mkdirSync(ASSETS_DIR, { recursive: true });
  mkdirSync(join(PUBLIC_DIR, 'og'), { recursive: true });

  let failed = 0;

  for (const [name, scene] of Object.entries(SCENES)) {
    if (dryRun) {
      console.log(`  [dry] ${name}: ${scene.width}×${scene.height} → ${scene.outputs.join(', ')}`);
      continue;
    }
    const [primary, ...copies] = scene.outputs;
    const tempSvg = join(ASSETS_DIR, `_${name}_temp.svg`);
    try {
      writeFileSync(tempSvg, scene.svg());
      execSync(`rsvg-convert -w ${scene.width} -h ${scene.height} -o "${primary}" "${tempSvg}"`, {
        stdio: 'pipe',
        timeout: 15000,
      });
      const size = statSync(primary).size;
      if (size < scene.minBytes) {
        console.error(`  ❌ ${name}: ${size}B, below ${scene.minBytes}B — probably blank`);
        failed++;
        continue;
      }
      for (const copy of copies) {
        if (existsSync(join(copy, '..'))) copyFileSync(primary, copy);
      }
      console.log(
        `  ✅ ${name}  ${scene.width}×${scene.height}  ${size.toLocaleString()}B  → ${scene.outputs.length} path(s)`
      );
    } catch (e: unknown) {
      const err = e as { stderr?: Buffer; message?: string };
      console.error(`  ❌ ${name}: ${err.stderr?.toString() || err.message}`);
      failed++;
    } finally {
      if (existsSync(tempSvg)) unlinkSync(tempSvg);
    }
  }

  for (const [path, svg] of Object.entries(VECTORS)) {
    if (dryRun) {
      console.log(`  [dry] vector → ${path}`);
      continue;
    }
    writeFileSync(path, `${svg.trim()}\n`);
    console.log(`  ✅ ${path.split('/').slice(-1)[0]}  vector`);
  }

  if (failed > 0) process.exit(1);
}

main();
