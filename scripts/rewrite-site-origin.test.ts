/**
 * A build for another host names that host everywhere a crawler or a person
 * reads, and a build for GitHub Pages leaves every file byte for byte.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'rewrite-site-origin.ts');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A dist directory holding the three hand-written files and one hashed bundle. */
function dist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-site-'));
  dirs.push(dir);
  const files: Record<string, string> = {
    'index.html': '<link rel="canonical" href="https://zz-plant.github.io/ambit/" />',
    'llms.txt': '[FAQ](https://zz-plant.github.io/ambit/docs/faq/)',
    'robots.txt': 'Sitemap: https://zz-plant.github.io/ambit/sitemap.xml',
    'sitemap.xml': '<loc>https://zz-plant.github.io/ambit/docs/</loc>',
    'assets/index-abc123.js': 'const site = "https://zz-plant.github.io/ambit/";',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(dir: string, env: Record<string, string>): void {
  execFileSync(process.execPath, ['--experimental-strip-types', SCRIPT, dir], {
    env: { ...process.env, AMBIT_SITE_ORIGIN: '', AMBIT_SITE_BASE: '', ...env },
    stdio: 'pipe',
  });
}

const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');

test('a root-served build rewrites every text file and leaves the bundle alone', () => {
  const dir = dist();
  run(dir, { AMBIT_SITE_ORIGIN: 'https://ambit.example.com', AMBIT_SITE_BASE: '/' });

  expect(read(dir, 'index.html')).toContain('href="https://ambit.example.com/"');
  expect(read(dir, 'llms.txt')).toContain('https://ambit.example.com/docs/faq/');
  expect(read(dir, 'robots.txt')).toContain('https://ambit.example.com/sitemap.xml');
  expect(read(dir, 'sitemap.xml')).toContain('<loc>https://ambit.example.com/docs/</loc>');
  // A hashed file keeps its content hash, so the page that asks for it still finds it.
  expect(read(dir, 'assets/index-abc123.js')).toBe(
    'const site = "https://zz-plant.github.io/ambit/";'
  );
});

test('the GitHub Pages build is unchanged', () => {
  const dir = dist();
  const before = Object.fromEntries(
    ['index.html', 'llms.txt', 'robots.txt', 'sitemap.xml', 'assets/index-abc123.js'].map(p => [
      p,
      read(dir, p),
    ])
  );
  run(dir, {});
  for (const [path, text] of Object.entries(before)) {
    expect(read(dir, path), path).toBe(text);
  }
});
