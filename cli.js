#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli.js sits at the package root, next to src/ — resolving ".." walked out
// of the package entirely and every command failed to find the engine.
const ROOT = __dirname;

const B = "\x1b[1m", R = "\x1b[0m", D = "\x1b[90m";

// A git checkout runs the TypeScript sources directly; an npm or Homebrew
// install runs the compiled copy in dist-cli, because Node refuses to
// type-strip anything under node_modules. Source wins when both exist so a
// contributor's edits are never shadowed by a stale build.
const srcEngine = resolve(ROOT, "src", "engine", "engine.ts");
const engineEntry = existsSync(srcEngine) ? srcEngine : resolve(ROOT, "dist-cli", "engine", "engine.js");
const mcpEntry = existsSync(resolve(ROOT, "src", "mcp", "server.ts"))
  ? resolve(ROOT, "src", "mcp", "server.ts")
  : resolve(ROOT, "dist-cli", "mcp", "server.js");

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "--help" || cmd === "help") {
  console.log(`
  Ambit — what you, your agents and your machines can jointly do,
  and where the scarce resource is being spent.

  ${B}Operate${R}
    ambit status           Health · degraded · spofs · deficits · pending approvals
    ambit graph            The graph as JSON (graph surface | combos | affordances)
    ambit history [since]  How the frontier moved

  ${B}Decide${R}
    ambit goal <cap-or-sentence> [--paths|--simulate|--prefs]
                           Route a goal, plan the delta, compare paths, simulate
    ambit attention [days] How much work still runs through the human
    ambit notify <topic>   Push the attention digest to ntfy — opt-in only
    ambit impact <id>      If this went away, what breaks?
    ambit verify [id] [--history]   Run the declared check, or past verification
    ambit authority [cap] [scope <target>]   What may run, on what, unattended
    ambit propose <id> [n] Draft a reviewable acquisition, using alternative n
    ambit proposals        Drafts so far ·  ambit proposal <id>  One in full

  ${B}Govern${R}
    ambit approve <id> <who>  Record that a person approved a draft
    ambit apply <id>       Apply an approved draft to your config
    ambit rollback <id>    Reverse an applied draft

  ${B}Record${R}
    ambit record <id> [class] [note]   Record that a missing capability blocked work

  ${B}Setup${R}
    ambit seed             Read your agent config and build the graph
    ambit where            Where the graph is stored
    ambit web              Open the visualizer

  ${D}The graph builds itself on first run; ambit seed rebuilds it after your
  config changes. ambit web needs a git checkout: the visualizer is built
  with dev dependencies an installed copy does not carry.${R}

  ${D}ambit mcp runs the MCP server, exposing the same questions to an agent
  session: claude mcp add ambit -- ambit mcp${R}
`);
  process.exit(0);
}

// Bare `ambit` used to print help — a list of things to read before doing
// anything. Showing where you actually are teaches more in one screen, and
// the help is still one flag away.
if (!cmd) {
  const run = (c, args = []) =>
    spawnSync("node", ["--experimental-sqlite", engineEntry, c, ...args],
      { stdio: "inherit" });
  console.log(`\n${B}Where you are${R}`);
  run("status");
  console.log(`\n${D}ambit --help for every command · ambit help <term> for what the terms mean${R}\n`);
  process.exit(0);
}

if (cmd === "web") {
  // The visualizer needs the dev dependencies (vite, react), which an npm or
  // Homebrew install of the CLI does not carry. Failing here with bun's
  // "script not found" taught nothing; say what the situation is.
  const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
  const hasDevDeps = existsSync(resolve(ROOT, "node_modules", "vite"));
  if (!hasBun || !hasDevDeps) {
    console.log(`\n  The visual map runs from a git checkout (the CLI install doesn't carry the web app):\n`);
    console.log(`    git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh web\n`);
    if (!hasBun) console.log(`  ${D}It also needs Bun — https://bun.sh${R}`);
    console.log(`  ${D}Or try the hosted demo with example data: https://zz-plant.github.io/ambit/?demo=1${R}\n`);
    process.exit(1);
  }
  spawnSync("bun", ["run", "dev"], { cwd: ROOT, stdio: "inherit" });
  process.exit(0);
}

// The MCP server, runnable from any install: `claude mcp add ambit -- ambit mcp`.
// Before this, registering it meant knowing where npm put the package.
if (cmd === "mcp") {
  const result = spawnSync("node", ["--experimental-sqlite", mcpEntry], { stdio: "inherit" });
  process.exit(result.status || 0);
}

const result = spawnSync("node", ["--experimental-sqlite", engineEntry, cmd, ...args], { stdio: "inherit" });
process.exit(result.status || 0);
