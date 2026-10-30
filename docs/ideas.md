# The ideas behind Ambit

[Why Ambit](./why-ambit.md) gives the argument; [the affordance frontier](./affordance-frontier.md) develops the theory; [the reference](./deep-dive.md) describes the software.

## The claim

What an agent setup can do is composed from pieces configured separately. A configured piece may fail, and technical reach differs from permission. Ambit models those distinctions for a person, their agents and their machines.

## One object, four names

| Name | Where you meet it | Meaning |
| :--- | :--- | :--- |
| Ambit | README and app | What you, your agents and machines can jointly do |
| Frontier | Map, CLI and ledger | The edge of that reach, with next steps beyond it |
| Capability graph | Reference | The nodes and dependencies used to compute reach |
| Affordance frontier | Theory | The broader object, including physical, social, institutional and economic action |

The [glossary](https://zz-plant.github.io/ambit/docs/glossary/) defines the product's terms.

## Three aims, one project

- **Widen reach:** identify missing pieces and the capabilities they would open.
- **Govern changes:** keep authority separate from ability, require approval to apply changes and record what their checks establish.
- **Account for attention:** record where people step in, investigate repeated burdens and compare recorded effort before and after a change.

## What is new

1. **Composition is computed.** A vector store and local embeddings may satisfy the authored prerequisites of semantic retrieval, even though neither config names it. The frontier ledger distinguishes direct acquisitions from combinations reached through other changes. Built: `ambit history since`.

2. **Checks change availability.** Structure (`state`) and verification health (`lifecycle`) are separate. A failing check excludes a capability from plans, permission decisions, rankings and simulations until it passes again. A node without a check remains unverified. Built: `ambit verify`.

3. **Automatic authority changes are asymmetric.** Promotion needs a threshold set by a person; demotion follows one failing check. A forbidden grant wins at any specificity. Built: `ambit can` and `ambit authority promote`.

4. **Repeated blocks guide investigation.** `ambit next` ranks recorded blocks, then structural leverage. An agent can draft an acquisition proposal, a person approves it, and the executor checks the signed approval before applying. `ambit roi` compares recorded intervention time afterward; it does not prove causation or financial returns.

5. **Reach has a history.** Snapshots preserve states, kinds and lifecycles. The map replays gains and losses, using today's names and edges. Built: `ambit history` and the map's History.

## Where it comes from

Attack graphs show how topology and permissions compose into reachable paths. The capability approach distinguishes resources from effective opportunities. Ambit uses that framing for productive action, combining dependency analysis with recorded checks and authority.

Configuration databases, workflow systems, agent evaluations and [MCP gateways](./compare.md) address related parts. The theory page gives the [genealogy](./affordance-frontier.md#intellectual-genealogy).

## The next product question

> Can this setup achieve this outcome, on this target, under these conditions?

The proposed next layer binds success criteria to the setup and evidence from each attempt. A complete release rehearsal would exercise delivery and recovery together. An owned paid service would also need customer acceptance, cash-flow and control records.

Work runs and outcome records exist. Versioned scenarios with acceptance evidence are [proposed in roadmap §17](./roadmap.md#17-defined-outcomes--proposed), and unbuilt.

## What it does not claim

- The graph algorithms are standard; the contribution is their application and the rules around them.
- Composition is authored in the curated tree, not discovered from behavior. A setup can extend it in `.ambit/techtree.json`.
- Enforcement covers `apply`, routed control-plane execution and Claude Code with the gate hook installed. Other runtimes choose whether to consult it.
- Reach and check results measure aspects of the assembled system, not model intelligence.
