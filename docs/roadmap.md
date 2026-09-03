> **Status: a design document, not a plan of record.**
>
> This is a long statement of intent with no dates, no owners and nothing that
> can close. It reads as a roadmap and functions as an essay. Items here that are
> actually going to be built belong in GitHub issues, where they can be
> assigned and closed; what remains is design rationale, which is why the file
> now lives in `docs/` beside the deep dive rather than at the repository root
> where it read as a commitment.

# Roadmap

Ambit today is a capability graph: it reads your configuration, places it on a curated tech tree, and answers questions about the structure — what is reached, what is one step away, what would break if a given thing disappeared.

That is a model of **what exists**. This document describes the move to a model of **what can be acquired**, and the loop that closes between the two.

Nothing below is implemented unless it appears in the README. Sections are ordered by dependency, not by date.

## Status at a glance

Each section below ends with what it still lacks. This is that ending, collected, so a reader deciding whether the project is real does not have to find it eleven times.

| § | Section | Status | What remains |
|---|---|---|---|
| 1 | Separate capability from implementation | built | `resource` is a kind with little behind it, and an action has no object: *read repo A* and *write repo B* are one node. |
| 2 | The human and the machines in the graph | partly built | Cost and risk tolerance are not modelled. The infrastructure manifest is read, not probed, so a device's reachability gates nothing. |
| 3 | Acquisition recipes | partly built | A recipe's multi-step verification is not executable; a check is one read-only command. |
| 4 | Detection becomes verification | built, and gates | Nothing enforces the gate. A failing check demotes a capability; nothing promotes one on evidence. |
| 5 | Goal → capability delta | partly built | A goal outside the known vocabulary has no route in, and whole-strategy alternatives have to be authored. |
| 6 | Failure becomes an input | built | The classification is declared, not inferred, and recurrence becoming a proposal is still a human step. |
| 7 | The ledger | shipped | Nothing writes evidence of *use*, so which capabilities are actually exercised is unanswered. |
| 7b | Affordance domains | built, derived | The map does not render the new domains as columns, and *environment* has no representation. |
| 8 | A runtime adapter layer | partly built | A runtime-owned capability surface exists as an export and a reader; no runtime publishes one yet. |
| 9 | Authority as a first-class edge | built, enforces nothing | Scope is checked and reported, not mediated. |
| 10 | A second-generation MCP | partly built | A capability with no declared check applies unverified, reported rather than refused. |
| 11 | The visualiser as a negotiating surface | built and shipping | Only the state and run subset of AG-UI; no tool-call or reasoning events, by design. |
| 12 | The long-running agent | built, except the install | The briefing, passive capture, the one-question contract, the curriculum, registered skills, promotion on evidence, the travelling ledger. What remains is §12.9: the package is not on the registry, so every path in still starts with a checkout. |

---

## Four layers

Ordered by ambition. Each is defensible on its own; each depends on the one above it.

| | | status |
|---|---|---|
| **1 · Inventory** | discover the capabilities implicit in configuration and infrastructure, model their dependencies, costs, and failure cascades | shipping |
| **2 · Assurance** | distinguish *configured* from *demonstrated* — `installed ≠ callable ≠ working ≠ reliable ≠ authorized ≠ appropriate` | shipping |
| **3 · Planning** | given a desired outcome, compute the capability delta and compare paths that close it | shipping (§5) |
| **4 · Reflexive infrastructure** | agents use the model to improve the environment they themselves operate in | shipping (§6–11) |

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

Once providers are separate, the comparison stops being between capabilities and becomes one between **ways of obtaining the same capability** — the comparison that actually matters when deciding what to build, and what `ambit goal --paths` and `ambit catalog` do today.

Built. Every node declares what kind of thing it is — `capability`, `action`, `provider`, `resource`, `actor`, `runtime` — and every edge declares what the relation means: `provides`, `contributes`, `requires`, `optional`, `authorizes`, `runs_on`. Authority and evidence are tables of their own. That is the six object types, with `goal` still absent because §5's free-form goals are.

The narrow half came first: the `provides` edges existed and no analysis consulted them, so every provider was treated as though it were the only one. `ambit impact` now asks whether anything else supplies a capability before calling its loss critical — removing one of three git providers reports `redundant · also provided by 2` where it previously reported `critical` four times over, once per edge. `ambit status` lists capabilities with exactly one provider, which is fragility; `ambit_bottlenecks` over MCP ranks leverage, which is the opposite reading.

Typing the edges was also a correctness fix rather than tidiness. `providersOf` matched three English sentences, so an adapter phrasing one differently dropped a provider out of both analyses with nothing failing: a capability with two providers still reported as a single point of failure.

Action-level capabilities are built. A tech-tree node may declare `contract.can`, and each entry becomes an `act:<node>/<action>` node conferred by the capability and carrying its own authority — so the model can now say *may read the repository, may not merge to its default branch*, which is the distinction the coarse node could not make. Ten nodes declare a contract; the rest behave exactly as before.

