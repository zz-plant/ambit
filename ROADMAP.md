# Roadmap

Ambit today is a capability graph: it reads your configuration, places it on a curated tech tree, and answers questions about the structure — what is reached, what is one step away, what would break if a given thing disappeared.

That is a model of **what exists**. This document describes the move to a model of **what can be acquired**, and the loop that closes between the two.

Nothing below is implemented unless it appears in the README. Sections are ordered by dependency, not by date.

---

## Four layers

Ordered by ambition. Each is defensible on its own; each depends on the one above it.

| | | status |
|---|---|---|
| **1 · Inventory** | discover the capabilities implicit in configuration and infrastructure, model their dependencies, costs, and failure cascades | shipping |
| **2 · Assurance** | distinguish *configured* from *demonstrated* — `installed ≠ callable ≠ working ≠ reliable ≠ authorized ≠ appropriate` | shipping |
| **3 · Planning** | given a desired outcome, compute the capability delta and compare paths that close it | §5 |
| **4 · Reflexive infrastructure** | agents use the model to improve the environment they themselves operate in | §6–11 |

"Reflexive infrastructure" rather than "self-improving": the system can inspect the conditions of its own action and propose modifications to them, and a human approves every one.

## The change in one line

> A capability is not something configured. A capability is an action the system has evidence it can perform.

Everything here follows from taking that seriously.

---

## 1. Separate capability from implementation — built

A node used to conflate two things: the capability (*web research*) and the thing providing it (*a Tavily MCP server*). Splitting them was the prerequisite for almost everything else, because it lets a capability survive a change of provider and lets two providers compete to satisfy one need.

Six first-class object types:

| Object | Example |
|---|---|
| **Goal** | "agents maintain my homelab unattended" |
| **Capability** | restart a service |
| **Provider** | Proxmox MCP |
| **Resource** | the NUC that runs Proxmox |
| **Authority** | may restart containers, not hosts |
| **Evidence** | probe restarted a test container and confirmed health |

```
Goal  "autonomously maintain homelab"
  │ requires
  ▼
Capability  "diagnose service failure"
  │ provided_by
  ├──────────────┐
  ▼              ▼
Netdata MCP    SSH / shell
  │              │
  └─── runs_on ──┘
          ▼
     homelab node
```

Once providers are separate, `tt fork` stops comparing capabilities and starts comparing **ways of obtaining the same capability** — which is the comparison that actually matters when deciding what to build.

Built. Every node declares what kind of thing it is — `capability`, `action`, `provider`, `resource`, `actor`, `runtime` — and every edge declares what the relation means: `provides`, `contributes`, `requires`, `optional`, `authorizes`, `runs_on`. Authority and evidence are tables of their own. That is the six object types, with `goal` still absent because §5's free-form goals are.

The narrow half came first: the `provides` edges existed and no analysis consulted them, so every provider was treated as though it were the only one. `tt impact` now asks whether anything else supplies a capability before calling its loss critical — removing one of three git providers reports `redundant · also provided by 2` where it previously reported `critical` four times over, once per edge. `tt spof` lists capabilities with exactly one provider, which is fragility, as against `tt bottlenecks`, which ranks leverage.

Typing the edges was also a correctness fix rather than tidiness. `providersOf` matched three English sentences, so an adapter phrasing one differently dropped a provider out of both analyses with nothing failing: a capability with two providers still reported as a single point of failure.

Action-level capabilities are built. A tech-tree node may declare `contract.can`, and each entry becomes an `act:<node>/<action>` node conferred by the capability and carrying its own authority — so the model can now say *may read the repository, may not merge to its default branch*, which is the distinction the coarse node could not make. Ten nodes declare a contract; the rest behave exactly as before.

The id rework was avoided rather than done, deliberately. Every id appears in the ledger's stored snapshots, so re-iding would invalidate the history of the one component whose value is that its history is continuous. Kind is a column instead, existing databases migrate by `ALTER TABLE` and a one-time backfill, and `tt spof`, `tt impact`, `tt plan` and `tt since` return byte-identical output against a graph seeded by the previous version. The cost is that an id no longer tells you what it is, and callers must read the column.

