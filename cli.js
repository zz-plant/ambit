#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * How the engine is launched.
 *
 * `--experimental-sqlite` is what Node 22 needs to expose node:sqlite; on 24 it
 * is accepted and unnecessary. The second flag suppresses the notice Node
 * prints because of the first — without it, every single `ambit` command an
 * installed user runs begins with a warning about a flag they did not pass,
 * about a module they did not choose, which reads as something being wrong.
 */
const NODE_FLAGS = ['--experimental-sqlite', '--disable-warning=ExperimentalWarning'];

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli.js sits at the package root, next to src/ — resolving ".." walked out
// of the package entirely and every command failed to find the engine.
const ROOT = __dirname;

const B = '\x1b[1m',
  R = '\x1b[0m',
  D = '\x1b[90m';

// A git checkout runs the TypeScript sources directly; an npm or Homebrew
// install runs the compiled copy in dist-cli, because Node refuses to
// type-strip anything under node_modules. Source wins when both exist so a
// contributor's edits are never shadowed by a stale build.
const srcEngine = resolve(ROOT, 'src', 'engine', 'engine.ts');
const engineEntry = existsSync(srcEngine)
  ? srcEngine
  : resolve(ROOT, 'dist-cli', 'engine', 'engine.js');
const mcpEntry = existsSync(resolve(ROOT, 'src', 'mcp', 'server.ts'))
  ? resolve(ROOT, 'src', 'mcp', 'server.ts')
  : resolve(ROOT, 'dist-cli', 'mcp', 'server.js');

const cmd = process.argv[2];
const args = process.argv.slice(3);

/**
 * Help is the engine's to print, not this wrapper's.
 *
 * This file used to carry its own hand-written command list. It drifted: the
 * engine grew `share`, `credentials`, `opportunities`, `roi`, `audit`, `work`
 * and `usage`, the list here did not, and `ambit help` claimed to be the full
 * surface while hiding seven working commands. Worse, intercepting `help`
 * swallowed its arguments, so `help --all` and `help <term>` — both of which
 * the engine implements — could never run.
 *
 * The engine derives its list from the same groups the dispatcher routes on,
 * so it cannot fall behind. `web` and `mcp` are the exception: they are
 * implemented here, never reach the engine, and so cannot appear in a list the
 * engine builds. They are appended after it.
 */
if (cmd === '--help' || cmd === 'help') {
  const helpArgs = cmd === 'help' ? args : [];
  const engineHelp = spawnSync('node', [...NODE_FLAGS, engineEntry, 'help', ...helpArgs], {
    stdio: 'inherit',
  });
  console.log(`
  ${D}ambit web              Open the visualizer. Needs a git checkout: it is
                         built with dev dependencies an installed copy does
                         not carry.
  ambit mcp              Run the MCP server, exposing the same questions to an
                         agent session: claude mcp add ambit -- ambit mcp${R}
`);
  process.exit(engineHelp.status ?? 0);
}

// Bare `ambit` used to print help — a list of things to read before doing
// anything. Showing where you actually are teaches more in one screen, and
// the help is still one flag away.
if (!cmd) {
  const run = (c, args = []) =>
    spawnSync('node', [...NODE_FLAGS, engineEntry, c, ...args], { stdio: 'inherit' });
  console.log(`\n${B}Where you are${R}`);
  run('status');
  console.log(
    `\n${D}ambit --help for every command · ambit help <term> for what the terms mean${R}\n`
  );
  process.exit(0);
}

if (cmd === 'web') {
  // The visualizer needs the dev dependencies (vite, react), which an npm or
  // Homebrew install of the CLI does not carry. Failing here with bun's
  // "script not found" taught nothing; say what the situation is.
  const hasBun = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;
  const hasDevDeps = existsSync(resolve(ROOT, 'node_modules', 'vite'));
  if (!hasBun || !hasDevDeps) {
    console.log(
      `\n  The visual map runs from a git checkout (the CLI install doesn't carry the web app):\n`
    );
    console.log(
      `    git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh web\n`
    );
    if (!hasBun) console.log(`  ${D}It also needs Bun — https://bun.sh${R}`);
    console.log(
      `  ${D}Or try the hosted demo with example data: https://zz-plant.github.io/ambit/?demo=1${R}\n`
    );
    process.exit(1);
  }
  spawnSync('bun', ['run', 'dev'], { cwd: ROOT, stdio: 'inherit' });
  process.exit(0);
}

// The MCP server, runnable from any install: `claude mcp add ambit -- ambit mcp`.
// Before this, registering it meant knowing where npm put the package.
if (cmd === 'mcp') {
  const result = spawnSync('node', [...NODE_FLAGS, mcpEntry], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

const result = spawnSync('node', [...NODE_FLAGS, engineEntry, cmd, ...args], {
  stdio: 'inherit',
});
process.exit(result.status || 0);