The id rework was avoided rather than done, deliberately. Every id appears in the ledger's stored snapshots, so re-iding would invalidate the history of the one component whose value is that its history is continuous. Kind is a column instead, existing databases migrate by `ALTER TABLE` and a one-time backfill, and `ambit status`, `ambit impact`, `ambit goal` and `ambit history` return byte-identical output against a graph seeded by the previous version. The cost is that an id no longer tells you what it is, and callers must read the column.

Scope is now checked rather than merely recorded. `ambit authority scope <target>` — `repo:owner/name`, `device:nuc`, `svc:ollama` — lists every authority grant, whether its scope covers the target, and the effective mode the covering grants resolve to. Scope is a prefix claim: `repo:owner/name` covers the repo and its branches, a grant scoped elsewhere is named as excluded rather than silently treated as covering. What remains: nothing *mediates* on the scope — the check is a report, not a gate, which is the same line every enforcement half of this roadmap sits behind.

Also built: `credential`, and the correction it exists for. Redundancy was counted by provider, so three things supplying one capability read as threefold redundancy — and if all three present the same token, one revocation takes them down together. Ambit called such a capability robust and, because having several providers is what kept it out of the single-point-of-failure report, excluded it by the very fact that made it fragile. A `uses` edge records what a provider authenticates with; `ambit status` lists such a capability among its spofs, `ambit impact` calls the survivors `nominal` rather than `redundant`, and `ambit credentials` answers what a revocation would end. The intersection, not the union: providers holding `{A}`, `{A,B}` and `{B}` survive losing either, and reporting that as fragile would be the same error inverted.

A credential node holds an identity and never a secret — there is no field one could arrive in. And because nothing *provides* a credential, the ledger's vocabulary rule could not catch it: a new node with no providers classifies as `gained`, so declaring three credentials on an unchanged machine would have read as three capabilities acquired. Credentials are excluded from the frontier by kind, which leaves every existing kind counted exactly as before and keeps a snapshot taken now comparable with one taken before they existed.

`resource` is still a kind without much behind it: a model and a machine are both resources, and nothing yet reasons about capacity, location or contention. The deeper gap it points at is that an action has no object: `act:version-control/commit` is a verb the model cannot attach to a repository, so *read repo A* and *write repo B* are one node. Scope checks a grant against a target string; it does not give the action a target of its own.

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

Built: an `actors` block seeds people as nodes. `provides` becomes a capability only that person supplies; `authorizes` becomes a hard prerequisite edge, so `ambit goal continuous-delivery` reports `requires_person: Kanav` rather than presenting the path as autonomous. Approval is a dependency, not a policy note.

Preferences are built. A person may declare how they like things done — `prefers: [local-when-practical, minimize-recurring-cost]` — stored as data and matched by `ambit goal` against the alternatives a step's acquisition actually offers. Where the plan's default choice fights a stated preference, the plan names it and points at the alternative that matches: asking Kanav to approve a hosted, recurring CI default when they prefer local and one-off reads as if there is no choice, and the plan refuses to read that way. `ambit goal --prefs [who]` lists the declarations.

Machines are now capability-bearing in the engine, not only in the visualiser. `INFRA_MANIFEST` devices seed as `resource` nodes with `runs_on` edges to the services hosted on them, so `ambit impact device:nuc` answers what actually breaks when the machine disappears, and a plan can point at capacity the graph can count.

Every human act is recorded and counted. `ambit digest` measures how much of the work still runs through the person — approvals, applications, permission blocks, failed checks — and names the reducible ones: the same approval demanded repeatedly is infrastructure shaped like a person, and the report says to grant the authority once. `ambit notify <topic>` pushes that digest to ntfy, and only when a topic is given — the attention loop is opt-in and local-first, a single POST of the digest text. This is the first turn of "repeated demands on human effort become evidence about what the system should learn to do without the human."

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

Built: seven capabilities carry `acquisition.alternatives`, and `ambit goal` attaches them to each step. Alternatives rather than one blessed answer, because the trade-off is rarely setup time — the hosted embedding API is three minutes against ten and costs money and a data boundary, and the plan says so.

The contract is built. `contract.can` lists the actions a capability confers, ten nodes declare one, and each action is a node with its own authority — `ambit authority version-control` reports that reading the repository and committing may happen unattended and that pushing a branch and merging to the default branch may not.

Built: executable verification per contract action. A contract entry may be a name or `{ id, verify }`, and `ambit verify act:<capability>/<action>` runs the action's own check against the action node — reading a repository is a weaker claim than having read a particular repository, and the two now carry separate evidence. `ambit verify` with no argument runs every declared node check and every action check; `ambit verify <capability>` still answers "no check declared" rather than erroring.

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

Built: nodes may declare a read-only `verify` command; `ambit verify` runs it and records the outcome in `session_learning`, which had carried the right columns since the first schema and had no writer. `ambit verify <id> --history` returns the history, and reliability is reported as passes over runs — one success is a weaker claim than forty-seven of fifty. Eight nodes declare a check today.

Checks execute, so they live in this repository, are read-only by construction, and run only when asked. Nothing verifies on seed.