Scope is now checked rather than merely recorded. `tt scope <target>` — `repo:owner/name`, `device:nuc`, `svc:ollama` — lists every authority grant, whether its scope covers the target, and the effective mode the covering grants resolve to. Scope is a prefix claim: `repo:owner/name` covers the repo and its branches, a grant scoped elsewhere is named as excluded rather than silently treated as covering. What remains: nothing *mediates* on the scope — the check is a report, not a gate, which is the same line every enforcement half of this roadmap sits behind.

`resource` is still a kind without much behind it: a model and a machine are both resources, and nothing yet reasons about capacity, location or contention.

## 2. Put the human and the machines in the graph — partly built

The interesting unit is not the agent. It is **user + agent population + infrastructure**, and each brings something the others cannot.

The human contributes authority, judgement, money, physical access, and the willingness to accept particular risks. Not as a profile — as an actor with capabilities and authorities, the same as any other node:

```yaml
human:kanav
  provides: [approve-purchases, physical-machine-access, github-admin,
             evaluate-subjective-output]
  prefers:  [local-when-practical, minimize-recurring-cost,
             tolerate-setup-for-compounding-benefit]
```

Hardware stops being "some computers" and becomes addressable capacity: 24GB of always-on VRAM reachable over Tailscale is *latent local inference, embeddings, browser workers, and batch evaluation* — and the graph can then observe that you already own most of what private semantic search requires.

The payoff is that a plan can include the human as a step. Instead of "I can't do that", the answer becomes: *eight of these ten steps are mine; you need to authorise the device and press the reset button; then I finish and verify the rest.*

Built: an `actors` block seeds people as nodes. `provides` becomes a capability only that person supplies; `authorizes` becomes a hard prerequisite edge, so `tt plan continuous-delivery` reports `requires_person: Kanav` rather than presenting the path as autonomous. Approval is a dependency, not a policy note.

Preferences are built. A person may declare how they like things done — `prefers: [local-when-practical, minimize-recurring-cost]` — stored as data and matched by `tt plan` against the alternatives a step's acquisition actually offers. Where the plan's default choice fights a stated preference, the plan names it and points at the alternative that matches: asking Kanav to approve a hosted, recurring CI default when they prefer local and one-off reads as if there is no choice, and the plan refuses to read that way. `tt preferences [who]` lists the declarations.

Machines are now capability-bearing in the engine, not only in the visualiser. `INFRA_MANIFEST` devices seed as `resource` nodes with `runs_on` edges to the services hosted on them, so `tt impact device:nuc` answers what actually breaks when the machine disappears, and a plan can point at capacity the graph can count.

Unbuilt: cost and risk *tolerance* are still not modelled — a preference is a word matched to an alternative's properties, not a budget or a threshold, so the plan cannot yet say "this step is not worth your attention" or "you asked not to spend more than this". The infrastructure manifest is read but not probed by the engine (the server probes it for the visualiser), so a device's reachability does not yet gate what runs on it.

## 3. Acquisition recipes — partly built

The largest single addition to the data model. A node stops being documentation and becomes an installable competency:

```yaml
capability: persistent-memory
contract:
  can: [store_fact, retrieve_fact, forget_fact]
requires: [durable-storage, retrieval-interface]
acquisition:
  alternatives: [mem0, postgres-memory, filesystem-memory]
verification:
  - store a random nonce
  - restart the agent
  - retrieve the nonce
  - delete it, confirm deletion
authority:
  read: autonomous
  write: autonomous
  delete: confirm
rollback:
  - disable the MCP server
  - restore the config backup
```

At that point the tech tree behaves less like a diagram and more like a package manager for agency.

Built: seven capabilities carry `acquisition.alternatives`, and `tt plan` attaches them to each step. Alternatives rather than one blessed answer, because the trade-off is rarely setup time — the hosted embedding API is three minutes against ten and costs money and a data boundary, and the plan says so.

