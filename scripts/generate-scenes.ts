#!/usr/bin/env bun
/**
 * generate-scenes.ts — renders every brand asset from one SVG source.
 *
 *   docs/assets/social-preview.png          1280×640, the card link unfurls show
 *   docs/assets/ambit-favicon.png           64×64, the raster favicon
 *   src/client/public/favicon.svg           the vector the page links
 *   src/client/public/apple-touch-icon.png  180×180, the iOS home screen icon
 *   src/client/public/social-preview.png    the page's own copy, for og:image
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

const ASSETS_DIR = join(process.cwd(), 'docs', 'assets');
const PUBLIC_DIR = join(process.cwd(), 'src', 'client', 'public');

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** The line the README leads with; index.html, package.json and CITATION.cff quote it too. */
const TAGLINE =
  'What you, your agents, and your machines can jointly do — and where your own time is going.';

/**
 * The tagline, broken for the card. The breaks fall on the comma and on the
 * dash, so each line ends where the sentence pauses; the version before this
 * one broke after "and where", which left a line hanging on a preposition.
 * `checkTagline` holds the two spellings together.
 */
const HEADLINE = [
  'What you, your agents,',
  'and your machines can jointly do —',
  'and where your own time is going.',
];

/** Fails the build if the card's line breaks stop spelling the tagline. */
function checkTagline(): void {
  const joined = HEADLINE.join(' ');
  if (joined !== TAGLINE) {
    console.error(
      `  ❌ headline drifted from the tagline\n     card: ${joined}\n     line: ${TAGLINE}`
    );
    process.exit(1);
  }
}

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

// ── The card ─────────────────────────────────────────────────────────────────
//
// One rule governs this drawing: nothing on it may depend on a detail smaller
// than the smallest size the card is seen at. A timeline unfurl renders it
// about 480px wide, two and a half times down from the 1280 it is drawn at.
//
// The card this replaces put a miniature of the running UI on the right — nine
// identical circles in three columns, with 12px era labels and a 10px "Era 1"
// under each. At 480px the labels were five pixels tall and the nine circles
// carried no information, so 40% of the card was noise. The other rule follows
// from that one: the graphic is honestly abstract. A drawing that imitates the
// product's screenshot at a size where no screenshot is legible is a fake, and
// the real screenshots are in the README where they have room.

/** A node of the map. `frontier` nodes are one step out, and drawn hollow. */
type Node = { x: number; y: number; r: number; c?: string; frontier?: boolean; key?: boolean };

/**
 * Hand-placed, in loose columns with uneven rows. An earlier pass fanned these
 * out radially at a fixed radius and it read as a sunburst logo; a map is
 * irregular, and it runs off the edges of its frame.
 *
 * Radii stay at 17 and above so every node clears 6px at unfurl scale, and the
 * palette is four of the app's node-type colours, amber used once.
 */
const NODES: Record<string, Node> = {
  a1: { x: 868, y: 122, r: 21, c: '#38bdf8' },
  a2: { x: 842, y: 332, r: 24, c: '#8b5cf6' },
  a3: { x: 886, y: 524, r: 20, c: '#10b981' },
  keystone: { x: 1022, y: 240, r: 34, key: true },
  b2: { x: 1006, y: 446, r: 23, c: '#38bdf8' },
  b3: { x: 1058, y: 608, r: 19, c: '#8b5cf6' },
  c1: { x: 1174, y: 104, r: 22, c: '#f59e0b' },
  c2: { x: 1202, y: 296, r: 21, c: '#8b5cf6' },
  c3: { x: 1158, y: 478, r: 18, frontier: true },
  d1: { x: 1248, y: 170, r: 20, frontier: true },
  d2: { x: 1254, y: 388, r: 18, frontier: true },
  d3: { x: 1238, y: 572, r: 17, frontier: true },
};

/** `[from, to, soft]`. Soft edges lead to the frontier, and are dashed. */
const EDGES: [string, string, boolean?][] = [
  ['a1', 'keystone'],
  ['a2', 'keystone'],
  ['a3', 'b2'],
  ['a2', 'b2'],
  ['keystone', 'c1'],
  ['keystone', 'c2'],
  ['keystone', 'b2'],
  ['b2', 'b3'],
  ['b2', 'c3', true],
  ['c1', 'd1', true],
  ['c2', 'd1', true],
  ['c2', 'd2', true],
  ['c3', 'd3', true],
  ['b3', 'd3', true],
];

