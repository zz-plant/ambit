# Capability Graph

<p align="center">
  <img src="docs/assets/capability-graph-demo.gif" alt="capability graph demo" width="720">
  <br>
  <a href="https://zz-plant.github.io/capability-graph/"><strong>Live Demo</strong></a>
</p>

You added an MCP server eight months ago. Is it still doing anything? Which of your agents point at a model you've since stopped using? What did you connect last quarter and never touch again?

`opencode.json` can't answer that. It's a flat file with no history and no edges — every entry looks equally load-bearing whether you use it hourly or added it once and forgot.

Capability Graph reads that config and builds a structure that can answer it: every capability as a typed node with a domain, a maturity score that decays when things go unmaintained, and a timestamp on every change. Then it gives you a terminal, an agent, and a visual to ask questions of.

## Quick Start

```bash
git clone https://github.com/zz-plant/capability-graph.git
cd capability-graph
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

### What seeding builds

Seeding reads your config and writes both nodes and the edges the config states outright:

```
provider:acme  ──requires──▶  model:acme/fast-1  ──requires──▶  agent:writer
```

A provider is a hard prerequisite for the models it serves; a model is a hard prerequisite for any agent pinned to it. Those relationships are declared in `opencode.json`, so they are read rather than guessed. That is what makes `tt bottlenecks`, `tt impact`, and `tt health` return something on a first run — for example, a local provider showing as a bottleneck because six models and two agents fall over if it goes away.

**Combos are not inferred.** A combo says "these capabilities together unlock something," which is a judgement about your work, not a fact in a config file — so the engine will not invent one. Define them and the unlock analyses (`tt combos`, `tt near`, `tt fork`) light up; leave them undefined and those commands return empty, which is accurate rather than broken:

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

Add that block to `opencode.json` (or to `CONFIG_MAPPING`) and re-run `./bootstrap.sh`. Prerequisites that don't resolve to a real capability are skipped, so a typo yields a missing combo rather than a permanently unreachable one.

Then start the visualizer:

```bash
./bootstrap.sh web
```

Homebrew (`brew install zz-plant/tap/capability-graph`) installs the `tt` CLI on its own, without the visualizer.

## What you get

| Component | What it does |
|---|---|
| **Visualizer** | Four layout modes: ERAS (era-column tech tree with hover tooltips, prerequisite highlighting, and a type filter), CONSTELLATION (3D hex map), ORBITAL (concentric shells by type), and FLAT (2D force-directed). Inline legend, DOCS modal, one-click PNG export. |
| **CLI** | 14 commands for querying the graph from a terminal — see [CLI reference](#cli-reference). |
| **MCP server** | 17 tools your agent can call inside an OpenCode session — see [MCP reference](#mcp-reference). |
| **Tracking plugin** | Records configuration changes: what you build, connect, keep, and remove. Not invocation counts. Installs to `~/.config/opencode/plugins/`. |
| **Consultant agent** | A subagent that knows how to query the graph and interpret what comes back. |

## Execution, not just advice

Most of the tools report. `tt prune <id>` acts: it removes the entry from `opencode.json`, writes a `.bak` alongside it first, and re-seeds the graph. The removal is then recorded as a deliberate decision rather than an absence, which is what keeps the graph's signal from degrading as it grows.

```bash
tt prune mcp:seq
```

## CLI reference

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
| `tt export` | Dumps capabilities and connections as JSON — paste it on the [demo site](https://zz-plant.github.io/capability-graph/) to view a graph without installing anything |

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
        ├──► src/mcp/server.ts      ←─ 17 MCP tools, JSON-RPC over stdio
        │
        ├──► plugin                 ←─ passive config-event tracking
        │       └── installs to ~/.config/opencode/plugins/
        │
        └──► consultant agent
```

The server binds `127.0.0.1` and rejects non-local origins. It can toggle an MCP on or off and edit an existing agent's description or model, but it cannot create config entries — an MCP entry carries a command OpenCode executes, so new servers are added by hand. The visualizer's "add server" screen generates a snippet for you to paste. See [AGENTS.md](./AGENTS.md) for the full reasoning.

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

## Contributing

Fork → branch → commit → PR. See [AGENTS.md](./AGENTS.md) for codebase conventions, the typechecking setup, and the security invariants the server must preserve.

## License

MIT — see [LICENSE](./LICENSE).
