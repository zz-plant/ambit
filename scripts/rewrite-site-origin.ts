#!/usr/bin/env node
/**
 * The built site's absolute URLs, pointed at the host it is being published to.
 *
 * Three files name the production address by hand: index.html writes its
 * canonical link, its Open Graph tags and its structured data; public/llms.txt
 * and public/robots.txt are copied byte for byte. Everything else is generated
 * from scripts/site.ts. A build for another host runs this after both build
 * steps, so no file claims an origin the site is not on.
 *
 * Only text a person or a crawler reads is touched. A hashed bundle is never
 * rewritten, so its content hash stays the name its page asks for.
 *
 *   node --experimental-strip-types scripts/rewrite-site-origin.ts [dir]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, DEFAULT_BASE, DEFAULT_ORIGIN, ORIGIN } from './site.ts';

const ROOT = join(import.meta.dirname ?? __dirname, '..');

/** Extensions a crawler or a person reads. A `.js` file is never one of them. */
const TEXT = new Set(['.html', '.txt', '.xml', '.json']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export interface Rewrite {
  /** Files whose text changed. */
  files: number;
  /** Absolute URLs that now name the configured host. */
  urls: number;
}

/**
 * Replace the default origin and prefix with the configured ones, in every text
 * file under `dir`. A build at the default origin rewrites nothing, because the two
 * are the same string.
 */
export function rewriteSiteOrigin(dir = join(ROOT, 'dist')): Rewrite {
  const from = `${DEFAULT_ORIGIN}${DEFAULT_BASE}`;
  const to = `${ORIGIN}${BASE}`;
  if (from === to) return { files: 0, urls: 0 };

  let files = 0;
  let urls = 0;
  for (const path of walk(dir)) {
    if (!TEXT.has(extname(path))) continue;
    const before = readFileSync(path, 'utf8');
    // The whole site first, so a link to the demo or a doc page keeps its path.
    const site = before.split(from).join(to);
    // Then a bare origin, which a link to the repository root or an asset at
    // the host's root can be written as.
    const after = site.split(DEFAULT_ORIGIN).join(ORIGIN);
    if (after === before) continue;
    urls += before.split(from).length - 1 + site.split(DEFAULT_ORIGIN).length - 1;
    writeFileSync(path, after);
    files += 1;
  }
  return { files, urls };
}

if (process.argv[1] && normalize(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || join(ROOT, 'dist');
  const { files, urls } = rewriteSiteOrigin(dir);
  console.log(`site: ${urls} absolute URLs in ${files} files name ${ORIGIN}${BASE}`);
}
