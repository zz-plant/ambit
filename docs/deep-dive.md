# Ambit reference

This is the long-form reference for how Ambit models capability. The [README](../README.md) covers getting started and the three surfaces; this covers the model underneath, every command and tool, and the map in full. The argument for building it is [why-ambit.md](./why-ambit.md); the theory under that is [the affordance frontier](./affordance-frontier.md).

<details>
<summary><b>Contents</b></summary>

**The model**

[The core idea](#the-core-idea) · [What a node is](#what-a-node-is) · [People in the graph](#people-in-the-graph) · [Runtimes are nodes, not owners](#runtimes-are-nodes-not-owners) · [Infrastructure belongs in the graph](#infrastructure-belongs-in-the-graph) · [Capability and authority are different things](#capability-and-authority-are-different-things) · [The frontier ledger](#the-frontier-ledger)

**What gets recorded, and what it buys**

[The work ledger](#the-work-ledger) · [The economic loop](#the-economic-loop) · [Previewing a change](#previewing-a-change) · [Delegation records](#delegation-records)

**The surfaces**

[The full CLI surface](#the-full-cli-surface) · [The full MCP surface](#the-full-mcp-surface) · [The map, and what it is allowed to do](#the-map-and-what-it-is-allowed-to-do)

</details>

---

## The model

### The core idea

Configuration tells you what is declared. Ambit tries to tell you what those declarations amount to: what the setup can do, composed from its pieces, proven by checks, and kept apart from what it is allowed to do. [The ideas behind Ambit](./ideas.md) is that claim in one page, with what is new in it.

A capability in a tool registry looks like *"GitHub access: yes."* The useful form is closer to:

> Can diagnose a failing service, modify its repository, deploy a fix, verify recovery, and report the intervention — because the system currently has repository write access, shell execution, deployment credentials, monitoring visibility, network reachability, persistent execution, and the required human authorization.

That second description is **effective capability**, and it is the object Ambit is built around. Getting there means keeping apart seven things that ordinary registries collapse into one:

| Property | What it means | Today |
| :--- | :--- | :--- |
| **Available** | something appears to exist | ✅ |
| **Reachable** | all necessary dependencies are currently accessible | ✅ |
| **Composed** | several lower-level capabilities together make a higher-order action possible | ✅ |
| **Verified** | the capability has actually succeeded | ✅ a passing check; a failing one reads as `degraded`/`broken` and stops being available |
| **Authorized** | the system has permission to use it | ✅ per action, declared, and enforced by `canExecute` on apply |
| **Delegated** | a human or another agent supplies a missing step | ✅ people are nodes; a plan names the person a step needs |
| **Persistent** | it can operate beyond the current interaction | roadmap |

Capability *change* is recorded over time (see [the frontier ledger](#the-frontier-ledger)), which is the accounting half of that table, not a seventh state.

Six of seven, with the caveats stated in the table and not hidden. Checks exist for eight capabilities, and for individual contract actions too, so `ambit verify act:version-control/commit_changes` proves the action and not the capability that confers it. A check that last failed **gates** the capability out of everything that decides availability, and nothing applies without a signed approval artifact and a per-step `canExecute` pass. [The roadmap](./roadmap.md) is the rest.

```
ambit verify            # run the declared checks, record what happened
  checked: 8 · verified: 8 · failed: 0
  Local Runtime   verified   23ms   reliability 4/4

ambit authority         # reached is not the same as permitted
  autonomous      File Editing · Parallel Execution
  needs approval  Shell Execution · Version Control · Continuous Delivery
  forbidden       Secret Management

ambit authority version-control    # and permission is finer than a capability
  exercisable     read_repository · commit_changes
  needs approval  push_branch · merge_to_default

ambit goal offline-capable
  goal: Offline Capable · steps: 2 · estimated setup: 25m
  1. Embeddings   2. Local Embeddings
```

The compressed form of the same point:

```
installed ≠ callable ≠ working ≠ reliable ≠ authorized ≠ appropriate
```

### What a node is

Every node says what kind of thing it is, and every edge says what the relation means:

```
capability   an action the system can bring about — the curated model's nodes
action       one concrete thing a capability confers, or that a person supplies
provider     what supplies a capability — an MCP server, a skill, a tool
resource     what a provider needs — a model, an inference endpoint, a machine
actor        a person: authority, money, judgment, physical access
runtime      an agent runtime, which contributes providers rather than owning them
credential   what a provider authenticates with — the identity of one, never the secret

provides · contributes · requires · optional · authorizes · runs_on · uses
```

**Redundancy is counted by what fails together.** A capability with three providers survives losing one — unless all three present the same token. Counting providers assumes they fail independently, and providers sharing a credential do not: one revocation takes all of them at once, and the capability reads as robust the whole time. Worse, having several providers is what *excluded* it from the single-point-of-failure report.

A `credentials` block declares the sharing:

```json
{ "credentials": {
    "github/user-token": { "name": "GitHub user token",
                           "used_by": ["mcp:github", "tool:bash"] } } }
```

`ambit status` then lists the capability among its spofs, `ambit impact` calls what survives `nominal` rather than `redundant`, and `ambit credentials` answers the question you have before rotating a token — what stops working. Only a credential *every* provider presents counts: given providers holding `{A}`, `{A,B}` and `{B}`, losing either leaves one standing, and calling that fragile would be the same overstatement inverted.

**No secret is read or stored.** Only the name, the holders and a note are consulted, so there is no field a value could arrive in and no column it could be written to. Sharing is declared, never inferred — guessing it from environment variable names would produce a redundancy claim nobody made, and a wrong one is worse than none.

Ten capabilities declare a `contract.can` — the actions they confer — and each becomes a node with its own authority. That is what lets the model say *may read the repository, may not merge to its default branch*, which the coarse node cannot. `ambit authority <cap>` reports them; the visualizer leaves them out of the era columns on purpose, because legibility is the point of that view.

Alongside `state`, each capability carries a **lifecycle** derived from its providers and its recorded evidence. The argument for keeping those two apart is in the README, under [Configured is not working](../README.md#configured-is-not-working); what follows here is where the lifecycle values come from.

| Lifecycle | When it holds |
| :--- | :--- |
| `unknown` | nothing supplies it |
| `detected` | something supplies it, but it is not reachable yet |
| `configured` | reachable, with no check run against it |
| `verified` | its check passed, and has not been run often |
| `reliable` | five runs or more, and the last five all passed |
| `degraded` | the last run passed, and recent ones did not |
| `broken` | the last run failed |

Nothing writes the column directly. It is recomputed from the evidence on seed and after verification, which are the two moments the inputs can change.

### People in the graph

Humans supply what machines cannot — legal authority, money, physical access, judgment — so they are nodes rather than users of the graph. An `actors` block declares them:

```json
{ "actors": { "kanav": {
    "provides": ["physical-access", "approve-purchases"],
    "authorizes": ["combo:continuous-delivery"] } } }
```

`provides` becomes a capability only that person supplies. `authorizes` becomes a required (hard) prerequisite, so a plan says whose step it is:

```
ambit goal continuous-delivery
  goal: Continuous Delivery
  requires person: Kanav
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

```
ambit attention 30
  interventions: 12
  3× approval: deploy to production
  2× permission block: restart svc:ollama
  2× failed: local embeddings
  reducible: deploy to production — grant bounded authority rather than approving each time
```

`ambit notify <topic>` pushes that digest to [ntfy](https://ntfy.sh), and only when a topic is given. Nothing leaves the machine otherwise; the push is a single HTTP POST of the digest text, no graph data.

### Runtimes are nodes, not owners

Ambit represents agent runtimes rather than being one. A runtime becomes a node, and everything it contributes hangs off it — so two runtimes configuring the same MCP server produce **one capability with two providers**, not two capabilities.

```bash
node --experimental-strip-types scripts/adapters/claude-code.ts          # what Claude Code provides
node --experimental-strip-types scripts/adapters/claude-code.ts --seed   # add it to the graph
node --experimental-strip-types scripts/adapters/hermes.ts               # the same for Hermes
```

The Claude Code adapter reads `~/.claude.json` and `~/.claude/` — MCP servers global and per project, skills, subagents, a pinned model — plus the authority the runtime states outright: permission mode, and how many allow, deny and ask rules are in force. Rule *names* only; an allow rule can name a path, and those are not Ambit's to copy into a graph you may export.

Against a real install, that yields:

```
runtime:opencode — contributes 127 capabilities
runtime:hermes   — contributes 32 capabilities
shared by both   — mcp:fetch · mcp:filesystem · mcp:git · mcp:sequential-thinking
```

`ambit impact runtime:hermes` then answers what would be lost if that runtime went away, and the answer is smaller than its capability count, because the shared four survive.

The adapter also reads what a config file cannot infer but the runtime states outright: Hermes reports `approvals: manual`, `cron_mode: deny`, eight messaging surfaces, a policy engine, and zero scheduled jobs — which is the difference between a capability that persists and one that lasts a session.

Hermes has no machine-readable config export today, so the adapter reads its documented paths. That is a stopgap: the durable contract is for runtimes to publish their capability surface and for Ambit to consume it.

### Infrastructure belongs in the graph

Agent capabilities do not stop at the model boundary. A local GPU, NAS, browser worker, Proxmox host, database, or cloud account can all contribute to what the system can accomplish.

Ambit scans infrastructure from an explicit local manifest (`INFRA_MANIFEST`, default `~/.config/opencode/infrastructure.json`) and from the local Docker socket when one exists (`DOCKER_HOST=unix://…`, `/var/run/docker.sock`, or the per-user socket Docker Desktop, OrbStack, Colima and Rancher Desktop leave). The socket is read with one `GET /containers/json`: every container, running or not, becomes a service on a `device:docker` node, with its image, state, published ports and compose project. A TCP `DOCKER_HOST` is never probed, and nothing here can start or stop a container. With no manifest and no socket it returns an empty scan rather than an error — no host addresses are baked in.

The Infra tab in My Setup draws that scan as a table: a status, a name, how old the reading is, and for each machine what an agent may do there. The modes are the gate's answer with the machine as the target (`device:nuc`), for the actions the tree gives Shell Execution, so they differ between machines only where a grant is scoped to one. They come from this machine's own grants, and a forbidden grant wins at any scope, as it does for `apply`. Nothing about when a machine was last seen is stored: the time on a row is the age of the scan in front of you, and a row the scan had nothing to probe says so.

The manifest is not specific to servers. A device is anything that can act — a Pi, a GPU host, a robot arm, a sensor, a decoder — and they seed as first-class nodes in a `physical` domain. Devices and services seed into the engine graph itself: a device is a `resource` with a `runs_on` edge to every service hosted on it, so `ambit impact device:nuc` answers what actually breaks when the machine disappears, and a plan can point at capacity the graph counts. Whether that generalization is the right one is argued in [the affordance frontier](./affordance-frontier.md); what is implemented is that the model does not assume software.

The goal is not another homelab inventory. It is to treat infrastructure as capability-bearing:

```
GPU node
  ├─ local inference
  ├─ embeddings
  ├─ batch evaluation
  └─ private processing
```

A machine matters because of the actions it makes reachable.

### Capability and authority are different things

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

Authority is recorded per action, and from two sources. The curated model says what an action is like in general; the runtime that would execute it says what it permits here — Hermes publishes `approvals.mode` and `approvals.cron_mode`, Claude Code publishes `permissions.defaultMode`, and both adapters pass them through. Where the two disagree the narrower wins, and `ambit authority` names which source narrowed it. A runtime's setting is stored once against the runtime and reaches every capability it contributes and every action those confer; `ambit authority` and the gate behind `ambit can`, `apply` and the control plane resolve it through the same reach, so the report can never be stricter than what is enforced.

Enforcement lands where it matters. `ambit can <cap> [--target=X] [--spend=N]` is the decision API, with the spend in dollars as a budget is set in them: it returns ALLOW, CONFIRM or DENY with the governing grant, the scope, and the remaining budget. `apply` gates every step through it, and nothing applies without a signed, unexpired approval artifact. Claude Code can put the same question on every tool call: `ambit gate` is a PreToolUse hook that finds the capability a call exercises (by the tree's own `detect` patterns, the matching failures use) and answers. It can only narrow. Forbidden or over budget is a deny; no grant yet, a failing check, or asking first is put to the person; allowed, or a tool the graph does not know, is no answer, so Claude Code's own permission settings decide. It never answers allow, and a call it cannot read is no answer. It adds about a fifth of a second to each call. Other runtimes are not interposed yet, and the runtime adapters are the next boundary.

A calibrated classifier is a capability, not an authority. Typed decision models such as TypeSafe's Jev are cheap and fast enough to screen every tool call, and harnesses now use them that way. They are welcome on the map as Typed Judgment, and a runtime may consult one before it asks `ambit can`. They never stand in for the grant. A probability read from state an agent fetched can be steered by whoever wrote that state, which is the failure a grant a person set in advance does not have.

### The frontier ledger

`capabilities` holds the present state and is overwritten on every seed, so on its own the graph can only say what the system can do *now*. Every seed also records the whole frontier, which lets it answer what was reachable at a past date:

```
ambit history since
  moved:     reached 13 to 19, 3 emergent
  frontier then: 13
  frontier now:  19
  gained:    Embeddings · Local Embeddings · nomic-embed-text
  emergent:  Model Routing · Offline Capable · Subagents
```

One embedding model was added. Six capabilities moved. The three under `emergent` became reachable although **nothing providing them was added** — their prerequisites were satisfied by something else entirely. Offline Capable was already provided by an agent that did not change.

That is the entry a per-component changelog structurally cannot produce, because no single change explains it. Accumulated capacity to act is a graph property, and this is where it shows up.

A fourth class, **vocabulary**, exists to keep `gained`, `emergent` and `lost` honest. When Ambit starts modeling a part of your system it did not model before — a new action on a contract, or a capability added to the curated tree that your existing tools already provide — the node is new and nothing about the machine changed. Those are described and not counted, so `frontier_now` stays comparable with `frontier_then`:

```
ambit history since
  moved:     reached 21
  frontier then: 21
  frontier now:  21
  vocabulary: 12   act:shell-execution/run_command · act:file-editing/write_file · …
```

Without it, upgrading Ambit would read as a dozen capabilities acquired on a machine where nothing happened, which is exactly what the ledger exists not to say.

The map reads the same ledger as a timeline under it, opened from its History button or by a link that names a moment. `GET /api/frontier` serves one tick per second in which a snapshot was taken; two snapshots inside one second are one tick showing the later, because a second is all a timestamp can name. Each tick carries what the snapshot holds, state, kind and lifecycle per capability, and the step since the tick before in the words `ambit history since <then> <now>` prints for the same two observations, since the terminal, MCP and the page share one comparison. Scrubbing redraws the map from the snapshot's states over today's names, eras and edges, which no snapshot stores. Grants, providers and attention are not stored either, so while the playhead is in the past the lenses that read them and the simulations stay off, never drawn from today. The playhead travels in the link as `at`, a timestamp and not a snapshot id, and a second the ledger does not hold opens on now.

---

## What gets recorded, and what it buys

### The work ledger

The work ledger that `attention` reads is written by observation, not by hand. The visualizer API exposes a loopback `POST /api/telemetry` that speaks the ledger's own verbs — `run`, `end`, `event`, `use`, `intervention`, `resource`, `outcome`, `failure` — so a runtime adapter records actual work without knowing the schema:

```bash
echo '{"run":{"goal":"recover production service","runType":"incident"}}' \
    | node --experimental-strip-types scripts/adapters/telemetry.ts
```

`scripts/adapters/telemetry.ts` is the ingestion client (stdin → one JSON object per line → `POST /api/telemetry`). A plugin bridge ships at `plugins/ambit-telemetry.js`: copy it to `~/.config/opencode/plugins/` and every tool execution in an OpenCode session lands in the ledger as a work event, and every permission prompt as an `authority` intervention. The endpoint is loopback-only and origin-allowlisted like every other route, and a telemetry payload is structured data — never a command.

Failures land in the ledger too, classified from what a runtime states outright: a shell's own message for a missing binary, an MCP error kind, a permission refusal. Nothing reads what the failure was *about*. So `deficits` and `opportunities` stop saying "nothing observed" within a day of real work, without anyone remembering to record anything, and `ambit signals` is the raw view, including the failures no capability could be attributed to. Those are a gap in the model, not in the environment.

`ambit work` reads the ledger back: each run with its elapsed time, events, capabilities exercised, interventions, resources, and outcome. `ambit usage <days>` aggregates where effort went per capability — the raw material the opportunity engine ranks.

### The economic loop

The graph half answers *what can this system do*. The loop that pays for it answers *where is the scarce resource going, and which durable fix is worth the next dollar or hour*:

```mermaid
flowchart TD
    WORK["1. Real Work Happens\n(OpenCode / Claude Code Sessions)"] --> TELEM["2. Work Ledger Observes\n(Telemetry Adapter / Hook Bridge)"]
    TELEM --> ATTN["3. Attention Accounting\n(Prices Human Interruptions @ $/hr)"]
    ATTN --> OPP["4. Opportunities Engine\n(Ranks High-Payback Tool Investments)"]
    OPP --> PROP["5. Structured Proposal Draft\n(Propose Capability + Cost Matrix)"]
    PROP --> APP["6. Signed HMAC Approval\n(Human Approves with Expiry Grant)"]
    APP --> APPLY["7. Apply & Verification Gate\n(Applies Patch + Runs Test Contracts)"]
    APPLY --> ROI["8. Realized ROI Written Back\n(Validates Forecast vs Actual Savings)"]
    ROI -.->|"Continuous Evidence Feedback"| ATTN
```

- `ambit attention` prices the human half of the ledger and, critically, **classifies agency**: clerical, exception, physical and authority-as-repeated-gate are reducible — *the human is the duct* — while judgment and knowledge are keepers, never proposed for removal however often they recur.
- `ambit economics` is the declared model: attention value per hour, purchase and recurring costs, goal values. Dollars declare, cents store. An undeclared actor's attention defaults to $250/hr and is reported as such.
- `ambit opportunities` ranks the durable fixes — observed middleware burden priced by attention value, acquisition cost, expected effect, payback, confidence (high = observed five-plus times, low = deficits only). Rank by `--by=attention|cash|roi|reliability|frontier`, or allocate a budget: `--budget=N` returns the best combination of investments within $N. Each opportunity carries its acquisition options from the catalog, so it is a purchase decision, not a report.
- `ambit roi` closes the loop. With a proposal id it measures before/after on the affected capability — interventions, human hours, attention dollars, verification failures — and returns a verdict (performing near forecast, above, below, too early). With no argument it is the cumulative headline: hours and dollars saved per year and forecast accuracy, written back so the next prediction has evidence to learn from.
- `ambit incidents` is the managed-ops vertical's first turn: probe the infrastructure manifest, open an incident run for every offline service, record detection, resolve the recovery against authority, and close it with MTTR from the ledger's own timestamps.
- `ambit audit` is the governance trail: a run end to end, a proposal's steps/approval/enforcement/result, or one person's approvals and interventions.
- `ambit portfolio` reads `federation` imports across environments: the same human burden recurring in several places, person-specific SPOFs, and where capex would produce the most. A portfolio layer reads signed receipts; it never merges graphs, and the receipts carry aggregates only — no credentials, no raw sessions.

The graph half is useful the moment you seed. `status`, `briefing`, `next`, `plan`, `verify` and `authority` need no telemetry at all.

### Previewing a change

`ambit goal <cap> --simulate` computes the frontier as it would be, without touching anything. What makes it worth reading is the second line:

```
ambit goal vector-store --simulate
  frontier before: 21
  frontier after:  23
  acquired:  Vector Store
  unblocked: Retrieval          # already provided, waiting on the prerequisite
```

`ambit propose` turns that into a reviewable draft — ordered steps, the alternative chosen, and what it costs beyond time:

```
ambit propose retrieval
  Retrieval · 25m
    Embeddings     nomic-embed via local runtime      none / local
    Vector Store   pgvector on existing Postgres      none / local
  simulated:
    frontier before: 21
    frontier after:  24
  applicable: false
```

Choosing the hosted alternatives (`ambit propose retrieval 1`) takes it to 13 minutes, at a per-token bill and a data boundary.

Where an acquisition genuinely *is* a config change, the step carries a declarative patch and Ambit derives its undo — removing what it adds, or restoring what it overwrites. Anything needing an installer gets no inverse, and a proposal is `applicable` only when every step has one.

```
ambit approve prop-msrrv9c2 kanav
  proposal: prop-msrrv9c2 · goal: Web Research
  approved by: Kanav · applicable: true
  note: Approved. Every step has an inverse. The approval artifact is signed and expires in 24 hours.
```

Approval mints a **signed artifact** — proposal hash, actor, budget, scope, expiry, timestamp, HMAC-signed with a machine-local key (`AMBIT_APPROVAL_KEY`, default `~/.config/opencode/ambit-approval.key`). It is also minted by the browser broker, `POST /api/proposals/:id/approve` (loopback, origin-allowlisted), which approves and signs but never applies. The visualizer's AG-UI stream surfaces the approval as a toast telling you exactly which terminal commands to run.

```
ambit apply prop-msrsqzij
  applied: true · keys: mcp.fetch
  backup: opencode.json.ambit-prop-msrsqzij.bak

ambit rollback prop-msrsqzij
  removed: mcp.fetch          # git survives — the inverse reverses only this
```

Approval and apply stay off the MCP surface — an agent may draft, preview, and ask, but never approve or apply. Proposing more capability and granting more authority are different acts, and the artifact is what keeps them apart.

### Delegation records

The revisable-delegation loop is what an institution runs when it delegates consequential work to machines: believe, know what can be done, decide what authority is justified, act, detect mismatch, revise. Five systems each hold a step of it. Ambit holds two, capability and authorization, and writes what happens to them as [STD-07 Revisable Delegation Records](https://ethotechnics.org/standards/std-07-revisable-delegation-record): an append-only, hash-chained stream that another system can read as evidence and never as an instruction, without sharing Ambit's database. The siblings are [Whether](https://github.com/zz-plant/whether) (act), [Refract](https://github.com/refract-org/refract) (discrepancy), [NextConsensus](https://nextconsensus.com) (belief), and [Ethotechnics](https://ethotechnics.org) (the record shape).

**The grant holds only while what it rests on does.** A capability whose hard prerequisite has started failing no longer runs unattended: `ambit can <capability>` returns CONFIRM instead of ALLOW and names what took it down. The declared grant is not rewritten — what a person wrote down stays written down — and the narrowing is a property of the decision, so it lifts by itself when the check passes again. A declared sandbox is exempt, because consequences are contained there.

**The export.** `ambit delegation --export` writes newline-delimited records. Four kinds are written automatically for every grant currently narrowed: the `capability` that broke, the `authorization` that rested on it with `depends_on` and `invalidated_by` populated, the `discrepancy`, and the `revision` superseding the authorization. The stream is append-only and hash-chained; `ambit delegation verify` recomputes it. Conformance level 2, declared in [`server.json`](../server.json) and measurable with the [record conformance checker](https://ethotechnics.org/diagnostics/record-conformance).

**A record can be argued with.** Every record names who may contest it — an exercise of authority names the people it binds, an observation names anyone who can re-run the check. `ambit delegation object <record> --by --basis` writes the challenge as an `objection`; `ambit delegation answer <objection> --by --because [--refuse]` writes the answer it is owed; `ambit delegation objections` lists the unanswered. Neither widens authority: an objection that reopened an unattended grant would make the gate negotiable, so widening still costs what it costs — fix the capability, or re-declare the grant. A stream containing an objection and its answer measures at level 3.

**Reading another system's records.** `ambit delegation ingest <file>` takes an STD-07 stream and records its `discrepancy` records about capabilities this graph knows, as evidence attributed to the sender. Three limits, each deliberate. It never moves a lifecycle, so no remote system can narrow a grant here by sending a file. Only `discrepancy` records are read, because a foreign `authorization` is that system's account of its own grants and importing it would be importing authority rather than evidence. A subject this graph has never heard of is reported as unmatched rather than dropped, since a sender and receiver disagreeing about what exists is the most useful thing a first integration can tell you.

**Sources are read without being asked.** `ambit delegation source add <id> --system --instance --from --by` declares where a system's records arrive, and a full `ambit verify` reads every enabled source from then on. A local path, deliberately: an outbound read on the verification path would put a remote host between this graph and its own evidence. A source that cannot be read records why and verification continues. `ambit delegation sources` shows when each was last read and what happened. `server.json` points `upstream` at these declarations instead of naming a peer, so it claims nothing while the honest answer is nothing.

**The source that works is another Ambit.** A peer runs the same tech tree, so it names capabilities identically, which is the whole reason its discrepancies are legible here; nothing else in the loop shares the vocabulary. A source must say which environment it is (`--instance`), because two graphs on the same tree produce identical record ids, and declaring this environment as a source is refused. When the laptop reports `combo:shell-execution` broken, the server records that as evidence attributed to `std07:ambit/laptop` and its own grant on `act:shell-execution/read_output` still returns ALLOW; on the laptop, where the check actually failed, the same grant returns CONFIRM. A peer can tell this graph something. It cannot revoke anything in it.

**What is honestly not there.** `action` and `outcome` records: the environment adapter is simulated, so an action record from here would attest to a fixture. Only Claude Code can be made to consult the gate, through the `ambit gate` hook; any other runtime that never calls `ambit can` is unaffected by any of this. And no sibling yet consumes what Ambit emits; the reading edge runs one way.

---

## The surfaces

### The full CLI surface

Run `ambit` with no arguments and it shows where the environment stands; `ambit help --all` shows the surface. Forty-two commands group under five nouns, and the grouping is presentation only — every verb also works flat, so `ambit impact x` and `ambit graph impact x` are the same command:

```
           seed · briefing [--json|--peek] · status · next [n] · help [term]
graph      impact <id> · catalog <cap> · where · skills · objects [target]
           share [--redact] [--out=path] · sync export|import <path>
           graph [surface|combos|affordances|unmapped|capacity]
plan       goal <cap-or-sentence> [--paths|--simulate|--prefs|--judge[=url]] · next [n]
           reversible
           opportunities [--by=…] [--budget=N] · opportunity <id>
           propose <cap> [option] [--for="…"] [--by=<who>] · roi [proposal-id]
           portfolio [--budget=N]
check      verify [cap] [--history] [--target=<object>]
           authority [cap] [scope <target>]
           authority promote [<cap> <action> --after=N --window=30d --scope=X --by=<person>]
           authority grant <cap> <mode> [--ttl=30m] [--scope=X] [--by=<person>]
           authority sandbox [<target> --by=<person>] · budget [set|clear]
           can <cap> [--target=X] [--spend=N] · gate (the Claude Code hook) · credentials
           incidents · incident resolve <svc> <outcome>
govern     proposals [--pending] · proposal <id> · approve <id> [<id>…] <person>
           reject <id> <person> ["why"]
           apply <id> · rollback <id> · dispatch <id> [--to=<url>]
           history [since <when> [<until>]]
           audit [run-…|prop-…|human:name|days]
           delegation [verify] [--record] [--export] · delegation ingest <file>
           delegation object|answer|objections · delegation source add|sources|pull
report     work [limit] · usage [days] · economics · attention [days]
           digest [days] · notify <topic> · notify-approvals <topic>
           record <cap> [class] [note] · record skill:<name> --provides= --verify=
           signals [days] · preferences [--observed] · federation export|import
```

Two more sit outside the groups because they start a process rather than answer a question: `ambit web` opens the visualizer (Vite in a checkout, and the built page with the loopback API server in an installed copy) and `ambit mcp` runs the MCP server.

The table covers the commands whose answer is not obvious from the name, in the same five-noun order as the block above.

| Command | The question it answers |
| :--- | :--- |
| **first session** — *the commands listed above the groups* | |
| `ambit briefing` | What an agent should know before its first tool call — reached and proven, configured but failing, waiting on a person, blocked recently, worth reaching next, and what changed since the last briefing. Prose, capped near 1,200 tokens, also served as the MCP resource `ambit://briefing` |
| `ambit status` | How are we doing — reached, verified, failing, degraded, SPOFs, recurring deficits, pending approvals, all in one report that ends on the one command to type next. `--json` carries that as `next`, a command and the reason for it |
| `ambit next [n]` | What to reach next and why — ranked by what has actually blocked work once the ledger has observations, and by leverage per hour of setup before then. The answer says which basis it used |
| **graph** — *the structure, and what it would cost to lose a piece* | |
| `ambit impact <id>` | What becomes unavailable if this disappears — and what survives on another provider? |
| `ambit catalog <cap>` | The ways to acquire a capability — build, buy, subscribe, delegate, hire — compared by setup, one-time and recurring cost, privacy, verification and rollback |
| `ambit objects [target]` | What may be done to a particular thing, and what has been proved about doing it *there*. Evidence about one repository is not a claim about another |
| `ambit sync export\|import <path>` | The graph and the ledger as one file, so a container rebuilt from nothing gets its history back. No authority grants, no skill check commands, no credentials — a command in a data file is a command that runs on import |
| `ambit graph` | The whole graph as JSON; `graph surface` is the runtime-owned vocabulary a runtime would publish, `graph combos` the near-reachable ones, `graph affordances` the structural domains, `graph unmapped` what the agents used that no node on the map accounts for (presence, never frequency) and the overlay that would add it, `graph capacity` the machines on your tailnet and this machine's memory, naming the online ones no manifest declares |
| **plan** — *what to acquire next, and whether it paid* | |
| `ambit goal <sentence>` | Route a free-form goal — "deploy without me" — to the capabilities whose words cover it, each with its plan delta |
| `ambit goal <cap> --paths` | The alternative ways to reach a capability, compared by setup time, risk and lock-in |
| `ambit goal --prefs [who]` | Who prefers what, and where a plan's default choice would fight them |
| `ambit reversible` | Which unreached capabilities could be acquired without a person, and which need hands. The same list, read backwards, is what an agent can never do for itself |
| `ambit opportunities` | Ranked structural changes worth making — observed middleware burden priced by attention value, acquisition cost, expected effect, payback, confidence. `--by=attention\|cash\|roi\|reliability\|frontier`; `--budget=N` allocates the best combination within $N |
| `ambit roi [proposal]` | One proposal's before/after verdict, or — with no argument — the cumulative headline: hours and dollars saved per year and forecast accuracy |
| `ambit portfolio [--budget=N]` | Across imported environments: the same human burden recurring in several places, person-specific SPOFs, and where capex would produce the most |
| **check** — *what is proven, what is permitted, what is currently broken* | |
| `ambit authority <cap>` | Which concrete actions does this confer, and which of them may run unattended? |
| `ambit authority scope <target>` | What a scope actually covers and what it does not — a grant scoped elsewhere is named as excluded |
| `ambit authority promote <cap> <action> --after=N --by=<person>` | The threshold that widens a grant once its evidence supports it. A person sets it once; a single failing check afterwards puts the grant back, with nobody asked |
| `ambit authority grant <cap> <mode> --ttl=30m` | Autonomy for a window and no longer. Once expired the grant decides nothing and whatever stood before it decides again; the row is never rewritten, so it stays as the record of what was granted |
| `ambit authority sandbox <target> --by=<person>` | Somewhere acting does not matter. Confirmation is relaxed inside it; a refusal never is, because rehearsing a forbidden action would be a way round it |
| `ambit budget set <cap> --amount=$20 --by=<person>` | A ceiling on what can be spent in a period. A spend past it is refused until the period turns over, for a caller that states its spend (`apply` and the control plane state none), which is what makes a ceiling safer than approving each purchase. It bounds a grant and does not widen one: within the ceiling the grant's own mode still decides |
| `ambit incidents` | Probe the infrastructure manifest; open an incident run for every offline service with the authority decision for its recovery. `incident resolve <svc> <outcome>` closes it with MTTR |
| **govern** — *the reviewable path from proposal to applied change* | |
| `ambit proposals --pending` | The drafts waiting on a decision, each with cost, bill and what it unlocks — so approving is one sitting rather than one interruption per proposal |
| `ambit reject <id> <person> ["why"]` | A refusal, recorded. Approval was always written to the graph and refusal was not, so nothing could learn the shape of a no |
| `ambit history since <when> [<until>]` | What became reachable since a past date, and what emerged with nothing added? Up to now, or up to a later observation, with the step in the sentence the map's timeline prints |
| `ambit audit <run-…\|prop-…\|human:name\|days>` | The trail: who approved what, what ran, against what target, under which grant, and whether it held |
| `ambit dispatch <id> [--to=<url>]` | Push a proposal to Slack, Discord, Telegram, ntfy or a JSON endpoint: the decision for a draft, the signed artifact once approved. One-way; the reply is `ambit approve` on a machine that holds the key |
| **report** — *what the system cost to operate* | |
| `ambit attention [days]` | How much of the work still runs through the human, and which interventions are likely reducible |
| `ambit notify <topic>` | Push the attention digest to ntfy — nothing is sent without a topic |
| `ambit record skill:<name> --provides=<cap> --verify="<cmd>"` | Put a skill the agent wrote on the map, with the read-only check that proves it. The check is required and runs immediately |
| `ambit signals [days]` | Failures observed without anyone recording them, by class and by tool — including the ones no capability could be attributed to |
| `ambit preferences [--observed]` | What someone declared they prefer, or what they have actually approved and refused |
| `ambit federation export\|import` | The signed summary a portfolio layer reads — aggregates only, no credentials, no raw sessions |

Every command prints for a person by default and takes `--json` for scripts.

What that looks like when a capability is one dependency away, and the dependency it names gates four further capabilities:

```
ambit goal local-embeddings

  Local Embeddings
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

**From a script, or an agent's shell.** Output is plain when nothing is reading it as a terminal: color is drawn only when stdout is one and `NO_COLOR` is unset, so a pipe, a file and a CI log read what was written. `--json` prints any answer as data, and `ambit status --json` carries its closing suggestion as `next`. The exit code says whether the command worked: 0 for an answer, 1 for a command that reported an error (a usage error, an id that is not on the map), and 2 for a word that is not a command. `ambit check --ci` keeps its own codes. `--exit-code` on `can` maps ALLOW, CONFIRM and DENY to 0, 1 and 2, and a DENY files the deficit as it does over MCP; on `verify` it exits 1 unless every check that ran passed, and also for a capability with no check to run, since nothing was proved. A flag with a value is written `--target=svc:ollama`; the two-word form is not read.

### The full MCP surface

Sixty tools in six groups:

| Group | Tools | Purpose |
| :--- | :--- | :--- |
| **Graph** | `ambit_stats`, `ambit_context`, `ambit_cap`, `ambit_combos`, `ambit_diff`, `ambit_health`, `ambit_decay`, `ambit_near`, `ambit_bottlenecks`, `ambit_spof`, `ambit_impact`, `ambit_credentials` | Query structure, single points of failure, keystones (the `ambit_bottlenecks` tool keeps the old name), combo prerequisites, and blast radius. |
| **Lifecycle** | `ambit_verify`, `ambit_evidence`, `ambit_authority`, `ambit_actions`, `ambit_plan`, `ambit_goal`, `ambit_paths`, `ambit_preferences`, `ambit_scope`, `ambit_affordances`, `ambit_since`, `ambit_ledger` | Is this real, may I act, what is missing: inspect health, run verification contracts, resolve authority scope, compute prerequisite paths. |
| **Operate** | `ambit_work`, `ambit_usage` (with `unmapped`, what was used and is on no node), `ambit_run_begin`, `ambit_run_end`, `ambit_work_event`, `ambit_digest`, `ambit_economics`, `ambit_goal_value`, `ambit_opportunities`, `ambit_opportunity`, `ambit_catalog`, `ambit_roi`, `ambit_roi_summary`, `ambit_audit`, `ambit_incidents`, `ambit_incident_resolve`, `ambit_portfolio`, `ambit_can` | The economic loop read and written by an agent: record telemetry, price attention, rank opportunities, and check permission before acting. |
| **Propose** | `ambit_blocked`, `ambit_deficits`, `ambit_simulate`, `ambit_propose`, `ambit_proposals`, `ambit_proposal` | Record deficits, simulate future frontier states, and draft reviewable patches. |
| **Session** | `ambit_briefing`, `ambit_next`, `ambit_record_failure`, `ambit_signals`, `ambit_register_skill`, `ambit_skills`, `ambit_promotions` | Know the environment before touching it, see what is worth reaching next, report a failure the runtime already noticed, and put a skill you wrote on the map with the check that proves it. |
| **Expand** | `ambit_objects`, `ambit_budgets`, `ambit_reversible`, `ambit_preferences_observed`, `ambit_pending` | What may be done to a particular target and what is proved there, what ceilings bound a spend, what would have to be written for an acquisition to need no person, what this person actually approves, and what is waiting on one right now. All read-only. |

Widening authority is a person's act throughout. An agent can ask; it can never approve or apply, and an agent that could grant itself more would make the distinction meaningless.

One resource sits beside the tools: `ambit://briefing`, which a client reads on connect. A tool has to be thought of; a resource arrives unasked, which is the only way it reaches the agent that does not know Ambit is there — the one that most needs to be told what is already broken.

### How a call is answered

An agent that connects is told what Ambit is: the server's `instructions` carry the one habit, ask `ambit_can` before a tool you have not used, so a client that passes them to the model shows it unasked. The protocol version is the one the client asked for when the server speaks it (2024-11-05 and 2025-06-18), and `ping` is answered.

Every tool says, before it is called, whether it changes anything. Forty-six are annotated read-only, and a test holds that claim against the database: each is called against a copy of a seeded graph and no table may differ afterwards. `ambit_can`, `ambit_briefing` and `ambit_context` are listed as writes, because `can` files a refusal as a deficit and the other two move the mark that says what changed since you were last told. `ambit_verify` and `ambit_register_skill` run a command that was declared in the graph, and claim no safety.

Every call is checked against the schema the tool advertised before it reaches the engine. One that cannot work comes back as a failed call the model can read, `isError: true` with the `error` and what the tool `takes`, where it used to arrive as an SQLite bind error, a CLI usage line or a TypeError. The check is lenient where the meaning is not in doubt (`null` for an omitted argument, `"14"` for 14, `capability_id` for `capId`) and refuses the rest, including an argument the tool does not take. Dropping it silently made `ambit_verify` with a misspelt name run every declared check. A failed call is one rule on both surfaces, a top-level string `error`, which is also what makes the CLI exit 1. An `error` inside a report, one failing check among many, is part of a real answer and does not count. An unknown tool is a protocol error (-32602) that names the one probably meant.

A capability is named by its id, its id without the kind (`shell-execution`) or its name (`Shell Execution`), and one resolver, `resolveCapability`, decides what that means for every tool that takes one. It normalizes and never guesses. A word that fits no node, or fits two, comes back as `did_you_mean` with the candidates, because an id picked on an agent's behalf can be a different capability under a different grant. `ambit_can` treats a near miss as a slip: it answers with the candidates and files no deficit, since a "no" to `shell-exection` reads as "you may not run a shell".

Two smaller choices keep answers small. The text half of a result is compact JSON, since a client may send both halves to a model and indentation was about a quarter of them. `ambit_authority` returns who may act alone, who must ask and what is forbidden, about 0.7KB, and the row for every grant, about 10KB more on a seeded machine, only for `detail: true`.

`ambit mcp --profile=agent`, or `AMBIT_MCP_PROFILE=agent`, lists ten tools (`ambit_briefing`, `ambit_can`, `ambit_next`, `ambit_impact`, `ambit_plan`, `ambit_goal`, `ambit_verify`, `ambit_record_failure`, `ambit_propose`, `ambit_register_skill`) in 4.4KB where the full listing is 19.5KB. It changes the listing and nothing else: every tool still answers by name, and what may be done is decided by the graph's grants and never by which tools an agent was shown. A name it does not know stops the server from starting, because falling back to sixty tools would answer a typo with the thing the flag was typed to avoid.

### The map, and what it is allowed to do

The web UI (`./bootstrap.sh web`) reads the same graph the CLI reads, over `/api/events`, and writes to your configuration in one place only: the My Setup switch, which edits an entry the config already holds and cannot create one. A proposal approved on the page mints an artifact, and only `ambit apply` spends it. What a person sees comes first here; what sits underneath it follows.

**Four views over one graph.** The **map** is the curated tree with your position on it. **My Setup** is one row per entry your configs declare, with what the engine has proved about it and the nodes on the map it provides; its Briefing tab is the prose an agent is given at connect, so what the agent believes about the machine is inspectable. Its Not on the map tab lists what the agents used in the last 30 days that no node on the map accounts for, with an overlay to paste into `.ambit/techtree.json` that would put it there. **Time & cost** is the ledger and the governance half: what may act without asking, which grants have earned a threshold nobody set, what to reach next and why, and how the frontier moved this week. It lays one run out in time, and each time you were asked in it is an exchange: the recorded request, and your answer with how long it took, or an empty reply where nothing recorded one. The request is the capability and action the ledger holds, never words written in the agent's voice. **Audit** is the trail, one line per event and newest first: proposals drafted, approved, applied and turned down, check runs, work runs, and the delegation records that say when a grant narrowed, each with what came of it where that was recorded, and a query bar that takes `actor:`, `action:` and `target:`.

**Who acted.** A mark before each line says who: a circle for a person, a rounded square for an agent, a hexagon for a machine and a diamond for Ambit, drawn only where the actor's id says which. A signature carries a seal.

**Search.** <kbd>/</kbd> finds anything by name and opens it where it lives, and lists actions beside what it finds: simulate an outage or an unlock, copy the command that checks a node, switch lens, open Proposals. It copies a check and never runs one, and a proposal is still decided by the buttons in its panel.

**What the map found.** Over the map, one line says what the map found before you read a node. A capability that is configured and failing its check is that line on its own, with a button that shows it, and the node it names is marked with corner brackets. With nothing failing, the line is the next step that reaches the most, with a button that previews it, and a second line gives the range: how many capabilities are verified, how that moved this week, and the one piece of the setup whose loss would stop the most, with a button that simulates it.

**Marks.** A failing node is striped, as is a forbidden grant under the Authority lens: stripes mean something refuses, and nothing else on the page is striped. Edges that cross more than two eras are drawn faint until a node they touch is in focus. A small person mark on a node means it needs someone: a person approves or supplies it; a device mark means it runs on one of your machines. The detail panel says who, under Joint capability. The **Key** button beside zoom opens what each mark means, and pressing a key there highlights its nodes; switching to the Attention or Authority lens opens it, since a lens paints with its own scale. **Image** beside it saves what the map shows as a card sized for posting. The **Docs** button defines every term on the canvas.

**Selecting a node.** Its edges are drawn apart: what it needs in violet, what it enables in blue, one hop each way. The panel states the answer before the simulation that draws it: what would stop and what would only lose a provider if the node went down, or what stands between it and being reached and how long that would take.

**Counts.** The header counts the map's nodes, leading with the reached ones that have a passing check (verified) apart from those with none or a failing one (unproven), and each count highlights its nodes, the way the keys do. Each era's header counts what is reached and working, and it is a control: click it and the era opens in the panel as a ladder, a bar for how far up it you are and one rung per node, each either reached, a next step with its setup time, or blocked with what it waits for. A reached node whose check failed is a rung of its own, failing, and is left out of the reached count.

**A map bigger than the window.** It gets a minimap at its bottom right: the whole tree as a thumbnail, a dot for each node with the failing ones red, and the part on screen outlined. Drag the outline, or focus it and use the arrow keys. It is not drawn when the whole map fits, and the line over the map says which way a failing node lies (off-screen left) when it is out of sight.

**Focus.** On a map too crowded to read, select a node and press **Focus** in its panel: only what it needs and what it enables within a few hops stays on the map. Choose which way (needs, both, enables) and how far (one to three hops), and a pill says how many nodes are hidden and brings them back. The columns keep their places, the header still counts the whole map, and a simulation still counts its whole cascade and says how much of it the focus hides. <kbd>Esc</kbd> ends it. It is off unless asked for, and a link carries it as `collapse=1`, with `depth` and `dir` when they are not two hops both ways.

**Three lenses.** The switch sits over the map, top right, and <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd> changes it from the keyboard.

| Lens | What it renders | Use it for |
| :--- | :--- | :--- |
| **Standard** | Era columns with reached, next-step and blocked nodes. | Reading overall progression and what is nearby. |
| **Attention** | Nodes shaded by how often a person had to step in, offered once the ledger has recorded any. | Finding which tools keep interrupting you. |
| **Authority** | Each reached node by what it may do: act without asking, ask first, forbidden, or no grant yet, which the gate refuses until someone grants one. | Seeing where being able to do something is not the same as being allowed to. |

**Simulating.** Select a node to open the inspector, then simulate against it. Neither mode writes anything.

- **Simulate an outage** dims the canvas and draws the cascade: red for what stops, amber for what keeps another provider and only loses one, with the count of each. The node that went down is labelled on the map with how many capabilities stop.
- **Simulate unlocking** acquires a locked primitive hypothetically and lights up, in green, everything that becomes reachable because of it.
- **Show the gap** draws what a blocked node is waiting on, every hop up, priced in setup time.

**The map through time.** Once the ledger holds two observations, the **History** button beside zoom opens a timeline under the map, one tick for each second a snapshot was taken. It stays closed until asked for, or until a link names a moment. Drag the playhead, or step it with the arrow keys, and the map redraws as that snapshot left it: states and checks from then, names, eras and edges from now, because a snapshot stores none of those. One sentence says what moved at each tick, such as "Sep 26: reached 43 to 45, 1 emergent, 1 went failing", in the words `ambit history since <then> <now>` prints for the same two observations. The header's counts and the detail panel follow the playhead and say "as of". A snapshot keeps no grants, providers or attention either, so while the playhead is in the past the Attention and Authority lenses and the simulations wait for now. The playhead is a timestamp in the link, so a link to last week's map opens on it wherever the same ledger is. With fewer than two observations there is no History button, since there is nothing to scrub.

**Approving proposals.** When an agent proposes an environment change over MCP, the **Proposals** panel reads it as a plan before you sign: how many steps, which of them nothing can undo, whether `ambit apply` can run it at all, the hours a month it is forecast to take before and after, what it costs, what it unlocks, and how you have decided on things like it before. Each proposal is drawn as a request beside the mark of whoever drafted it, the agent's runtime over MCP or whoever `ambit propose --by=` names, and your decision as the answer under it: a signed approval is a receipt with a seal and your mark, and a no is recorded with the reason, which is what the next draft learns from. When several drafts are waiting, tick the ones to decide and approve or turn them down together: each is still signed on its own, against the version you were shown, so one that changed since is refused while the rest go ahead, and nothing is applied. A draft your record leans against starts unticked. The same things happen from the terminal with `ambit approve <id> <who>` and `ambit reject <id> <who> "why"`. When you are away from the machine, `ambit dispatch <id>` pushes the draft to a Slack, Discord or Telegram webhook, or an ntfy topic, with the commands that decide it; the decision itself still happens here, on a machine that holds the approval key.

**Simulation is arithmetic on the graph, not on the host.** An outage walks the transitive downstream closure of the chosen node and counts what stops working; an unlock takes a locked node whose other hard prerequisites are already met and lights what becomes reachable. Neither reads a config file or writes one.

**Seven loopback endpoints carry governance.** `GET /api/proposals` lists drafts and their history, each with the hash an approval artifact binds. `POST /api/proposals/:id/approve` mints the same HMAC-signed approval artifact the terminal does and never applies, and `POST /api/proposals/:id/reject` records a no with its reason. `POST /api/proposals/approve` and `POST /api/proposals/reject` are the queue: an explicit list of drafts, each sent with the hash the page showed and decided on its own as the person at the browser, so one that changed since is refused while the rest go ahead. They decide drafts only, answer per id, and ask anything with no browser behind it for the local API token, since one request there decides up to fifty. `GET /api/attention` aggregates interventions per capability from the ledger. `GET /api/audit` is the trail the Audit view draws: acts, proposals, runs and delegation records merged newest first and cut once at a limit, with what a check printed left out. All seven bind loopback and reject a non-local origin before routing, like every route.

**One run is drawn in time from what the ledger recorded, and no more.** `GET /api/run` lays a run out: the capabilities it used for as long as each was measured to last, its events as points, and every time a person was asked, with permission asks in amber. An ask with both its times is a span, one with seconds and no end is a filled point that carries its figure, and one with neither is a marked point that says it was not timed. The OpenCode plugin logs a permission prompt and cannot see the reply, so most asks have no end, and an unmeasured wait is never drawn as zero. The total of a person's time in the run counts only the asks something timed, and says so. It is read only, and it is the same projection the Time & cost page draws.
