#!/usr/bin/env bun
/**
 * generate-scenes.ts — renders the two composed brand assets from SVG.
 *
 *   docs/assets/social-preview.png   1280×640, the card link unfurls show
 *   docs/assets/ambit-favicon.png     64×64, the raster favicon
 *
 * Fifteen variants used to come out of here — badge, blur, email header,
 * Mastodon, square, touch — and thirteen of them were referenced by nothing.
 * The social card was then overwritten by a raw 1280×640 screenshot of the
 * UI with the first-run guide covering the legend, so the unfurl showed a
 * modal rather than a wordmark. Two files now, both composed, both with the
 * one tagline.
 *
 * Usage: node --experimental-strip-types scripts/generate-scenes.ts [--dry-run]
 * Needs rsvg-convert (librsvg).
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join(process.cwd(), 'docs', 'assets');
const PUBLIC_DIR = join(process.cwd(), 'src', 'client', 'public');

/** The line the README leads with; index.html, package.json and CITATION.cff quote it too. */
const TAGLINE = [
  'What you, your agents, and your machines',
  'can jointly do — and where',
  'your own time is going.',
];

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

type SceneSpec = { width: number; height: number; minBytes: number; file: string };

const SCENES: Record<string, SceneSpec> = {
  social: { width: 1280, height: 640, minBytes: 15_000, file: 'social-preview.png' },
  favicon: { width: 64, height: 64, minBytes: 600, file: 'ambit-favicon.png' },
};

const DEFS = `
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1120" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <radialGradient id="glowA" cx="25%" cy="20%" r="55%">
      <stop offset="0%" stop-color="rgba(99, 102, 241, 0.16)" />
      <stop offset="100%" stop-color="rgba(99, 102, 241, 0)" />
    </radialGradient>
    <radialGradient id="glowB" cx="85%" cy="85%" r="55%">
      <stop offset="0%" stop-color="rgba(14, 165, 233, 0.12)" />
      <stop offset="100%" stop-color="rgba(14, 165, 233, 0)" />
    </radialGradient>
  </defs>`;

/** A node of the map: filled when reached, outlined when one step away. */
function node(cx: number, cy: number, r: number, color: string, label: string, reached = true) {
  const fill = reached ? color : '#111827';
  const text = reached ? '#ffffff' : '#94a3b8';
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="${reached ? 0 : 2.5}" ${reached ? '' : 'stroke-dasharray="6,4"'} />
    <text x="${cx}" y="${cy + r + 22}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="500" fill="${text}">${label}</text>`;
}

function edge(x1: number, y1: number, x2: number, y2: number, soft = false) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${soft ? 'rgba(148, 163, 184, 0.45)' : 'rgba(99, 102, 241, 0.7)'}" stroke-width="${soft ? 1.5 : 2}" ${soft ? 'stroke-dasharray="5,4"' : ''} stroke-linecap="round" />`;
}