The contract is built. `contract.can` lists the actions a capability confers, ten nodes declare one, and each action is a node with its own authority — `tt actions version-control` reports that reading the repository and committing may happen unattended and that pushing a branch and merging to the default branch may not.

Built: executable verification per contract action. A contract entry may be a name or `{ id, verify }`, and `tt verify act:<capability>/<action>` runs the action's own check against the action node — reading a repository is a weaker claim than having read a particular repository, and the two now carry separate evidence. `tt verify` with no argument runs every declared node check and every action check; `tt verify <capability>` still answers "no check declared" rather than erroring.

Unbuilt: a recipe's verification steps (the multi-step "store a nonce, restart, retrieve, delete" sequence) are not executable — a check is a single read-only command, not a procedure with an undo. That is the remaining executable half of §3.

## 4. Detection becomes verification — built, and gates

Today detection is regex against discovered configuration. That is a reasonable bootstrap, and it is honest about what it proves — *something named Ollama exists* — but it does not prove an agent can use Ollama to finish a task.

Each capability gets a lifecycle:

```
UNKNOWN → DETECTED → CONFIGURED → VERIFIED → RELIABLE → DEGRADED → BROKEN
```

with verification that executes:

```
Local Tool Calling
  detected:  a Qwen model is configured
  verified:  model emitted a tool schema, the tool ran,
             the result returned, the model used it
  reliable:  47/50 fixture tasks passed
```

Built: nodes may declare a read-only `verify` command; `tt verify` runs it and records the outcome in `session_learning`, which had carried the right columns since the first schema and had no writer. `tt evidence <id>` returns the history, and reliability is reported as passes over runs — one success is a weaker claim than forty-seven of fifty. Eight nodes declare a check today.

Checks execute, so they live in this repository, are read-only by construction, and run only when asked. Nothing verifies on seed.

The lifecycle is built and stored. `capabilities.lifecycle` holds `unknown`, `detected`, `configured`, `verified`, `reliable`, `degraded` or `broken`, derived on seed and after each verification from providers and recorded evidence — five runs with the last five passing is `reliable`, one passing run is `verified`, and a check that has started failing is `broken`.

`state` is untouched beside it, deliberately: `state` is what every frontier snapshot records, so repurposing it would break the ledger to answer a question the ledger does not ask. A capability whose check fails is therefore `broken` and still in the frontier — reachable and working are different columns, and collapsing them would lose the distinction this section exists to make.

Unbuilt: the gate is read at the decision surfaces — plans, simulations, authority, near-miss and bottleneck analyses — but nothing enforces it. Ambit describes availability and permission; it does not mediate action, and the check whose failure flips a capability to `broken` still has to be re-verified by hand. The remaining half of §4's promise — verification that *promotes* a capability on evidence rather than only demoting it on failure — is the executable recipe in §3.

## 5. Goal → capability delta — partly built

The headline capability of the mature system. Given a goal, compute the gap and the routes across it:

```
plan("maintain homelab unattended")

  have    ✓ tailscale  ✓ docker  ✓ proxmox  ✓ shell
          ✓ notifications  ✓ scheduling
  missing ○ service health observation   ○ bounded restart authority
          ○ credential broker            ○ rollback snapshots
          ○ post-action verification     ○ escalation policy

  A  broad authority          45 min   risk high
  B  capability-scoped MCP      2 hr   risk low    unlocks +7
  C  kubernetes migration      14 hr   risk med    unlocks +19,
                                                   regret-if-abandoned high
```

Built for the narrow case: `tt plan <capability>` walks hard prerequisites depth-first and returns them in the order they must be closed, with an estimate.

```console
$ tt plan offline-capable
  goal: Offline Capable · steps: 2 · estimated setup: 25m
  1. Embeddings        10m
  2. Local Embeddings  15m
```

The route in is built. The curated tree carries a `goal` vocabulary — the intent-side mirror of `detect`, which matches config ids: `detect` says "a git MCP named X is Version Control", `goal` says "a person wanting to *deploy without me* means Continuous Delivery and Scheduled Work". `tt goal <sentence>` ranks every capability whose words appear in the sentence, each with its plan delta, so a free-form goal becomes a shortlist of concrete plans rather than an error:

```console
$ tt goal "maintain the homelab unattended"
  recommended: Scheduled Work
  Scheduled Work       unattended          → steps 3 · 50m
  Observability        maintain           → steps 1 · 30m
  Self-Hosted Stack    homelab            → steps 2 · 2.5h
```

`tt paths <capability>` compares the alternative ways to close the gap, deriving risk from what the alternatives themselves carry — hosted moves data off the machine, recurring adds a bill, a step without a config patch cannot be undone by §10 — and folding identical paths together so the list is of choices, not accidents:

```console
$ tt paths web-research
  5m   risk low   local   none   reversible
```

Unbuilt: the goal is routed to capabilities the model already knows, so a goal that names no known vocabulary still has no route in — "maintain the homelab unattended" reaches the three capabilities above but does not synthesise *service health observation* or *bounded restart authority* out of whole cloth. And the paths comparison derives risk from the alternatives that exist; whole-strategy alternatives (broad authority vs capability-scoped MCP vs kubernetes migration) still have to be authored for the goal to be offered as a choice at that grain. That is the remaining substance of this section.

## 6. Failure becomes an input — built

`session_learning` is more important than it currently looks. Every failed task should be classified: was it reasoning, missing knowledge, a missing tool, a missing permission, weak infrastructure, or an unreliable capability?

```
task failure → capability deficit → does it recur?
                                      no  → solve it manually
                                      yes → propose a permanent upgrade
```

Built. `tt failed <capability>` records that work was blocked by something missing; `tt deficits` reports which deficits recur. One is bad luck, three is a structural deficit and the verdict says so. Both are exposed over MCP as `tt_blocked` and `tt_deficits`, since an agent hitting the same wall is exactly who should record it.

Classification is built. `tt failed <capability> <class> ["what you were trying to do"]` records why work was blocked — reasoning, knowledge, tool, permission, infrastructure, or reliability — and `tt deficits` reports the causes beside the count, so a capability blocked four times as a missing tool and once as a missing permission reads as one structural deficit and one incident rather than five of a kind. `tt_blocked` accepts the same classification over MCP.

Unbuilt: the classification is declared, not inferred — a person or agent says why work was blocked, and nothing yet reads the failure's own text to classify it. And the loop from "this cause recurs" to "propose the permanent upgrade" (§5/§10) is still a human step.

The tree already tells you to write a SKILL.md for anything you explain more than twice. Generalised, that rule is the governing principle of the whole project:

> **Repeated friction should become infrastructure.**

## 7. The ledger — shipped

Built. `frontier_snapshots` records every capability's state on each seed, written only when the state differs from the previous observation, so the table logs changes rather than runs. `tt ledger` lists the observations; `tt since [when]` compares two.

The entry that justified the table works:

```console
$ tt since
  frontier then: 13
  frontier now:  19
  gained:    Embeddings · Local Embeddings · nomic-embed-text
  emergent:  Model Routing · Offline Capable · Subagents
```

`emergent` is the column a per-component changelog cannot produce: those three became reachable although nothing providing them was added. Offline Capable was already provided by an agent that did not change — it flipped because its prerequisites were satisfied elsewhere. One embedding model was added; six capabilities moved.

Classification compares against the ids recorded in the snapshot rather than timestamps. `created_at > taken_at` looked equivalent and was not: `datetime('now')` resolves to the second, so two seeds inside the same second classified every addition as pre-existing.

`tt since` also distinguishes a fourth thing: **vocabulary**. A node the past observation never saw, everything supplying which the past observation did see, is Ambit having started to model a part of the system rather than the system having changed — the release that introduced action nodes, or a capability added to the curated tree that your existing tools already provide. Those are described and not counted, so `frontier_now` stays on the same basis as `frontier_then`. Without it, upgrading would have reported twenty-eight capabilities gained on a machine where nothing happened, which is exactly what this table exists not to do.

