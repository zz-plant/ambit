#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli.js sits at the package root, next to src/ — resolving ".." walked out
// of the package entirely and every command failed to find the engine.
const ROOT = __dirname;

const B = "\x1b[1m", R = "\x1b[0m", D = "\x1b[90m";

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "--help" || cmd === "help") {
  // A bare list of verbs taught nothing. Lead with the two commands worth
  // running first, group the rest by the question each answers.
  console.log(`
  Ambit — what you, your agents and your machines can jointly do.

  ${B}Start here${R}
    tt near              What is one step away from where I am?
    tt explain           What do the terms in this tool mean?

  ${B}Where am I${R}
    tt stats             Counts by domain, overall maturity
    tt health            Per-domain composite scores
    tt context           A summary block to hand an agent
    tt export            Dump the graph as JSON

  ${B}What next${R}
    tt insight           Top actions, ranked
    tt combos            Capabilities whose prerequisites are met
    tt fork              Compare candidates by efficiency
    tt bottlenecks       What the most things depend on
    tt impact <id>       If this went away, what breaks?
    tt budget <s> <t>    Best moves within a setup-time and token budget

  ${B}Upkeep${R}
    tt decay             What have I stopped tending?
    tt diff              What changed since last time?
    tt trend <days>      Projected health
    tt prune             Removal candidates
    tt prune <id>        Remove it, writing a .bak first

  ${B}Setup${R}
    ./bootstrap.sh       Build or refresh the graph
    ./bootstrap.sh web   Open the visualizer

  ${D}recs and cap are MCP-only, available inside an agent session.${R}
`);
  process.exit(0);
}

// Bare `tt` used to print help — a list of things to read before doing
// anything. Showing where you actually are teaches more in one screen, and
// the help is still one flag away.
if (!cmd) {
  const run = (c, args = []) =>
    spawnSync("node", ["--experimental-sqlite", resolve(ROOT, "src", "engine", "engine.ts"), c, ...args],
      { stdio: "inherit" });
  console.log(`\n${B}Where you are${R}`);
  run("stats");
  console.log(`\n${B}What is one step away${R}`);
  run("near");
  console.log(`\n${B}What to do next${R}`);
  run("insight");
  console.log(`\n${D}tt --help for every command · tt explain for what the terms mean${R}\n`);
  process.exit(0);
}

if (cmd === "web") {
  spawnSync("bun", ["run", "dev"], { cwd: ROOT, stdio: "inherit" });
  process.exit(0);
}

const enginePath = resolve(ROOT, "src", "engine", "engine.ts");
const result = spawnSync("node", ["--experimental-sqlite", enginePath, cmd, ...args], { stdio: "inherit" });
process.exit(result.status || 0);