The lifecycle is built and stored. `capabilities.lifecycle` holds `unknown`, `detected`, `configured`, `verified`, `reliable`, `degraded` or `broken`, derived on seed and after each verification from providers and recorded evidence — five runs with the last five passing is `reliable`, one passing run is `verified`, and a check that has started failing is `broken`.

`state` is untouched beside it, deliberately: `state` is what every frontier snapshot records, so repurposing it would break the ledger to answer a question the ledger does not ask. A capability whose check fails is therefore `broken` and still in the frontier — reachable and working are different columns, and collapsing them would lose the distinction this section exists to make.

Promotion on evidence is built, at the grain where it changes what happens: §12.6. A person sets a threshold on a grant once — *stop asking me about this after three passing checks in thirty days* — and the evidence decides when it takes effect. A single failing check afterwards puts the grant back, and that half needs nobody. The lifecycle itself still only moves on the evidence of its own check, which is what it should do.

Unbuilt: the gate is read at the decision surfaces — plans, simulations, authority, near-miss and bottleneck analyses — but nothing enforces it. Ambit describes availability and permission; it does not mediate action, and the check whose failure flips a capability to `broken` still has to be re-verified by hand.

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

Built for the narrow case: `ambit goal <capability>` walks hard prerequisites depth-first and returns them in the order they must be closed, with an estimate.

```console
$ ambit goal offline-capable
  goal: Offline Capable · steps: 2 · estimated setup: 25m
  1. Embeddings        10m
  2. Local Embeddings  15m
```

The route in is built. The curated tree carries a `goal` vocabulary — the intent-side mirror of `detect`, which matches config ids: `detect` says "a git MCP named X is Version Control", `goal` says "a person wanting to *deploy without me* means Continuous Delivery and Scheduled Work". `ambit goal <sentence>` ranks every capability whose words appear in the sentence, each with its plan delta, so a free-form goal becomes a shortlist of concrete plans rather than an error:

```console
$ ambit goal "maintain the homelab unattended"
  recommended: Scheduled Work
  Scheduled Work       unattended          → steps 3 · 50m
  Observability        maintain           → steps 1 · 30m
  Self-Hosted Stack    homelab            → steps 2 · 2.5h
```

`ambit goal <capability> --paths` compares the alternative ways to close the gap, deriving risk from what the alternatives themselves carry — hosted moves data off the machine, recurring adds a bill, a step without a config patch cannot be undone by §10 — and folding identical paths together so the list is of choices, not accidents:

```console
$ ambit goal web-research --paths
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

Built. `ambit record <capability>` records that work was blocked by something missing, and `ambit status` reports which deficits recur. One is bad luck, three is a structural deficit and the verdict says so. Both are exposed over MCP as `ambit_blocked` and `ambit_deficits`, since an agent hitting the same wall is exactly who should record it.

Classification is built. `ambit record <capability> <class> ["what you were trying to do"]` records why work was blocked — reasoning, knowledge, tool, permission, infrastructure, or reliability — and `ambit status` reports the causes beside the count, so a capability blocked four times as a missing tool and once as a missing permission reads as one structural deficit and one incident rather than five of a kind. `ambit_blocked` accepts the same classification over MCP.

Inference is built, from the signals rather than from the prose: §12.2. A runtime already states that a command was not found, that permission was denied, that a host was unreachable, that an MCP call returned an error kind — and the telemetry bridge hands those over for classification, so the ledger fills from work instead of from someone remembering to record it. A failure whose shape says nothing is left unclassified rather than guessed at, and one that cannot be attributed to a capability is kept anyway, since "this keeps failing and the model cannot name it" is a finding about the model.

Unbuilt: the loop from "this cause recurs" to "propose the permanent upgrade" (§5/§10) is still a human step, deliberately — `ambit next` ranks the recurrences and drafts nothing until someone chooses.

The tree already tells you to write a SKILL.md for anything you explain more than twice. Generalised, that rule is the governing principle of the whole project:

> **Repeated friction should become infrastructure.**

## 7. The ledger — shipped

Built. `frontier_snapshots` records every capability's state on each seed, written only when the state differs from the previous observation, so the table logs changes rather than runs. `ambit history` lists the observations, and `ambit history since [when]` compares two.

The entry that justified the table works:

```console
$ ambit history since
  frontier then: 13
  frontier now:  19
  gained:    Embeddings · Local Embeddings · nomic-embed-text
  emergent:  Model Routing · Offline Capable · Subagents
