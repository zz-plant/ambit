/**
 * A dependency array may not contain a function plucked off a value.
 *
 * This exists because of a real hang. A lint autofix "completed" two effect
 * dependency arrays in App.tsx with `params.get` and `items.find`. Both are
 * methods read off a value rebuilt on every render — `new URLSearchParams(...)`
 * and a fresh `items` array — so each render produced a new identity, the
 * effect re-ran, it loaded the graph, that set state, and the render happened
 * again. The result was an unbounded loop of GET /api/tech-tree that pinned
 * the tab until Chrome reported ERR_INSUFFICIENT_RESOURCES.
 *
 * Nothing caught it: types were fine, lint was satisfied (it had written the
 * code), and the client's other test renders with `renderToStaticMarkup`,
 * which never runs an effect at all.
 *
 * `items.length` is fine and stays legal — it is a number. What is banned is a
 * *callable* read off something the render just created, which is never a
 * dependency and is always a re-render trigger.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const CLIENT = join(import.meta.dirname, '.');

/** Properties that are functions rather than values, on the types used here. */
const CALLABLE = [
  'get', 'set', 'has', 'find', 'findIndex', 'map', 'filter', 'some', 'every',
  'includes', 'indexOf', 'slice', 'reduce', 'forEach', 'join', 'sort', 'concat',
  'keys', 'values', 'entries', 'push', 'pop', 'at', 'flatMap', 'split',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'public' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

test('no effect depends on a method read off a per-render value', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(CLIENT)) {
    const source = readFileSync(file, 'utf8');
    // The closing line of a hook call: `}, [a, b.c]);`
    for (const match of source.matchAll(/\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/g)) {
      const deps = match[1]
        .split(',')
        .map(d => d.replace(/\/\/.*$/gm, '').trim())
        .filter(Boolean);
      for (const dep of deps) {
        const property = dep.split('.').pop();
        if (dep.includes('.') && property && CALLABLE.includes(property)) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${file.replace(CLIENT, 'src/client')}:${line} — ${dep}`);
        }
      }
    }
  }

  expect(offenders).toEqual([]);
});
