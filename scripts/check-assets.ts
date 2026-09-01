#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const ASSETS_DIR = join(ROOT, 'docs', 'assets');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type Spec = { width: number; height: number; minBytes: number };

const SPECS: Record<string, Spec> = {
  badge: { width: 240, height: 96, minBytes: 2_000 },
  blur: { width: 50, height: 28, minBytes: 300 },
  card: { width: 400, height: 300, minBytes: 8_000 },
  circle: { width: 540, height: 540, minBytes: 8_000 },
  dark: { width: 960, height: 540, minBytes: 10_000 },
  demo: { width: 720, height: 405, minBytes: 12_000 },
  email: { width: 600, height: 200, minBytes: 5_000 },
  favicon: { width: 64, height: 64, minBytes: 600 },
  github: { width: 1280, height: 640, minBytes: 15_000 },
  header: { width: 1920, height: 400, minBytes: 12_000 },
  mastodon: { width: 1200, height: 600, minBytes: 15_000 },
  og: { width: 1200, height: 675, minBytes: 15_000 },
  square: { width: 1080, height: 1080, minBytes: 15_000 },
  touch: { width: 360, height: 360, minBytes: 8_000 },
  unfurl: { width: 1200, height: 628, minBytes: 15_000 },
};

const COLOR_TYPE_LABELS: Record<number, string> = {
  0: 'grayscale',
  2: 'RGB',
  3: 'indexed',
  4: 'grayscale+alpha',
  6: 'RGBA',
};

type PngInfo = {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  byteLength: number;
};

function readPngInfo(filePath: string): PngInfo {
  const buf = readFileSync(filePath);
  if (buf.length < 33) throw new Error('file too small for valid PNG');
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a valid PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
    bitDepth: buf.readUInt8(24),
    byteLength: buf.length,
  };
}

// ── Staleness ────────────────────────────────────────────────────────────────
//
// The specs above check that the branding PNGs are the right shape. They say
// nothing about whether a picture of the product still shows the product, and
// for two UI generations nothing did: the README's hero GIF was a light theme
// with a toolbar that no longer existed, and the only reason anyone noticed was
// that a person looked at it.
//
// The obvious check — "is the image older than the last commit to src/client" —
// is the one this file shipped with, and it was wrong. It fired on every commit
// to the client, including a scrollbar fix that changed no pixel of the frame,
// and the only way to clear it was to re-record a 425KB binary. That turns a
// staleness check into a machine for pushing half a megabyte into git history
// per UI commit; the hero GIF has already been rewritten seven times for 4.6MB
// of blobs. A gate whose remedy is worse than the problem gets disabled, and it
// should be.
//
// CI cannot answer the real question — whether the picture still looks like the
// product — because answering it means rendering the product, which needs
// Chrome and ffmpeg. So this measures rot rather than correctness: how many
// commits to the client the image is behind. One is noise. Twenty is a
// different screen. The threshold is where the two stop being confusable.

/**
 * Pictures of the running client that the README embeds, mapped to the command
 * that regenerates each one.
 *
 * Only assets with a producer are listed: a check that fails without being able
 * to say how to fix it teaches a contributor to ignore it. When a screenshot
 * gains a recorder, it belongs here.
 */
const UI_ASSETS: Record<string, string> = {
  'capability-graph-demo.gif': 'npm run assets:hero',
};

/**
 * How far behind an image may fall before it is treated as wrong rather than
 * merely old.
 *
 * Not a measure of anything exact — it is the point at which "the client has
 * moved on since this was taken" stops being a guess. The failure this exists
 * to catch was fourteen commits and two UI generations behind; a lint pass and
 * a CSS fix are one or two.
 */
const STALE_AFTER_COMMITS = 12;

export type Staleness = 'current' | 'drifting' | 'stale';

/**
 * What a number of unaccounted-for client commits means for an image.
 *
 * Separated from the reporting so the rule can be tested without a git history
 * to arrange: this file had no tests, and the version of it that shipped
 * yesterday failed CI on its first real commit.
 */
export function stalenessOf(behind: number, strict = false): Staleness {
  if (behind <= 0) return 'current';
  if (strict || behind >= STALE_AFTER_COMMITS) return 'stale';
  return 'drifting';
}

/** Commit epoch of the last change to `path`, or null outside a git checkout. */
function lastCommit(path: string): number | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? Number(out) * 1000 : null;
  } catch {
    return null;
  }
}

