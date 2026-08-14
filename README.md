<div align="center">

# Ambit

**A capability graph for agent stacks.**

[![Release](https://img.shields.io/github/v/release/zz-plant/ambit?style=flat-square&color=1f7a8c)](https://github.com/zz-plant/ambit/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-informational?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-43853d?style=flat-square)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-runtime-fbf0df?style=flat-square)](https://bun.sh)
[![Server](https://img.shields.io/badge/server-loopback%20only-b8860b?style=flat-square)](#security)

[**Live demo**](https://zz-plant.github.io/ambit/) · [Quick start](#start-here) · [CLI](#ask-better-questions-about-your-stack) · [MCP](#agents-can-query-it-too) · [Roadmap](./ROADMAP.md) · [Why Ambit](./docs/why-ambit.md) · [Theory](./docs/affordance-frontier.md)

</div>

Ambit is a capability-accounting system for agentic infrastructure. It gives agents and their users a persistent model of what their combined environment can actually do: which capabilities exist, what they depend on, what is one step away, what is decaying, and what would break if something disappeared.

The premise is that the meaningful capabilities of an AI system do not reside entirely in the model. They arise from composition — models, tools, credentials, machines, networks, memory, schedulers, humans, policies, persistent processes — so the question worth answering is not what the model knows or what appears in a config file, but:

> **What can this human-machine system actually cause to happen right now?**

It is built for the point where an agent setup stops fitting comfortably in your head.

You have multiple models. MCP servers. Skills. Subagents. Local machines. Hosted services. Credentials. Scheduled jobs. Maybe a homelab.

The individual pieces are visible in configuration files. Their combined action space is not.

Ambit makes that action space explicit.

<div align="center">
<img src="docs/assets/screenshot-tree.png" alt="Ambit capability graph: seven era columns from Foundation to Sovereignty, with reached capabilities filled, reachable ones outlined with setup estimates, and blocked ones faded" width="900">
<br><sub>Filled = reached · outlined = next, with setup cost · faded = blocked by a missing prerequisite</sub>
</div>

## Why Ambit exists

Agent systems are becoming capable through composition.

A shell is one capability. Tailscale is another. Docker is another. Monitoring is another. Together, under the right conditions, they may amount to:

> safely diagnose and recover a failed service without human intervention

No individual config entry says that.

Likewise, the presence of a tool does not prove an agent can reliably use it. A model may technically support tool calling and fail in practice. An agent may hold credentials for an action it is not authorised to take. A machine may have idle compute that no agent can actually reach.

As agent environments grow, several different questions collapse into one:

> **What can this system actually do?**

Ambit treats that as a graph problem. It models capabilities, dependencies, costs, maturity, and composition so that both humans and agents can reason over the environment they share.

## The core idea

Configuration tells you what is declared. Ambit tries to tell you what those declarations amount to.

A capability in a tool registry looks like *"GitHub access: yes."* The useful form is closer to:

> Can diagnose a failing service, modify its repository, deploy a fix, verify recovery, and report the intervention — because the system currently has repository write access, shell execution, deployment credentials, monitoring visibility, network reachability, persistent execution, and the required human authorisation.

That second description is **effective capability**, and it is the object Ambit is built around. Getting there means keeping apart seven things that ordinary registries collapse into one:

| | | today |
|---|---|---|
| **Available** | something appears to exist | ✅ |
| **Reachable** | all necessary dependencies are currently accessible | ✅ |
| **Composed** | several lower-level capabilities together make a higher-order action possible | ✅ |
| **Verified** | the capability has actually succeeded | ✅ where a check is declared |
| **Authorized** | the system has permission to use it | ✅ per action, declared, not enforced |
| **Delegated** | a human or another agent supplies a missing step | ✅ people are nodes; who to ask is roadmap |
| **Persistent** | it can operate beyond the current interaction | roadmap |

Capability *change* is now recorded over time — see [the ledger](#the-ledger) — which is the accounting half of that table rather than a seventh state.

Six of seven, with the caveats stated in the table rather than hidden: checks exist for eight capabilities, and authority is described rather than mediated. [The roadmap](./ROADMAP.md) is the rest.

```console
$ tt verify              # run the declared checks, record what happened
  checked: 8 · verified: 8 · failed: 0
  Local Runtime   verified   23ms   reliability 4/4

$ tt authority           # reached is not the same as permitted
  autonomous      File Editing · Parallel Execution
  needs approval  Shell Execution · Version Control · Continuous Delivery
  forbidden       Secret Management

$ tt actions version-control    # and permission is finer than a capability
  exercisable     read_repository · commit_changes
  needs approval  push_branch · merge_to_default

$ tt plan offline-capable
  goal: Offline Capable · steps: 2 · estimated setup: 25m
  1. Embeddings   2. Local Embeddings
```

The compressed form of the same point:

```
installed ≠ callable ≠ working ≠ reliable ≠ authorized ≠ appropriate
```

## What it does today

Ambit reads your agent configuration and maps discovered components onto a capability graph. It ships with a curated seven-era capability model:

```
1  Foundation     shell · files · code intelligence · version control
2  Model Access   hosted inference · local runtime · local tool calling
                  extended context · model routing
3  Tool Use       tool protocol · browser automation · web research
                  secret management · data access
4  Memory         embeddings · vector store · retrieval
                  persistent memory · context compaction
5  Autonomy       subagents · skills · parallel execution
                  scheduled work · notifications
6  Assurance      tests · review loop · evaluation
                  observability · continuous delivery
7  Sovereignty    local embeddings · offline operation
                  private data · self-hosted infrastructure
```

Each node is in one of three states:

- **Reached** — your environment provides evidence for it, and the graph records which capability provided that evidence
- **Next** — its prerequisites are satisfied and nothing is configured yet
- **Blocked** — an implementation exists but a prerequisite is missing

Ambit also records explicit dependency edges from your configuration: `provider → model`, and `model → agent` for agents pinned to one.

### What a node is

Every node says what kind of thing it is, and every edge says what the relation means:

```
capability   an action the system can bring about — the curated model's nodes
action       one concrete thing a capability confers, or that a person supplies
provider     what supplies a capability — an MCP server, a skill, a tool
resource     what a provider needs — a model, an inference endpoint, a machine
actor        a person: authority, money, judgement, physical access
runtime      an agent runtime, which contributes providers rather than owning them

provides · contributes · requires · optional · authorizes · runs_on
```

Ten capabilities declare a `contract.can` — the actions they confer — and each becomes a node with its own authority. That is what lets the model say *may read the repository, may not merge to its default branch*, which the coarse node cannot. `tt actions` reports them; the visualizer leaves them out of the era columns on purpose, because legibility is the point of that view.

Alongside `state`, each capability carries a **lifecycle** derived from its providers and its recorded evidence:

```
unknown → detected → configured → verified → reliable
                                     ↓
                                 degraded → broken
```

The two are separate columns because reachable and working are different claims. A capability whose check has started failing reads as `broken` and stays in the frontier.

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshot-config.png" alt="Config view: capabilities grouped into domain columns with a diagnostics sidebar" width="100%">
<br><sub><b>CONFIG</b> — your configuration as a graph, with diagnostics.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshot-docs.png" alt="The concept guide explaining capability, era, and the reached/next/blocked states" width="100%">
<br><sub><b>DOCS</b> — nine terms carry all the meaning; the same definitions back <code>tt explain</code>.</sub>
</td>
</tr>
</table>

Any view is linkable: `?view=tree`, `?layout=constellation`, `?docs=open`.

The view updates itself when the graph changes underneath it. `/api/events` streams [AG-UI](https://docs.ag-ui.com) `StateSnapshot` events over SSE — the state subset of that protocol, chosen so the transport an agent would use to propose a change and a human to approve it is a standard one rather than invented. Runs, messages and tool calls are not implemented.

## Start here

```bash
git clone https://github.com/zz-plant/ambit.git
cd ambit
./bootstrap.sh
```

Bootstrap installs dependencies, discovers your environment, and seeds the graph:

```
Installing...
✓ 168 capabilities
┌─ Toolchain ───────────────────────────────────────────┐
│ 156/168 capabilities, 8 domains, 33 combos
│ █████████░ ai-ml        22/26
│ ████████░░ backend      6/8
│ █████████░ devops       7/8
│ ██████████ frontend     1/1
│ █████████░ infra        26/28
│ ██████████ meta         88/89
│ ████████░░ quality      5/6
│ █████░░░░░ security     1/2
└───────────────────────────────────────────────────────┘
```

To inspect what it would find without changing anything:

```bash
./bootstrap.sh --dry-run
```

To launch the visualizer:

```bash
./bootstrap.sh web
```

Bootstrap links the `tt` command into `~/.local/bin` when that directory is on your PATH. If it isn't, bootstrap prints the one-line `ln -s` to run instead; until then the CLI works in place as `./cli.js`.

Homebrew installs the CLI on its own, as `tt`. There is no clone, so build the graph with `tt seed`:

```bash
brew install zz-plant/tap/ambit
tt seed
```

The graph is a local SQLite file — `~/.local/share/ambit/graph.db` for an installed copy, or the checkout itself when you cloned. `tt where` prints the path, and `TOOLCHAIN_DB` overrides it. The engine, the MCP server and the visualizer all read the same one. Nothing is uploaded.

**Requires** Bun for the visualizer and server, Node 22+ for the engine and CLI. Bootstrap checks for both before doing anything. The visualizer needs a checkout; an installed copy carries the engine, CLI and MCP server.

Without an agent config, bootstrap still seeds the curated capability model and says so — you get the graph with nothing of yours in it yet, rather than an error. Point it at your own config with `OPENCODE_CONFIG`, or map a different format with `CONFIG_MAPPING` (see [Other configurations](#other-configurations)).

## Ask better questions about your stack

Run `tt` with no arguments and it shows where you are, what is one step away, and what to do next. The full set:

```
Explore    stats · context · health · profile · export · explain
Verify     verify [id] · evidence <id> · authority · actions [id]
Maintain   decay · diff · trend · prune · prune <id> · ledger · since · failed · deficits
Plan       plan <id> · simulate <id> · propose <id> [n] · proposals · proposal <id>
Act        approve <id> <who> · apply <id> · rollback <id>
Plan       near · combos · fork · insight
Analyze    bottlenecks · impact <id> · spof · budget <setup> <tokens>
```

| | asks |
|---|---|
| `tt near` | What am I one or two dependencies away from being able to do? |
| `tt bottlenecks` | Which capability would unlock the largest part of the graph? |
| `tt impact <id>` | What becomes unavailable if this disappears — and what survives on another provider? |
| `tt spof` | Which capabilities have only one provider — and which actions has only one person? |
| `tt actions <id>` | Which concrete actions does this confer, and which of them may run unattended? |
| `tt fork` | Which nearby path has the best trade-off between setup cost, regret, and downstream leverage? |
| `tt decay` | Which parts of the system appear to be rusting? |
| `tt since` | What became reachable since a past date — and what emerged rather than being added? |

Real output — one dependency away, and the dependency it names gates four further capabilities:

```console
$ tt near

  Local Embeddings
    missing: 1
    met count: 1
    total required: 2
    met maturity: 70
    investment: Add Embeddings
```

More useful is where composition *fails*. Capabilities you have already half-built carry the reason:

```
Retrieval          configured, but Vector Store is not in place yet
Offline Capable    configured, but Local Embeddings is not in place yet
Self-Hosted Stack  configured, but Observability is not in place yet
```

Nothing declared those. They fall out of the dependency structure, and they are invisible in every file you own.

### People in the graph

Humans supply what machines cannot — legal authority, money, physical access, judgement — so they are nodes rather than users of the graph. An `actors` block declares them:

```json
{ "actors": { "kanav": {
    "provides": ["physical-access", "approve-purchases"],
    "authorizes": ["combo:continuous-delivery"] } } }
```

`provides` becomes a capability only that person supplies. `authorizes` becomes a hard prerequisite, so a plan says whose step it is:

```console
$ tt plan continuous-delivery
  goal: Continuous Delivery
  requires a person: Kanav
  steps: 1 · estimated setup: 30m
```

A plan that hides the human step reads as autonomous when it is not. A capability chain can therefore run:

```
diagnose hardware failure → request replacement → human approves expenditure
→ vendor ships component → human installs it → agent configures it
→ monitoring verifies recovery
```

The capability belongs to the human-machine system, not to either half — which lets partial, structured autonomy be described as it actually is, rather than forced into "fully autonomous" or "human controlled".

### Previewing a change

`tt simulate` computes the frontier as it would be, without touching anything. What makes it worth reading is the second line:

```console
$ tt simulate vector-store
  frontier: 21 → 23
  acquired:  Vector Store
  unblocked: Retrieval          # already provided, waiting on the prerequisite
```

`tt propose` turns that into a reviewable draft — ordered steps, the alternative chosen, and what it costs beyond time:

```console
$ tt propose retrieval
  Retrieval · 25m
    Embeddings     nomic-embed via local runtime      none / local
    Vector Store   pgvector on existing Postgres      none / local
  simulated frontier: 21 → 24
  executable: false
```

Choosing the hosted alternatives (`tt propose retrieval 1`) takes it to 13 minutes, at a per-token bill and a data boundary.

Where an acquisition genuinely *is* a config change, the step carries a declarative patch and Ambit derives its undo — removing what it adds, or restoring what it overwrites. Anything needing an installer gets no inverse, and a proposal is `applicable` only when every step has one.

```console
$ tt approve prop-msrrv9c2 kanav
  approved by: Kanav · applicable: true
  Approved. Applying is not implemented — this records permission, not action.
```

```console
$ tt apply prop-msrsqzij
  applied: true · keys: mcp.fetch
  backup: opencode.json.ambit-prop-msrsqzij.bak

$ tt rollback prop-msrsqzij
  removed: mcp.fetch          # git survives — the inverse reverses only this
```

**Apply only edits configuration, and cannot do otherwise.** A step carries a declarative patch or nothing; there is no field that holds a command. It refuses a proposal no person approved, and any step without an inverse. It backs up first, and if verification fails afterwards it rolls back automatically and says the change was reversed.

`applicable` and `executable` are separate claims: the first says a proposal could be applied safely, the second says apply does not exist. Approval is CLI-only and not exposed over MCP — an agent may draft and preview, but approval is the human's act and should not be reachable by the thing being approved.

### The ledger

`capabilities` holds the present state and is overwritten on every seed, so on its own the graph can only say what the system can do *now*. Every seed also records the whole frontier, which lets it answer what was reachable at a past date:

```console
$ tt since
  frontier then: 13
  frontier now:  19
  gained:    Embeddings · Local Embeddings · nomic-embed-text
  emergent:  Model Routing · Offline Capable · Subagents
```

One embedding model was added. Six capabilities moved. The three under `emergent` became reachable although **nothing providing them was added** — their prerequisites were satisfied by something else entirely. Offline Capable was already provided by an agent that did not change.

That is the entry a per-component changelog structurally cannot produce, because no single change explains it. Accumulated capacity to act is a graph property, and this is where it shows up.

A fourth class, **vocabulary**, exists to keep the first three honest. When Ambit starts modelling a part of your system it did not model before — a new action on a contract, or a capability added to the curated tree that your existing tools already provide — the node is new and nothing about the machine changed. Those are described and not counted, so `frontier_now` stays comparable with `frontier_then`:

```console
$ tt since
  frontier then: 21
  frontier now:  21
  vocabulary: 12   act:shell-execution/run_command · act:file-editing/write_file · …
```

Without it, upgrading Ambit would read as a dozen capabilities acquired on a machine where nothing happened — which is exactly what this table exists not to do.

Every command prints for a person by default and takes `--json` for scripts.

## Agents can query it too

Ambit ships an MCP server exposing the graph directly to an agent:

```
tt_stats   tt_context  tt_recs    tt_cap     tt_decay    tt_combos
tt_diff    tt_health   tt_impact  tt_budget  tt_trend    tt_near
tt_insight tt_profile  tt_prune   tt_fork    tt_bottlenecks

tt_verify  tt_evidence tt_authority tt_plan  tt_since    tt_ledger
tt_blocked tt_deficits tt_spof
tt_simulate tt_propose tt_proposals tt_proposal
```

The second group is the capability lifecycle: is this real, may I act, what is missing, and — when the answer is *nothing here can do that* — recording it so a deficit hit repeatedly becomes visible as infrastructure that should exist rather than a wall to work around again.

Register it with Claude Code:

```bash
claude mcp add ambit -- node --experimental-sqlite /path/to/ambit/src/mcp/server.ts
```

Or in `opencode.json` — and in any other runtime that takes a stdio command:

```json
{ "mcp": { "ambit": {
    "type": "local",
    "command": ["node", "--experimental-sqlite", "/path/to/ambit/src/mcp/server.ts"],
    "enabled": true } } }
```

It reads the same database `bootstrap.sh` writes. Set `TOOLCHAIN_DB` if you keep the graph somewhere else; the engine, the MCP server and the visualizer API all resolve that one variable.

This matters because Ambit is not only a dashboard for the user. An agent should be able to ask:

- What infrastructure am I operating inside?
- Which capabilities are already available?
- Why is this task outside the current action space?
- Is this limitation local to the task, or are we repeatedly missing the same primitive?
- Which existing component is a single point of failure?

The agent no longer has to reconstruct the environment from conversational context every session.

## Runtimes are nodes, not owners

Ambit represents agent runtimes rather than being one. A runtime becomes a node, and everything it contributes hangs off it — so two runtimes configuring the same MCP server produce **one capability with two providers**, not two capabilities.

```bash
bun run scripts/adapters/claude-code.ts          # what Claude Code provides
bun run scripts/adapters/claude-code.ts --seed   # add it to the graph
bun run scripts/adapters/hermes.ts               # the same for Hermes
```

The Claude Code adapter reads `~/.claude.json` and `~/.claude/` — MCP servers global and per project, skills, subagents, a pinned model — plus the authority the runtime states outright: permission mode, and how many allow, deny and ask rules are in force. Rule *names* only; an allow rule can name a path, and those are not Ambit's to copy into a graph you may export.

Against a real install, that yields:

```
runtime:opencode — contributes 127 capabilities
runtime:hermes   — contributes 32 capabilities
shared by both   — mcp:fetch · mcp:filesystem · mcp:git · mcp:sequential-thinking
```

`tt impact runtime:hermes` then answers what would be lost if that runtime went away — and the answer is smaller than its capability count, because the shared four survive.

The adapter also reads what a config file cannot infer but the runtime states outright: Hermes reports `approvals: manual`, `cron_mode: deny`, eight messaging surfaces, a policy engine, and zero scheduled jobs — which is the difference between a capability that persists and one that lasts a session.

Hermes has no machine-readable config export today, so the adapter reads its documented paths. That is a stopgap: the durable contract is for runtimes to publish their capability surface and for Ambit to consume it.

## The visualizer

Four views: **ERAS** (capability model by era), **CONSTELLATION** (3D), **ORBITAL** (concentric by type), **FLAT** (force-directed).

The visualizer is a view over the model, not the product's ultimate abstraction. The underlying graph is meant to stay useful when no human is looking at it.

## Infrastructure belongs in the graph

Agent capabilities do not stop at the model boundary. A local GPU, NAS, browser worker, Proxmox host, database, or cloud account can all contribute to what the system can accomplish.

Ambit scans infrastructure from an explicit local manifest (`INFRA_MANIFEST`, default `~/.config/opencode/infrastructure.json`). With no manifest it returns an empty scan rather than an error — no host addresses are baked in.

The manifest is not specific to servers. A device is anything that can act — a Pi, a GPU host, a robot arm, a sensor, a decoder — and they seed as first-class nodes in a `physical` domain. Whether that generalisation is the right one is argued in [the affordance frontier](./docs/affordance-frontier.md); what is implemented is that the model does not assume software.

The goal is not another homelab inventory. It is to treat infrastructure as capability-bearing:

```
GPU node
  ├─ local inference
  ├─ embeddings
  ├─ batch evaluation
  └─ private processing
```

A machine matters because of the actions it makes reachable.

## Composition is the interesting part

A growing agent environment produces capabilities that no individual component declares:

```
monitoring + shell + service manager + network reachability
+ notifications + appropriate authority

        → diagnose and recover a failed service
```

Ambit's direction is to represent and verify those compositions explicitly — moving from *which tools are installed?* toward *which goals are reachable?*

## From configured to demonstrated

Detection is a first approximation. Today Ambit infers capability from configuration and naming patterns. The deeper model is empirical:

```
unknown → detected → configured → demonstrated
        → repeatedly verified → degraded → unavailable
```

A capability should mean more than "something with the right name exists". It should mean the system has evidence the action can be performed under known conditions. That distinction matters more as agents gain authority.

That lifecycle is now a stored column rather than an aspiration — see [what a node is](#what-a-node-is). What it does not yet do is gate anything: `tt plan` will route a path through a `broken` capability without complaint.

## Capability and authority are different things

Being technically capable of an action should not imply permission to perform it.

```
CAN OBSERVE    autonomous
CAN PLAN       autonomous
CAN SIMULATE   autonomous
CAN EXECUTE    approval required
CAN VERIFY     autonomous
CAN ESCALATE   autonomous
```

This lets technical capability accumulate without silently broadening delegated authority. It is not a restriction on the capability model — it is what makes a larger capability surface governable.

Authority is recorded per action, and from two sources. The curated model says what an action is like in general; the runtime that would execute it says what it permits here — Hermes publishes `approvals.mode` and `approvals.cron_mode`, Claude Code publishes `permissions.defaultMode`, and both adapters pass them through. Where the two disagree the narrower wins, and `tt authority` names which source narrowed it.

Two limits worth stating plainly. **Nothing is enforced** — Ambit describes authority, it does not mediate action. And **scope is declared, not checked**: a grant can say `repo:owner/name`, and nothing verifies that the scope is the one an action would touch.

## Why an AI might ask you to install Ambit

The interesting case is not *"you should install another developer tool."* It is an agent recognising:

> I keep encountering environmental limitations that neither of us can represent or fix systematically.

That happens when every session rediscovers the same machines and permissions, when unrelated tasks fail on the same missing primitive, when capabilities exist but their composition is unclear, or when the distinction between *possible* and *permitted* lives only in conversation.

The point is not to make the agent indiscriminately more powerful. It is to give the joint system a durable representation of the environment it is already building.

## Why this may matter beyond developer tooling

As AI systems acquire more persistent means of action, capability increasingly becomes a **systems property** rather than a model property. Effective agency can grow through thousands of small integrations without any dramatic increase in model intelligence — credentials, persistence, schedulers, tools, machines, memory, delegation, and network reach all contribute.

A useful design norm follows:

> **No increase in effective capability without a corresponding increase in legibility, verification, and governability.**

Ambit does not attempt to solve alignment. It addresses a narrower problem: the growth of effective agency outpacing our ability to represent, bound, verify, and revoke it.

A mature capability graph could make several invariants explicit — no autonomous acquisition of new authority; no delegation beyond the delegator's; no persistent worker without an owner and a kill path; no capability promotion without verification; no irreversible action without a recovery path.

The larger idea is simple: **make capability accumulation explicit rather than accidental.**

There is a longer version of this argument in [why-ambit.md](./docs/why-ambit.md), and the theory it rests on — affordances as relational, robotics and BCIs as the cases that test the abstraction, and the intellectual genealogy — in [affordance-frontier.md](./docs/affordance-frontier.md).

## Architecture

```
agent config
infrastructure manifest
        │
        ▼
   Ambit engine
        │
        ▼
    SQLite graph
        │
        ├──► CLI                tt
        ├──► MCP server         31 tools, JSON-RPC over stdio
        ├──► visualizer API     Bun.serve, port 3001
        └──► tracking plugin    config-change events
```

TypeScript · Node 22 with `node:sqlite` · Bun server · React + Vite · Three.js · JSON-RPC MCP · local-first state.

## Security

The server reads and writes `opencode.json`, so two invariants hold:

- **Loopback only.** It binds `127.0.0.1` and rejects non-local origins **before routing** — CORS headers alone are insufficient, because a simple request skips preflight and reaches the handler regardless.
- **It cannot create configuration entries.** An MCP entry carries a command your agent runtime executes, so creating one over HTTP would be remote code execution. The API can toggle an MCP and edit an existing agent's description or model; adding a server generates a snippet you paste yourself.

Ambit should become more capable without making its own control surface casually dangerous. There is no telemetry.

## Other configurations

OpenCode is the default input format, but the engine is not tied to it. Map another JSON configuration with `CONFIG_MAPPING`:

```bash
CONFIG_MAPPING='{
  "config_keys": {
    "tools": { "type": "tool", "domain": "devops", "desc_field": "description" }
  }
}' \
OPENCODE_CONFIG=my-project.json \
./bootstrap.sh
```

The default mapping covers MCP servers, agents, providers, commands, and skills.

The eventual goal is broader: different agent runtimes should attach to the same capability model rather than each maintaining a private and incompatible understanding of the environment.

## Status

Ambit is early. Today it is strongest as capability discovery, dependency mapping, maturity and decay analysis, failure-cascade analysis, near-miss discovery, budget-aware planning, and an MCP-readable external model of an agent environment.

Verified capability and explicit authority are built: the graph distinguishes capability from provider from resource from actor, records what each action confers, and holds authority from both the model and the runtime that would execute the step. What remains of the larger direction — goal-to-capability planning from a free-form goal, comparing acquisition paths by risk and lock-in, enforcement rather than description, and scope that is checked rather than declared — is the architecture the current graph is meant to grow toward. See [ROADMAP.md](./ROADMAP.md).

The point is not to pretend those pieces exist. It is to build toward them without changing the fundamental object. That object is the system's **ambit**: the set of actions presently reachable by the combined capabilities of its human, agents, tools, and machines.

## Contributing

Fork → branch → commit → PR. See [AGENTS.md](./AGENTS.md) for conventions, the typechecking setup, and the security invariants the server must preserve.

## License

MIT — see [LICENSE](./LICENSE).
