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

  ${D}Installed via Homebrew or npm? ambit seed is how you build the graph —
  bootstrap.sh is the equivalent for a git checkout, and does the same thing
  plus installing dependencies. ambit web needs a checkout: the visualizer is
  built with dev dependencies an installed copy does not carry.${R}

  ${D}An MCP server exposes the same questions to an agent session.${R}
`);
  process.exit(0);
}

// Bare `ambit` used to print help — a list of things to read before doing
// anything. Showing where you actually are teaches more in one screen, and
// the help is still one flag away.
if (!cmd) {
  const run = (c, args = []) =>
    spawnSync("node", ["--experimental-sqlite", resolve(ROOT, "src", "engine", "engine.ts"), c, ...args],
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

const enginePath = resolve(ROOT, "src", "engine", "engine.ts");
const result = spawnSync("node", ["--experimental-sqlite", enginePath, cmd, ...args], { stdio: "inherit" });
process.exit(result.status || 0);