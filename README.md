<div align="center">

# Ambit

**Where your system is wasting scarce resources — and which capability investment has the highest return.**

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

Ambit treats that as a graph problem. It models capabilities, dependencies, costs, and composition so that both humans and agents can reason over the environment they share.

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
| **Verified** | the capability has actually succeeded | ✅ a passing check; a failing one reads as `degraded`/`broken` and stops being available |
| **Authorized** | the system has permission to use it | ✅ per action, declared, and enforced by `canExecute` on apply |
| **Delegated** | a human or another agent supplies a missing step | ✅ people are nodes; a plan names the person a step needs |
| **Persistent** | it can operate beyond the current interaction | roadmap |

Capability *change* is now recorded over time — see [the ledger](#the-ledger) — which is the accounting half of that table rather than a seventh state.

Six of seven, with the caveats stated in the table rather than hidden: checks exist for eight capabilities — and, since §3, for individual contract actions, so `ambit verify act:version-control/commit_changes` proves the action rather than the capability that confers it — a check that last failed now **gates** the capability out of everything that decides availability, and authority is enforced where it matters most: nothing applies without a signed approval artifact and a per-step `canExecute` pass. [The roadmap](./ROADMAP.md) is the rest.

```console
$ ambit verify            # run the declared checks, record what happened
  checked: 8 · verified: 8 · failed: 0
  Local Runtime   verified   23ms   reliability 4/4

$ ambit authority         # reached is not the same as permitted
  autonomous      File Editing · Parallel Execution
  needs approval  Shell Execution · Version Control · Continuous Delivery
  forbidden       Secret Management

$ ambit authority version-control    # and permission is finer than a capability
  exercisable     read_repository · commit_changes
  needs approval  push_branch · merge_to_default

$ ambit goal offline-capable
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

Ten capabilities declare a `contract.can` — the actions they confer — and each becomes a node with its own authority. That is what lets the model say *may read the repository, may not merge to its default branch*, which the coarse node cannot. `ambit authority <cap>` reports them; the visualizer leaves them out of the era columns on purpose, because legibility is the point of that view.

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
<img src="docs/assets/screenshot-config.png" alt="Config view: capabilities grouped into domain columns with a capability list sidebar" width="100%">
<br><sub><b>CONFIG</b> — your configuration as a graph.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/assets/screenshot-docs.png" alt="The concept guide explaining capability, era, and the reached/next/blocked states" width="100%">
<br><sub><b>DOCS</b> — nine terms carry all the meaning; the same definitions back <code>ambit help</code>.</sub>
</td>
</tr>
</table>

Any view is linkable: `?view=tree`, `?docs=open`.

The view updates itself when the graph changes underneath it. `/api/events` streams [AG-UI](https://docs.ag-ui.com) `StateSnapshot` and `StateDelta` events over SSE, and carries the work stream too — telemetry observations and proposal approvals surface as they happen, so the visualizer narrates the loop, not only the graph. The transport an agent would use to propose a change and a human to approve it is a standard one rather than invented.

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

Bootstrap links the `ambit` command into `~/.local/bin` when that directory is on your PATH. If it isn't, bootstrap prints the one-line `ln -s` to run instead; until then the CLI works in place as `./cli.js`.

Homebrew installs the CLI on its own, as `ambit`. There is no clone, so build the graph with `ambit seed`:

```bash
brew install zz-plant/tap/ambit
ambit seed
```

The graph is a local SQLite file — `~/.local/share/ambit/graph.db` for an installed copy, or the checkout itself when you cloned. `ambit where` prints the path, and `TOOLCHAIN_DB` overrides it. The engine, the MCP server and the visualizer all read the same one. Nothing is uploaded.

**Requires** Bun for the visualizer and server, Node 22+ for the engine and CLI. Bootstrap checks for both before doing anything. The visualizer needs a checkout; an installed copy carries the engine, CLI and MCP server.

Without an agent config, bootstrap still seeds the curated capability model and says so — you get the graph with nothing of yours in it yet, rather than an error. Point it at your own config with `OPENCODE_CONFIG`, or map a different format with `CONFIG_MAPPING` (see [Other configurations](#other-configurations)).

## Ask better questions about your stack

Run `ambit` with no arguments and it shows the surface. The whole CLI is a handful of verbs; everything else is a view inside them:

```
Operate    status · graph [surface|combos|affordances] · history [since <when>]
Decide     goal <cap-or-sentence> [--paths|--simulate|--prefs] · attention [days]
           notify <topic> · notify-approvals <topic> · work [limit] · usage [days]
           economics · opportunities [--by=…] [--budget=N] · opportunity <id>
           roi [proposal-id] · catalog <cap> · audit [run|prop|human|days]
           incidents · incident resolve <svc> <outcome> · portfolio [--budget=N]
           impact <id> · verify [cap] [--history]
           authority [cap] [scope <target>] · can <cap> [--target X] [--spend N]
           · propose <cap> [n] · proposals · proposal <id>
Govern     approve <id> <who> · apply <id> · rollback <id>
Record     record <cap> [class] [note] · federation export|import
           · seed · where · help [term]
```

| | asks |
|---|---|
| `ambit status` | How are we doing — reached, verified, failing, degraded, SPOFs, recurring deficits, pending approvals, all in one report |
| `ambit graph` | The whole graph as JSON; `graph surface` is the runtime-owned vocabulary a runtime would publish, `graph combos` the near-reachable ones, `graph affordances` the structural domains |
| `ambit impact <id>` | What becomes unavailable if this disappears — and what survives on another provider? |
| `ambit goal <sentence>` | Route a free-form goal — "deploy without me" — to the capabilities whose words cover it, each with its plan delta |
| `ambit goal <cap> --paths` | The alternative ways to reach a capability, compared by setup time, risk and lock-in |
| `ambit goal --prefs [who]` | Who prefers what, and where a plan's default choice would fight them |
| `ambit authority <cap>` | Which concrete actions does this confer, and which of them may run unattended? |
| `ambit authority scope <target>` | What a scope actually covers and what it does not — a grant scoped elsewhere is named as excluded |
| `ambit history since <when>` | What became reachable since a past date — and what emerged rather than being added? |
| `ambit attention [days]` | How much of the work still runs through the human, and which interventions are likely reducible |
| `ambit notify <topic>` | Push the attention digest to ntfy — nothing is sent without a topic |
| `ambit opportunities` | Ranked structural changes worth making — observed middleware burden priced by attention value, acquisition cost, expected effect, payback, confidence. `--by=attention|cash|roi|reliability|frontier`; `--budget=N` allocates the best combination within $N |
| `ambit catalog <cap>` | The ways to acquire a capability — build, buy, subscribe, delegate, hire — compared by setup, one-time and recurring cost, privacy, verification and rollback |
| `ambit roi [proposal]` | One proposal's before/after verdict, or — with no argument — the cumulative headline: hours and dollars saved per year and forecast accuracy |
| `ambit audit <run\|prop\|human>` | The trail: who approved what, what ran, against what target, under which grant, and whether it held |
| `ambit incidents` | Probe the infrastructure manifest; open an incident run for every offline service with the authority decision for its recovery. `incident resolve <svc> <outcome>` closes it with MTTR |
| `ambit portfolio [--budget=N]` | Across imported environments: the same human burden recurring in several places, person-specific SPOFs, and where capex would produce the most |
| `ambit federation export\|import` | The signed summary a portfolio layer reads — aggregates only, no credentials, no raw sessions |

Real output — one dependency away, and the dependency it names gates four further capabilities:

```console
$ ambit goal local-embeddings

  Local Embeddings
    missing: 1
    steps: 2 · estimated setup: 25m
    order: Embeddings → Local Embeddings
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
$ ambit goal continuous-delivery
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

Every intervention is recorded. `ambit attention` counts the human acts in a window — approvals, applications, permission blocks, failed checks — and names the reducible ones: an approval given three times for the same capability is infrastructure shaped like a person, and the fix is a grant, not another reminder.

```console
$ ambit attention 30
  interventions: 12
  3× approval: deploy to production
  2× permission block: restart svc:ollama
  2× failed: local embeddings
  reducible: deploy to production — grant bounded authority rather than approving each time
```

`ambit notify <topic>` pushes that digest to [ntfy](https://ntfy.sh) — and only when a topic is given. Nothing leaves the machine otherwise; the push is a single HTTP POST of the digest text, no graph data.

### Work telemetry

The same ledger that `attention` reads is written by observation, not by hand. The visualizer API exposes a loopback `POST /api/telemetry` that speaks the ledger's own verbs — `run`, `end`, `event`, `use`, `intervention`, `resource`, `outcome` — so a runtime adapter records actual work without knowing the schema:

```console
$ echo '{"run":{"goal":"recover production service","runType":"incident"}}' \
    | bun run scripts/adapters/telemetry.ts
```

`scripts/adapters/telemetry.ts` is the ingestion client (stdin → one JSON object per line → `POST /api/telemetry`). A plugin bridge ships at `plugins/tech-tree-telemetry.js`: copy it to `~/.config/opencode/plugins/` and every tool execution in an OpenCode session lands in the ledger as a work event, and every permission prompt as an `authority` intervention. The endpoint is loopback-only and origin-allowlisted like every other route, and a telemetry payload is structured data — never a command.

`ambit work` reads the ledger back: each run with its elapsed time, events, capabilities exercised, interventions, resources, and outcome. `ambit usage <days>` aggregates where effort went per capability — the raw material the opportunity engine ranks.

### Previewing a change

`ambit goal <cap> --simulate` computes the frontier as it would be, without touching anything. What makes it worth reading is the second line:

```console
$ ambit goal vector-store --simulate
  frontier: 21 → 23
  acquired:  Vector Store
  unblocked: Retrieval          # already provided, waiting on the prerequisite
```

`ambit propose` turns that into a reviewable draft — ordered steps, the alternative chosen, and what it costs beyond time:

```console
$ ambit propose retrieval
  Retrieval · 25m
    Embeddings     nomic-embed via local runtime      none / local
    Vector Store   pgvector on existing Postgres      none / local
  simulated frontier: 21 → 24
  executable: false
```

Choosing the hosted alternatives (`ambit propose retrieval 1`) takes it to 13 minutes, at a per-token bill and a data boundary.

Where an acquisition genuinely *is* a config change, the step carries a declarative patch and Ambit derives its undo — removing what it adds, or restoring what it overwrites. Anything needing an installer gets no inverse, and a proposal is `applicable` only when every step has one.

```console
$ ambit approve prop-msrrv9c2 kanav
  proposal: prop-msrrv9c2 · goal: Web Research
  approved by: Kanav · applicable: true
  note: Approved. Every step has an inverse. The approval artifact is signed and expires in 24 hours.
```

Approval mints a **signed artifact** — proposal hash, actor, budget, scope, expiry, timestamp, HMAC-signed with a machine-local key (`AMBIT_APPROVAL_KEY`, default `~/.config/opencode/ambit-approval.key`). It is also minted by the browser broker, `POST /api/proposals/:id/approve` (loopback, origin-allowlisted), which approves and signs but never applies. The visualizer's AG-UI stream surfaces the approval as a toast telling you exactly which terminal commands to run.

```console
$ ambit apply prop-msrsqzij
  applied: true · keys: mcp.fetch
  backup: opencode.json.ambit-prop-msrsqzij.bak

$ ambit rollback prop-msrsqzij
  removed: mcp.fetch          # git survives — the inverse reverses only this
```

**Apply is the only thing that can spend an approval.** It refuses a proposal no person approved, any step without an inverse, and any step authority denies — every step is gated through `canExecute` (ALLOW / CONFIRM / DENY + governing grant + remaining budget), and the signed artifact must be present, unexpired, and matching the proposal as stored. **Apply only edits configuration, and cannot do otherwise.** A step carries a declarative patch or nothing; there is no field that holds a command. It backs up first, and if verification fails afterwards it rolls back automatically and says the change was reversed. A successful apply **re-seeds**, so the graph reflects the change immediately rather than on the next manual seed.

Approval and apply stay off the MCP surface — an agent may draft, preview, and ask, but never approve or apply. Proposing more capability and granting more authority are different acts, and the artifact is what keeps them apart.

### The ledger

`capabilities` holds the present state and is overwritten on every seed, so on its own the graph can only say what the system can do *now*. Every seed also records the whole frontier, which lets it answer what was reachable at a past date:

```console
$ ambit history since
  frontier then: 13
  frontier now:  19
  gained:    Embeddings · Local Embeddings · nomic-embed-text
  emergent:  Model Routing · Offline Capable · Subagents
```

One embedding model was added. Six capabilities moved. The three under `emergent` became reachable although **nothing providing them was added** — their prerequisites were satisfied by something else entirely. Offline Capable was already provided by an agent that did not change.

That is the entry a per-component changelog structurally cannot produce, because no single change explains it. Accumulated capacity to act is a graph property, and this is where it shows up.

A fourth class, **vocabulary**, exists to keep the first three honest. When Ambit starts modelling a part of your system it did not model before — a new action on a contract, or a capability added to the curated tree that your existing tools already provide — the node is new and nothing about the machine changed. Those are described and not counted, so `frontier_now` stays comparable with `frontier_then`:

```console
$ ambit history since
  frontier then: 21
  frontier now:  21
  vocabulary: 12   act:shell-execution/run_command · act:file-editing/write_file · …
```

Without it, upgrading Ambit would read as a dozen capabilities acquired on a machine where nothing happened — which is exactly what this table exists not to do.

Every command prints for a person by default and takes `--json` for scripts.

## The economic loop

The graph half answers *what can this system do*. The loop that pays for it answers *where is the scarce resource going, and which durable fix is worth the next dollar or hour*:

```
real work happens → the ledger observes → attention prices the human burden
→ opportunities ranks the fixes → propose carries the observed case
→ approval mints a signed artifact → apply enforces and verifies
→ roi measures before/after and writes the observation back
```

<div align="center">
<img src="docs/assets/capability-graph-demo.gif" alt="The loop in motion: the capability tree at rest, a new capability becoming reachable, an approval arriving as a negotiation toast, and the graph settling with the change in place" width="900">
<br><sub>The loop in motion — the tree at rest, a capability becoming reachable, an approval toast arriving, the graph settling.</sub>
</div>

- `ambit attention` prices the human half of the ledger and, critically, **classifies agency**: clerical, exception, physical and authority-as-repeated-gate are reducible — *the human is the duct* — while judgment and knowledge are keepers, never proposed for removal however often they recur.
- `ambit economics` is the declared model: attention value per hour, purchase and recurring costs, goal values. Dollars declare, cents store. An undeclared actor's attention defaults to $250/hr and is reported as such.
- `ambit opportunities` ranks the durable fixes — observed middleware burden priced by attention value, acquisition cost, expected effect, payback, confidence (high = observed five-plus times, low = deficits only). Rank by `--by=attention|cash|roi|reliability|frontier`, or allocate a budget: `--budget=N` returns the best combination of investments within $N. Each opportunity carries its acquisition options from the catalog, so it is a purchase decision, not a report.
- `ambit roi` closes the loop. With a proposal id it measures before/after on the affected capability — interventions, human hours, attention dollars, verification failures — and returns a verdict (performing near forecast, above, below, too early). With no argument it is the cumulative headline: hours and dollars saved per year and forecast accuracy, written back so the next prediction has evidence to learn from.
- `ambit incidents` is the managed-ops vertical's first turn: probe the infrastructure manifest, open an incident run for every offline service, record detection, resolve the recovery against authority, and close it with MTTR from the ledger's own timestamps.
- `ambit audit` is the governance trail: a run end to end, a proposal's steps/approval/enforcement/result, or one person's approvals and interventions.
- `ambit portfolio` reads `federation` imports across environments: the same human burden recurring in several places, person-specific SPOFs, and where capex would produce the most. A portfolio layer reads signed receipts; it never merges graphs, and the receipts carry aggregates only — no credentials, no raw sessions.

The loop is only as valuable as the telemetry that feeds it. With no runs recorded, `opportunities` correctly says "nothing observed." Its real test is the first month of real work flowing through the ledger, then comparing the first prediction to the first `roi`.

## Agents can query it too

Ambit ships an MCP server exposing the graph directly to an agent:

```
Graph      tt_stats tt_context tt_cap   tt_combos tt_diff tt_health
           tt_decay tt_near   tt_bottlenecks        tt_spof tt_impact

Lifecycle  tt_verify tt_evidence tt_authority tt_actions tt_plan tt_goal
           tt_paths  tt_preferences tt_scope  tt_affordances tt_since tt_ledger

Operate    tt_work tt_usage tt_run_begin tt_run_end tt_work_event tt_digest
           tt_economics tt_goal_value tt_opportunities tt_opportunity
           tt_catalog tt_roi tt_roi_summary tt_audit tt_incidents
           tt_incident_resolve tt_portfolio tt_can

Propose    tt_blocked tt_deficits tt_simulate tt_propose tt_proposals tt_proposal
```

The lifecycle group is "is this real, may I act, what is missing" — and when the answer is *nothing here can do that*, recording it so a deficit hit repeatedly becomes visible as infrastructure that should exist rather than a wall to work around again. The operate group is the economic loop read and written by an agent: report work, record what it did, ask which investments rank, and — via `tt_can` — *ask* whether an action is permitted. An agent can ask; it can never approve or apply.

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

`ambit impact runtime:hermes` then answers what would be lost if that runtime went away — and the answer is smaller than its capability count, because the shared four survive.

The adapter also reads what a config file cannot infer but the runtime states outright: Hermes reports `approvals: manual`, `cron_mode: deny`, eight messaging surfaces, a policy engine, and zero scheduled jobs — which is the difference between a capability that persists and one that lasts a session.

Hermes has no machine-readable config export today, so the adapter reads its documented paths. That is a stopgap: the durable contract is for runtimes to publish their capability surface and for Ambit to consume it.

## The visualizer

One renderer: the **ERAS** capability tree — era columns as filter metadata, filled for reached, outlined for next-with-cost, faded for blocked. The 3D modes were sunset: they told you something interesting about the graph without changing what you should do.

The visualizer is a view over the model, not the product's ultimate abstraction. The underlying graph is meant to stay useful when no human is looking at it.

## Infrastructure belongs in the graph

Agent capabilities do not stop at the model boundary. A local GPU, NAS, browser worker, Proxmox host, database, or cloud account can all contribute to what the system can accomplish.

Ambit scans infrastructure from an explicit local manifest (`INFRA_MANIFEST`, default `~/.config/opencode/infrastructure.json`). With no manifest it returns an empty scan rather than an error — no host addresses are baked in.

The manifest is not specific to servers. A device is anything that can act — a Pi, a GPU host, a robot arm, a sensor, a decoder — and they seed as first-class nodes in a `physical` domain. Devices and services seed into the engine graph itself: a device is a `resource` with a `runs_on` edge to every service hosted on it, so `ambit impact device:nuc` answers what actually breaks when the machine disappears, and a plan can point at capacity the graph counts. Whether that generalisation is the right one is argued in [the affordance frontier](./docs/affordance-frontier.md); what is implemented is that the model does not assume software.

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

That lifecycle is a stored column rather than an aspiration — see [what a node is](#what-a-node-is) — and it now **gates**. A capability whose lifecycle is `degraded` or `broken` stops reading as available wherever availability is decided: `ambit goal` refuses to route through it (and says "re-verify" rather than "add"), `ambit goal <cap> --simulate` reports it as `blocked_by_degraded`, `ambit authority` stops listing it as reachable, and `ambit status` reports it in a `failing` count. `ambit verify` changes the lifecycle immediately; a re-seed reconciles it from the recorded evidence, and nothing verifies on seed.

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

Authority is recorded per action, and from two sources. The curated model says what an action is like in general; the runtime that would execute it says what it permits here — Hermes publishes `approvals.mode` and `approvals.cron_mode`, Claude Code publishes `permissions.defaultMode`, and both adapters pass them through. Where the two disagree the narrower wins, and `ambit authority` names which source narrowed it.

Enforcement lands where it matters. `ambit can <cap> [--target X] [--spend N]` is the decision API: it returns ALLOW, CONFIRM or DENY with the governing grant, the scope, and the remaining budget. `apply` gates every step through it, and nothing applies without a signed, unexpired approval artifact. The one limit worth stating: enforcement is on Ambit's own apply path, not yet interposed between every runtime and every tool — the runtime adapters are the next boundary.

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
        ├──► CLI                ambit
        ├──► MCP server         47 tools, JSON-RPC over stdio
        ├──► visualizer API     Bun.serve, port 3001
        ├──► work ledger        /api/telemetry · AG-UI events · plugin bridge
        └──► tracking plugin    config-change events
```

TypeScript · Node 22 with `node:sqlite` · Bun server · React + Vite · JSON-RPC MCP · local-first state.

## Security

The server reads and writes `opencode.json`, so two invariants hold:

- **Loopback only.** It binds `127.0.0.1` and rejects non-local origins **before routing** — CORS headers alone are insufficient, because a simple request skips preflight and reaches the handler regardless.
- **It cannot create configuration entries.** An MCP entry carries a command your agent runtime executes, so creating one over HTTP would be remote code execution. The API can toggle an MCP and edit an existing agent's description or model; adding a server generates a snippet you paste yourself.

Ambit should become more capable without making its own control surface casually dangerous. Telemetry is loopback-only and structured: the work ledger is written through `POST /api/telemetry` or the plugin bridge, a payload is ledger verbs — `run`, `end`, `event`, `use`, `intervention`, `resource`, `outcome` — never a command, and nothing leaves the machine unless a runtime adapter or an opt-in ntfy push sends it.

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

Ambit is early, and its two halves are at different depths. The **graph half** is strong: capability discovery, dependency mapping, failure-cascade analysis, near-miss discovery, verification and the lifecycle gate, authority per action, and an MCP-readable external model of an agent environment. The **economic half** is built end to end but young — the ledger, attention, economics, opportunities, the approval broker, enforcement, ROI, the catalog, incidents, audit, portfolio and federation all exist, and they are only as good as the telemetry that feeds them.

What remains of the larger direction is the accumulation: real work flowing through the ledger so the first predictions have observed baselines, demand filling the catalog before any marketplace exists, and the portfolio reading many environments instead of one. See [ROADMAP.md](./ROADMAP.md).

The point is not to pretend those pieces are finished. It is to build toward them without changing the fundamental object. That object is the system's **ambit**: the set of actions presently reachable by the combined capabilities of its human, agents, tools, and machines — and the evidence about which of them is worth buying next.

## Contributing

Fork → branch → commit → PR. See [AGENTS.md](./AGENTS.md) for conventions, the typechecking setup, and the security invariants the server must preserve.

## License

MIT — see [LICENSE](./LICENSE).
