# The ideas behind Ambit

[Why Ambit](./why-ambit.md) is the argument at length, [the affordance frontier](./affordance-frontier.md) is the theory under it, and [the reference](./deep-dive.md) is how the software does it.

## The claim

**What an agent setup can do is not written in any config file.** It is composed from pieces configured separately, a configured piece may not work, and none of it says what the setup is allowed to do.

Everything else follows from taking that seriously. If reach is composed, it has to be computed. If a configured piece may not work, a configured tool and a working one are different facts. If it differs from permission, the two need separate records and separate rules for changing. Ambit is a working model of that, for one kind of system: a person, their agents and their machines.

## One object, four names

The same thing appears under four names, each for a different reader:

| Name | Where you meet it | What it names |
| :--- | :--- | :--- |
| **Ambit** | The README, the app | What you, your agents and your machines can jointly do. The word the product is named after. |
| **Frontier** | The map, the CLI, the ledger | The edge of your ambit: everything reached, with the next steps just past it. The ledger records where it stood at each moment. |
| **Capability graph** | The reference | The model that computes it: every tool, model, skill, credential, person and machine as a node, and every dependency as an edge. |
| **Affordance frontier** | The theory | The formal name for the ambit, extended to physical, social, institutional and economic action. |

They are one object at different levels of formality. The [glossary](https://zz-plant.github.io/ambit/docs/glossary/) defines each.

## Three aims, one project

Ambit is for **widening** your ambit: naming the step that opens the most, and the combinations a single missing piece would give you.

The same composition that widens a reach widens it whether or not anyone is watching. Give one model shell access, credentials, a scheduler and a second machine, and the system can do far more without a single weight changing. So Ambit **governs** each widening: it is verified before it is trusted, it is distinct from authority, and a change to the setup waits for a person. The design norm from [Why Ambit](./why-ambit.md#effective-agency-as-a-governed-object) is the hinge: *no increase in effective capability without a corresponding increase in legibility, verification, and governability.* Governing is not the opposite of widening; it is what makes a wider reach safe to lean on.

And Ambit **accounts** for it: where your own time goes, which is the second half of the tagline. Each time a person steps in so an agent can continue is recorded against the capability it was waiting on, which is how a next step is priced and how you find out afterwards whether it paid.

## What is new

1. **Capability is computed, not declared.** A capability can exist that no component declares: a vector store plus local embeddings supplies the prerequisites of semantic retrieval, which neither config mentions. Each observation of the frontier records which capabilities were reached, and the comparison between two separates what was acquired from what was *emergent*: reached with nothing new providing it, because a prerequisite was met elsewhere. No per-component changelog can show an emergent capability, because no single change explains one. Built: [the frontier ledger](./deep-dive.md#the-frontier-ledger), `ambit history since`.

2. **Evidence gates every decision.** `installed ≠ working ≠ authorized`. A capability is *reached* when something provides it and its prerequisites are reached, and *proven* when its declared check passes. One no check covers still counts. A failing check takes it out of every plan, permission decision, ranking and simulation, without anyone asking, until it passes again. Structure (`state`) and health (`lifecycle`) are separate columns, so the ledger records what was configured and the gate reads what works. Built: [assurance](./roadmap.md#4-detection-becomes-verification--built-and-gates), `ambit verify`.

3. **Authority changes asymmetrically.** Being able to do something is not permission to do it, and the two are stored apart. A grant widens only past a threshold a person set in advance, never on evidence alone. It narrows on a single failing check, with nobody asked. A forbidden grant wins at any specificity, so a narrower scope is never a route to something refused. Technical reach can grow without silently broadening what may run unattended. Built: [capability and authority](./deep-dive.md#capability-and-authority-are-different-things), `ambit can`, `ambit authority promote`.

4. **The agent asks for what it lacks.** An agent that hits a limit records it as a deficit, and a limit hit again and again is a capability or workflow worth investigating. `ambit next` ranks what to reach by those recorded blocks first and then by how much each step opens per hour of setup, and the agent drafts the step as a proposal. A person approves it, the approval is a signed artifact the executor verifies, a check proves the result, and the hours it saved are measured against the hours it was forecast to save. Built: [the economic loop](./deep-dive.md#the-economic-loop), `ambit next`, `ambit propose`, `ambit roi`.

5. **Reach has a history.** The question is not only what a setup can do now but how that set is changing: `ΔC = C(S_t+1) − C(S_t)`. The ledger is a first, narrow implementation of that difference for one kind of system, recording gained and lost apart, and the map replays it. Built: `ambit history`, the map's History.

## Where it comes from

No existing field studies this frontier as its own object; its concepts are spread across several. The two nearest:

- **Attack-graph analysis** asks what a principal can reach, given a topology of hosts, permissions and vulnerabilities. Innocuous permissions compose into reachable paths. Ambit asks the same structural question of all productive action, not only unauthorized paths, and adds evidence that each step works.
- **The capability approach** in economics (Sen, Nussbaum, Robeyns) separates possessing resources from the effective freedom to achieve something with them. Ambit makes that conversion computable for one system: from *tool installed* to *capability actually reachable*.

The rest are closer to parts than to the whole: dependency and configuration databases know what depends on what; tool search and MCP catalogs find a tool by name or similarity; workflow graphs order steps within one task; agent evaluations measure what a model can do on a benchmark; [MCP gateways](./compare.md) decide calls as they happen. [The affordance frontier](./affordance-frontier.md#intellectual-genealogy) has the full genealogy, and the README places Ambit [in the stack](../README.md#where-this-sits-in-the-stack).

## What it does not claim

- **Not new algorithms.** Reachability over a dependency graph, cascades and single points of failure are standard graph work. What is new is the object they are run on and the rules around it.
- **Not discovered composition.** The curated tree is authored, and a combination is reached when its declared prerequisites are, not inferred from behavior. A setup can add its own nodes in `.ambit/techtree.json`.
- **Not enforcement everywhere.** The gate is consulted at every decision surface and enforced in three places: the apply path, the control plane for execution routed through it, and Claude Code's tool calls once the `ambit gate` hook is installed. Other runtimes still choose whether to ask it. [The roadmap](./roadmap.md#status-at-a-glance) lists every gap like this one.
- **Not a measure of intelligence.** Ambit does not measure how capable a model is. It measures what a system has acquired the means to do.
