# Contributing

Fork → branch → commit → PR. [AGENTS.md](./AGENTS.md) carries the conventions, the typechecking setup, and the security invariants the server must preserve; this file is the short version of how to get from a clone to a passing PR.

## Setup

```bash
git clone https://github.com/zz-plant/ambit.git
cd ambit
./bootstrap.sh
```

Bun for the visualizer and server, Node 22+ for the engine and CLI. Bootstrap checks for both. A checkout keeps its graph in the checkout (`toolchain-viz.db`), so your working graph is never the one an installed copy uses — `ambit where` prints the path either way.

## Checks

CI runs these on every push and pull request. Running them first is faster than a round trip:

```bash
bun run typecheck && bun test && bun run build
```

CI also runs `./bootstrap.sh` against a machine with no agent config, because that is the first thing a new user does and it is the path that has broken twice.

## What is worth contributing

**Capability model.** The seven eras and their dependencies are curated, and they encode opinions that deserve argument — whether a capability is real, what it genuinely requires, which era it belongs to. Open a capability-model issue rather than a PR if the change is a judgement call.

**Runtime adapters.** Runtime readers map agent configuration onto the graph. Ambit discovers OpenCode, Claude Code, Cursor, and Windsurf directly; `scripts/adapters/` contains deeper runtime-specific adapters such as Hermes telemetry. Every additional runtime makes the shared model more useful and the single-runtime assumption weaker, which is the direction the project is going.

**Detection that is honest about itself.** A capability inferred from a filename is weaker evidence than one with a declared check that passes. Contributions that turn the first kind into the second are the most valuable ones here.

## Things to keep true

- `server.ts` binds loopback only, rejects non-local origins before routing, and cannot create configuration entries. An MCP entry carries a command the runtime executes, so creating one over HTTP would be remote code execution.
- The engine, the MCP server, and the visualizer API all resolve `src/shared/db-path.ts`. Three components with three ideas of where the graph lives is a bug that has already shipped once.
- Nothing phones home. There is no telemetry, and adding any would need to be argued in an issue first.
