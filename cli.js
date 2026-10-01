#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
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

// Colour only on a terminal, and not when NO_COLOR is set to anything but
// empty. This is a transcription of `colorOn` in src/engine/cli/output.ts, not
// a second opinion: this file is plain JavaScript run by a bare `node`, which
// cannot load the engine's TypeScript, so the test is repeated here and has to
// match. A pipe gets the same words from both with nothing painted on them.
const painted = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const R = painted ? '\x1b[0m' : '',
  D = painted ? '\x1b[90m' : '';

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
  ${D}ambit web [--port=N] [--no-open]   Open the map on localhost: the built
                         page from an install, Vite from a checkout
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
  // The short screen; `ambit status` is the whole report, and the screen ends
  // by saying so.
  console.log('');
  const shown = run('status', ['--brief']);
  process.exit(shown.status ?? 0);
}

/**
 * The first port from `from` that nothing on loopback is listening on. 3001
 * is a common default for other development servers, and a map that failed
 * with EADDRINUSE taught nothing about which port to pass instead.
 */
function freePort(from) {
  return new Promise(done => {
    const probe = createServer();
    probe.once('error', () => done(freePort(from + 1)));
    probe.listen(from, '127.0.0.1', () => probe.close(() => done(from)));
  });
}

if (cmd === 'web') {
  // A checkout runs Vite with its dev dependencies, so an edit shows at once.
  // An install has no Vite and runs the page it shipped with.
  //
  // Node is the only runtime. This used to insist on Bun as well, which
  // bootstrap.sh never needed and CI never installs — a checkout that had
  // just run `./bootstrap.sh web` successfully was told it lacked a tool.
  const hasDevDeps = existsSync(resolve(ROOT, 'node_modules', 'vite'));
  if (!hasDevDeps) {
    // An installed copy carries the built page and the API server that serves
    // it, so the map runs here too: one process, loopback only, the same
    // server a checkout's `npm start` runs.
    const page = resolve(ROOT, 'dist', 'index.html');
    const srcServer = resolve(ROOT, 'src', 'server', 'api.ts');
    const server = existsSync(srcServer)
      ? srcServer
      : resolve(ROOT, 'dist-cli', 'server', 'api.js');
    if (!existsSync(page) || !existsSync(server)) {
      console.log(`\n  This install does not carry the map. From a git checkout:\n`);
      console.log(
        `    git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh web\n`
      );
      console.log(
        `  ${D}ambit share writes the map as one HTML file; the hosted demo is https://zz-plant.github.io/ambit/?demo=1${R}\n`
      );
      process.exit(1);
    }
    // The server reads the graph and never builds it, so an empty one is
    // seeded first, the same way any other first command is.
    const where = spawnSync('node', [...NODE_FLAGS, engineEntry, 'where', '--json'], {
      encoding: 'utf8',
    });
    let seeded = true;
    try {
      seeded = JSON.parse(where.stdout).capabilities > 0;
    } catch {}
    if (!seeded) spawnSync('node', [...NODE_FLAGS, engineEntry, 'seed'], { stdio: 'inherit' });

    const asked = args.find(a => a.startsWith('--port='))?.slice(7) || process.env.AMBIT_API_PORT;
    const port = asked ? Number(asked) : await freePort(3001);
    const url = `http://localhost:${port}/`;
    const child = spawn('node', [...NODE_FLAGS, server], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, AMBIT_API_PORT: String(port), NODE_ENV: 'production' },
    });
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('running on')) return process.stdout.write(chunk);
      console.log(`\n  The map: ${url}\n  ${D}Loopback only. Ctrl-C stops it.${R}\n`);
      // Typed by the person, to their own machine: opening it is the command.
      if (!args.includes('--no-open')) {
        const opener =
          process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
        if (opener)
          spawn(opener, [url], { stdio: 'ignore', detached: true })
            .on('error', () => {})
            .unref();
      }
    });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.on('exit', code => process.exit(code ?? 0));
  } else {
    const web = spawnSync('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'inherit' });
    process.exit(web.status ?? 0);
  }
}

// The MCP server, runnable from any install: `claude mcp add ambit -- ambit mcp`.
// Before this, registering it meant knowing where npm put the package. What
// follows `mcp` is the server's own: `ambit mcp --profile=agent` offers the
// ten tools a working agent needs and not all sixty.
if (cmd === 'mcp') {
  const result = spawnSync('node', [...NODE_FLAGS, mcpEntry, ...args], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

// `web` from an install keeps running as the server's parent, so it must not
// fall through to the engine, which knows no such verb.
if (cmd !== 'web') {
  const result = spawnSync('node', [...NODE_FLAGS, engineEntry, cmd, ...args], {
    stdio: 'inherit',
  });
  process.exit(result.status || 0);
}
