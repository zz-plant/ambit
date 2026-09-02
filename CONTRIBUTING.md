# Contributing

Fork → branch → commit → PR. [AGENTS.md](./AGENTS.md) carries the conventions, the typechecking setup, and the security invariants the server must preserve; this file is the short version of how to get from a clone to a passing PR.

## Setup

```bash
git clone https://github.com/zz-plant/ambit.git
cd ambit
./bootstrap.sh
```

Node 22+, and nothing else. The engine, the CLI, the API server and the test runner all open the graph through `node:sqlite`; the visualiser is Vite, which runs on Node too. A checkout keeps its graph in the checkout (`toolchain-viz.db`), so your working graph is never the one an installed copy uses — `ambit where` prints the path either way.

## Checks

CI runs these on every push and pull request. Running them first is faster than a round trip:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

CI also runs `./bootstrap.sh` against a machine with no agent config, because that is the first thing a new user does and it is the path that has broken twice.

## What is worth contributing

**Capability model.** The seven eras and their dependencies are curated, and they encode opinions that deserve argument — whether a capability is real, what it genuinely requires, which era it belongs to. Open a capability-model issue rather than a PR if the change is a judgement call.

**Runtime adapters.** Runtime readers map agent configuration onto the graph. Ambit discovers OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop and Codex CLI directly — the last five through `src/engine/mcp-clients.ts` — plus `~/.agents/skills`; `scripts/adapters/` contains deeper runtime-specific adapters such as Hermes telemetry. Every additional runtime makes the shared model more useful and the single-runtime assumption weaker, which is the direction the project is going.

**Detection that is honest about itself.** A capability inferred from a filename is weaker evidence than one with a declared check that passes. Contributions that turn the first kind into the second are the most valuable ones here.

## A first contribution

Three kinds of change are small, self-contained, and worth more than their size:

- **A runtime reader.** If you use an agent client Ambit does not discover, the readers in `src/engine/mcp-clients.ts` are each about a screen long: find the config file, map its server entries onto the shape `seedFromConfig` accepts, and add a test beside the others. Every one makes the shared model more useful.
- **A declared check.** Any capability in `src/engine/techtree.json` that is inferred from a filename but has no `verify` command is a candidate. A check that passes turns "configured" into "working" for everyone who has that tool.
- **A README block that drifted.** The console examples are captured by `npm run docs:examples`, and CI fails when they no longer match. If a command's output moved and the README did not, re-capture and send the diff.

Issues labelled [`good first issue`](https://github.com/zz-plant/ambit/labels/good%20first%20issue) are scoped to one of these, and a first pull request gets a reply that names what CI will run. You can also open in [Codespaces](https://codespaces.new/zz-plant/ambit?quickstart=1); the devcontainer seeds a graph and starts the map, so nothing needs installing to read the code and the canvas side by side.

## Things to keep true

- `src/server/api.ts` binds loopback only, rejects non-local origins before routing, and cannot create configuration entries. An MCP entry carries a command the runtime executes, so creating one over HTTP would be remote code execution.
- The engine, the MCP server, and the visualizer API all resolve `src/shared/db-path.ts`. Three components with three ideas of where the graph lives is a bug that has already shipped once.
- Nothing phones home. There is no telemetry, and adding any would need to be argued in an issue first.
