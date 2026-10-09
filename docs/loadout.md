# Your loadout, from A to B

Your agents, your tools, your credentials and your machines are your loadout, and you are its pilot. What the two of you can do together is your [ambit](./ideas.md). Every number below is the hosted demo's, so each can be checked by [opening it](https://zz-plant.github.io/ambit/?demo=1).

## Point A

Most loadouts start the same way. One runtime, Claude Code or Cursor, a handful of MCP servers picked from a "best servers" list, a GitHub token, perhaps a local model. The agent does chores and a person supervises every one of them. Nobody knows which servers actually work, what they combine into, or what to add next. Permission prompts arrive all day, or the setting that approves everything is on and the person hopes. When something breaks, the first sign is an agent behaving strangely, hours later.

## Point B

B is not "the agent does everything." It is a loadout that reliably does a class of work, say triage a failing service, fix it, open a pull request, deploy to staging, check the service recovered and report, with its reach known, its pieces proven, its autonomy granted per action and per target, and the person present only where judgment is needed.

The person's role changes on the way. At A they operate and approve each call. At B they set thresholds and judge proposals. In the ledger's words, the *clerical* interruptions are gone and the *keeper* ones remain: the decisions that should always reach a person.

## The seven legs

My Setup in the app opens on a readout of these seven legs for the loadout on screen, each with where it stands and the one command that moves it.

**1. See where it stands.** Each runtime keeps its servers in a file of its own ([where each one keeps it](./mcp-config-locations.md)), and none of them says whether a server works. `ambit seed` reads them all into one map, and `ambit verify` runs each declared check. The demo's loadout reaches 16 of the 46 capabilities on its map, and 13 of those are proven. *Easier: this was always possible by hand.*

**2. Pick the next step.** Adding servers from a list is a guess about what they combine into. `ambit next` ranks what to reach by what has actually blocked work, and `ambit graph combos` names the combinations one missing piece away. In the demo, Embeddings is next: it has blocked work four times, and it also reaches Vector Store. The map, the welcome screen and `ambit next` name the same step, because they read the same ranking. *Tractable: the choice is combinatorial, and without a model people stop at the size they can hold in their heads.*

**3. Add it safely.** `ambit propose` writes the change as a proposal: what it does, what undoes it, what it costs, what it is forecast to save, and, with `--for`, the work it is for. Your approval binds that purpose, so a proposal whose purpose changes after you sign it is no longer covered. You sign it, `ambit apply` applies it, `ambit rollback` undoes it, and a check proves the result. *Easier: no hand-edited JSON, no change without a record.*

**4. Hand over trust gradually.** This is the leg that separates A from B, and the one nothing else offers. A grant is per action and per target, so "deploy to staging without asking" can be true while "deploy to production" still asks. `ambit authority promote <capability> <action> --after=10 --by=<you>` sets the bar once: the grant widens when the evidence reaches it, and narrows again on a single failing check, with nobody asked. A sandbox relaxes confirmation inside it and never a refusal, and `--ttl=30m` grants a window that closes on its own. The demo's loadout has 31 capabilities that may act without asking, 12 that ask first and 3 forbidden, and Secret Management has passed often enough to stop asking, once someone sets the number of passes. In Claude Code, the `ambit gate` hook makes these answers binding on every tool call: forbidden is refused, asking first is put to you, and it never allows anything Claude Code would otherwise ask about. *Possible: approval per action and per target, with a bar you set, instead of a runtime-wide approve-everything or ask-everything setting.*

**5. Keep it standing.** A loadout decays: tokens expire, binaries move, services go down. `ambit status` lists what is configured but failing and the pieces the setup rests on alone, and [`ambit impact`](./mcp-outage.md) says what would stop before you revoke or remove one. *Tractable: maintenance grows with every piece added, and a model is what keeps it from growing faster than the loadout.*

**6. Know whether it paid.** The OpenCode telemetry plugin and the Claude Code plugin record each time a person steps in so an agent can continue, against the capability it was waiting on. That is how a next step is priced before you take it, and how `ambit roi` says afterwards whether it saved what it was forecast to save. The demo records 89 interventions and 41 hours a year saved. *Possible: without measurement, B cannot be told apart from a setup that only feels busier.*

**7. Let the agent ask for what it lacks.** Registered over MCP, an agent reads a briefing before its first tool call and asks `ambit_can` before a tool it has not used. When something missing blocks it, it records the deficit and drafts the step that closes it, for you to sign. In the demo, agents have asked for Vector Store. *Possible: this is what makes the journey compound, because the loadout grows out of the work itself.*

## What changes for the person

Two things change, and the ledger shows both.

**What you can reach becomes something you design.** At A, a setup is a collection of tools other people recommended. With the map, you choose what to add from what it would open and what keeps blocking you, and you see what each new reach rests on. In the demo, Embeddings is the next step: it has blocked work four times, and it also opens Vector Store.

**How you hold that reach becomes something you govern.** At A, you approve every call or none. At B, you set a bar once, a grant widens when a capability's checks meet it, and one failure narrows it again without anyone asking. Your interruptions shift from *clerical* (routine steps an agent could take) to *keeper* (decisions that should always reach a person), and the ledger records which is which.

Together that is a setup with written-down authority, signed approvals and a trail of what happened: the governance of a small organization, at the scale of one person and their agents.

**What it will not do.** It will not choose your B, the class of work you want done without you. It routes a goal you state, and each proposal can carry the work it is for, which your approval binds. It measures reach, not judgment: a wide reach with poor judgment is a bigger blast radius. And it sees only what is on the map.

