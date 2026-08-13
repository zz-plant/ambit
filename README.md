<div align="center">

# Ambit

**A capability model and planning layer for personal agent infrastructure.**

[![Release](https://img.shields.io/github/v/release/zz-plant/ambit?style=flat-square&color=1f7a8c)](https://github.com/zz-plant/ambit/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-informational?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-43853d?style=flat-square)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-runtime-fbf0df?style=flat-square)](https://bun.sh)
[![Server](https://img.shields.io/badge/server-loopback%20only-b8860b?style=flat-square)](#security)

[**Live demo**](https://zz-plant.github.io/ambit/) · [Quick start](#quick-start) · [Roadmap](./ROADMAP.md) · [CLI](#cli-reference) · [MCP](#mcp-reference)

</div>

## Know what your agent stack can actually do

Ambit builds a capability graph across your agents, tools, models, and infrastructure — so you can inspect dependencies, see what is merely configured versus actually working, and reason about what to add next.

You have six agents, eleven MCP servers, three model providers, a GPU box, a handful of scheduled jobs, and some custom skills. Which capabilities are available to which agents? Which are only declared? What breaks if one provider goes away? What are you one dependency away from being able to do?

Nothing in the stack answers that. Config files say what is *declared*. Observability says what *ran*. IAM says what is *permitted*. Service discovery says what *exists*. Agent frameworks say what one runtime can *call*. None of them say:

> **What can this whole system reliably do, why can it do it, and what would change that?**

<div align="center">
<img src="docs/assets/screenshot-tree.png" alt="Ambit capability graph: seven columns from Foundation to Sovereignty, with reached capabilities filled, currently-reachable ones outlined with time estimates, and unreachable ones faded" width="900">
<br><sub>Filled = effective · outlined = reachable now, with setup cost · faded = blocked by a missing prerequisite</sub>
</div>

## Capabilities compose, and Ambit derives that

The value is not knowing that eleven capabilities exist. It is that they compose, and no config file states the composition. Run against a real setup, `tt near` reports what the graph puts within reach:

```console
$ tt near

  Local Embeddings
    missing: 1
    met count: 1
    total required: 2
    met maturity: 70
    investment: Add Embeddings
```

One dependency away, and the dependency it names — Embeddings — gates four further capabilities: Vector Store, Retrieval, Local Embeddings, Offline Capable. `tt bottlenecks` ranks capabilities by exactly that.

More useful is where composition *fails*. Capabilities you have already half-built carry the reason in the graph:

```
Retrieval          configured, but Vector Store is not in place yet
Offline Capable    configured, but Local Embeddings is not in place yet
Self-Hosted Stack  configured, but Observability is not in place yet
```

Nothing declared those. They fall out of the dependency structure — a semantic-search agent with no vector store configured, an offline path with no local embedding model. That state is the most informative of the three, and it is invisible in every file you own.

## Effective capability

The object Ambit models is not the configured capability but the effective one.

*Configured* is "there is a Playwright MCP." *Effective* is "this agent can currently navigate and inspect a rendered application, under these credentials and network conditions, with this observed reliability."

```
installed  ≠  callable  ≠  working  ≠  reliable  ≠  authorized  ≠  appropriate
```

Today Ambit models the first three of those distinctions and records which capability provided the evidence. Verification and authority are the next two layers — see [ROADMAP.md](./ROADMAP.md).

Infrastructure enters the model the same way: a GPU host is not a capability, it is a resource that can *bear* one. Ambit treats machines as capability-bearing rather than as a separate inventory, which is what lets it observe that a host is technically capable of serving local embeddings while no agent has a routable path to it.

Human actions are modelled as legitimate dependencies, not as failures of automation. A path can require agent work, then approval, then physical intervention, then agent verification. The objective is not maximum autonomy — it is minimum *unnecessary* human coordination.

## What Ambit is not

| | why not |
|---|---|
| An MCP marketplace | the question is not "what should I install" |
| Agent orchestration | it does not own the runtime |
| Observability | traces are evidence *about* capability, not the model of it |
| A CMDB | a CMDB models assets; Ambit models actionability |
| IAM | permissions are one determinant of effective capability |
| A homelab dashboard | machines are resources that provide possible capabilities |
| A benchmark dashboard | evals establish whether a supposed capability deserves to be trusted |

Ambit takes what is currently scattered across configuration, topology, permissions, runtime evidence, and human knowledge, and makes **capability** the first-class object connecting them.

## The graph is queryable by your agents

The same model is exposed over MCP, so an agent can begin a task by asking what means exist for accomplishing it rather than rediscovering the environment every session. See the [MCP reference](#mcp-reference).

Longer term this is what makes capability acquisition explicit: when a task falls outside the current action space, derive what is missing, compare ways to add it, and verify that the result actually works. That is [the roadmap](./ROADMAP.md), and none of it is built — this file describes only what runs.

## Quick Start

```bash
git clone https://github.com/zz-plant/ambit.git
cd ambit
./bootstrap.sh
```

Bootstrap installs dependencies, reads your config, and prints what it found:

```
Installing...
✓ 123 capabilities
┌─ Toolchain ───────────────────────────────────────────┐
│ 123/123 capabilities, 6 domains
│ ██████████ ai-ml        5/5
│ ██████████ backend      5/5
│ ██████████ devops       5/5
│ ██████████ infra        25/25
│ ██████████ meta         82/82
│ ██████████ quality      1/1
└───────────────────────────────────────────────────────┘
```

To see what it would find without building anything, run `./bootstrap.sh --dry-run`.

### The reference model

Seeding places your setup against a curated model of agent capabilities and their prerequisites. It is authored content — everyone is measured against the same model and differs only in position on it — which is what makes it work with nothing to define first. The visualiser renders it as era columns, so progression reads left to right.

Seven eras, from Foundation up to Sovereignty:

```
1 Foundation    shell · files · code intelligence · version control
2 Model Access  hosted inference · local runtime · local tool calling ·
                extended context · model routing
3 Tool Use      MCP · browser automation · web research · secrets · data access
4 Memory        embeddings · vector store · retrieval · persistent memory ·
                context compaction
5 Autonomy      subagents · skills · parallel execution · scheduling ·
                notifications
6 Assurance     tests · review loop · evaluation · observability · CD
7 Sovereignty   local embeddings · offline capable · private data ·
                self-hosted stack
```

The local-model path is a full spine of its own — local runtime, tool calling that actually works, extended context, local embeddings, and finally running the whole loop with the network off.

Each node is matched against what your config already contains, so a run tells you three things:

- **Reached** — something in your setup provides it, and the graph records which capability proved it
- **Next** — prerequisites met, nothing detected yet. This is what `tt near` and `tt insight` surface, with a hint for how to get there
- **Blocked** — you have the tooling but a prerequisite is missing. Usually the most useful thing it says: *"Retrieval — configured, but Vector Store is not in place yet"*

```
$ tt near
Local Embeddings — 1 dependency away (70% existing maturity). Add Embeddings
```

The tree also gives `tt impact` something real to reason about: remove a provider and it can tell you which models, agents, and capabilities fall over with it.

Toggle **TECH TREE** in the visualizer to see it as a map: eras run left to right, filled circles are what you have reached, dashed outlines with a time estimate are what you can take next, and faded ones are further off.

Seeding writes the edges your config states outright too — a provider is a hard prerequisite for the models it serves, and a model for any agent pinned to it. Those are read from `opencode.json`, not guessed.

**Adding your own.** The curated tree is a starting point, not a ceiling. Define combos for capabilities specific to your work and they join the same analyses:

```json
{
  "combos": {
    "e2e-on-edge": {
      "name": "E2E on Edge",
      "domain": "quality",
      "requires": ["mcp:playwright", "provider:cloudflare"],
      "optional": ["skill:vitest"]
    }
  }
}
```

Prerequisites that don't resolve to a real capability are skipped, so a typo yields a missing combo rather than an unreachable one.

Then start the visualizer:

```bash
./bootstrap.sh web
```

Homebrew (`brew install zz-plant/tap/ambit`) installs the `tt` CLI on its own, without the visualizer.

## Two views

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/screenshot-config.png" alt="Config view: capabilities grouped into domain columns with a diagnostics sidebar" width="100%">
<br><sub><b>CONFIG</b> — your <code>opencode.json</code> as a graph, grouped by domain, with diagnostics down the side.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshot-docs.png" alt="The concept guide, explaining capability, era, and the reached/next/blocked states" width="100%">
<br><sub><b>DOCS</b> — nine terms carry all the meaning. The same definitions back <code>tt explain</code>.</sub>
</td>
</tr>
</table>

Any view is linkable: `?view=tree`, `?layout=constellation`, `?docs=open`.

## What you get

| Component | What it does |
|---|---|
| **Visualizer** | Four layout modes: ERAS (era-column tech tree with hover tooltips, prerequisite highlighting, and a type filter), CONSTELLATION (3D hex map), ORBITAL (concentric shells by type), and FLAT (2D force-directed). Inline legend, DOCS modal, one-click PNG export. |
| **Tech tree** | A curated tree of 33 agent capabilities across 7 eras, matched against your config — what you have reached, what is next, and what is blocked. |
| **CLI** | 14 commands for querying the graph from a terminal — see [CLI reference](#cli-reference). |
| **MCP server** | 17 tools your agent can call inside an OpenCode session — see [MCP reference](#mcp-reference). |
| **Tracking plugin** | Records configuration changes: what you build, connect, keep, and remove. Not invocation counts. Ships in `plugins/`; copy it to `~/.config/opencode/plugins/` and add it to `plugin` in `opencode.json`. |
| **Consultant agent** | A subagent that knows how to query the graph and interpret what comes back. |

## Execution, not just advice

Most of the tools report. `tt prune <id>` acts: it removes the entry from `opencode.json`, writes a `.bak` alongside it first, and re-seeds the graph. The removal is then recorded as a deliberate decision rather than an absence, which is what keeps the graph's signal from degrading as it grows.

```bash
tt prune mcp:seq
```

## Learning it

Three places explain the vocabulary, all reading the same definitions from `src/shared/concepts.json`:

- **`tt explain`** — every term in the terminal; `tt explain maturity` for one
- **`tt --help`** — commands grouped by the question each answers, starting with the two worth running first
- **DOCS in the visualizer** — the same definitions, plus how to read the map

If you run one command, run `tt near`. It answers "what is one step away", which is the question the rest of the tool supports.

## CLI reference

Run `tt` with no arguments and it shows where you are, what is one step away, and what to do next:

```console
$ tt

Where you are
Toolchain: 156/168
  ai-ml        22/26
  backend      6/8
  devops       7/8
  infra        26/28
  meta         88/89
  quality      5/6
  security     1/2

What is one step away

  Local Embeddings
    missing: 1
    met maturity: 70
    investment: Add Embeddings
```

`tt impact` answers what falls over if something goes away — here, a local provider taking six models and two agents with it:

```console
$ tt impact provider:local-code

  capability: local-code
  decayed:
    Gemma 4 31B (VISION QUALITY tier ...)   becomes unavailable: true
    Qwen3-Next 80B-A3B 2-bit (QUALITY ...)  becomes unavailable: true
    ...
```

Every command prints for a person by default and takes `--json` for scripts.

```
Explore     stats  export  context  health  profile
Maintain    decay  prune  prune <id>  diff  trend
Plan        near  combos  fork  insight
Analyze     bottlenecks  impact <id>  budget <setup> <tokens>
```

| Command | What it answers |
|---|---|
| `tt stats` | Where am I? Domain breakdown and global maturity |
| `tt context` | What should the agent know? Session context block |
| `tt health` | How healthy? Composite domain scores |
| `tt profile` | How has the graph evolved? Density, removals, combos over time |
| `tt decay` | What's rusting? Capabilities losing proficiency |
| `tt diff` | What changed? Session-over-session delta |
| `tt trend <days>` | What's coming? Projected health in N days |
| `tt near` | What's almost ready? Combos one or two dependencies away |
| `tt combos` | What's ready? Auto-detected prerequisite clusters |
| `tt fork` | Which path? Combos compared by efficiency, regret, cascade |
| `tt insight` | What should I do right now? Top actionable items |
| `tt bottlenecks` | What's high-leverage? Capabilities that unlock the most combos |
| `tt impact <id>` | What if this decays? Downstream damage |
| `tt budget <s> <t>` | What's optimal given a setup-time and token budget? |
| `tt prune [id]` | What should I remove? With an ID, performs the removal |
| `tt export` | Dumps capabilities and connections as JSON — paste it on the [demo site](https://zz-plant.github.io/ambit/) to view a graph without installing anything |

## MCP reference

Seventeen tools, available inside any OpenCode session once the MCP server is registered. They overlap with the CLI but are not identical: `tt_recs` and `tt_cap` are MCP-only, and `tt_export` is CLI-only.

`tt_stats` · `tt_recs` · `tt_cap` · `tt_context` · `tt_decay` · `tt_combos` · `tt_diff` · `tt_health` · `tt_bottlenecks` · `tt_impact` · `tt_budget` · `tt_trend` · `tt_near` · `tt_insight` · `tt_profile` · `tt_prune` · `tt_fork`

```
> What's rusting?
→ tt_decay: capabilities ranked by days since their config last changed,
  with the combos that depend on each one.

> What's the highest-leverage thing to invest in?
→ tt_bottlenecks: capabilities ordered by how many combos they unlock.

> If I let this decay, what breaks?
→ tt_impact <id>: downstream combos at risk, separated into hard
  prerequisites that would fail and soft ones that would degrade.
```

## Architecture

```
opencode.json          ←─ your config
        │
        ▼
   engine.ts           ←─ discovers capabilities, builds the graph
        │
        ▼
toolchain-viz.db       ←─ capabilities · dependencies · session_learning
        │
        ├──► server.ts              ←─ visualizer API (Bun.serve, port 3001)
        │       ├── /api/config             config as a graph model
        │       ├── /api/repos/scan         per-repo drift vs. global config
        │       ├── /api/infrastructure/scan  device and service topology
        │       ├── /api/snapshots          saved graph states
        │       └── /api/trending           newly published MCP servers
        │
        │       └── /api/tech-tree          the graph, for the visualizer
        │
        ├──► src/mcp/server.ts      ←─ 17 MCP tools, JSON-RPC over stdio
        │
        ├──► plugins/               ←─ passive config-event tracking
        │       └── copy to ~/.config/opencode/plugins/
        │
        └──► consultant agent
```

The server binds `127.0.0.1` and rejects non-local origins. It can toggle an MCP on or off and edit an existing agent's description or model, but it cannot create config entries — an MCP entry carries a command OpenCode executes, so new servers are added by hand. The visualizer's "add server" screen generates a snippet for you to paste. See [AGENTS.md](./AGENTS.md) for the full reasoning.

## Security

The server reads and writes `opencode.json`, so two invariants hold and are documented in [AGENTS.md](./AGENTS.md):

- **Loopback only.** It binds `127.0.0.1` and rejects non-local origins **before routing** — CORS headers alone are not enough, because a simple request skips preflight and reaches the handler regardless.
- **It cannot create config entries.** An MCP entry carries a command OpenCode executes, so creating one over HTTP would be remote code execution. The API can toggle an MCP and edit an existing agent's description or model; adding a server generates a snippet you paste yourself.

Nothing is sent anywhere. There is no telemetry, and the only outbound requests are the ones you can see in `/api/trending`.

## How it works

The engine reads `opencode.json` and discovers every capability. Each gets a maturity score (0–1), cost metadata, and a domain classification that determines its column in the ERAS view. Dependencies form a directed graph: hard prerequisites must be met, soft ones are optional, synergies discount costs.

**Domains are inferred from names.** An MCP called `cloudflare-bindings` classifies as `backend`, `tailscale` as `infra`. The keyword table in `src/client/utils/configImporter.ts` is tuned to a Cloudflare/Tailscale/Ollama-shaped toolchain — on a different stack, more items will land in the `meta` fallback, and that table is the first place to edit.

**Using other configs.** Not on OpenCode? Describe your config's shape with `CONFIG_MAPPING`:

```bash
CONFIG_MAPPING='{"config_keys":{"tools":{"type":"tool","domain":"devops","desc_field":"description"}}}' \
  OPENCODE_CONFIG=my-project.json \
  ./bootstrap.sh
```

This maps the `tools` key of `my-project.json` into the graph. The default mapping covers `mcp`, `agent`, `provider`, `command`, and `skills`.

**The compounding loop.** Seeding gives you the structure the config declares. Depth beyond that comes from use: each removal recorded as a decision rather than a gap, each combo you define revealing which capabilities were load-bearing all along. The graph is meant to get better structured rather than merely bigger — but the part that arrives on day one is what the config can prove.

## Requirements

- **Bun** for the visualizer and API server
- **Node 22+** for the engine and CLI, which use `node:sqlite` behind `--experimental-sqlite`

## Where this is going

Ambit currently models what exists. The work ahead is modelling what can be **acquired**, under one principle:

> A capability is not something configured. A capability is an action the system has evidence it can perform.

That implies separating capabilities from the providers that satisfy them, putting the human and the hardware in the graph as actors with their own authorities, giving each capability an acquisition recipe and an executable verification, and closing the loop so repeated friction turns into infrastructure rather than repeated effort.

See [ROADMAP.md](./ROADMAP.md). Nothing there is implemented; if it were, it would be documented above.

## Contributing

Fork → branch → commit → PR. See [AGENTS.md](./AGENTS.md) for codebase conventions, the typechecking setup, and the security invariants the server must preserve.

## License

MIT — see [LICENSE](./LICENSE).
