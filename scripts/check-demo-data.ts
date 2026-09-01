/**
 * Fails when src/client/utils/demo-data.json no longer matches what the engine
 * would produce from the fixture.
 *
 * This is the part that makes generating it worth anything. A generated file
 * that nobody re-generates is a hand-written file with a misleading header —
 * which is how the demo came to describe a machine sharing five ids with the
 * one beside it. The engine's model changes; this says so at the point the
 * model changes, rather than the next time somebody looks at a screenshot.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoData, serialise } from './generate-demo-data.ts';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'client',
  'utils',
  'demo-data.json'
);

const committed = readFileSync(OUT, 'utf8');
const fresh = serialise(buildDemoData());

if (committed === fresh) {
  const { config, tree } = JSON.parse(committed);
  console.log(
    `demo-data.json is current — ${config.items.length} setup items, ${tree.items.length} tree items`
  );
  process.exit(0);
}

console.error(
  'demo-data.json no longer matches what the engine produces from the fixture.\n' +
    'The published demo would show a system this engine would not build.\n' +
    'Run `npm run demo:generate` and commit the result.'
);
process.exit(1);
