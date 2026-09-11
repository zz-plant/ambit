/**
 * capture-doc-examples.ts — fills marked console blocks in the docs with real
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
 *   node --experimental-sqlite scripts/capture-doc-examples.ts [--check]
 *
 * `--check` verifies the committed files match a fresh capture and exits
 * non-zero if they do not, which is the form CI wants.
 *
 * TARGETS is a list because the README is not the only file that could carry a
 * captured block. It is currently the only file that does, and that is a
 * decision rather than a limitation: the hand-written blocks in the deep dive
 * and the roadmap are illustrations chosen to make a point, and the fixture
 * graph carries a deliberately failing check, so capturing them would replace
 * the argument each one is making with a different one. Those blocks are left
 * untagged for that reason, and ```console now means captured everywhere it
 * appears. To add one: tag the fence `console`, wrap it in the marker pair, and
 * add the command here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, seedFixtureGraph, assertNoRealData } from './lib/fixture.ts';

const CHECK = process.argv.includes('--check');

/** Each file that carries captured blocks, and the commands it shows, in order. */
const TARGETS: { file: string; examples: string[][] }[] = [
  {
    file: 'README.md',
    examples: [['status'], ['goal', 'local-embeddings'], ['impact', 'combo:local-runtime']],
  },
];

// The engine colours its output for a terminal; a README block is not one.
// Matching ESC is the whole job here, so the control character is deliberate.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR codes
const ANSI = /\u001b\[[0-9;]*m/g;

/** Trim to the lines worth showing: a captured block is an illustration. */
function excerpt(text: string, limit: number): string {
  const lines = text.replace(ANSI, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length <= limit) return lines.join('\n');
  return [...lines.slice(0, limit), '    …'].join('\n');
}

const sandbox = seedFixtureGraph('ambit-docs');
try {
  let replaced = 0;
  const stale: string[] = [];

  for (const target of TARGETS) {
    const path = join(ROOT, target.file);
    const before = readFileSync(path, 'utf8');
    let after = before;

    for (const argv of target.examples) {
      const label = `ambit ${argv.join(' ')}`;
      const marker = new RegExp(
        `(<!-- example: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->\\n\`\`\`console\\n)([\\s\\S]*?)(\`\`\`\\n<!-- /example -->)`
      );
      if (!marker.test(after)) {
        console.warn(`  ! no block in ${target.file} for "${label}" — skipped`);
        continue;
      }
      const out = excerpt(sandbox.engine(argv), 14);
      assertNoRealData(out);
      after = after.replace(marker, `$1$ ${label}\n\n${out}\n$3`);
      replaced++;
      console.log(`  ✓ ${target.file}: ${label}`);
    }

    if (before === after) continue;
    if (CHECK) stale.push(target.file);
    else writeFileSync(path, after);
  }

  if (CHECK) {
    if (stale.length) {
      console.error(
        `\nConsole examples are stale in ${stale.join(', ')}. Run:\n  npm run docs:examples\n`
      );
      process.exit(1);
    }
    console.log(`\n${replaced} example(s) match the engine's actual output.`);
  } else {
    console.log(`\nWrote ${replaced} example(s) across ${TARGETS.length} file(s)`);
  }
} finally {
  sandbox.cleanup();
}
