/**
 * How well a model on this machine places a sentence on the curated tree,
 * measured through `judgeGoal` itself, so what is measured is what ships: the
 * question, the "none of these" option, the floors.
 *
 *   npm run judge:eval                       the judge (Kev's default, or AMBIT_JUDGE_URL)
 *   npm run judge:eval -- --judge=<url>      a judge on another loopback port
 *   npm run judge:eval -- --embed            the embedding fallback (AMBIT_EMBED_URL)
 *
 * judge-eval.json holds 48 sentences written for the tree, each with the node
 * a person would mean, and 16 that mean nothing in it. None of them is in the
 * tree, so a model that read the goal phrases is not being tested on them.
 * The floor in judge.ts and the figures in docs/jev.md were measured with it;
 * a new model, a reworded node or a changed prompt is measured again the same
 * way. It needs a running model, so CI does not run it; judge-eval.test.ts
 * holds that every node it names is still in the tree.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeGoal } from '../src/engine/judge.ts';

interface Eval {
  placed: Array<{ text: string; want: string }>;
  offTree: string[];
}

const EVAL: Eval = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'judge-eval.json'), 'utf8')
);

const args = process.argv.slice(2);
const embed = args.includes('--embed');
const named = args.find(a => a.startsWith('--judge='))?.slice('--judge='.length);
// The discard port: nothing answers there, so judgeGoal falls through to the
// embedding model, as it does for a person with no judge running.
const url = embed ? 'http://127.0.0.1:9' : named;

let model = 'unnamed';

type Answer = { top?: string; score?: number; top3: string[]; suggested?: string; none?: number };

async function ask(text: string): Promise<Answer> {
  const out: any = await judgeGoal(text, { url });
  if (out.error) {
    console.error(out.error);
    process.exit(1);
  }
  if (embed && out.by !== 'embedding') {
    console.error(`a judge answered at ${out.asked}; --embed measures the fallback only`);
    process.exit(1);
  }
  if (typeof out.model === 'string') model = out.model;
  const ranked: Array<{ id: string; probability?: number; similarity?: number }> =
    out.considered ?? out.nearest ?? [];
  const strip = (id: string) => id.replace(/^combo:/, '');
  return {
    top: ranked[0] && strip(ranked[0].id),
    score: ranked[0]?.probability ?? ranked[0]?.similarity,
    top3: ranked.map(r => strip(r.id)),
    suggested: out.suggested && strip(out.suggested.id),
    none: out.none,
  };
}

const started = Date.now();
const placed: Array<Answer & { want: string; text: string }> = [];
for (const { text, want } of EVAL.placed) placed.push({ ...(await ask(text)), want, text });
const offTree: Array<Answer & { text: string }> = [];
for (const text of EVAL.offTree) offTree.push({ ...(await ask(text)), text });

const n = placed.length;
const first = placed.filter(p => p.top === p.want);
const scores = (rows: Answer[]) =>
  rows
    .map(r => r.score)
    .filter((s): s is number => typeof s === 'number')
    .sort((a, b) => a - b)
    .map(s => s.toFixed(2))
    .join(' ');

console.log(
  `${embed ? 'embedding' : 'judge'}: ${model}, ${EVAL.placed.length + EVAL.offTree.length} sentences in ${((Date.now() - started) / 1000).toFixed(0)}s`
);
console.log(`  placed first     ${first.length}/${n}`);
console.log(`  in the top three ${placed.filter(p => p.top3.includes(p.want)).length}/${n}`);
console.log(
  `  suggested        ${placed.filter(p => p.suggested === p.want).length} right, ${placed.filter(p => p.suggested && p.suggested !== p.want).length} wrong, ${offTree.filter(o => o.suggested).length} of ${offTree.length} off-tree`
);
if (!embed)
  console.log(
    `  "none of these"  ${offTree.filter(o => !o.top || (o.none ?? 0) >= (o.score ?? 0)).length} of ${offTree.length} off-tree, ${placed.filter(p => (p.none ?? 0) >= (p.score ?? 0)).length} of ${n} placed`
  );
console.log('  top score, to choose a floor by:');
console.log(`    right     ${scores(first)}`);
console.log(`    wrong     ${scores(placed.filter(p => p.top !== p.want))}`);
console.log(`    off-tree  ${scores(offTree)}`);
const misses = placed.filter(p => p.top !== p.want);
if (misses.length) {
  console.log('  placed elsewhere:');
  for (const m of misses) console.log(`    ${m.text} → ${m.top ?? 'nothing'} (meant ${m.want})`);
}
