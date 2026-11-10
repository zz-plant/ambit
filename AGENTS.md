# Agent Guide

Ambit — what you, your agents, and your machines can jointly do — and where your own time is going. [README.md](./README.md) says what it does, [docs/deep-dive.md](./docs/deep-dive.md) says what the model means, this file says what must not break, and [CONTRIBUTING.md](./CONTRIBUTING.md) says how to get a pull request merged. [SECURITY.md](./SECURITY.md) is the same posture written for someone reviewing it from outside. See [the roadmap](./docs/roadmap.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, an SVG map of the curated tree in era columns, MCP server, control plane interceptor, and the plugins that feed the work ledger from OpenCode and Claude Code.

This file is short on purpose: it is loaded on every turn. It holds the commands, the check that says a change is done, and each rule in one line. The map of the code and the full text of each rule are in one guide per area, listed under [Where to read next](#where-to-read-next).

## Maintenance mode (since 2026-11-10)

Ambit is in maintenance: the owner decided on 2026-11-10 to keep it working and stop developing it. Until this section is removed, it overrides the roadmap and any other document that names work to do next.

Take:

- a fix for something broken: a failing build or check, a page error, a dead link or source, a deploy that stopped;
- security updates and the monthly dependency pull request;
- a fix for something that breaks the owner's own setup, or a bug an outside user reports;
- keeping the config readers working when a supported agent changes its config format. That is a fix;
- a release only to ship fixes.

It stays a personal tool unless outside users start asking for it. This overrides [docs/roadmap.md](docs/roadmap.md).

Decline the rest, and say in your reply that the repository is in maintenance:

- new features, pages, tools, datasets or integrations;
- redesigns, copy passes, and refactors that fix nothing broken;
- new automation, services, secrets, paid APIs or scheduled jobs.

The owner can still ask for any of these. Do one only when the request says it overrides this section.

## Running it

```bash
./bootstrap.sh                          # seed a graph and link the ambit command
./bootstrap.sh web                      # the same, then open the map on :3000
npm run dev                             # API on :3001 and Vite on :3000, together
npm run dev:fixture                     # disposable graph and config, API :3101 and Vite :3100
./cli.js status                         # the CLI from a checkout, nothing installed
npx vitest run src/engine/cli.test.ts   # one test file
./cli.js where                          # which graph is open, and whether it is seeded
npm run render:images -- --demo         # the saved map, relief and specimens, to output/images
npm run shots                           # every view as a screenshot at three sizes, to output/shots
```

For site work in a fresh worktree, start with `npm ci` and `npm run dev:fixture`. [The site iteration guide](./CONTRIBUTING.md#iterate-on-the-site) has the dev and production URLs, how to override ports, and screenshot commands. `npm run shots -- --help` lists cases and sizes. A run writes a contact sheet and `report.json`. Add `--strict` to fail on flagged frames or `--expect-revision <sha>` to also require the deployed commit.

`ambit web` runs Vite in a checkout. An installed copy has no Vite: it serves the page it shipped with (`dist/index.html` and `dist/assets`, built by `prepack`) from the compiled API server, on the first free loopback port from 3001.

A checkout keeps its graph in the checkout (`toolchain-viz.db`), so the graph you are working on is never the one an installed copy uses; `AMBIT_DB` overrides both. What CI requires before a change lands is in [CONTRIBUTING.md](./CONTRIBUTING.md#the-checks-ci-runs). How to run something belongs where an agent reads, what must pass belongs where a contributor reads.

## When a change is done

```bash
npm run check -- --fast   # lint, typecheck and the suite: the loop to iterate in
npm run check             # every check CI runs from npm; run it before a pull request
```

Each step prints one line. A step that fails prints the end of its output and the command that usually fixes it. Do not open a pull request while `npm run check` fails, and fix the cause instead of adding a second "fix build" commit. What each check is for is in [CONTRIBUTING.md](./CONTRIBUTING.md#the-checks-ci-runs).

## Where to read next

Before editing a file, read the guide for its directory. Each has a one-line description of every file there and the full text of the rules that govern it.

| You are editing | Read first |
| --- | --- |
| `src/engine/` (the graph, the CLI, the gate, the ledger) | [src/engine/AGENTS.md](src/engine/AGENTS.md) |
| `src/server/`, `src/mcp/`, `src/control_plane/` | [src/server/AGENTS.md](src/server/AGENTS.md) |
| `src/client/` (the map and every view), or any copy a person reads | [src/client/AGENTS.md](src/client/AGENTS.md) |
| `src/shared/`, `scripts/`, `plugins/` | [src/shared/AGENTS.md](src/shared/AGENTS.md) |

A change that crosses two areas reads both. When a guide and the code disagree, the code is right and the guide is the bug: fix the guide in the same change.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, vanilla CSS
- **Store**: Zustand, in memory. What survives a reload lives in the URL (`src/client/linkState.ts`), not in storage; the one localStorage key records that the first-run card was seen
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `node:http` in `src/server/api.ts` — visualizer API, SSE stream, and static `dist/` in production. It is a reader of the graph: every projection comes from `src/engine/views.ts`, never from SQL written here
- **MCP Server**: JSON-RPC over stdio in `src/mcp/`, one `ambit_*` tool per question the engine answers. The roster is in [the deep dive](./docs/deep-dive.md#the-full-mcp-surface); no test holds a count, so do not write one down here
- **Plugins**: `plugins/ambit-telemetry.js` (tool executions and permission prompts → the work ledger) and `plugins/ambit-tracker.js` (configuration changes), both copied to `~/.config/opencode/plugins/`. Each default-exports `{ id, setup, server }`: OpenCode 2 runs `setup` and OpenCode 1 calls `server`, and neither version runs the other's half. Claude Code's are under `plugins/claude-code/`: `ambit`, whose hooks spool tool runs, failures and asks into the same ledger (`src/engine/spool.ts`), and `ambit-gate`. Cursor's is `plugins/cursor/ambit-ledger.mjs`, a hook `ambit connect cursor --ledger` adds to `~/.cursor/hooks.json`, writing to the same spool

## Typechecking

Two configs, because the halves have different constraints:

- `tsconfig.json` — `src/client`, `strict`.
- `tsconfig.node.json` — engine, MCP server, control plane, the API server, scripts. Also `strict`: `db.ts` narrows the `node:sqlite` handle once at the boundary, so nothing downstream needs the exemption this config used to carry.

Both must stay at zero errors. `npm run typecheck` runs both, and `npm run build` runs it first.

## Working in this tree

More than one agent session may be working in this checkout. Before committing, check whether the tree has changes that are not yours; for parallel work, use a git worktree, never this one. A concurrent session committed and pushed mid-edit on 2026-08-12, which is how a database of local capability data reached the public remote. `*.db` is ignored now, and that is the class of accident a worktree prevents.

## Security posture

Four invariants protect the API server, which can write an agent config. None may be relaxed. Read [the full text](src/server/AGENTS.md#security-posture) before touching `src/server`, any command that opens a socket, or anything that starts a process. [SECURITY.md](./SECURITY.md) is the same posture for a reviewer.

1. **Loopback only.** The server listens on `127.0.0.1`. Never bind `0.0.0.0`.
2. **Origin and Host allowlist.** A request from any other origin, or addressed to any other host name, is a 403 before routing. Write routes also need the API token.
3. **No entry creation over HTTP.** A route may edit allow-listed fields of a config entry that exists. No route adds an entry, runs a declared check, or reads an actor from a request body.
4. **No egress you did not type.** Nothing opens a socket or starts a command unless a person typed the command for it or an agent called the tool for it. The server never does.

## Rules

Each line is the instruction. The link is the reasoning, the history, and the edge cases, which you need before changing code the rule governs.

1. Write vanilla CSS. Add no CSS framework. [Full text](src/client/AGENTS.md).
2. Add a column in `schema.sql` and in `ADDED_COLUMNS` in `migrate.ts`, both, and only ever add. [Full text](src/engine/AGENTS.md).
3. Give a seeded item its domain in `src/engine/seed/writers.ts`. `inferDomain` in the client only sees a config dropped into the browser. [Full text](src/engine/AGENTS.md).
4. Record configuration decisions (`built`, `removed`, `unlocked`). Never write a `used` count. [Full text](src/engine/AGENTS.md).
5. Take state lists, lifecycle lists and summary SQL from `src/engine/vocabulary.ts`. Never spell the list again. [Full text](src/engine/AGENTS.md).
6. Decide availability with `usable(lifecycle)`. Never test `state` alone, and never change `state` to express a check result. [Full text](src/engine/AGENTS.md).
7. Nothing that travels may execute: no command in a sync file, an overlay or a spec, and every id in a printed command goes through `shellQuote`. [Full text](src/engine/AGENTS.md).
8. A bridge reports what the runtime said. Only `src/engine/failures.ts` classifies a failure, and it never guesses. [Full text](src/engine/AGENTS.md).
9. Resolve authority through `canExecute`: a forbidden grant wins outright, then the most specific covering scope governs. [Full text](src/engine/AGENTS.md).
10. Count only a failing check as a failure. A failed run is not evidence against what it touched. [Full text](src/engine/AGENTS.md).
11. Widen a grant only against a threshold a person set. Narrow it on one failing check, compared by row id. [Full text](src/engine/AGENTS.md).
12. A sync file carries every row its rows point at. Add a table to `TABLES` after what it references. [Full text](src/engine/AGENTS.md).
13. Never insert a budget row to record a spend. `recordSpend` updates one that exists. [Full text](src/engine/AGENTS.md).
14. Find the graph with `resolveDbPath` in `src/shared/db-path.ts` and nothing else. [Full text](src/engine/AGENTS.md).
15. A plugin transcribes a path and appends to a spool. It never chooses the graph or decides a meaning. [Full text](src/shared/AGENTS.md).
16. Never render an absent value as a value. Drop the row, or print `—` where the slot is structural. `absence.test.tsx` holds it. [Full text](src/client/AGENTS.md).
17. Keep em dashes and "rather than" down. `npm run prose:check` holds the ceiling. [Full text](src/shared/AGENTS.md).
18. Colour goes only to a terminal and is never the only signal. A formatter takes a palette and returns lines. [Full text](src/engine/AGENTS.md).
19. Declare an MCP argument in `src/mcp/tools.ts` before the server takes it, and annotate a tool read-only only if it writes no table. `server.test.ts` holds both. [Full text](src/server/AGENTS.md).
20. `ambit gate` answers deny, ask or nothing. It never answers allow. [Full text](src/engine/AGENTS.md).
21. A page does not narrate itself. Cut the sentence a heading already says. [Full text](src/client/AGENTS.md).