What remains from the original sketch: nothing writes evidence of *use*, so the ledger still cannot answer which capabilities are actually exercised. It does now record demonstrated reliability beside reach: each snapshot carries a `verified` count and an id→lifecycle map, so `tt since` reports a capability that stopped working as `diminished` (with `reason: verification failing`) while `frontier_now` stays flat — the check started failing, nothing was removed. The *use* half is the part still waiting on §4's executable verification.

## 7b. Affordance domains

The domain vocabulary was entirely software, so anything acting on the world collapsed into `meta`. `physical` now exists and infrastructure devices land there — a robot arm and a neural decoder seed and render alongside MCP servers.

`cognitive`, `institutional` and `economic` do not. They are the domains that make the [theory](./docs/affordance-frontier.md) more than a metaphor, and each needs more than a keyword: an institutional capability implies an authority holder, an economic one implies a budget and a counterparty. Adding the words without the structure would be worse than leaving them out.

Related and partly built: the distinction between human-gated, human-composed, and machine-composed-human capability. The first is approval, which §9 covers. The second now has somewhere to live — an action a person supplies is an `action` node like any other, so `tt spof` reports *only Kanav can do this* in the same breath as *only one MCP server supplies this*. The third, which a tight interface — a BCI being the extreme case — actually produces, has nothing.

## 8. A runtime adapter layer — partly built

`scripts/adapters/hermes.ts` reads a Hermes installation and contributes its capabilities to the same graph, with `AMBIT_RUNTIME` attributing them to a runtime node. Ids are deliberately not namespaced: a git MCP under either runtime is one capability with two providers, and the runtime edges keep that legible.

What building it surfaced, and what remains:

- Hermes exposes **authority as data** — `approvals.mode`, `approvals.cron_mode` — so §9 has a real source of truth to read rather than a schema to invent.
- Detection was tuned to one runtime's naming. Hermes names a model `Jan-v1-4B-Q4_K_M` where OpenCode names the runtime `ollama`; quantisation suffixes are now a local-weights signal.
- No runtime publishes a machine-readable capability surface. Reading another tool's private files works and is not the right contract. The durable version is an export the runtime owns.
- Both adapters read authority and could only print it. They now hand it to the engine in the same fragment they hand over their MCP servers, so what a runtime permits reaches the graph and can narrow what the model says an action is like in general.



Do not model "Claude has tool X, Hermes has tool Y". Model what each runtime *provides*, and let the graph decide which runtime can execute which step:

```
             send-email
          ╱      │       ╲
    Claude     Hermes    OpenCode
    connector  SMTP      MCP server
```

The point is durability. You stop maintaining a setup for one assistant and start maintaining a capability fabric that different intelligences attach to — which matters more each time the model landscape shifts.

## 9. Authority as a first-class edge — built, and enforces nothing

The server already refuses to create MCP entries because those entries contain commands that get executed, binds to loopback, and rejects foreign origins. That boundary should be **generalised, never weakened**.

Per capability:

```
OBSERVE  autonomous     EXECUTE   conditional
PLAN     autonomous     VERIFY    autonomous
SIMULATE autonomous     ESCALATE  autonomous

docker-container-management
  inspect: autonomous   recreate: confirm
  restart: autonomous   delete:   confirm
                        change_mount: forbidden
```

This is not guardrails instead of capability. Granular, legible authority is what makes it safe to grant a much larger total action surface — the agent can be given more precisely because the limits are explicit.

Built. Authority is a table, not a blob on a node: each grant records its mode, its source, its holder and its scope. `tt authority` splits reached capabilities into what may run unattended and what may not — Shell Execution is reached everywhere and still gated; Secret Management is forbidden outright.

Also built: authority derived from the runtime that would execute the step. Hermes states `approvals.mode` and `approvals.cron_mode`, Claude Code states `permissions.defaultMode`, and both adapters now pass them through. A runtime's grant is held against the runtime node and resolved through what it contributes, so a capability added in a later run cannot miss a grant recorded in an earlier one. Where the model and the runtime disagree the narrower wins and the report names which source narrowed it, since that is the half worth knowing. An unrecognised approval setting becomes `confirm`, never `autonomous`: guessing permissively would describe a system as freer to act than the runtime in front of it permits.

