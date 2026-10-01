<div align="center">

# Ambit

**What you, your agents, and your machines can jointly do — and where your own time is going.**

That is your *ambit*. Ambit reads the configs of Claude Code, Cursor, OpenCode and eight more agent runtimes into one local map of it, and shows how to widen it: what you can do now, what one more step would unlock, and which of what you have is configured but not actually working.

[![CI](https://img.shields.io/github/actions/workflow/status/zz-plant/ambit/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/zz-plant/ambit/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zz-plant/ambit?style=flat-square&color=7aa2f7)](https://github.com/zz-plant/ambit/releases/latest)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational?style=flat-square)](./LICENSE)

[**Try the live demo**](https://zz-plant.github.io/ambit/?demo=1) · [Get started](#get-started) · [Connect it to your agent](#connect-it-to-your-agent) · [FAQ](./docs/faq.md) · [Docs](https://zz-plant.github.io/ambit/docs/)

<br>

<img src="docs/assets/capability-graph-demo.gif" alt="Ambit showing one developer setup as a map: Embeddings, a next step, is selected and simulating it lights the four capabilities it would make reachable in green; then Shell Execution is switched off, what depends on it turns red, and nine working capabilities would stop; a second view colors the tools that interrupt a person most often, and a proposed config change waits for approval" width="920">

<sub>One setup, mapped. Pick a next step and Ambit shows what it would open: four more capabilities. Pick one you rely on and switch it off, and it counts the nine working things that would stop with it. Then which tools interrupt you most, and a change waiting on your approval.</sub>

`brew install zz-plant/tap/ambit && ambit`, or [open the hosted demo](https://zz-plant.github.io/ambit/?demo=1) and install nothing.

</div>

---

## Who it is for

Anyone running AI agents who wants them to do more. A small setup, one runtime and a few MCP servers, has the most ground ahead of it, and Ambit names the step that unlocks the most and the combos a single missing piece would give you. A large one, with several runtimes, dozens of servers and a second machine, gets the other half as well: what is configured but failing, and what would stop together if one shared piece went.

The demo walks a sample setup in five steps: an outage that spreads, a check that was already failing, the next step worth taking, the approval every change waits for, and then your own config, pasted into the tab and mapped there with nothing uploaded.

## What Ambit is

An *ambit* (from Latin *ambitus*: circuit, perimeter, sphere of action) is the boundary of what someone can reach. Working with agents, yours is set by a stack spread across LLM providers, MCP servers, local CLI tools, skill directories, credentials and machines, each with its own config file. What they add up to is written down nowhere, and so is where the boundary sits and how to move it.

Ambit reads those configs and builds one map. Every tool, model, skill and credential becomes a point on it, and everything one of them needs in order to work becomes a line to another. The map answers four questions no single file can:

1. **What is one step away?** The frontier: capabilities whose prerequisites you already meet, each with its setup time, and the near misses one or two prerequisites from unlocking several more. Tools configured separately combine, too: a vector store plus local embeddings is semantic retrieval, which neither config mentions.
2. **What is worth setting up next?** Ranked by what keeps blocking your agents and by how much each step unlocks, and once the work ledger holds a few weeks, by the human attention it would save.
3. **What actually works?** A configured tool is not a working one. Ambit runs each capability's declared check (`ambit verify`), keeps what is configured apart from what is proven (`installed ≠ working ≠ authorized`), and takes a failing capability out of every plan without asking, so the boundary it draws is one you can lean on.
4. **What would stop if one piece went?** It follows dependencies all the way down, so three "redundant" providers behind one shared token show up as the single point of failure they are.

You ask from the terminal. Your agents ask over MCP: what they can do before they try, and when they hit a limit, what would lift it, drafted as a change you approve. Ambit is itself an MCP server, so the thing describing your MCP servers speaks their protocol. (A *meta-MCP server*, if you want the term to search for.)

### The words Ambit uses

Four of them carry most of the meaning, in the terminal and on the map alike.

- **Capability**: one thing your setup can do. Every MCP server, agent, skill, provider, model and command in your config becomes one, as does every node of the curated tree.
- **Era**: how far up the tree a capability sits. Later eras depend on earlier ones. Eras describe ordering, not importance.
- **Reached, next step, blocked**: reached means something in your config provides it. A next step is one whose prerequisites are met with nothing detected: this is the frontier, and `ambit goal` lists it. Blocked means a prerequisite is missing, which is usually the most informative of the three.
- **Required vs optional prerequisite**: a required prerequisite gates the capability; an optional one strengthens it without gating. Only required ones block a node. The data model and the CLI call these hard and soft.

<div align="center">
<img src="docs/assets/screenshot-tree.png" alt="The Ambit capability map: tools and skills drawn as connected nodes in themed eras" width="900">
<br><sub>Filled nodes are reached · Bright rings are a next step, with their setup time · Dashed nodes are blocked, with a prerequisite missing · The line on top is what the map found</sub>
</div>

---

## In practice

**The combo you already almost have.** You run local Postgres and Ollama, but your agent cannot search your code semantically. `ambit graph combos` reports the gap as one step, `CREATE EXTENSION vector;`, and `ambit goal retrieval --simulate` shows what that five-minute change reaches, with no cloud API in the path.

**An agent that asks for what it lacks.** Mid-task, an agent needs local embeddings and has none. It records the deficit, asks Ambit what the goal is missing, and drafts a proposal: one config patch. You approve and apply it, and the frontier moves by four capabilities, Local Embeddings among them, through combination. [The recording below](#the-one-habit-worth-teaching) is that loop, run for real.

**Rotating a shared token.** Before you revoke a personal access token, `ambit impact credential:github/user-token` names everything standing on it: the two background MCP tools and the scheduled sync agent that would otherwise fail some hours later without a word. The sharing is declared in a `credentials` block, whose shape is in [the deep dive](./docs/deep-dive.md#what-a-node-is); until you write one, `ambit credentials` says none are declared.

---

## Where this sits in the stack

Ambit sits above the protocol layer and below workflow orchestration. It neither routes calls nor runs them.

| System | Finds a tool | Knows prerequisite order | Tells working from configured | Prices human attention | Gates what an agent may do |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Vector tool-RAG | by similarity | – | – | – | – |
| Workflow state machines (LangGraph) | – | within one task | – | – | within one task |
| Package managers (Nix, Homebrew) | – | for binaries | – | – | – |
| Flat MCP catalogs (Smithery, registries) | by name | – | – | – | – |
| **Ambit** | by what it needs | across the whole host | ✓ declared checks | ✓ work ledger | ✓ authority contracts, signed approvals |

Semantic search finds tools that sound relevant and cannot tell a working one from a broken one. A workflow graph models control flow within one task. A package manager installs binaries. Flat catalogs index servers without tracking whether their prerequisites exist on your machine. Ambit models what those tools add up to on this host, what it costs a person to keep them working, and what an agent may do with them.

---

## Get started

| Way in | What it gives you |
| :--- | :--- |
| **In the browser** | [Open the hosted demo](https://zz-plant.github.io/ambit/?demo=1) for a sample setup, or drop in your own MCP config from Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, Cline, Roo Code or OpenCode, and it is mapped in the tab, uploading nothing. |
| **On your machine** | `brew install zz-plant/tap/ambit && ambit` reads your real agent configs and prints where you stand. This is the CLI and the MCP server; the map needs a checkout. |
| **With the map** | `git clone https://github.com/zz-plant/ambit.git && cd ambit && ./bootstrap.sh web` builds the graph from your own configs and serves the map the pictures on this page show. |
| **In a cloud IDE** | [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/zz-plant/ambit?quickstart=1) A full checkout with the map running, in a browser tab, touching nothing on your machine. |
| **From your agent** | Register Ambit over MCP and the agent can ask what it is able to do before it tries. [Connect it to your agent](#connect-it-to-your-agent) has the snippet. |

Homebrew installs the tagged release on macOS or Linux. `./bootstrap.sh` discovers OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex CLI, Cline, Roo Code, Continue and Zed, and the skill directories `~/.agents/skills`, `~/.opencode/skills` and `~/.config/opencode/skills`, builds a local SQLite graph, links `ambit` into `~/.local/bin` (or prints the `ln -s` line when that is not on your PATH), and ends on `ambit status`. `--dry-run` shows what it would do first.

> [!NOTE]
> The npm package is built and ready but not yet published, so there is no `npx` path yet.

<div align="center">
<img src="docs/assets/screenshot-config.png" alt="The My Setup view: MCP servers, agents, and models read from local config, one row each, with what the engine has proved about them and the capabilities each provides" width="900">
<br><sub>My Setup is the list the map is drawn from: every server, agent, and model found on the machine, whether it is on, what its check said, and which capabilities on the map it provides</sub>
</div>

---

## Ask from the terminal

| Command | What it answers |
| :--- | :--- |
| `ambit status` | Environment health: what is reached and how much of it is proven, what is failing its declared check, what has a single provider, pending approvals, and the one command to type next |
| `ambit goal <name>` | The path to unlock a capability, in order, with setup estimates |
| `ambit impact <id>` | Blast radius: what breaks if this tool, model, or credential goes down |
| `ambit graph combos` | Compound capabilities, including the ones you are one prerequisite away from |
| `ambit authority` | Per-action permissions: what runs unattended, what needs confirmation |
| `ambit verify [id]` | Run a capability's declared check and record whether it actually works |
| `ambit history [since <when> [<until>]]` | How the frontier moved, separating what you acquired from what emerged |
| `ambit share` | A self-contained HTML snapshot of the map, written locally and safe to post |

`ambit help` covers a first session, `ambit help --all` the full surface, and `ambit help <term>` one concept.

Everything above answers on a graph Ambit builds by itself. A second group (`attention`, `work`, `usage`, `opportunities`, `roi`, `audit`) prices the human cost of running the stack from a work ledger that starts empty. Those commands say what they need instead of returning a number, and they become useful after a few weeks of recorded runs, not on install. [The FAQ](./docs/faq.md#i-ran-ambit-attention-and-it-says-nothing-is-recorded-is-it-broken) says how to start recording.

### ambit status — where the environment stands

<!-- example: ambit status -->
```console
$ ambit status

    39 of 59 reached · 0 proven · 9 with a single provider
    ──────────────────────────────────────────────────────
    proven          0
  › unproven       15
    failing         0
    last check  never

    actions: 18/28 reached
    provable now: Automated Tests, Browser Automation, Code Intelligence, Continuous Delivery, Data Access, File Editing, Local Runtime, Shell Execution
    domains:
      ████░░░░░░ ai-ml     5/13
      █████████░ backend   7/8
      ████████░░ devops    4/5
      ██████████ frontend  1/1
    …

    Next  ambit verify · turns 11 of the unproven into evidence
```
<!-- /example -->

This is a fresh graph, before any check has run: reached and proven lead, the `›` marks the count that wants a person, and the last line is the command to type next. CI captures the block from a fixture graph and fails if it drifts from what the command prints.

### ambit share — what may leave the graph, and what may not

`ambit share` builds its HTML from an allow-list: name, kind, category, domain, era, state, lifecycle, edges. Commands, URLs, paths, descriptions and economics cannot enter the file, people render as "a person", and `--redact` replaces every non-curated name with its category. Nothing is uploaded; writing the file locally is the whole command.

### From a script, or an agent's shell

`--json` prints any answer as data, colour is drawn only on a terminal, and the exit code says whether the command worked. Two commands can gate a script the way `git diff --exit-code` does:

```bash
ambit can shell-execution --exit-code     # 0 go ahead, 1 put it to the person, 2 stop
ambit verify shell-execution --exit-code  # 1 unless every check that ran passed
```

[The CLI reference](./docs/deep-dive.md#the-full-cli-surface) has every exit code and flag.

---

## Connect it to your agent

Registered as an MCP server, Ambit lets an agent check what it can do before it tries, and plan around what is missing.

### Claude Code

```bash
claude mcp add ambit -- ambit mcp --profile=agent
```

`--profile=agent` lists the ten tools an agent that asks before it acts uses, in 4.4KB of its context. Leave the flag off for all sixty, about 19.5KB; the other fifty answer by name either way. [The deep dive](./docs/deep-dive.md#the-full-mcp-surface) names every tool and [says how a call is answered](./docs/deep-dive.md#how-a-call-is-answered).

Ambit also publishes `ambit://briefing`, a resource a client reads on connect: what is reached and proven, what is failing, what is waiting on you, what blocked work in the last week, and what is worth reaching next, in about 1,200 tokens. To put it at the top of every session yourself, add a hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "ambit briefing" }] }]
  }
}
```

### OpenCode

`ambit connect opencode` adds the entry to `~/.config/opencode/opencode.json` in whichever shape the file already uses, OpenCode 1's or 2's, with or without comments. By hand, in OpenCode 1's shape:

```json
{
  "mcp": {
    "ambit": {
      "type": "local",
      "command": ["ambit", "mcp", "--profile=agent"],
      "enabled": true
    }
  }
}
```

OpenCode 2 puts the same entry under `mcp.servers`, with `"disabled": false` in place of `"enabled": true`.

Both clients assume `ambit` is on your PATH, which Homebrew and `bootstrap.sh` both arrange; failing that, use the absolute path to `cli.js`. An agent can read the map, ask what a goal is missing, and **propose** a configuration change. Applying one always requires your approval.

### The one habit worth teaching

> Before running a tool you have not used this session, call `ambit_can` with
> the capability. On `yes`, act. On `ask`, put it to the person. On `no`, it has
> already recorded the deficit, so do not retry it under another name.

The server sends this line itself, as the `instructions` a client receives when it connects. For a client that does not pass those to its model, `ambit init-rules` writes the line into `CLAUDE.md`, `AGENTS.md` or `.cursorrules`, and an agent with a shell and no MCP asks the same question with `ambit can <capability> --exit-code`. A refusal files itself as a deficit, so the third time something is missing it shows up as infrastructure that should exist, not a wall to work around again.

<div align="center">
<img src="docs/assets/agent-loop-demo.gif" alt="An agent hits a missing capability, asks Ambit why over MCP, and drafts a proposal; a person approves and applies it; the frontier moves and Local Embeddings unlocks through composition" width="920">
<br><sub>Agent: hits a block, records the deficit, asks <code>goal</code>, drafts a proposal · Human: <code>approve</code>, <code>apply</code> · One config patch, four capabilities. Every frame is real engine output, re-recorded by <code>scripts/demo-agent-loop.ts</code>.</sub>
</div>

---

## The map

`./bootstrap.sh web` serves four views over the graph the CLI reads.

- **Map**: the curated tree with your position on it. One line over it says what it found before you read a node: a capability failing its check, or else the next step that reaches the most.
- **My Setup**: one row per entry your configs declare, with its recent check runs and the capabilities it provides. Its Briefing tab is the text an agent is given at connect, so what the agent believes about the machine can be read.
- **Time & cost**: the work ledger, what may act without asking, what to reach next, and how the frontier moved this week.
- **Audit**: proposals, approvals, check runs and work runs, newest first, with a query bar.

Select a node and the panel says what would stop if it went down, or what stands between it and being reached and how long that would take. **Simulate an outage** draws that cascade, red for what stops and amber for what only loses a provider; **simulate unlocking** lights what one missing piece would make reachable. Neither writes anything. Three lenses repaint the map: **Standard** (reached, next step, blocked), **Attention** (which tools keep interrupting a person) and **Authority** (what may act alone, what must ask, what is forbidden).

When an agent proposes a change over MCP, the **Proposals** panel reads it as a plan before you sign: its steps, which of them nothing can undo, what it unlocks and costs, and how you decided on drafts like it before. Approving mints a signed artifact, and applying it is a separate `ambit apply`.

[The reference](./docs/deep-dive.md#the-map-and-what-it-is-allowed-to-do) covers the rest: what each mark means, focus, the minimap, the timeline that replays the map as it was, deciding several drafts at once, and pushing one to your phone.

---

## How it works

Discovery reads your host configs into an embedded SQLite graph, and three surfaces read it back out: the CLI, the MCP server and the map. Discovery, verification and the work ledger write to the graph. Your agent configuration changes only through a proposal you approve, or through the map's switch for an entry that already exists, which cannot create one.

Each client is read from its own standard config path, and every server stays attributed to the client that listed it. Two clients naming the same server is one capability with two providers, which is what stops Ambit counting one binary twice and calling the result redundancy.

Discovered capabilities are placed in a curated tree of seven eras, from **Foundation** and **Model Access** through **Tool Use**, **Memory**, **Autonomy** and **Assurance** to **Sovereignty**. Because each capability records what it needs, Ambit works out what you can reach without taking a config file's word for it, which combos emerge from tools configured apart, and which near misses are one or two prerequisites from unlocking several others.

### Configured is not working

Ambit keeps two properties apart, and the distinction is load-bearing:

- `state` is **structural**: is this thing configured, and what does it depend on. This is what the frontier ledger records.
- `lifecycle` is **health**: did its declared verification command actually pass. A capability can be fully configured and still `degraded` or `broken`.

Every availability decision gates on lifecycle, not state. A broken capability is excluded from plans, simulations, goals, authority checks and opportunity ranking, because a plan routed through a tool that does not run is worse than no plan. `ambit status` reports proven, unproven and failing counts, and the map badges each reached node: `✓` for a passing check, `!` for a failing one, nothing for configured but never verified.

### Fragility is computed, not guessed

- **Single points of failure**: capabilities with exactly one provider.
- **Bottlenecks**: nodes ranked by how much sits downstream of them. The map marks the same idea on each node, as a keystone.
- **Shared credentials**: providers presenting the same credential fail together, so three providers behind one token is not redundancy. This one is declared, never inferred: name the sharers in a `credentials` block and `ambit impact credential:...` shows what revoking it would end.

---

## The control plane

Host-level agent tooling is a real attack surface, so execution goes through an interceptor and never straight to the shell. Before a tool call reaches your machine, the proxy in `src/control_plane/proxy.ts` checks three things: are this capability's prerequisites in place, is it actually working, and is the caller allowed to do this. A call that fails any of them is refused (`AMBIT_BLOCKED_UNAUTHORIZED`, exit code `2`) and nothing on the machine changes. A blocked call drafts a proposal and an HMAC challenge; `ambit approve <proposal-id> <person>` mints a signed artifact the executor verifies, and it stops being valid if the proposal changed after approval or has expired. Spans record each evaluation, challenge and receipt.

The decision is real and runs against your actual graph. What sits on the other side of the gate is a fixture: `simulatedAdapter` keeps its state in a JSON file, and Ambit ships no deployment integration. A real one implements the three-method `EnvironmentAdapter` in the same file, and nothing above the gate changes. [`INCIDENT_TRACE_001`](./docs/incidents/INCIDENT_TRACE_001.md) walks a deploy agent blocked mid-flight and then remediated, and `npm run demo:incident` replays it in 90 seconds.

---

## Security invariants

Ambit reads developer toolchains and writes to agent configs, so four properties are fixed and cannot be relaxed. [`SECURITY.md`](./SECURITY.md) states each in full, with what is in scope and what is not; [`AGENTS.md`](./AGENTS.md#security-posture) says where each is enforced.

1. **Loopback only.** The API server binds `127.0.0.1`. No LAN, no tunnel.
2. **Origin allowlist.** A request with a non-local `Origin` is rejected with 403 *before* routing, because a simple request skips preflight and response headers alone would not stop it.
3. **No entry creation over HTTP.** The HTTP layer edits entries that already exist and nothing else. An MCP entry carries a command the runtime later executes, so creating one over HTTP would be remote code execution; adding a server returns a snippet for you to paste.
4. **No egress you did not type.** The graph is an embedded SQLite database on your machine, and there is no telemetry. Five commands open a socket at all (`notify`, `notify-approvals`, `dispatch`, `incidents`, and `goal --judge`). The first four each need a target you name, and the last refuses any host but this machine. [The FAQ](./docs/faq.md#does-anything-leave-my-machine) lists exactly what each one sends.

---

## Documentation

- [FAQ](./docs/faq.md): what needs installing, what leaves the machine, why the attention commands are empty on day one.
- [Deep dive](./docs/deep-dive.md): the reference for the model under everything above, the map in full, and where Ambit sits in the revisable-delegation loop.
- [Where each AI agent keeps its MCP config](./docs/mcp-config-locations.md) · [What breaks if an MCP server goes down](./docs/mcp-outage.md) · [Auditing an agent's MCP servers](./docs/audit-mcp-servers.md) · [Ambit and MCP gateways](./docs/compare.md): the questions people search for, answered with the commands above.
- [Security](./SECURITY.md) · [Agent invariants](./AGENTS.md) · [Support](./SUPPORT.md) · [Contributing](./CONTRIBUTING.md): the invariants above in full, where each is enforced, where each kind of question goes, and how to send a change.
- [Everything else](./docs/): the argument, the theory, Jev, the design notes, the changelog, the incident traces.
- [`llms.txt`](https://zz-plant.github.io/ambit/llms.txt): the project in one page, for an agent that is deciding whether to recommend it.

---

## Contributing

New capability models, runtime readers, visualization work and edge-case reports are all welcome. Issues labelled [good first issue](https://github.com/zz-plant/ambit/labels/good%20first%20issue) are scoped to an afternoon and name the files to start from. [CONTRIBUTING.md](./CONTRIBUTING.md) gets you from a clone to a passing pull request and [lists every check CI runs](./CONTRIBUTING.md#the-checks-ci-runs).

---

## Support the project

Ambit is a personal project. If it answered a question your config files could not, [a star](https://github.com/zz-plant/ambit/stargazers) is how the next person with the same stack finds it.

- Post an `ambit share --redact` snapshot of your own map. The file names nothing on your machine, and every real graph is an argument the demo cannot make.
- Report the runtime it does not read yet, or the capability it models wrong. Both are [issue templates](https://github.com/zz-plant/ambit/issues/new/choose).
- To hear when a new runtime reader or capability lands, choose **Watch → Custom → Releases**.

---

## License

[MIT](./LICENSE) © Kanav Jain