/** Commits touching `path` since `sinceIso`, newest first. */
function commitsSince(path: string, sinceEpoch: number): string[] {
  try {
    return execFileSync(
      'git',
      ['log', '--format=%h %s', `--since=@${Math.floor(sinceEpoch / 1000)}`, '--', path],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Reports how far each README image has fallen behind the client.
 *
 * `strict` (the --strict flag) fails on any drift at all. That is the right
 * setting for a release, where re-recording once is proportionate; it is the
 * wrong setting for every push, which is what this file used to do.
 */
function checkStaleness(errors: string[], warnings: string[], strict: boolean): void {
  if (lastCommit('src/client') === null) {
    console.log('\n  ⚠  not a git checkout — skipping the staleness check\n');
    return;
  }

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  console.log('\n🕒 Staleness — README images against commits to src/client\n');

  for (const [name, command] of Object.entries(UI_ASSETS)) {
    const rel = `docs/assets/${name}`;
    if (!readme.includes(rel)) continue; // not on the page a reader sees

    const taken = lastCommit(rel);
    if (taken === null) {
      errors.push(`${name}: referenced by README but not committed`);
      continue;
    }

    const behind = commitsSince('src/client', taken);
    if (behind.length === 0) {
      console.log(`  ✅ ${name}  current with the client`);
      continue;
    }

    const summary =
      `${name}: ${behind.length} commit(s) to src/client since it was recorded` +
      ` — ${behind
        .slice(0, 3)
        .map(c => c.split(' ')[0])
        .join(', ')}` +
      (behind.length > 3 ? `, +${behind.length - 3} more` : '');

    if (stalenessOf(behind.length, strict) === 'stale') {
      errors.push(`${summary}. Run \`${command}\`.`);
    } else {
      warnings.push(`${summary}. Re-record with \`${command}\` if any of them changed the view.`);
      console.log(`  ⚠  ${summary}`);
    }
  }
}

function main() {
  const files = readdirSync(ASSETS_DIR)
    .filter(f => f.endsWith('.png'))
    .sort();
  if (files.length === 0) {
    console.error(`FAIL: no PNGs found in ${ASSETS_DIR}`);
    process.exit(1);
  }

  const errors: string[] = [];
  const found = new Set<string>();
  const filesWithSizes = files.map(f => ({
    name: f,
    size: statSync(join(ASSETS_DIR, f)).size,
  }));

  const prefix = (files[0] ?? 'unknown').split('-')[0] ?? '';
  console.log(`\n🔍 Checking assets for «${prefix}» in ${ASSETS_DIR}\n`);

  for (const { name, size } of filesWithSizes) {
    const filePath = join(ASSETS_DIR, name);
    let typeKey = name.replace(/\.png$/, '').replace(new RegExp(`^${prefix}-`), '');

    if (typeKey.startsWith('dark-og')) typeKey = 'dark';
    else if (typeKey.startsWith('touch')) typeKey = 'touch';
    else if (typeKey.startsWith('github-preview')) typeKey = 'github';

    const spec = SPECS[typeKey];
    if (!spec) {
      try {
        const info = readPngInfo(filePath);
        found.add(typeKey);
        console.log(`  ⚠  ${name}  (${info.width}×${info.height}) — no spec, skipped`);
      } catch (e: unknown) {
        errors.push(`${name}: invalid PNG — ${(e as Error).message}`);
      }
      continue;
    }

    found.add(typeKey);
    try {
      const info = readPngInfo(filePath);

      if (info.width !== spec.width || info.height !== spec.height) {
        errors.push(
          `${name}: expected ${spec.width}×${spec.height}, got ${info.width}×${info.height}`
        );
        continue;
      }
      if (info.colorType === 3) {
        errors.push(`${name}: indexed color (type 3) — posterized`);
        continue;
      }
      if (info.bitDepth < 8) {
        errors.push(`${name}: low bit depth (${info.bitDepth}-bit)`);
        continue;
      }
      if (size < spec.minBytes) {
        errors.push(
          `${name}: ${size}B < ${spec.minBytes}B min — possible posterization or truncation`
        );
        continue;
      }

      const label = COLOR_TYPE_LABELS[info.colorType] ?? `type${info.colorType}`;
      console.log(
        `  ✅ ${name}  ${info.width}×${info.height}  ${size.toLocaleString()}B  ${label}`
      );
    } catch (e: unknown) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  const svgPath = join(ASSETS_DIR, 'source.svg');
  try {
    const svg = readFileSync(svgPath, 'utf8').trim();
    if (svg.startsWith('<svg') || svg.startsWith('<?xml')) {
      console.log(
        `  ✅ source.svg  (${(statSync(svgPath).size).toLocaleString()}B)  design reference`
      );
    } else {
      errors.push('source.svg: invalid SVG (missing <svg> root)');
    }
  } catch {
    errors.push('source.svg: missing — design source file required');
  }

  const warnings: string[] = [];
  checkStaleness(errors, warnings, process.argv.includes('--strict'));

  const expectedTypes = Object.keys(SPECS);
  const missing = expectedTypes.filter(t => !found.has(t));
  if (missing.length > 0) {
    console.log(`\n  ⚠  Missing types: ${missing.join(', ')}`);
  }

  console.log(
    `\n${errors.length === 0 ? '✅ All assets valid' : '❌ FAILURES:'}  (${files.length} PNGs, 1 SVG checked)\n`
  );

  for (const warn of warnings) console.warn(`  ⚠  ${warn}`);

  if (errors.length > 0) {
    for (const err of errors) console.error(`  ❌ ${err}`);
    process.exit(1);
  }
}

// Only when run as a script; the exports above are imported by its test.
if (process.argv[1]?.endsWith('check-assets.ts')) main();