And the granularity the section asked for. The `docker-container-management` sketch above — inspect autonomous, recreate confirm, change_mount forbidden — is expressible now that a capability's contract actions are nodes with their own authority.

Unbuilt: nothing enforces any of this. Ambit describes authority, it does not mediate action. Scope is recorded and unchecked.

## 10. A second-generation MCP — partly built

Today's seventeen tools are analytical: they answer questions about the graph. The next set exposes a lifecycle:

```
cg_state  cg_can  cg_goal  cg_plan  cg_explain_plan
cg_propose_acquisition  cg_simulate_acquisition
cg_request_approval  cg_apply_step
cg_verify  cg_rollback
cg_report_failure  cg_record_outcome
cg_opportunities  cg_compound
```

`cg_simulate_acquisition` matters as much as `cg_plan`: showing the graph as it *would* be, before anything changes, is what makes approval meaningful rather than ceremonial.

Built, the two safe stages. `tt simulate <capability>` computes the frontier as it would be, against a copy of the state; its useful output is not the acquisition but what comes with it — a capability already provided and held back only by the prerequisite the change satisfies. On this machine, acquiring a vector store moves the frontier by two, because Retrieval is already supplied by an agent and waiting.

`tt propose <capability> [n]` drafts a reviewable acquisition: ordered steps, the alternative chosen and its cost and privacy consequences, the simulated result, stored in a `proposals` table. Choosing the hosted alternatives for Retrieval takes it from 25 minutes to 13, at a per-token bill and a data boundary — the trade-off stated rather than implied.

Every step carries an `inverse` that is null. That is the gate, not an omission: no step may execute without one, so nothing drafted today is applicable by construction.

Also built, both sides of the threshold except the act itself. Alternatives whose acquisition genuinely *is* a config change carry a declarative `config_patch`, and `inverseOf` derives the undo from it — removing what it adds, or restoring what it overwrites when the key already exists. Anything needing an installer or a running service gets no inverse, and null is a refusal rather than a gap: a proposal is `applicable` only when every step has one.

`tt approve <proposal> <person>` records approval as evidence against a `human:` node, so the ledger can later answer who authorised an expansion of the frontier. It refuses a name that is not a person in the graph — an approval has to come from someone accountable — and refuses to approve twice. Deliberately CLI-only and not exposed over MCP: an agent may draft and preview, but approval is the human's act and should not be reachable by the thing being approved.

`applicable` and `executable` are kept apart on purpose. The first says this proposal could be applied safely; the second says apply does not exist.

Built, with the two decisions made explicitly.

**Scope is configuration, structurally.** A step carries a declarative patch or it carries nothing; there is no field that holds a command, so no data file in this repository can cause something to be executed. That is the shape `addMcp` over HTTP had, and refusing it permanently is worth more than gating it.

**Approval stays in the terminal.** The write path is off the network entirely. A browser-reachable apply would reopen the surface this project spent its early work closing; the visualiser can display proposals without being able to authorise them.

`tt apply` refuses in this order: unknown proposal, already applied, not approved by a person, any step without an inverse, any step that is not a configuration change. It backs the file up before the first byte changes, writes, records the act against the approver, then verifies the goal — and if verification fails, rolls back automatically and reports the change as reversed rather than as a success.

`tt rollback` uses the stored inverse rather than the backup, because the inverse describes only what the proposal changed; restoring a whole backup would discard anything edited since.

An apply now re-seeds, so the graph reflects the change immediately rather than on the next manual seed — both on a successful apply and on the rollback that follows a failed verification, which is the "reversed" half of the same guarantee. The order that matters is enforced: the inverse is computed and stored before a step runs, verification promotes state only on evidence, and a failed apply runs its inverse automatically.