```

`emergent` is the column a per-component changelog cannot produce: those three became reachable although nothing providing them was added. Offline Capable was already provided by an agent that did not change — it flipped because its prerequisites were satisfied elsewhere. One embedding model was added; six capabilities moved.

Classification compares against the ids recorded in the snapshot rather than timestamps. `created_at > taken_at` looked equivalent and was not: `datetime('now')` resolves to the second, so two seeds inside the same second classified every addition as pre-existing.

`ambit history` also distinguishes a fourth thing: **vocabulary**. A node the past observation never saw, everything supplying which the past observation did see, is Ambit having started to model a part of the system rather than the system having changed — the release that introduced action nodes, or a capability added to the curated tree that your existing tools already provide. Those are described and not counted, so `frontier_now` stays on the same basis as `frontier_then`. Without it, upgrading would have reported twenty-eight capabilities gained on a machine where nothing happened, which is exactly what this table exists not to do.

What remains from the original sketch: nothing writes evidence of *use*, so the ledger still cannot answer which capabilities are actually exercised. It does now record demonstrated reliability beside reach: each snapshot carries a `verified` count and an id→lifecycle map, so `ambit history` reports a capability that stopped working as `diminished` (with `reason: verification failing`) while `frontier_now` stays flat — the check started failing, nothing was removed. The *use* half is the part still waiting on §4's executable verification.

## 7b. Affordance domains

The domain vocabulary was entirely software, so anything acting on the world collapsed into `meta`. `physical` now exists and infrastructure devices land there — a robot arm and a neural decoder seed and render alongside MCP servers.

`cognitive`, `institutional` and `economic` are built as **derived** domains, not keywords. `ambit graph affordances` (and `ambit_affordances` over MCP) reads each capability's domain off its structure: *institutional* when an actor authorises it (an authority holder must exist for it to be acquirable), *economic* when its acquisition carries a recurring cost (a budget and a counterparty are implied), *cognitive* when a person supplies it (human cognition is necessary to produce the action), *physical* when a provider runs on a device. A capability can satisfy several — Continuous Delivery is institutional *and* economic, and both are named.

Related and built: the distinction between human-gated, human-composed, and machine-composed-human capability. The first is approval, which §9 covers. The second has somewhere to live — an action a person supplies is an `action` node like any other, so `ambit status` reports *only Kanav can do this* in the same breath as *only one MCP server supplies this*. The third is now named: a capability supplied by both a person and a machine reads as `machine-composed-human`, the theory's BCI case given a structural home.

Unbuilt: the visualiser does not render the new domains as columns — the era grammar is deliberately designed, and adding three columns to make the point would be design work, not model work. And the theory's *environment* term — an affordance holding in one workspace and not another — still has no representation.

## 8. A runtime adapter layer — partly built

`scripts/adapters/hermes.ts` reads a Hermes installation and contributes its capabilities to the same graph, with `AMBIT_RUNTIME` attributing them to a runtime node. Ids are deliberately not namespaced: a git MCP under either runtime is one capability with two providers, and the runtime edges keep that legible.

What building it surfaced, and what remains:

- Hermes exposes **authority as data** — `approvals.mode`, `approvals.cron_mode` — so §9 has a real source of truth to read rather than a schema to invent.
- Detection was tuned to one runtime's naming. Hermes names a model `Jan-v1-4B-Q4_K_M` where OpenCode names the runtime `ollama`; quantisation suffixes are now a local-weights signal.
- No runtime publishes a machine-readable capability surface. Reading another tool's private files works and is not the right contract. The durable version is an export the runtime owns — and the export now exists: `ambit graph surface` emits the graph's whole vocabulary (nodes by kind, edges by meaning, authority grants) in a schema-versioned manifest, and `scripts/adapters/surface.ts` consumes one, so a runtime that publishes a surface is read directly and file-parsing is only the fallback. The round-trip works, which is how the contract gets exercised before any other runtime adopts it.
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

Built. Authority is a table, not a blob on a node: each grant records its mode, its source, its holder and its scope. `ambit authority` splits reached capabilities into what may run unattended and what may not — Shell Execution is reached everywhere and still gated; Secret Management is forbidden outright.

Also built: authority derived from the runtime that would execute the step. Hermes states `approvals.mode` and `approvals.cron_mode`, Claude Code states `permissions.defaultMode`, and both adapters now pass them through. A runtime's grant is held against the runtime node and resolved through what it contributes, so a capability added in a later run cannot miss a grant recorded in an earlier one. Where the model and the runtime disagree the narrower wins and the report names which source narrowed it, since that is the half worth knowing. An unrecognised approval setting becomes `confirm`, never `autonomous`: guessing permissively would describe a system as freer to act than the runtime in front of it permits.

And the granularity the section asked for. The `docker-container-management` sketch above — inspect autonomous, recreate confirm, change_mount forbidden — is expressible now that a capability's contract actions are nodes with their own authority.

Unbuilt: nothing enforces any of this. Ambit describes authority, it does not mediate action. Scope is recorded and unchecked.

## 10. A second-generation MCP — partly built

Today's seventeen tools were analytical: they answered questions about the graph. The next set exposes a lifecycle:

```
cg_state  cg_can  cg_goal  cg_plan  cg_explain_plan
cg_propose_acquisition  cg_simulate_acquisition
cg_request_approval  cg_apply_step
cg_verify  cg_rollback
cg_report_failure  cg_record_outcome
cg_opportunities  cg_compound
```

`cg_simulate_acquisition` matters as much as `cg_plan`: showing the graph as it *would* be, before anything changes, is what makes approval meaningful rather than ceremonial.

Built, the two safe stages. `ambit goal <capability> --simulate` computes the frontier as it would be, against a copy of the state; its useful output is not the acquisition but what comes with it — a capability already provided and held back only by the prerequisite the change satisfies. On this machine, acquiring a vector store moves the frontier by two, because Retrieval is already supplied by an agent and waiting.

`ambit propose <capability> [n]` drafts a reviewable acquisition: ordered steps, the alternative chosen and its cost and privacy consequences, the simulated result, stored in a `proposals` table. Choosing the hosted alternatives for Retrieval takes it from 25 minutes to 13, at a per-token bill and a data boundary — the trade-off stated rather than implied.

Every step carries an `inverse` that is null. That is the gate, not an omission: no step may execute without one, so nothing drafted today is applicable by construction.

Also built, both sides of the threshold except the act itself. Alternatives whose acquisition genuinely *is* a config change carry a declarative `config_patch`, and `inverseOf` derives the undo from it — removing what it adds, or restoring what it overwrites when the key already exists. Anything needing an installer or a running service gets no inverse, and null is a refusal rather than a gap: a proposal is `applicable` only when every step has one.

`ambit approve <proposal> <person>` records approval as evidence against a `human:` node, so the ledger can later answer who authorised an expansion of the frontier. It refuses a name that is not a person in the graph — an approval has to come from someone accountable — and refuses to approve twice. Deliberately CLI-only and not exposed over MCP: an agent may draft and preview, but approval is the human's act and should not be reachable by the thing being approved.

`applicable` and `executable` are kept apart on purpose. The first says this proposal could be applied safely; the second says apply does not exist.

Built, with the two decisions made explicitly.

**Scope is configuration, structurally.** A step carries a declarative patch or it carries nothing; there is no field that holds a command, so no data file in this repository can cause something to be executed. That is the shape `addMcp` over HTTP had, and refusing it permanently is worth more than gating it.

**Approval stays in the terminal.** The write path is off the network entirely. A browser-reachable apply would reopen the surface this project spent its early work closing; the visualiser can display proposals without being able to authorise them.

`ambit apply` refuses in this order: unknown proposal, already applied, not approved by a person, any step without an inverse, any step that is not a configuration change. It backs the file up before the first byte changes, writes, records the act against the approver, then verifies the goal — and if verification fails, rolls back automatically and reports the change as reversed rather than as a success.

`ambit rollback` uses the stored inverse rather than the backup, because the inverse describes only what the proposal changed; restoring a whole backup would discard anything edited since.

An apply now re-seeds, so the graph reflects the change immediately rather than on the next manual seed — both on a successful apply and on the rollback that follows a failed verification, which is the "reversed" half of the same guarantee. The order that matters is enforced: the inverse is computed and stored before a step runs, verification promotes state only on evidence, and a failed apply runs its inverse automatically.

What remains: a capability with no declared check applies unverified, which is reported rather than hidden — the honest answer to "did this work" is "it cannot say". Refusing unverified applies outright would break the acquisition path for every capability whose recipe is not a check, so it stays a report until executable verification per recipe (§3's multi-step remainder) can back it.

Built: the surface is 55 tools where it was 17 analytical ones, adding `ambit_verify`, `ambit_evidence`, `ambit_authority`, `ambit_actions`, `ambit_plan`, `ambit_since`, `ambit_ledger`, `ambit_blocked` and `ambit_deficits` — so an agent can ask whether a capability is real, whether it may act, what is missing, and record being blocked. Previously those existed only on the CLI, which meant the lifecycle was available to the human and not to the agent. `ambit_actions` is the one an agent should reach for before acting: `ambit_authority` answers at the capability grain, and permission is per action.

Unbuilt: everything that changes the world. `ambit_simulate` and `ambit_propose` exist; there is no `apply_step`, `request_approval` or `rollback` over MCP, and that is a decision rather than a gap (§10's second paragraph above). Ambit still only describes.

## 11. The visualiser becomes a negotiating surface — built and shipping

Ambit implements the state and run subset of [AG-UI](https://docs.ag-ui.com), the Agent-User Interaction protocol: `/api/events` streams `RunStarted`, a `StateSnapshot` on connect, and — when the graph changes underneath the view — a `StateDelta` of RFC 6902 patches plus a `TextMessageChunk` narrating the change. The client reloads when the graph changes. The immediate benefit is a view that does not go stale when a seed or an adapter rewrites the graph; the durable one is that the transport an agent would use to propose a change, and a human to approve it, already speaks a standard vocabulary rather than one invented here.

`StateDelta` is the protocol's reason for existing: a patch is smaller than a snapshot, and a client that kept the connect snapshot can apply it. The delta is emitted for every change after the initial snapshot, so the transport is honest about what changed rather than resending the whole graph.

The visual negotiating surface is shipping:
1. **Simulation on the canvas.** *Simulate an outage* dims the map and draws the multi-hop cascade in red with a count of what stops working; *Simulate unlocking this* lights what becomes reachable in green. Neither writes anything.
2. **Approval in one click.** The Proposals panel shows what an agent drafted, whether every step has an inverse, and signs a receipt; applying stays a command the person runs.
3. **Three lenses**, switched on the map itself: Standard, Attention (nodes warmed by how often a person had to step in) and Shared credentials. The host-cluster lens was sunset with the 3D views.

Not implemented: tool calls and reasoning events. Ambit does not execute agent steps — it models the environment those steps would run in — so fabricating a tool-call or reasoning stream would be noise in the protocol's own vocabulary. Calling Ambit "AG-UI compatible" would still overstate it; it implements the state and run subset deliberately.

**A2UI was evaluated and rejected.** It is a generative UI specification: agents describe components and the front end renders them. Ambit's interface is a designed visual grammar — era columns, three states, dependency edges, a legend — and its legibility is the product. Letting an agent improvise components would replace a representation that was reasoned about with one that is generated per response. A2UI suits surfaces where the agent's output shape is unknown in advance; here it is known and deliberate.

## 12. The long-running agent — built, except the install

Everything above assumes someone asks. A long-running agent — one that works with the same person across weeks, on more than one machine, and wants to become more capable — does not ask. It hits a missing binary mid-task, works around it, and hits it again next week. Ambit's thesis is exactly that agent's loop: friction, deficit, acquisition with approval, verification, a larger action space. What is missing is the plumbing that puts Ambit in front of the agent at the moment friction happens, and that turns growth into something the person can grant rather than something the agent has to request each time.

Each part below states what it is, the interface, the data it reads or writes, and the test that says it is done. All but the last are built, and their acceptance tests are in `src/engine/agent-loop.test.ts` and `src/mcp/server.test.ts` rather than in this document.

### 12.1 The session briefing — built

**What.** Twenty lines the agent has before its first tool call, without asking: what is reached, what is failing, what is one step away, what is waiting for approval, and what the last session recorded as blocked.

**Interface.** An MCP *resource*, `ambit://briefing`, alongside the tools, since a resource is what a runtime reads at connect and a tool has to be thought of first. The same text from `ambit briefing` on the CLI, `--json` for a runtime that wants the fields, and `--peek` for a look that does not move the "since last briefing" mark. The README documents the Claude Code `SessionStart` hook that injects it; OpenCode reads the resource, so it has no plugin event of its own. The briefing is prose with ids, not YAML: an agent quotes it, a person skims it.

