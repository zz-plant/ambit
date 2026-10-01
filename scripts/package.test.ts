/**
 * What the npm package carries, held to what `ambit web` needs from it.
 *
 * The map used to need a git checkout, so `npx ambit-cli` gave a terminal
 * and nothing to look at. An installed copy now serves the page it shipped
 * with from the compiled API server. Either half left out of the package, or
 * the test harness left in it, ships a `web` that fails or a package that
 * carries code nobody runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('the package carries the built page and the server that serves it, and no test harness', () => {
  const pkg = read('package.json');
  for (const file of ['dist/index.html', 'dist/assets', 'dist-cli', 'cli.js']) {
    expect(pkg.files).toContain(file);
  }
  // Not the docs pages or the social cards: they are the hosted site's.
  expect(pkg.files).not.toContain('dist');
  expect(pkg.scripts.prepack).toContain('vite build');

  const publish = read('tsconfig.publish.json');
  expect(publish.include).toContain('src/server');
  expect(publish.exclude).toContain('src/engine/testing');
});

test('the server finds the page beside itself, not in the directory it was started from', () => {
  const api = readFileSync(join(ROOT, 'src/server/api.ts'), 'utf8');
  expect(api).toContain("join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')");
  expect(api).not.toContain("join(process.cwd(), 'dist')");
});

test('the page loads nothing from another origin', () => {
  // Google Fonts was the one exception, so opening the local map asked Google
  // for a stylesheet on every visit. Links to other sites are fine; a resource
  // the browser fetches on load is not.
  const html = readFileSync(join(ROOT, 'src/client/index.html'), 'utf8');
  const fetched = [
    ...html.matchAll(/<link[^>]+rel="(?:stylesheet|preload|preconnect|modulepreload)"[^>]*>/g),
    ...html.matchAll(/<script[^>]+src="[^"]*"[^>]*>/g),
    ...html.matchAll(/<img[^>]+src="[^"]*"[^>]*>/g),
  ].map(m => m[0]);
  expect(fetched.filter(tag => /(?:href|src)="(?:https?:)?\/\//.test(tag))).toEqual([]);
});
