#!/usr/bin/env node
/**
 * One answer to "is this change done": the checks CI runs, in one command.
 *
 * `npm run check` runs every `npm run` step of ci.yml's check job and prints
 * one line per step. A step that fails prints the end of its own output and
 * the command that usually fixes it, and the run goes on, so one pass names
 * everything that is wrong. `npm run check -- --fast` runs lint, typecheck and
 * the suite only, which is the loop to iterate in.
 *
 * It leaves out `./bootstrap.sh`, which CI runs on a machine with no agent
 * config and which seeds a graph and links the `ambit` command here, and the
 * Windows job. check.test.ts holds the list to ci.yml.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');

export interface Step {
  /** The package.json script. */
  script: string;
  /** Whether `--fast` runs it. */
  fast?: true;
  /** Whether only `--fast` runs it, because a full step already covers it. */
  fastOnly?: true;
  /** What to do when it fails, in one line. */
  fix: string;
}

/** Cheapest first, so the first lines printed are the ones that fail soonest. */
export const STEPS: readonly Step[] = [
  {
    script: 'lint',
    fast: true,
    fix: '`npm run lint:fix` rewrites what Biome can; fix what it still reports by hand.',
  },
  {
    script: 'typecheck',
    fast: true,
    fastOnly: true,
    fix: 'Both tsconfig projects must be at zero errors. Fix the type, never cast past it.',
  },
  {
    script: 'test',
    fast: true,
    fastOnly: true,
    fix: 'Run the one file: `npx vitest run <path>`. A failing test names a rule in AGENTS.md more often than a bug in the test.',
  },
  {
    script: 'build',
    fix: 'A type error fails this first; `npm run typecheck` shows it alone. Otherwise read the Vite or docs:build error above.',
  },
  {
    script: 'test:coverage',
    fix: 'A failing test: `npx vitest run <path>`. A coverage floor: add a test for what you added, never lower the floor in vitest.config.ts.',
  },
  {
    script: 'assets:check',
    fix: 'A shipped image is the wrong size or stale. `npm run assets:generate` or `npm run assets:hero` re-makes them.',
  },
  {
    script: 'prose:check',
    fix: 'The corpus went over a ceiling. Reword what you wrote: fewer em dashes, and "instead of", "not" or "never" for "rather than".',
  },
  {
    script: 'docs:examples:check',
    fix: 'A README console block no longer matches the command. If the new output is right, `npm run docs:examples` rewrites the block.',
  },
  {
    script: 'mcp:check',
    fix: 'The MCP listing is over its byte budget or a description fails. Shorten a description in src/mcp/tools.ts.',
  },
  {
    script: 'demo:check',
    fix: 'The demo data no longer matches the engine. If the model change is intended, `npm run demo:generate` rebuilds it.',
  },
];

export const stepsFor = (fast: boolean): Step[] => STEPS.filter(s => (fast ? s.fast : !s.fastOnly));

/** The end of a step's output, which is where a runner puts what failed. */
export function tail(output: string, lines = 30): string {
  const all = output.trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--fast');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: npm run check [-- --fast]`);
    process.exit(2);
  }
  const fast = args.includes('--fast');
  const failed: string[] = [];
  for (const step of stepsFor(fast)) {
    const started = Date.now();
    const run = spawnSync('npm', ['run', '--silent', step.script], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (run.status === 0) {
      console.log(`ok    ${step.script} (${seconds}s)`);
      continue;
    }
    failed.push(step.script);
    console.log(`FAIL  ${step.script} (${seconds}s)`);
    console.log(
      tail(`${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`)
    );
    console.log(`  fix: ${step.fix}\n`);
  }
  if (failed.length) {
    console.log(
      `${failed.length} failed: ${failed.join(', ')}. Re-run one with \`npm run <name>\`.`
    );
    process.exit(1);
  }
  console.log(
    fast
      ? 'The fast checks pass. Run `npm run check` before a pull request.'
      : 'Every check CI runs from npm passes.'
  );
}

if (process.argv[1]?.endsWith('check.ts')) main();