**Data.** Read-only over what exists, except for the mark: `capabilities` (state, lifecycle), `proposals` (drafts), `session_learning` (the week's deficits), `failure_signals`, and the frontier delta since the previous briefing (§7). Reading it also applies any authority threshold whose evidence now supports it (§12.6) — asking what the environment is like is the right moment for a promotion someone already authorised to take effect.

**Done when.** A fresh agent session on a seeded machine can answer "what can you do here, what is broken, what is waiting on me" before running anything, and the briefing is under 1,200 tokens on a 200-node graph. Both are asserted; the cap is enforced by trimming whole lines from the bottom, since the order is the order of usefulness.

### 12.2 Passive deficit capture — built

**What.** The ledger fills without anyone recording anything. Today `ambit record` and `ambit_blocked` exist and the README warns that the economic commands are useless on install because nothing has been observed. The tracker plugin records configuration changes; the telemetry plugin records tool executions and permission prompts. Neither records *failure*.

**Interface.** The telemetry bridge reports a failed tool execution and the engine classifies it — `command not found`, `EACCES`, `ECONNREFUSED`, a 401, an MCP error kind, exit 127 — into the classes §6 already defines. The bridge gathers and never decides: a bridge that made its own judgement about what counts as a permission error would be a second copy of that rule, and the two would disagree within a release. The same classifier serves `POST /api/telemetry` with a `failure` body and the `ambit_record_failure` tool, so an agent can report a failure it just hit without a bridge at all. A failure whose shape says nothing — a test that failed, a type error — is left alone: those are work going wrong, not capability deficits, and counting them would drown the signal.

**Data.** Two writes, deliberately. Every signal goes to `failure_signals` with its class, the tool and the raw text, so the unattributed count is honest. A signal Ambit can attribute — by the MCP tool's own server name, or by the curated model's `detect` vocabulary, which is the same matching that turns a config file into a graph — also writes the `session_learning` row the deficit reports already read, so nothing downstream had to change.

**Done when.** A session that fails three times on the same missing capability shows that deficit in `ambit status` and in the next briefing with nobody recording anything, and a failure that cannot be attributed is still counted and named in `ambit signals`.

### 12.3 One question before acting — built

**What.** The habit worth teaching an agent is a single call before any tool it has not used this session: may I, unattended or with confirmation, and if not, what is missing. `ambit_can` and `ambit_actions` exist; what does not is the contract that makes calling them cheap enough to be automatic.

**Interface.** `ambit_can` answers in one round trip with a `verdict` of exactly `yes`, `ask` or `no`, a `reason` written as a sentence an agent can repeat to a person, and `missing` on the branch where the answer is no because something is not there. `decision` stays as ALLOW / CONFIRM / DENY, because that is the right vocabulary for the control plane and the wrong one for a question asked fifty times a session. Nothing is probed and nothing runs: the answer is three indexed reads. The snippet ships in the README and in `llms.txt`, and the `no` branch records the deficit in the same call, so the habit costs one round trip rather than two.

**Data.** Reads `authority`, `lifecycle`, and the capability's unmet hard prerequisites. Writes through §12.2 on a `no`, which is reported back as `recorded_deficit` so the agent knows it does not need to record it again.

**Done when.** The three verdicts come back from a graph with an autonomous, a confirm and a forbidden grant; a forbidden answer tells the agent in words not to retry it under another name; and a refusal over MCP arrives with the deficit already filed.

### 12.4 A curriculum, not a frontier — built

**What.** `ambit goal` answers *how do I reach X*. A pair that wants to grow asks *what should we reach next, and why*. `ambit opportunities` answers that once the ledger has data; on a cold start it has nothing to rank by. The tree already knows leverage (how much sits downstream, keystones) and cost (setup seconds); nothing surfaces the three best next steps with a reason a person would accept.

**Interface.** `ambit next` and `ambit_next`: three capabilities, each with *why* (what it unlocks, in names), *cost* (setup time, the cheapest catalogued option's recurring bill and privacy consequence), and the `ambit propose` command that would draft it. Not a drafted proposal — answering "what next" by writing three proposal rows every time someone asks a question is how a table fills with documents nobody chose. Ranking uses observed blocks when the ledger has them and leverage per hour of setup when it does not, and says which. Only capabilities one acquisition away are offered; anything further is a project, and `ambit goal` is where projects live. It is what the briefing shows after what is broken.

**Done when.** On a freshly seeded machine `ambit next` returns three reachable, unreached capabilities with plain-language reasons and says its basis is structural; after four recorded blocks on one of them, the same command puts it first and says its basis is observed.

### 12.5 The agent's own growth on the map — built

**What.** Ambit maps tools, servers and models. A long-running agent grows mostly through what it writes for itself: skills, memory, procedures it has proven. Those are the Skill Library and Persistent Memory nodes of the curated tree, and today they are reached when a directory exists, not when it contains anything the agent made.

**Interface.** `ambit record skill:<name> --provides=<capability> --verify="<read-only check>"`, and `ambit_register_skill` over MCP. The check is required and is refused if absent: an unverifiable claim of new capability is the exact failure this project exists to prevent, and it is worst coming from the agent whose reach it widens. It runs immediately, so a registration arrives either proven or honest about failing. `ambit skills` lists what has been registered and what each check last said.

**Data.** A provider node plus a `provides` edge to the capability it supplies, and a row in `declared_checks` carrying the command and the runtime that registered it. Lifecycle derivation now covers anything with a declared check, whatever its kind, so a registered skill degrades on a failing check exactly as a curated capability does.

**Done when.** A registration with no check is refused; one with a passing check appears in `ambit skills` attributed to the runtime that registered it, verifies by name, and moves to `verified`; one whose check fails says so rather than reporting success.

### 12.6 From evidence to authority — built

**What.** The person widens what runs unattended when there is proof it works. §4 records evidence and §9 records authority in separate tables, and nothing connects them: a capability can pass fifty checks and stay at `confirm` forever. This is the piece that makes *become more capable* something the person grants on evidence rather than something the agent argues for each time.

**Interface.** `ambit authority promote <capability> <action> --after=N --window=30d --by=<person>`. It refuses a person who is not in the graph, the same rule approval follows, and refuses a threshold below two, because one passing run is not a pattern. A forbidden grant is refused outright: a threshold on `forbidden` would be a mechanism for talking a system into what it was told not to do. Thresholds are applied wherever evidence changes or is read — after a verification, and when the briefing is composed — so a promotion never waits for someone to run a command named "promote", which is the confirmation prompt it was meant to replace. CLI only, like approve: an agent can read `ambit_promotions` and can never set one.

**Data.** `authority` gains `promote_after`, `promote_window_days`, `promote_set_by`, `promoted_at` and `promoted_on_evidence`; each transition writes a `session_learning` row. Demotion compares against the row id recorded at promotion, not the timestamp: `datetime('now')` resolves to the second, so a check failing in the same second would have compared as "not after it" and the demotion would silently never have happened.

**Done when.** A threshold set once promotes the grant when the evidence arrives and `ambit_can` starts answering `yes`; a single failing check puts it back to `ask` with nobody asked; and failures inside the window hold the promotion rather than being outvoted by passes.

### 12.7 The digest as heartbeat — built into the briefing

**What.** `ambit digest` and `ambit notify` exist and are optional. What keeps a person running the tool, and what gives an agent something to cite, is a short, regular account: *this week the system gained twelve reachable capabilities, three emerged from combination, you were interrupted forty fewer times, two grants were promoted on evidence.*

**Interface.** Built into the briefing rather than beside it. Every briefing carries what changed since the last one — gained, emergent, diminished, and any grant that widened or narrowed on evidence — so the account arrives in the place both parties already read, and the mark moves when it is read rather than on a schedule. The existing `ambit digest` and `ambit notify <topic>` are unchanged for the person who wants it pushed.

**Done when.** A briefing after a week of work names what was gained, what emerged from composition rather than acquisition, and what authority changed, and every line of it can be reproduced with one command.

### 12.8 A ledger that travels — built

**What.** A long-running agent lives in containers that reset and on more than one host. The graph and ledger are one SQLite file in one place, and `federation export|import` moves signed aggregates for a portfolio view, not the working state.

**Interface.** `ambit sync export <path>` writes the graph and the ledger as one file against an explicit table and column allow-list, and `ambit sync import <path>` merges by id and timestamp rather than overwriting — capabilities take the newer of the two, observations already present are skipped, so importing the same file twice changes nothing.

Two things are deliberately absent from the file. **Commands**: a registered skill's check is a command, and a command that travels in a data file is a command that runs on the machine importing it. The skill arrives as a node with its evidence, and the file names it as needing its check re-registered locally. **Authority**: a grant states what may run unattended *here*, and importing one would let a permissive machine widen a careful one by moving a file, which inverts the direction authority is supposed to travel.

**Done when.** A machine that imports another's file reports the same deficits, importing it again is a no-op, and a grant that is autonomous on the exporting machine is still `ask` on the importing one.

### 12.9 One line to install — unbuilt

**What.** An agent that decides Ambit would help cannot act on that until the package exists. Every path today is a git checkout.

**Interface.** `claude mcp add ambit -- npx -y ambit-cli mcp`, and the equivalent OpenCode entry, working on a machine with Node and nothing else. The publish workflow exists and waits on a token.

**Done when.** The README's *connect it to your agent* section has no clone step, and the CI job that refuses to advertise the npm package is removed because the package is on the registry.

### What §12 adds up to

```
session starts → briefing (12.1) → agent asks before acting (12.3)
      ↑                                       │
      │                          no → deficit recorded (12.2)
      │                                       │
      │                          recurs → next (12.4) → propose → approve
      │                                       │
      │                          acquire → verify → registered (12.5)
      │                                       │
      │                          evidence accrues → authority widens (12.6)
      │                                       │
      └────── digest says what changed (12.7), on every machine (12.8)
```

The arrows exist now. What does not is §12.9: until the package is on the registry, an agent that decides Ambit would help still cannot act on that decision without a checkout, which is the one remaining reason this loop stays a thing you set up rather than a thing you install.

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

## The economic half

The loop above is the graph half, and it is built. The loop that pays for it is now built too, first turn:

```
real work happens → the work ledger observes (runs, events, interventions,
consumption) → attention prices the human burden → opportunities ranks the
durable fixes → propose carries the observed case → the approval broker mints
a signed, expiring artifact → apply enforces canExecute and verifies → roi
measures before/after and writes the observation back
```

What exists: the work ledger and its AG-UI ingestion, the attention report
that never flags judgment, the economic model (dollars declare, cents store),
the opportunity engine ranked by attention/cash/roi/reliability/frontier,
economic proposals, the signed approval broker with browser approval, the
capital allocator (`opportunities --budget N`), the acquisition catalog (the
supply side for the demand the opportunity engine finds), realized ROI, and a
federation skeleton of signed summaries. What does not yet: the marketplace —
deliberately, until real observed demand fills the catalog.

## Sunset

Anything that told you something interesting about the graph without changing
what you should do is not a first-class feature. The 3D visualiser, `trend`,
`recs`, `fork`, `insight`, `profile`, `prune`, the setup/token `budget`, the
consultant/snapshot/trending stores, and `maturity_score` as a headline are
gone or demoted. The CLI is a handful of operating verbs — `status`, `graph`,
`goal`, `attention`, `notify`, `impact`, `verify`, `authority`, `history`,
`propose`, `approve`, `apply`, `rollback`, `record` — with everything else a
view inside them. What stays is what establishes truth, measures dependence,
supports decisions, and governs change.

## Honest status

Sections 1, 5, 6, 7, 9 and 11's state stream are built, with their remaining edges recorded under each. Sections 2, 3, 4, 8 and 10 have most of their substance built and a named remainder. Section 12 is built but for the npm publish it waits on, and it is the part that decides whether a long-running agent ever reaches for the rest: a briefing it does not have to ask for, deficits recorded from failures the runtime already reported, one cheap question before acting, and authority that widens on evidence a person set the price of in advance.

The through-line in what remains is enforcement and objects. Ambit can now say what may be done, by whom, with what, on what evidence, and — since scope became checkable — whether a grant covers a given target. It still does not stop anything, and the target is a string the grant is compared against rather than something the action holds.

That last distinction is the next architectural move, and it is not another object type: the object types are largely in place. What none of them expresses is that an action has no object. Every entry on the list the graph will eventually need — read repo A, write repo A, open PR, merge PR, deploy service B, restart container C, query database D read-only — is a verb bound to a noun, and Ambit has only the verbs. Once actions carry objects, authority and evidence can refer to them per object, and the era tree stops being the ontology and becomes what it should be: a rollup over affordances, with *Version Control* derived from `{read, commit, push, merge}` over the repositories that actually exist.

The economic half above is built through its first turn — the work ledger prices attention, the opportunity engine ranks the durable fixes, and realized ROI writes the verdict back. What it has not yet had is a long enough run of real observations to be worth trusting: those reports start empty and become useful after weeks of recorded work, not on install.

The gap between this document and the README is deliberate. The README describes only what runs.