function graph(): string {
  const parts: string[] = [];

  for (const [from, to, soft] of EDGES) {
    const f = NODES[from];
    const t = NODES[to];
    parts.push(
      `<line x1="${f.x}" y1="${f.y}" x2="${t.x}" y2="${t.y}" stroke="${
        soft ? 'rgba(148,163,184,0.30)' : 'rgba(129,140,248,0.50)'
      }" stroke-width="${soft ? 2.5 : 3.5}"${soft ? ' stroke-dasharray="8 7"' : ''} stroke-linecap="round"/>`
    );
  }

  for (const n of Object.values(NODES)) {
    if (n.key) continue;
    parts.push(
      n.frontier
        ? `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="none" stroke="rgba(148,163,184,0.62)" stroke-width="3.2" stroke-dasharray="9 6.5"/>`
        : `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}"/>`
    );
  }

  // The keystone last, so it sits over its own edges: lit, ringed, and the
  // source of every solid edge on the card.
  const k = NODES.keystone;
  parts.push(`<circle cx="${k.x}" cy="${k.y}" r="96" fill="url(#keyGlow)"/>
    <circle cx="${k.x}" cy="${k.y}" r="48" fill="none" stroke="rgba(99,102,241,0.30)" stroke-width="1.5"/>
    <circle cx="${k.x}" cy="${k.y}" r="${k.r}" fill="#6366f1"/>
    <circle cx="${k.x}" cy="${k.y}" r="${k.r}" fill="none" stroke="#c7d2fe" stroke-width="3"/>`);

  return parts.join('\n    ');
}

function socialCard(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
    <defs>
      ${MARK_GRADIENT}
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="640" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#0c1222"/>
        <stop offset="100%" stop-color="#080b13"/>
      </linearGradient>
      <radialGradient id="glowA" cx="0.12" cy="0.08" r="0.62">
        <stop offset="0%" stop-color="rgba(99,102,241,0.20)"/>
        <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
      </radialGradient>
      <radialGradient id="glowB" cx="0.8" cy="0.55" r="0.5">
        <stop offset="0%" stop-color="rgba(14,165,233,0.13)"/>
        <stop offset="100%" stop-color="rgba(14,165,233,0)"/>
      </radialGradient>
      <radialGradient id="keyGlow">
        <stop offset="0%" stop-color="rgba(99,102,241,0.40)"/>
        <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
      </radialGradient>
    </defs>

    <rect width="1280" height="640" fill="url(#bg)"/>
    <rect width="1280" height="640" fill="url(#glowA)"/>
    <rect width="1280" height="640" fill="url(#glowB)"/>

    ${graph()}

    <g transform="translate(88, 100) scale(0.84)">${mark('url(#mk)')}</g>
    <text x="158" y="148" font-family="${FONT}" font-size="66" font-weight="700" fill="#f8fafc" letter-spacing="-2.2">Ambit</text>

    ${HEADLINE.map(
      (line, i) =>
        `<text x="88" y="${250 + i * 52}" font-family="${FONT}" font-size="40" font-weight="500" fill="#eef2f8" letter-spacing="-0.6">${line}</text>`
    ).join('\n    ')}

    <text x="88" y="430" font-family="${FONT}" font-size="23" font-weight="500" fill="#94a3b8">Ask from the terminal. Your agents ask over MCP.</text>
    <text x="88" y="562" font-family="${FONT}" font-size="17" font-weight="500" fill="#61708a" letter-spacing="0.2">zz-plant.github.io/ambit</text>
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

/** The vectors that ship as vectors, written from the same `mark()`. */
const VECTORS: Record<string, string> = {
  [join(PUBLIC_DIR, 'favicon.svg')]: icon(14),
  [join(ASSETS_DIR, 'source.svg')]: sourceSheet(),
};

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  checkTagline();
  mkdirSync(ASSETS_DIR, { recursive: true });

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
