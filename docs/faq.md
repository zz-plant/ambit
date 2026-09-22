# FAQ

Short answers, with a pointer to the longer one where there is one. Terms are defined in [the README](../README.md#the-words-ambit-uses), and `ambit help <term>` looks any of them up from the terminal.

## Is this for me

### How is this different from listing my MCP servers?

A list shows what is configured, one server at a time. Ambit records what each capability *needs*, so it can answer the questions a list cannot: what breaks downstream if this credential is revoked, which capability you are one prerequisite away from, and which tools interrupt you most. The [comparison table](../README.md#where-this-sits-in-the-stack) in the README places it next to tool-RAG, workflow graphs, and package managers.

### Do I need Claude Code for this?

No. Ambit reads OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, and Codex CLI from each one's standard config path, plus the skill directories `~/.agents/skills` and `~/.opencode/skills`. A server that two clients both list is one capability with two providers, not two capabilities. Adding a reader for another client is one of the most useful contributions; [CONTRIBUTING.md](../CONTRIBUTING.md) points at where they live.

### I use Jev. Where does it fit?

Ambit maps TypeSafe's Jev as **Typed Judgment**, in the Model Access era, and finds it however it arrives: as one of its MCP servers, as TypeSafe listed as a provider, or as an open clone that serves the same API. A clone such as Kev or LitJev running on your own hardware also reaches **Local Typed Judgment** in Sovereignty. That difference matters because the hosted API may keep requests for a while unless you have a zero-retention agreement, and a local clone keeps the state it judges on your machine. `ambit verify combo:local-typed-judgment` asks the clone one trivial question on this machine and records whether it answered; it never contacts the hosted API. A clone can also route goals the tree's words do not cover: `ambit goal "triage incoming bug reports" --judge` puts the sentence to it as a Choice over the tree, and prints the likeliest capability with its probability as a suggestion. It writes nothing.

Use Jev to decide what to try, and `ambit_can` to decide whether it may run. Jev returns a probability, and text inside the state it reads can move that probability. In one published test, injected text dropped Jev's probability of blocking `rm -rf ~/.ssh` from 0.76 to 0.48. Ambit's answer to whether an action may run comes from a grant a person set, so nothing an agent reads can widen it.

## Installing and running

### What do I need installed?

Node 22.18 or newer, and nothing else. The engine, the CLI, the API server, and the test runner all use `node:sqlite`; the map is Vite, which runs on Node too. Python is only needed for `npm run demo:incident`, the terminal walkthrough.

### Can I `npx` it?

Not yet. The npm package is built and ready but not published. Until it is, use one of:

```bash
brew install zz-plant/tap/ambit                                  # CLI and engine
git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh   # everything, including the map
```

### How do I reset the graph?

Delete the database file `ambit where` names and run `./bootstrap.sh` (or `ambit seed`) again. Discovery is idempotent, and `*.db` is gitignored so a checkout never commits one.

## What it touches

### Does anything leave my machine?

Not unless you ask it to. The graph is a local SQLite file (`ambit where` prints its path), there is no telemetry, and the API server binds loopback only. Five commands are the ones to check if you are auditing egress.

| Command | What it sends | Where it goes |
| :--- | :--- | :--- |
| `ambit notify <topic>` | The attention digest: which capabilities interrupted you, how often, and the suggested fix for each. | One HTTP POST to [ntfy](https://ntfy.sh), or to the server you name in `NTFY_SERVER`. |
| `ambit notify-approvals <topic>` | Proposals waiting to be applied, by id and goal; and unapproved drafts, each with its id, goal, cost, recurring billing, and up to three capabilities it would unlock. | The same POST. |
| `ambit dispatch <id>` (and `propose`/`approve` with `--dispatch`) | One proposal: its id, goal, cost and what it unlocks, with the approve and reject commands; once approved, the signed artifact too. Never a command to run. | One POST to the URL in `AMBIT_APPROVAL_WEBHOOK` or `--to`, in Slack, Discord, Telegram, ntfy or plain JSON shape. Nothing is sent without one. |
| `ambit incidents` | Nothing. It sends an empty GET to each service URL named in your infrastructure manifest (`$INFRA_MANIFEST`, or `~/.config/opencode/infrastructure.json`), to see which are answering. | Those hosts, and nowhere else. |
| `ambit goal "<sentence>" --judge` | The sentence you typed, and the name and one-line description of every node in the curated tree, as one Choice question. Only when no goal phrase in the tree matches it. | One POST to a judgment model on this machine: `--judge=<url>`, `AMBIT_JUDGE_URL`, or Kev's default `http://127.0.0.1:8009`. Any other host is refused before anything is sent. |
| `ambit share [--redact]` | Nothing. It writes an HTML file you send yourself. | Your disk. |

Neither notify command sends anything without a topic. An ntfy topic is readable by anyone who knows its name, so pick one you would not guess. The share file is built from an allow-list; [`ambit share`](../README.md#ambit-share--what-may-leave-the-graph-and-what-may-not) in the README says what may enter it. [SECURITY.md](../SECURITY.md) lists the invariants.

### What does Ambit store about my machine?

Names and structure. A credential is a node you declared in a `credentials` block, holding a name and a note; the schema has no column a secret could be written to, and discovery never reads one. The one `command` column in the database belongs to `declared_checks`, which holds a check a skill registered for itself, never anything read from your config. Discovery reads your config files and writes only the database. Writing back to one takes a person, which is the next answer.

### Can an agent change my configuration through Ambit?

Not on its own. An agent can read the graph, ask what a goal is missing, and *propose* a change over MCP. Approving and applying are not MCP tools. They run from the terminal or the map, by a person, and `ambit apply` writes a `.bak` beside any file it edits. The map also has a direct editor for entries that already exist, such as switching an MCP server off, which writes to the config on a person's click without a proposal; it cannot create an entry, because an entry carries a command your runtime executes. An approval is valid only for the capability named in the proposal that was approved, so an approval to install a linter cannot be spent on a deploy.

### Where do I report a security problem?

Privately, through [GitHub security advisories](https://github.com/zz-plant/ambit/security/advisories/new). Anything that lets a web page reach the local API, turns an HTTP request into a new executable config entry, or moves the graph off the machine is in scope, and an exfiltration path is high severity. [SECURITY.md](../SECURITY.md) has the full scope.

## Reading what it tells you

### I ran `ambit attention` and it says nothing is recorded. Is it broken?

No. `attention`, `work`, `usage`, `opportunities`, `roi`, and `audit` price the human cost of running your stack, and they read from a work ledger that starts empty. They become useful after a few weeks of recorded runs. Copying `plugins/ambit-telemetry.js` into `~/.config/opencode/plugins/` records every tool execution and permission prompt from OpenCode sessions; [the deep dive](./deep-dive.md#the-work-ledger) covers the ledger.

### What is the difference between "reached" and "verified"?

Reached is structural: something in your config provides the capability, and its prerequisites are met. Verified is evidence: its declared read-only check ran and passed. The database calls these `state` and `lifecycle`, and a capability can be reached and still `degraded` or `broken`, so every availability decision gates on the check. `ambit verify` runs the checks; `ambit status` reports proven, unproven, and failing counts. The README section [Configured is not working](../README.md#configured-is-not-working) is the longer argument.

## Something else?

[SUPPORT.md](../SUPPORT.md) says where each kind of question goes.
