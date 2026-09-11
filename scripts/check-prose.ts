#!/usr/bin/env node
/**
 * Two constructions this repository reaches for past the rate English uses them.
 *
 * The prose here is largely machine-written, and a machine writing English
 * leans on the same few moves. Measured across every comment and document that
 * ships, the em dash runs several times the 1 to 3 per thousand words of edited
 * prose, and "rather than" an order of magnitude above the 0.3 it runs there.
 *
 * The two are not the same problem. Auditing the dashes found that almost all
 * of them sit in sentences already carrying two or more commas, where the dash
 * outranks the commas and is doing real work; ten could have been swapped for
 * a comma without loss. Purging the rest would flatten the hierarchy and read
 * worse. "rather than" has no such defense: it is one phrase repeated where
 * "instead of", "not", "never", or a rewritten clause would each serve, and the
 * repetition is what a reader hears.
 *
 * The numbers here are deliberately not written down. They moved once already
 * and the copies went stale; `npm run prose:check` prints the current pair.
 *
 * So this is a ceiling on drift, not a rule about a sentence. One comment that
 * wants three dashes is free to have them. Both numbers are higher than they
 * should be and are meant to come down; lower the ceiling when they do.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');

/**
 * Per thousand words, over the whole corpus. Set just above where the prose
 * stands, so the next drift up fails and every improvement can lower them.
 */
const CEILING = { dash: 9.6, ratherThan: 3.2 };

/** A changelog is a record of what was said at the time, so it is not edited. */
const NOT_PROSE = /^CHANGELOG\.md$|^docs\/incidents\//;

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(f => !NOT_PROSE.test(f));

/** Doc comments and line comments. Code is not prose and is not counted. */
function proseOfSource(text: string): string {
  const parts: string[] = [];
  for (const m of text.matchAll(/\/\*\*(.*?)\*\//gs)) parts.push(m[1].replace(/^\s*\*/gm, ''));
  for (const m of text.matchAll(/^\s*\/\/(.*)$/gm)) parts.push(m[1]);
  return parts.join('\n');
}

/**
 * Markdown without its code fences, which are output and not written, and
 * without table rows, where a cell too narrow for a subordinate clause makes
 * the dash typography.
 */
const proseOfMarkdown = (text: string): string =>
  text
    .replace(/```.*?```/gs, '')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('|'))
    .join('\n');

/**
 * A dash introducing a definition after a leading term is typography:
 * `- **Capability** — one thing your setup can do`. Only the dash inside a
 * running sentence is counted.
 */
const DEFINITION_DASH =
  /(?:^\s*[-*]\s+|^\s*\|\s*|^\s*\d+\.\s+)(?:\*\*)?[^—|\n]{0,60}?(?:\*\*)?\s—/gm;
const DASH = /—/g;
const RATHER_THAN = /\brather than\b/g;

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

type Row = { file: string; words: number; dash: number; ratherThan: number };

const rows: Row[] = [];
for (const file of tracked()) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const prose = file.endsWith('.md') ? proseOfMarkdown(text) : proseOfSource(text);
  const words = prose.split(/\s+/).filter(Boolean).length;
  if (!words) continue;
  rows.push({
    file,
    words,
    dash: count(prose, DASH) - count(prose, DEFINITION_DASH),
    ratherThan: count(prose, RATHER_THAN),
  });
}

const words = rows.reduce((n, r) => n + r.words, 0);
const dash = rows.reduce((n, r) => n + r.dash, 0);
const ratherThan = rows.reduce((n, r) => n + r.ratherThan, 0);
const per1k = (n: number) => (n / words) * 1000;

const over = [
  per1k(dash) > CEILING.dash ? `em dash ${per1k(dash).toFixed(2)} > ${CEILING.dash}` : '',
  per1k(ratherThan) > CEILING.ratherThan
    ? `"rather than" ${per1k(ratherThan).toFixed(2)} > ${CEILING.ratherThan}`
    : '',
].filter(Boolean);

console.log(`prose corpus: ${words.toLocaleString()} words in ${rows.length} files`);
console.log(
  `  em dash       ${dash.toString().padStart(4)}  ${per1k(dash).toFixed(2)}/1k  (ceiling ${CEILING.dash})`
);
console.log(
  `  "rather than" ${ratherThan.toString().padStart(4)}  ${per1k(ratherThan).toFixed(2)}/1k  (ceiling ${CEILING.ratherThan})`
);

if (over.length) {
  const worst = rows
    .filter(r => r.words >= 150)
    .sort((a, b) => b.dash / b.words - a.dash / a.words)
    .slice(0, 10);
  console.error(`\nover ceiling: ${over.join('; ')}`);
  console.error('densest files (dashes per 1k words of their own prose):');
  for (const r of worst) {
    console.error(
      `  ${((r.dash / r.words) * 1000).toFixed(1).padStart(6)}  ${r.dash.toString().padStart(3)} in ${r.words.toString().padStart(5)}w  ${r.file}`
    );
  }
  process.exit(1);
}
