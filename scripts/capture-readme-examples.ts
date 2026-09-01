/**
 * capture-readme-examples.ts — fills the console blocks in README.md with real
 * output.
 *
 * The two examples the README shipped were invented. `ambit goal
 * local-embeddings` was documented as "missing: 1 · steps: 2 · 25m"; it prints
 * four steps and an hour. `ambit impact tool:docker` was documented as a
 * twelve-capability cascade down a named critical path; that id does not exist
 * in any graph the tool builds, and the command answered with the id and
 * nothing else. Both read as evidence and neither was.
 *
 * So the blocks are generated. Each one is delimited in the README by
 *
 *     <!-- example: ambit status -->
 *     ```console
 *     $ ambit status
 *     …
 *     ```
 *     <!-- /example -->
 *
 * and this rewrites what is between the fences from a run against the shared
 * fixture graph. A command that starts failing turns into a visibly failing
 * README rather than a quietly wrong one.
 *
 *   node --experimental-sqlite scripts/capture-readme-examples.ts [--check]
 *
 * `--check` verifies the committed README matches a fresh capture and exits
 * non-zero if it does not, which is the form CI wants.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, seedFixtureGraph, assertNoRealData } from './lib/fixture.ts';

const README = join(ROOT, 'README.md');
const CHECK = process.argv.includes('--check');

/** The commands the README shows, in the order it shows them. */
const EXAMPLES: string[][] = [
  ['status'],
  ['goal', 'local-embeddings'],
  ['impact', 'combo:local-runtime'],
];

// The engine colours its output for a terminal; a README block is not one.
// Matching ESC is the whole job here, so the control character is deliberate.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR codes
const ANSI = /\u001b\[[0-9;]*m/g;

/** Trim to the lines worth showing: a README block is an illustration. */
function excerpt(text: string, limit: number): string {
  const lines = text.replace(ANSI, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length <= limit) return lines.join('\n');
  return [...lines.slice(0, limit), '    …'].join('\n');
}

const sandbox = seedFixtureGraph('ambit-readme');
try {
  let readme = readFileSync(README, 'utf8');
  let replaced = 0;

  for (const argv of EXAMPLES) {
    const label = `ambit ${argv.join(' ')}`;
    const marker = new RegExp(
      `(<!-- example: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n\`\`\`console\\n)([\\s\\S]*?)(\`\`\`\\n<!-- /example -->)`
    );
    if (!marker.test(readme)) {
      console.warn(`  ! no block in README for "${label}" — skipped`);
      continue;
    }
    const out = excerpt(sandbox.engine(argv), 14);
    assertNoRealData(out);
    readme = readme.replace(marker, `$1$ ${label}\n\n${out}\n$3`);
    replaced++;
    console.log(`  ✓ ${label}`);
  }

  const current = readFileSync(README, 'utf8');
  if (CHECK) {
    if (current !== readme) {
      console.error('\nREADME console examples are stale. Run:\n  npm run docs:examples\n');
      process.exit(1);
    }
    console.log(`\n${replaced} example(s) match the engine's actual output.`);
  } else {
    writeFileSync(README, readme);
    console.log(`\nWrote ${replaced} example(s) into README.md`);
  }
} finally {
  sandbox.cleanup();
}
