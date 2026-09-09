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

Three kinds of change are small, self-contained, and worth more than their size. Issues labelled [`good first issue`](https://github.com/zz-plant/ambit/labels/good%20first%20issue) are scoped to one of them, and a first pull request gets a reply that names what CI will run.

- **A runtime reader.** Ambit discovers OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop and Codex CLI — the last five through `src/engine/mcp-clients.ts`, where each reader is about a screen long: find the config file, map its server entries onto the shape `seedFromConfig` accepts, add a test beside the others. Every one makes the shared model more useful and the single-runtime assumption weaker. Deeper adapters, such as Hermes telemetry, live in `scripts/adapters/`.
- **A declared check.** Any capability in `src/engine/techtree.json` inferred from a filename but with no `verify` command is a candidate. A check that passes turns "configured" into "working" for everyone who has that tool, and turning the first kind of evidence into the second is the most valuable contribution here.
- **A README block that drifted.** The console examples are captured by `npm run docs:examples`, and CI fails when they no longer match. If a command's output moved and the README did not, re-capture and send the diff.

The seven eras and their dependencies are curated and encode opinions that deserve argument — whether a capability is real, what it genuinely requires, which era it belongs to. Open a [capability-model issue](https://github.com/zz-plant/ambit/issues/new?template=capability-model.md) rather than a PR if the change is a judgement call.

You can also open the repository in [Codespaces](https://codespaces.new/zz-plant/ambit?quickstart=1); the devcontainer seeds a graph and starts the map, so nothing needs installing to read the code and the canvas side by side.

## Things to keep true

The invariants a change must not break — loopback only, no entry creation over HTTP, one database path, nothing that travels may execute, and the rest — are listed once, in [AGENTS.md](./AGENTS.md). Read that before touching `src/server/api.ts`, `sync.ts`, or anything under `assure/`.
