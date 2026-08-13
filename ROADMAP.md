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
| **2 · Assurance** | distinguish *configured* from *demonstrated* — `installed ≠ callable ≠ working ≠ reliable ≠ authorized ≠ appropriate` | §3–4 |
| **3 · Planning** | given a desired outcome, compute the capability delta and compare paths that close it | §5 |
| **4 · Reflexive infrastructure** | agents use the model to improve the environment they themselves operate in | §6–11 |

"Reflexive infrastructure" rather than "self-improving": the system can inspect the conditions of its own action and propose modifications to them, and a human approves every one.

## The change in one line

> A capability is not something configured. A capability is an action the system has evidence it can perform.

Everything here follows from taking that seriously.

---

## 1. Separate capability from implementation

Today a node conflates two things: the capability (*web research*) and the thing providing it (*a Tavily MCP server*). Splitting them is the prerequisite for almost everything else, because it lets a capability survive a change of provider and lets two providers compete to satisfy one need.

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

## 2. Put the human and the machines in the graph

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

## 3. Acquisition recipes

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

## 4. Detection becomes verification

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

This philosophy is already latent in the tree — the Local Tool Calling node exists precisely because models claim tool support and fail in practice. Section 4 is making that universal.

## 5. Goal → capability delta

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

This is `near` + `fork` + `budget` + `bottlenecks` generalised from configuration into means-end planning. The analytical primitives already exist; what is missing is a goal to point them at.

## 6. Failure becomes an input

`session_learning` is more important than it currently looks. Every failed task should be classified: was it reasoning, missing knowledge, a missing tool, a missing permission, weak infrastructure, or an unreliable capability?

```
task failure → capability deficit → does it recur?
                                      no  → solve it manually
                                      yes → propose a permanent upgrade
```

The tree already tells you to write a SKILL.md for anything you explain more than twice. Generalised, that rule is the governing principle of the whole project:

> **Repeated friction should become infrastructure.**

## 7. The ledger

Capability accounting gets substantially more interesting longitudinally. Rather than describing only today's environment, record: *at time T, what could this system do — and what changed since?*

```
gains a machine → then network access → then credentials → then a scheduler
→ then memory → then authority to deploy → then the ability to create agents
```

Each addition is not only an infrastructure change but a change in the reachable capability frontier. That turns the graph into something closer to a balance sheet for agency: traditional accounting records accumulated economic claims, IAM records accumulated authority, a CMDB records accumulated infrastructure — this would record **accumulated capacity for action**.

The interesting entries are the ones no single change explains:

> The system acquired autonomous incident-recovery capability yesterday, although no component added yesterday was itself an incident-recovery system.

Agency emerging as a graph property is exactly what a per-component changelog cannot show.

**This is nearer than the rest of this document, because the schema is already there.** `capabilities` carries `created_at` and `updated_at`; `session_learning` carries `session_id`, `capability_id`, `action`, `outcome_score`, `timestamp`. What is missing is that nothing writes a time series of *frontier state*, and no command can answer a question as of a past date — `tt diff`, `tt profile` and `tt trend` all read current state. The work is a snapshot-on-change writer and a reader that takes a timestamp.

## 8. A runtime adapter layer

Do not model "Claude has tool X, Hermes has tool Y". Model what each runtime *provides*, and let the graph decide which runtime can execute which step:

```
             send-email
          ╱      │       ╲
    Claude     Hermes    OpenCode
    connector  SMTP      MCP server
```

The point is durability. You stop maintaining a setup for one assistant and start maintaining a capability fabric that different intelligences attach to — which matters more each time the model landscape shifts.

## 9. Authority as a first-class edge

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

## 10. A second-generation MCP

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

## 11. The visualiser becomes a negotiating surface

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

Sections 1–2 are data-model work the current schema can mostly absorb. Sections 3–5 are the substance and are not started. Section 7 is nearer than its position suggests — the tables exist, only the writer and the time-aware reader are missing. Sections 8–11 depend on 3–5 and are sketches, not designs.

The gap between this document and the README is deliberate. The README describes only what runs.
