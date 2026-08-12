#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli.js sits at the package root, next to src/ — resolving ".." walked out
// of the package entirely and every command failed to find the engine.
const ROOT = __dirname;

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (!cmd || cmd === "--help") {
  console.log("  Toolchain capability graph\n");
  console.log("  Bootstrap: ./bootstrap.sh");
  console.log("");
  console.log("  Explore:   stats  export  context  health  profile");
  console.log("  Maintain:  decay  prune  prune <id>  diff  trend");
  console.log("  Plan:      near  combos  fork  insight");
  console.log("  Analyze:   bottlenecks  impact <id>  budget <s> <t>");
  console.log("");
  console.log("  Web:       tt web  — visualizer at http://localhost:3000");
  console.log("");
  console.log("  recs and cap are MCP-only tools, available inside OpenCode sessions.");
  process.exit(0);
}

if (cmd === "web") {
  spawnSync("bun", ["run", "dev"], { cwd: ROOT, stdio: "inherit" });
  process.exit(0);
}

const enginePath = resolve(ROOT, "src", "engine", "engine.ts");
const result = spawnSync("node", ["--experimental-sqlite", enginePath, cmd, ...args], { stdio: "inherit" });
process.exit(result.status || 0);