function socialCard(): string {
  // Three era columns of the real tree, reduced: reached nodes filled, the
  // frontier outlined, one keystone marked. The same drawing the map makes.
  const map = `
    <g transform="translate(720, 96)">
      <rect width="480" height="448" rx="18" fill="#111827" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      ${['Foundation', 'Model Access', 'Tool Use']
        .map(
          (era, i) => `
        <rect x="${28 + i * 146}" y="24" width="130" height="400" rx="10" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.06)" />
        <text x="${93 + i * 146}" y="50" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" fill="#f8fafc" letter-spacing="0.3">${era}</text>
        <text x="${93 + i * 146}" y="66" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#7b8799">Era ${i + 1}</text>`
        )
        .join('')}
      ${edge(93, 120, 239, 120)}
      ${edge(93, 120, 239, 230)}
      ${edge(93, 230, 239, 230)}
      ${edge(239, 120, 385, 120)}
      ${edge(239, 230, 385, 230)}
      ${edge(93, 340, 239, 340, true)}
      ${edge(239, 340, 385, 340, true)}
      ${edge(239, 230, 385, 340, true)}
      <rect x="61" y="88" width="64" height="64" rx="8" fill="none" stroke="rgba(245, 158, 11, 0.6)" stroke-width="1.5" stroke-dasharray="4,3" />
      ${node(93, 120, 24, '#8b5cf6', 'Shell')}
      ${node(93, 230, 24, '#8b5cf6', 'Files')}
      ${node(93, 340, 24, '#8b5cf6', 'Git')}
      ${node(239, 120, 24, '#8b5cf6', 'Hosted model')}
      ${node(239, 230, 24, '#8b5cf6', 'Local runtime')}
      ${node(239, 340, 24, '#8b5cf6', 'Embeddings', false)}
      ${node(385, 120, 24, '#8b5cf6', 'Browser')}
      ${node(385, 230, 24, '#8b5cf6', 'Tool calling', false)}
      ${node(385, 340, 24, '#8b5cf6', 'Retrieval', false)}
      <circle cx="405" cy="100" r="9" fill="#10b981" stroke="#111827" stroke-width="2" />
      <text x="405" y="104" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="#ffffff">✓</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
    ${DEFS}
    <rect width="1280" height="640" fill="url(#bgGrad)" />
    <rect width="1280" height="640" fill="url(#glowA)" />
    <rect width="1280" height="640" fill="url(#glowB)" />

    <g transform="translate(96, 160)">
      <g transform="translate(0, -6)">
        <line x1="10" y1="34" x2="26" y2="8" stroke="#6366f1" stroke-width="3" stroke-linecap="round" />
        <line x1="42" y1="34" x2="26" y2="8" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" />
        <line x1="10" y1="34" x2="42" y2="34" stroke="#10b981" stroke-width="2.5" stroke-dasharray="3,3" stroke-linecap="round" />
        <circle cx="26" cy="8" r="7" fill="#1e293b" stroke="#6366f1" stroke-width="3" />
        <circle cx="10" cy="34" r="5.5" fill="#1e293b" stroke="#6366f1" stroke-width="2.5" />
        <circle cx="42" cy="34" r="5.5" fill="#1e293b" stroke="#10b981" stroke-width="2.5" />
      </g>
      <text x="66" y="36" font-family="${FONT}" font-size="56" font-weight="700" fill="#f8fafc" letter-spacing="-1.5">Ambit</text>

      ${TAGLINE.map(
        (line, i) =>
          `<text x="0" y="${108 + i * 38}" font-family="${FONT}" font-size="27" font-weight="500" fill="#e2e8f0">${line}</text>`
      ).join('')}

      <text x="0" y="246" font-family="${FONT}" font-size="15" fill="#94a3b8">One map of every tool, model, skill and credential in your agent setup.</text>
      <text x="0" y="270" font-family="${FONT}" font-size="15" fill="#94a3b8">Ask from the terminal. Your agents ask over MCP.</text>

      <text x="0" y="326" font-family="${FONT}" font-size="13" fill="#7b8799">zz-plant.github.io/ambit</text>
    </g>
    ${map}
  </svg>`;
}

function favicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#090d16" />
    <line x1="20" y1="44" x2="32" y2="22" stroke="#6366f1" stroke-width="3" stroke-linecap="round" />
    <line x1="44" y1="44" x2="32" y2="22" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" />
    <line x1="20" y1="44" x2="44" y2="44" stroke="#10b981" stroke-width="2.5" stroke-dasharray="3,3" stroke-linecap="round" />
    <circle cx="32" cy="22" r="8" fill="#1e293b" stroke="#6366f1" stroke-width="3" />
    <circle cx="20" cy="44" r="6" fill="#1e293b" stroke="#6366f1" stroke-width="2.5" />
    <circle cx="44" cy="44" r="6" fill="#1e293b" stroke="#10b981" stroke-width="2.5" />
  </svg>`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  mkdirSync(ASSETS_DIR, { recursive: true });

  let failed = 0;
  for (const [scene, spec] of Object.entries(SCENES)) {
    const outPath = join(ASSETS_DIR, spec.file);
    if (dryRun) {
      console.log(`  [dry] ${scene}: ${spec.width}×${spec.height} → ${spec.file}`);
      continue;
    }
    const tempSvgPath = join(ASSETS_DIR, `_${scene}_temp.svg`);
    try {
      writeFileSync(tempSvgPath, scene === 'favicon' ? favicon() : socialCard());
      execSync(`rsvg-convert -w ${spec.width} -h ${spec.height} -o "${outPath}" "${tempSvgPath}"`, {
        stdio: 'pipe',
        timeout: 15000,
      });
      const size = statSync(outPath).size;
      if (size < spec.minBytes) {
        console.error(`  ❌ ${scene}: ${size}B, below ${spec.minBytes}B — probably blank`);
        failed++;
      } else {
        console.log(`  ✅ ${spec.file}  ${spec.width}×${spec.height}  ${size.toLocaleString()}B`);
      }
    } catch (e: any) {
      console.error(`  ❌ ${scene}: ${e.stderr || e.message}`);
      failed++;
    } finally {
      if (existsSync(tempSvgPath)) unlinkSync(tempSvgPath);
    }
  }

  // The page serves its own copy of the card for og:image.
  const card = join(ASSETS_DIR, SCENES.social.file);
  if (!dryRun && existsSync(card) && existsSync(PUBLIC_DIR)) {
    copyFileSync(card, join(PUBLIC_DIR, 'social-preview.png'));
  }

  if (failed > 0) process.exit(1);
}

main();