The questions transfer even where the software does not: what is one step away, what you have proven against what you assume, what rests on a single credential or tool, and where you are able but not permitted, or permitted but not able. Ambit computes them only for agent setups.

The aim is not more reach for its own sake. It is reach that is legible, earned and revocable, which you can grow on purpose because you can see what holds it up.

## Why it compounds

Every capability reached moves the frontier, and that changes what is a next step. A step taken can make the next one cheaper, safer or newly visible, and can also add maintenance, coupling or expense. Each addition's benefits and costs need their own assessment, which is why B is a direction more than a destination. The map's eras order capabilities by what they depend on, so the next steps on any route sit at the edge of the eras you have reached, and an era's ladder says how far up it you are. They are not the route itself: a B is a class of work you choose, and Sovereignty is a kind of capability, not the end of the road.

## Where the journey still has gaps

- **Leg 4 is enforced where it can be.** Ambit's own `apply`, its control plane for execution routed through it, and Claude Code once the `ambit gate` hook is installed. Cursor and the other runtimes still choose whether to ask `ambit_can`, so there the gradual hand-over depends on the agent following its instructions.
- **Legs 6 and 7 need a record.** The OpenCode telemetry plugin and the Claude Code plugin fill it, other runtimes do not yet, and the figures need weeks of history. On day one those legs say so.
- **Leg 2 knows the curated tree.** A goal outside it needs the judgment model or an overlay in `.ambit/techtree.json`.
- **It is one person's journey.** The same path for a team, with shared thresholds and several approvers, is only partly built.

[The roadmap](./roadmap.md#status-at-a-glance) lists every gap of this kind, and [the ideas behind Ambit](./ideas.md) is the claim the journey rests on.

## Pilot and machine

**Two stations.** Between runs you work in the hangar: the map, My Setup and Proposals, where the whole loadout is laid out, you choose the next step and you sign the change. During a run the agent works in the cockpit, and what it sees there is a heads-up display: the briefing in its context before its first tool call, `ambit_can` before a tool it has not used, and in Claude Code, once the `ambit gate` hook is installed, the gate on every tool call. Both stations read the same graph and differ in what they can afford to show. The hangar shows all of it. The cockpit gets about 1,200 tokens, trimmed from the bottom, so a line is there only if the agent can act on it. My Setup's Briefing tab shows you that display as the agent receives it.

**The edge is an envelope.** An aircraft's flight envelope is the range of speed, altitude and load it is known to fly safely in. The frontier is that kind of edge for your loadout: what it reaches, with anything that has failed its check taken out, so the edge is one you can lean on. Failed instruments are handled as a cockpit handles them: the gauge is flagged, never left showing a zero the pilot might fly on. A capability whose check fails stays on the map, marked as failing, and is out of every plan until it passes again.

**A loadout has a weight.** Every tool server a runtime starts puts its whole tool list into the agent's context before the first message, called or not, so each server added is carried into every session. `ambit weigh` measures it: each local server's list in tokens, each runtime's total, and, once the ledger has a few weeks of calls, the servers carried and never called. My Setup prints the same figures beside each tool server.

For anyone who has seen *Neon Genesis Evangelion*, the show has this picture with more parts in it. A pilot does not drive an Eva; they sync with it, and what the two can do together is more than either alone. That is why a list of the tools you own says so little: the reach is in how they combine and how well they answer.

Some of the picture carries over:

| In the Eva | In your loadout | Where Ambit shows it |
| :--- | :--- | :--- |
| **Sync ratio**: how much of the Eva actually answers the pilot | How much of what is configured is proven to work | Proven against reached, on the map and in `ambit status` |
| **The umbilical cable**: power from outside, and what fails when it is cut | What a reach rests on: one token, one server, one machine | The outage simulation and `ambit impact`: what stops, and what only weakens |
| **The restraints**: what holds the Eva back until it is cleared to move | What must ask before it acts, set per action and per target | The Authority lens, `ambit can` |
| **MAGI**: the decision taken before NERV acts | A change to the setup is a proposal a person signs before it applies | The Proposals panel, `ambit approve` |
| **The dummy plug**: the Eva moving with its pilot taken out | What Ambit refuses: autonomy that widens with no person having set the bar | A grant widens only past a threshold a person set in advance |

Where the picture stops matters as much:

- **The display can be out of date.** A cockpit's instruments read the aircraft directly. Ambit's are rebuilt from config files and the last check on each piece, and a passing check proves only what that check tests.
- **Widening is not pushing the envelope.** A test pilot finds an edge by flying past it. Ambit's way to move the edge is one piece at a time: proposed, signed, applied and checked.
- **Sync here is per piece, not one number.** Ambit says which capabilities are proven and which are not; it does not score how well you pilot.
- **There is no clock.** An outage simulation says what would stop, not how long you would have.
- **The restraints come off by a rule the show does not have.** In Ambit a person sets a bar once, a grant widens when the evidence meets it, and one failing check narrows it again with nobody asked.
- **MAGI is three systems voting; Ambit's approval is one person signing.** Several approvers are not built yet.
- **Autonomy is allowed.** An agent may act without asking where a grant says so. What Ambit refuses is that grant widening with no person behind it, which is the part the dummy plug stands for.

The short version, for anyone who has not seen it: a powerful suit is only as useful as the pilot's sync with it, and only as safe as its restraints. Ambit is how you see both.
