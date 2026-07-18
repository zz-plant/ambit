# Capability Graph

<p align="center">
  <img src="docs/assets/capability-graph-demo.gif" alt="capability graph demo" width="720">
  <br>
  <a href="https://zz-plant.github.io/capability-graph/"><strong>Live Demo</strong></a>
</p>

A capability graph for your [OpenCode](https://opencode.ai) toolchain. Discovers every skill, agent, MCP server, and model from your config. Tracks what you've built, connected, maintained, and removed. Shows maturity for each capability and the cheapest path to unlock new ones.

## Why a capability graph

```
  FLAT MEMORY                         CAPABILITY GRAPH
┌──────────────────┐            ┌──────────────────────────┐
│  "I know X"      │            │  skill:playwright         │
│  "I know Y"      │            │  maturity: 0.72 → 0.66    │
│  "I know Z"      │            │  last used: 23 days ago   │
│                  │            │  unlocks: 4 combos         │
│  prose file      │            │  decay rate: -0.02/day    │
│  ctrl-f to find  │            │                            │
│  time has no     │            │  pathfind · bottleneck     │
│  effect          │            │  impact · budget · trend   │
└──────────────────┘            └──────────────────────────┘

     claim               →         evidence
     static              →         dynamic
     search              →         compute
     self-report         →         ground truth
```

A flat list of claims has no edges, no time, no computation. You can search it. That's all.

A capability graph has domain-classified nodes, typed dependencies, maturity scores with decay, and timestamps on every event. Seventeen tools compute answers from the structure: pathfinding, impact analysis, bottleneck detection, budget optimization, trend projection, prune recommendations, and fork comparison.

## Quick Start

```bash
brew install zz-plant/tap/capability-graph && tt
```

Or with Node:

```bash
npx @zz-plant/capability-graph
```

Or clone and run:

```bash
git clone https://github.com/zz-plant/capability-graph.git
cd capability-graph
./bootstrap.sh
```

That's it. No decisions. No config files. The bootstrap scans your system and tells you what it found:

```
┌─ Discovery ──────────────────────────────────────────────┐
│ ✓ opencode.json found                                    │
│ ✓ Ollama running — 5 models available                    │
│ ✓ Skills: 105 across 4 directories                       │
│ ✓ MCP servers: 28                                        │
│ ✓ Agents: 25                                             │
└──────────────────────────────────────────────────────────┘
```

Then it builds the graph and shows your toolchain summary:

```
┌─ Your toolchain ─────────────────────────────────────────┐
│ 118/120 capabilities across 8 domains                    │
│ ██████████ ai-ml        11/11                            │
│ █████████░ devops       11/12                            │
│ ██████░░░░ security      2/2                             │
│ 7 combo capabilities                                     │
└──────────────────────────────────────────────────────────┘
```

Curious what it would find without committing? `./bootstrap.sh --dry-run` shows the discovery phase only, no graph built.

### What you get

<p align="center">
  <img src="docs/assets/constellation-view.png" alt="hexagonal constellation view" width="720">
</p>

| Component | What it does |
|---|---|
| **Visualizer** | Two layout modes: ERAS (era-column tech tree with hover tooltips, prereq highlighting, and tree filter) and CONSTELLATION (3D hex map). Inline legend, DOCS modal, and one-click PNG export. |
| **CLI Engine** | `tt stats`, `tt recs`, `tt context`, `tt decay`, `tt combos`, `tt health`, `tt prune`, `tt fork`, `tt near`, `tt insight`, `tt profile`, `tt export` — query your toolchain from the terminal. |
| **MCP Server** | 17 tools available inside OpenCode sessions. Your agent can query its own capabilities. |
| **Tracking Plugin** | Tracks configuration changes — what you build, connect, keep, and remove. Not invocation frequency. |
| **Consultant Agent** | A subagent that knows how to query the graph and interpret the results. |
| **Teach Skill** | Load with `skill(name="tech-tree")` to give any agent toolchain awareness. |

### Once bootstrapped, inside any OpenCode session

```
> What's my toolchain look like?
→ tt_stats: 118 capabilities, 94% maturity. 8 domains.
  Security is thin (2). Local Model Inference at 90%.

> What's rusting?
→ tt_decay: Playwright unused for 23 days (72% → 66%).
  4 combos depend on it.

> What's ready to unlock?
→ tt_combos: Deploy Pipeline — all prerequisites met at 68% avg.
  2 hard deps (Cloudflare, Wrangler) already active.

> If I let Cloudflare decay, what breaks?
→ tt_impact skill:cloudflare: 5 downstream combos at risk.
  3 critical (hard prerequisite would fail).

> What's the cheapest path to Agent Deployment?
→ tt_path combo:agent-deployment:
  Cloudflare → Wrangler → Agents SDK → Agent Deployment
  60s setup, 600 tokens. 1 cascade unlock.

> Where should I invest effort today?
→ tt_bottlenecks: Cloudflare unlocks 8 combos — highest leverage.
  Wrangler unlocks 6. Git Mastery unlocks 4.

> What should I prune?
→ tt prune mcp:seq — removes the entry from opencode.json, creates a backup,
  and re-seeds the graph. The action is carried out, not just recommended.

> What's almost ready?
→ tt_near: Deploy Pipeline — 1 dependency away (Agents SDK).
  Cloudflare, Wrangler, Git all at 80%+ maturity.

> What should I do right now?
→ tt_insight: Top 3 actions — Playwright decaying (affects 4 combos),
  Deploy Pipeline near-miss (add one dependency), Cloudflare bottleneck (unlocks 8).
```

## Execution Layer

Recommendations are actionable. `tt prune mcp:seq` removes the entry from opencode.json, creates a `.bak` backup, and re-seeds the graph. Every removal and unlock is tracked as a deliberate decision, improving the graph's signal-to-noise ratio over time.

## Tools Reference

| Tool | What it answers |
|---|---|
| `tt_stats` | Where am I? Domain breakdown, global maturity, learned patterns |
| `tt_recs` | What next? Unlock recommendations ranked by efficiency |
| `tt_path <id>` | How do I get there? Optimal unlock route with costs |
| `tt_context` | What should the agent know? Session context block |
| `tt_cap <query>` | What's in this domain? Zoom into any area |
| `tt_decay` | What's rusting? Unused capabilities losing proficiency |
| `tt_combos` | What's ready? Auto-detected prerequisite clusters |
| `tt_diff` | What changed? Session-over-session delta |
| `tt_health` | How healthy? Composite domain scores |
| `tt_bottlenecks` | What's high-leverage? Skills that unlock the most combos |
| `tt_impact <id>` | What if this decays? Downstream damage analysis |
| `tt_budget <s> <t>` | What's optimal? Best unlocks given constraints |
| `tt_trend <days>` | What's coming? Projected health in N days |
| `tt_near` | What's almost ready? Combos 1-2 dependencies away at high maturity |
| `tt_insight` | What should I do right now? Top actionable items |
| `tt_profile` | How has my graph evolved? Density, removals, combos over time |
| `tt_prune <id>` | What should I remove? Run with an ID to execute the removal |
| `tt_fork` | Which path? Compare combos by efficiency, regret, cascade |
| `tt_export` | Share your graph. Dumps capabilities and connections as JSON — paste on the Pages site to share. |

## Architecture

```
opencode.json          ←─ your config
        │
        ▼
   engine.ts           ←─ discovers capabilities, builds graph
        │
        ▼
toolchain-viz.db       ←─ capabilities · dependencies · synergies · session_learning
        │
        ├──► server.ts              ←─ web visualizer (hex map + Civ layout)
        │       └── /api/tech-tree       serves graph to frontend
        │
        ├──► mcp/server.ts          ←─ 17 MCP tools for OpenCode queries
        │
        ├──► plugins/               ←─ passive event tracking (zero-token instrumentation)
        │       └── writes session_learning · timestamps · outcome scores
        │
        └──► consultant agent + tech-tree skill
                └── knows how to query and interpret the graph
```

## Visualizer Features

**ERAS layout.** Era-column tech tree with domain bands, dependency connection lines, maturity rings, hover tooltips showing downstream capabilities, and prerequisite chain highlighting when a node is selected.

**Tree filter.** Filter nodes by type — servers, agents, skills, combos — to focus on what matters.

**Export.** The camera button exports the current graph as a PNG. Share it in a PR, a Notion doc, or a tweet.

**Import.** Paste JSON from `tt export` on the [demo site](https://zz-plant.github.io/capability-graph/) to see your own graph without installing anything.

## How It Works

The engine reads your opencode.json and discovers every capability. Each one gets a maturity score (0–1), cost metadata (setup time, token overhead), and domain classification. Dependencies form a directed graph — hard prerequisites must be met, soft ones are optional, synergies discount costs.

**Using other configs.** Don't use OpenCode? Set `CONFIG_MAPPING` to describe your config structure:

```bash
CONFIG_MAPPING='{"config_keys":{"tools":{"type":"tool","domain":"devops","desc_field":"description"},"plugins":{"type":"plugin","domain":"backend","desc_field":"version"}}}' \
  OPENCODE_CONFIG=my-project.json \
  ./bootstrap.sh
```

This maps `my-project.json`'s `tools` and `plugins` keys into the capability graph. Each becomes a typed node with the specified domain and description. The default mapping matches opencode.json's `mcp`, `agent`, `provider`, `command`, and `skills` keys.

The tracking plugin hooks OpenCode's configuration events and records every capability addition, removal, and connection. The decay system lowers maturity scores for unmaintained capabilities. The auto-combo system detects when prerequisite clusters reach unlock thresholds.

**The compounding loop.** The graph doesn't just grow — it improves. Each new capability connects to existing ones, increasing density (connections per node). Each removal cleans up unused entries, improving signal-to-noise. Each combo unlock reveals downstream combos that were previously invisible. After 3 months, the graph isn't larger — it's better structured, because every entry reflects a deliberate decision.

**Execution.** Recommendations can be carried out directly. `tt prune mcp:seq` removes the entry from opencode.json, creates a `.bak` backup, and re-seeds the graph. Every action is tracked as a deliberate decision, not an oversight to be corrected.

## Contributing

Fork → branch → commit → PR. See [AGENTS.md](./AGENTS.md) for codebase conventions.

## License

MIT — see [LICENSE](./LICENSE).
