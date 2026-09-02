# Frequently asked questions

Short answers, each pointing at the longer one. Terms are defined in [the README](../README.md#the-words-ambit-uses) and in depth in [the deep dive](./deep-dive.md).

## Do I need Claude Code for this?

No. Ambit reads OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, and Codex CLI from each one's standard config path, plus `~/.agents/skills`. A server that two clients both list is one capability with two sources, not two capabilities. Adding a reader for another client is one of the most useful contributions; [CONTRIBUTING.md](../CONTRIBUTING.md) points at where they live.

## Does anything leave my machine?

Not unless you ask it to. The graph is a local SQLite file (`ambit where` prints its path), there is no telemetry, and the API server binds loopback only. Two commands are explicit exceptions: `ambit notify <topic>` pushes the attention digest and `ambit notify-approvals <topic>` pushes the approved-and-waiting count to [ntfy](https://ntfy.sh), or to a server you name with `NTFY_SERVER`. Each is a single HTTP POST of short text, no graph data, and nothing is sent without a topic. `ambit share` produces a file meant for sharing but does not upload it: the HTML is built from an allow-list, so commands, paths, URLs, and economics cannot enter it, and `--redact` replaces every non-curated name with its category. [SECURITY.md](../SECURITY.md) lists the invariants.

## What do I need installed?

Node 22.18 or newer, and nothing else. The engine, the CLI, the API server, and the test runner all use `node:sqlite`; the map is Vite, which runs on Node too. Python is only needed for `npm run demo:incident`, the terminal walkthrough.

## Can I `npx` it?

Not yet. The npm package is built and ready but not published. Until it is, use one of:

```bash
brew install zz-plant/tap/ambit                                  # CLI and engine
git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh   # everything, including the map
```

## I ran `ambit attention` and it says nothing is recorded. Is it broken?

No. `attention`, `work`, `usage`, `opportunities`, `roi`, and `audit` price the human cost of running your stack, and they read from a work ledger that starts empty. They become useful after a few weeks of recorded runs. Copying `plugins/ambit-telemetry.js` into `~/.config/opencode/plugins/` records every tool execution and permission prompt from OpenCode sessions; [the deep dive](./deep-dive.md#work-telemetry) covers the ledger.

## Can an agent change my configuration through Ambit?

An agent can read the graph, ask what a goal is missing, and *propose* a change over MCP. Approving and applying are not MCP tools. They run from the terminal or the map, by a person, and `ambit apply` writes a `.bak` beside any file it edits. An approval is valid only for the capability named in the proposal that was approved, so an approval to install a linter cannot be spent on a deploy.

## What is the difference between "reached" and "verified"?

`state` is structural: is this thing configured, and what does it depend on. `lifecycle` is health: did its declared check actually pass. A capability can be fully configured and still `degraded` or `broken`, and every availability decision gates on lifecycle. `ambit verify` runs the checks; `ambit status` reports proven, unproven, and failing counts. The README section [Configured is not working](../README.md#configured-is-not-working) is the longer argument.

## How is this different from listing my MCP servers?

A list shows what is configured, one server at a time. Ambit records what each capability *needs*, so it can answer the questions a list cannot: what breaks downstream if this credential is revoked, which capability you are one prerequisite away from, and which tools interrupt you most. The [comparison table](../README.md#where-this-sits-in-the-stack) in the README places it next to tool-RAG, workflow graphs, and package managers.

## How do I reset the graph?

Delete the database file `ambit where` names and run `./bootstrap.sh` (or `ambit seed`) again. Discovery is idempotent, and `*.db` is gitignored so a checkout never commits one.

## Where do I report a security problem?

Privately, through [GitHub security advisories](https://github.com/zz-plant/ambit/security/advisories/new). Anything that lets a web page reach the local API, turns an HTTP request into a new executable config entry, or moves the graph off the machine is high severity. [SECURITY.md](../SECURITY.md) has the full scope.

## Something else?

[SUPPORT.md](../SUPPORT.md) says where each kind of question goes.
