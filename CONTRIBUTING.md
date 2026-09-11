# Contributing

Fork → branch → commit → PR. This file gets you from a clone to a passing PR. [AGENTS.md](./AGENTS.md) is what a change must not break, and where the code lives. [The deep dive](./docs/deep-dive.md) is what the model means: what a node is, what a check proves, what an authority grant does. [The README](./README.md) is what Ambit is for.

## Setup

```bash
git clone https://github.com/zz-plant/ambit.git
cd ambit
./bootstrap.sh
```

Node 22.18 or newer, and nothing else. CI runs 22 and 24. The engine, the CLI, the API server and the test runner all open the graph through `node:sqlite`; the visualizer is Vite, which runs on Node too. A checkout keeps its graph in the checkout (`toolchain-viz.db`), so your working graph is never the one an installed copy uses — `ambit where` prints the path either way.

`./bootstrap.sh web` does all of that and then serves the map on :3000, which is worth opening once before you change anything behind it. Once you are editing the client, `npm run dev` runs the API on :3001 and Vite on :3000 together.

You can also open the repository in [Codespaces](https://codespaces.new/zz-plant/ambit?quickstart=1); the devcontainer seeds a graph and starts the map, so nothing needs installing to read the code and the canvas side by side.

## The checks CI runs

Every push and pull request runs all of these, twice, on Node 22 and Node 24. Running them locally first is faster than a round trip:

```bash
npm run test:coverage        # the suite, plus the coverage floors a bare `npm test` does not apply
npm run lint                 # Biome, formatting included
npm run build                # typechecks both projects, then builds the client
npm run assets:check         # the shipped images are the right shape, and the hero GIF is not stale
npm run prose:check          # the corpus ceiling on em dashes and "rather than"
npm run docs:examples:check  # every console block in the README still matches what the command prints
npm run demo:check           # the published demo still matches what the engine would build from its fixture
```

CI also runs `./bootstrap.sh` against a machine with no agent config, because that is the first thing a new user does and it is the path that has broken twice. It then greps the README for an `ambit-cli` install line, which cannot be advertised until that package is on npm.

The last three commands are the ones an ordinary change trips. `prose:check` measures the whole corpus, not your paragraph: it fails when a pass pushes either of the two constructions it counts past the ceiling in `scripts/check-prose.ts`. That ceiling sits above where the corpus stands, so the next drift up fails and every improvement can lower it. `docs:examples:check` re-runs the real commands behind the README's console blocks, so a block that stops matching is a fact that moved, not a typo. `demo:check` rebuilds the published demo from its fixture, which is how a model change fails at the commit that caused it instead of going stale in a screenshot nobody reopens.

## What is worth contributing

Three kinds of change are small, self-contained, and worth more than their size. They are the standing list: no backlog of scoped issues sits behind them, and an issue carries [`good first issue`](https://github.com/zz-plant/ambit/labels/good%20first%20issue) once somebody files one against them. Start from a bullet.

- **A runtime reader.** Ambit discovers the runtimes [the FAQ lists](./docs/faq.md#do-i-need-claude-code-for-this), and five of them are read by `src/engine/mcp-clients.ts`, 140 lines for the set. Each client is a five-field entry in the `CLIENTS` array: a runtime, a label, an env override, the paths to look in, and a parser. Four of the five share `readMcpServersJson`, because they all keep an `mcpServers` block, so a client that keeps one is five fields and no new code. Codex's TOML is the exception, and reading it takes under thirty lines. Nothing tests this file yet, so the first reader to arrive with a fixture and a test for `discoverMcpClients` is worth more than the reader. Every one makes the shared model more useful and the single-runtime assumption weaker. Deeper adapters, such as Hermes telemetry, live in `scripts/adapters/`.
- **A declared check.** Every node in `src/engine/techtree.json` carries a `detect` block: regexes matched against the ids of what a seed found. A match says something on the machine supplies the capability, which is not the same as the capability working. What closes that gap is `verify`, one field holding a command and a timeout, and 8 of the 33 nodes have one. The other 25 are open. A check that passes turns "configured" into "working" for everyone who has that tool, and turning the first kind of evidence into the second is the most valuable contribution here.
- **A README block that drifted.** The console examples are captured by `npm run docs:examples`, and CI fails when they no longer match. If a command's output moved and the README did not, re-capture and send the diff.

The seven eras and their dependencies are curated and encode opinions that deserve argument — whether a capability is real, what it genuinely requires, which era it belongs to. Open a [capability-model issue](https://github.com/zz-plant/ambit/issues/new?template=capability-model.md) rather than a PR if the change is a judgment call.

## Sending it

Branch off `main` and keep the pull request to one thing. The template's checklist is conditional, so most changes tick nothing: it asks only when the change touches the API server, where the graph is stored, the curated tree, or the set of runtime readers and declared checks, and each question is the one a review would ask anyway. A first pull request gets an automatic reply, then a person.

## Things to keep true

The invariants a change must not break are stated once, in [AGENTS.md](./AGENTS.md). Two of the four under [Security posture](./AGENTS.md#security-posture) bear on ordinary changes: loopback only, and no entry creation over HTTP. Two more are numbered [rules](./AGENTS.md#rules): one resolver decides where the graph is, and nothing that travels may execute. Read that file before touching `src/server/api.ts`, `sync.ts`, or anything under `assure/`.

Release and launch mechanics, including the directory-submission table, live in [.github/launch-kit.md](./.github/launch-kit.md).
