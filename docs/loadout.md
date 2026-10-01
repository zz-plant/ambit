# Your loadout, from A to B

Your agents, your tools, your credentials, your machines, and you: together they are one loadout, and what it can do is your [ambit](./ideas.md). This page walks one person's loadout from where most setups start to where they can go, leg by leg, with the command that moves each leg and what Ambit shows at each one. The numbers are the hosted demo's, so every one of them can be checked by [opening it](https://zz-plant.github.io/ambit/?demo=1).

## Stepping in

If you have seen *Neon Genesis Evangelion*, you already have the picture. A pilot does not drive an Eva; they sync with it, and what the two can do together is more than either alone. That is a loadout. It is not a list of tools you own. It is one body, made of you and everything you have connected, and it can only do what its weakest joint allows.

The rest of the picture carries over too:

| In the Eva | In your loadout | Where Ambit shows it |
| :--- | :--- | :--- |
| **Sync ratio**: how much of the body actually answers the pilot | How much of what is configured is proven to work | Proven against reached, on the map and in `ambit status` |
| **The umbilical cable**: power from outside, and a clock when it is cut | What a reach rests on: one token, one server, one machine | The outage simulation and `ambit impact`: what stops, and what only weakens |
| **The restraints**: released as the pilot proves control, and locked again when control slips | What may act without asking, released per action as checks pass, narrowed on one failure | The Authority lens, `ambit can`, `ambit authority promote` |
| **MAGI**: a change of course is put to a vote before it happens | A change to the setup is a proposal a person signs before it applies | The Proposals panel, `ambit approve` |
| **The dummy plug**: the body moving with nobody in it | What Ambit refuses: autonomy that widens with no person having set the bar | A grant widens only past a threshold a person set in advance |

If you have not seen it, the short version is this: a powerful suit is only as useful as the pilot's sync with it, and only as safe as its restraints. Ambit is how you see both.

## Point A

Most loadouts start the same way. One runtime, Claude Code or Cursor, a handful of MCP servers picked from a "best servers" list, a GitHub token, perhaps a local model. The agent does chores and a person supervises every one of them. Nobody knows which servers actually work, what they combine into, or what to add next. Permission prompts arrive all day, or the setting that approves everything is on and the person hopes. When something breaks, the first sign is an agent behaving strangely, hours later.

## Point B

B is not "the agent does everything." It is a loadout that reliably does a class of work, say triage a failing service, fix it, open a pull request, deploy to staging, check the service recovered and report, with its reach known, its pieces proven, its autonomy granted per action and per target, and the person present only where judgment is needed.

The person's role changes on the way. At A they operate and approve each call. At B they set thresholds and judge proposals. In the ledger's words, the *clerical* interruptions are gone and the *keeper* ones remain: the decisions that should always reach a person.

## The seven legs

My Setup in the app opens on a readout of these seven legs for the loadout on screen, each with where it stands and the one command that moves it.

**1. See where it stands.** Eleven runtimes keep their servers in eleven files ([where each one keeps it](./mcp-config-locations.md)), and none of them says whether a server works. `ambit seed` reads them all into one map, and `ambit verify` runs each declared check. The demo's loadout reaches 16 of the 35 capabilities on its map, and 13 of those are proven. *Easier: this was always possible by hand.*

**2. Pick the next step.** Adding servers from a list is a guess about what they combine into. `ambit next` ranks what to reach by what has actually blocked work, and `ambit graph combos` names the combinations one missing piece away. In the demo, Embeddings is next: it has blocked work four times, and it also reaches Vector Store. Ranked by how much each step opens, the welcome screen's pick is Model Routing, which would open six more. *Tractable: the choice is combinatorial, and without a model people stop at the size they can hold in their heads.*

**3. Add it safely.** `ambit propose` writes the change as a proposal: what it does, what undoes it, what it costs and what it is forecast to save. You sign it, `ambit apply` applies it, `ambit rollback` undoes it, and a check proves the result. *Easier: no hand-edited JSON, no change without a record.*

**4. Hand over trust gradually.** This is the leg that separates A from B, and the one nothing else offers. A grant is per action and per target, so "deploy to staging without asking" can be true while "deploy to production" still asks. `ambit authority promote <capability> <action> --after=10 --by=<you>` sets the bar once: the grant widens when the evidence reaches it, and narrows again on a single failing check, with nobody asked. A sandbox relaxes confirmation inside it and never a refusal, and `--ttl=30m` grants a window that closes on its own. The demo's loadout has 31 capabilities that may act without asking, 12 that ask first and 3 forbidden, and Secret Management has earned a threshold nobody has set yet. *Possible: without it the only routes are approving every call or approving none.*

**5. Keep it standing.** A loadout decays: tokens expire, binaries move, services go down. `ambit status` lists what is configured but failing and the pieces the setup rests on alone, and [`ambit impact`](./mcp-outage.md) says what would stop before you revoke or remove one. *Tractable: maintenance grows with every piece added, and a model is what keeps it from growing faster than the loadout.*

**6. Know whether it paid.** The telemetry plugin records each time a person steps in so an agent can continue, against the capability it was waiting on. That is how a next step is priced before you take it, and how `ambit roi` says afterwards whether it saved what it was forecast to save. The demo records 89 interventions and 41 hours a year saved. *Possible: without measurement, B cannot be told apart from a setup that only feels busier.*

**7. Let the agent ask for what it lacks.** Registered over MCP, an agent reads a briefing before its first tool call and asks `ambit_can` before a tool it has not used. When something missing blocks it, it records the deficit and drafts the step that closes it, for you to sign. In the demo, agents have asked for Vector Store. *Possible: this is what makes the journey compound, because the loadout grows out of the work itself.*

## Why it compounds

Every proven capability moves the frontier, and that changes what is one step away. A step taken makes the next one cheaper, safer or newly visible, which is why B is a direction more than a destination. The map draws the route in advance: its eras, Foundation through Sovereignty, are the journey laid out, and an era's ladder says how far up it you are.

## Where the journey still has gaps

- **Leg 4 is enforced in two places.** Ambit's own `apply` and its control plane enforce grants. Nothing forces Claude Code or Cursor to ask `ambit_can`, so for most people the gradual hand-over depends on the agent following its instructions.
- **Legs 6 and 7 need a record.** The telemetry plugins run in OpenCode, and the figures need weeks of history. On day one those legs say so.
- **Leg 2 knows the curated tree.** A goal outside it needs the judgment model or an overlay in `.ambit/techtree.json`.
- **It is one person's journey.** The same path for a team, with shared thresholds and several approvers, is only partly built.

[The roadmap](./roadmap.md#status-at-a-glance) lists every gap of this kind, and [the ideas behind Ambit](./ideas.md) is the claim the journey rests on.