What remains: a capability with no declared check applies unverified, which is reported rather than hidden — the honest answer to "did this work" is "it cannot say". Refusing unverified applies outright would break the acquisition path for every capability whose recipe is not a check, so it stays a report until executable verification per recipe (§3's multi-step remainder) can back it.

Built: the surface is 31 tools where it was 17 analytical ones, adding `tt_verify`, `tt_evidence`, `tt_authority`, `tt_actions`, `tt_plan`, `tt_since`, `tt_ledger`, `tt_blocked` and `tt_deficits` — so an agent can ask whether a capability is real, whether it may act, what is missing, and record being blocked. Previously those existed only on the CLI, which meant the lifecycle was available to the human and not to the agent. `tt_actions` is the one an agent should reach for before acting: `tt_authority` answers at the capability grain, and permission is per action.

Unbuilt: everything that changes the world. No `apply_step`, `request_approval`, `simulate` or `rollback`. Ambit still only describes.

## 11. The visualiser becomes a negotiating surface — transport built

Ambit implements the state subset of [AG-UI](https://docs.ag-ui.com), the Agent-User Interaction protocol: `/api/events` streams `RunStarted` and `StateSnapshot` over SSE, and the client reloads when the graph changes underneath it. The immediate benefit is a view that does not go stale when a seed or an adapter rewrites the graph; the durable one is that the transport an agent would use to propose a change, and a human to approve it, already speaks a standard vocabulary rather than one invented here.

Not implemented: runs, messages, tool calls, reasoning events, and `StateDelta` (RFC 6902 patches). Snapshots are correct and this graph is small enough that patches would be an optimisation. Calling Ambit "AG-UI compatible" would overstate it — it implements a subset deliberately.

**A2UI was evaluated and rejected.** It is a generative UI specification: agents describe components and the front end renders them. Ambit's interface is a designed visual grammar — era columns, three states, dependency edges, a legend — and its legibility is the product. Letting an agent improvise components would replace a representation that was reasoned about with one that is generated per response. A2UI suits surfaces where the agent's output shape is unknown in advance; here it is known and deliberate.



Today it explains the graph to you. It should become where you and an agent agree on changes to your shared capability:

```
Autonomous Backup Recovery              readiness 73%

have     ✓ snapshots  ✓ NAS  ✓ scheduled agents  ✓ notifications
missing  ○ restore verification environment

why      lets the agent test backups instead of only creating them
setup    ~42 min
unlocks  unattended restore drills · disaster-recovery verification
         · storage-migration testing

[ Discuss ]  [ Simulate ]  [ Approve build ]
```

---

## What this is optimising

A conventional assistant optimises roughly:

```
utility = task_value − cost − risk
```

Ambit adds a fourth term and takes it seriously:

```
utility = task_value − cost − risk + λ · reusable_capability_created
```

That single change produces the behaviours worth having:

- *"I can do this by hand in 20 minutes, but 35 minutes spent building it as a capability makes every future instance nearly free."*
- *"Don't add another service — the Postgres node already does this with pgvector."*
- *"We have done this manually five times. It should be a skill."*
- *"This mini PC closes four current bottlenecks at once."*

The objective is not a bigger graph. It is:

> **Increase the frontier of reliably achievable goals per unit of human attention, money, risk, and infrastructure.**

## The loop

```
do real work → discover friction → identify the capability deficit
     ↑                                        │
     │                              find the cheapest reusable fix
     │                                        │
     │                              human + agent decide
     │                                        │
     │                              build / connect / acquire
     │                                        │
     │                              verify it
     │                                        │
     └──────── more becomes possible ◄── record it in the graph
```

## Honest status

Sections 1, 5, 6, 7 and 9 are built, with their remaining edges recorded under each. Sections 2, 3, 4, 8 and 10 have most of their substance built and a named remainder. Section 11 has its transport and none of its surface.

The through-line in what remains is enforcement and scope. Ambit can now say what may be done, by whom, to what, and on what evidence. It still cannot say *on which repository, in which workspace, within what budget*, and it does not stop anything.

The gap between this document and the README is deliberate. The README describes only what runs.
