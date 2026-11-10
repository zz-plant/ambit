# From A to B: the seven steps

Ambit reads the agent configs on a machine into one map of what the setup can do. This page walks one setup from A, a pile of configs and an agent supervised call by call, to B, a class of work done without you, in seven steps with one command each. Your agents, tools, credentials and machines are your setup, and what you and they can do together is your [ambit](./ideas.md). Every number below is the hosted demo's, so each can be checked by [opening it](https://zz-plant.github.io/ambit/?demo=1).

## Point A

Most setups start the same way. One runtime, Claude Code or Cursor, a handful of MCP servers picked from a "best servers" list, a GitHub token, perhaps a local model. The agent does chores and a person supervises every one of them. Nobody knows which servers actually work, what they combine into, or what to add next. Permission prompts arrive all day, or the setting that approves everything is on and the person hopes. When something breaks, the first sign is an agent behaving strangely, hours later.

## Point B

B is not "the agent does everything." It is a setup that reliably does a class of work, say triage a failing service, fix it, open a pull request, deploy to staging, check the service recovered and report, with its reach known, its pieces verified, its autonomy granted per action and per target, and the person present only where judgment is needed.

The person's role changes on the way. At A they operate and approve each call. At B they set thresholds and judge proposals.

## The seven steps

`ambit web` opens the map in a browser. Its My Setup view closes with these seven steps, under **Where this setup is headed**, each with where it stands and the one command that moves it.

A step ends with the kind of change it is. *Easier* is the same result for less work. *Tractable* is work that does not grow with the setup. *Possible* is something the setup could not express before.

**1. See where it stands.** Each runtime keeps its servers in a file of its own ([where each one keeps it](./mcp-config-locations.md)), and none of them says whether a server works. `ambit seed` reads them all into one map, and `ambit verify` runs each declared check. `npx ambit-cli` does the first read with nothing installed, and `npm install -g ambit-cli` keeps the `ambit` command these steps use. The demo's setup reaches 15 of the 46 capabilities on its map, 12 of them verified, and one more is configured with a failing check. *Easier: this was always possible by hand.*

**2. Pick the next step.** Adding servers from a list is a guess about what they combine into. `ambit next` ranks what to reach by what has actually blocked work, and `ambit graph combos` names the combinations one missing piece away. In the demo, Embeddings is next: it has blocked work four times, and reaching it makes Vector Store and Local Embeddings next steps. The map, the welcome screen and `ambit next` name the same step, because they read the same ranking. *Tractable: the choice is combinatorial, and without a model people stop at the size they can hold in their heads.*

**3. Add it safely.** `ambit propose` writes the change as a proposal. Read it the way you read a pull request: what the file will say, what undoes it, what it costs, what it is forecast to save, and, with `--for`, the work it is for. Your approval binds that purpose, so a proposal whose purpose changes after you sign it is no longer covered. You sign it, `ambit apply` applies it, `ambit rollback` undoes it, and a check proves the result. *Easier: no hand-edited JSON, no change without a record.*

**4. Hand over trust gradually.** This is the step that separates A from B. A grant is per action and per target, so "deploy to staging without asking" can be true while "deploy to production" still asks. `ambit authority promote <capability> <action> --after=10 --by=<you>` sets the bar once: the grant widens when the evidence reaches it, and narrows again on a single failing check, with nobody asked. A sandbox relaxes confirmation inside it and never a refusal, and `--ttl=30m` grants a window that closes on its own. On the demo's setup, 31 of the 43 actions on what is reached run without asking, 12 ask first and 3 more are forbidden, and Secret Management has passed often enough to stop asking, once someone sets the number of passes. In Claude Code, the `ambit gate` hook is a brake on every tool call: it can only deny or ask, never allow, so forbidden is refused and asking first is put to you. *Possible: approval per action and per target, with a bar you set, instead of a runtime-wide approve-everything or ask-everything setting.*

**5. Keep it standing.** A setup decays: tokens expire, binaries move, services go down. `ambit status` lists what is configured but failing and the pieces the setup rests on alone, and [`ambit impact`](./mcp-outage.md) says what would stop before you revoke or remove one. *Tractable: maintenance grows with every piece added, and a model is what keeps it from growing faster than the setup.*

**6. Know whether it paid.** The OpenCode telemetry plugin and the Claude Code plugin record each time a person steps in so an agent can continue, against the capability it was waiting on. That is how a next step is priced before you take it, and how `ambit roi` says afterwards whether it saved what it was forecast to save. The demo records 89 interventions and 41 hours a year saved. *Possible: without measurement, B cannot be told apart from a setup that only feels busier.*

**7. Let the agent ask for what it lacks.** Registered over MCP, an agent reads a briefing before its first tool call and asks `ambit_can` before a tool it has not used. When something missing blocks it, it records the deficit and drafts the step that closes it, for you to sign. In the demo, agents have asked for Vector Store. *Possible: this is what makes the journey compound, because the setup grows out of the work itself.*

## What changes for the person

**What you can reach becomes something you design.** At A, a setup is a collection of tools other people recommended. With the map, you choose what to add from what it would open and what keeps blocking you, and you see what each new reach rests on.

**How you hold that reach becomes something you govern.** Your interruptions shift from *clerical* (routine steps an agent could take) to *keeper* (decisions that should always reach a person), and the session history, Ambit's record of each time a person stepped in, says which is which.

Together that is a setup with written-down authority, signed approvals and a trail of what happened. It is the governance of a small organization, at the scale of one person and their agents.

**What it will not do.** It will not choose your B, the class of work you want done without you. It routes a goal you state, and each proposal can carry the work it is for, which your approval binds. It measures reach, not judgment: a wide reach with poor judgment is a bigger blast radius. And it sees only what is on the map.

The questions transfer even where the software does not: what is one step away, what you have verified against what you assume, what rests on a single credential or tool, and where you are able but not permitted, or permitted but not able. Ambit computes them only for agent setups.

The aim is not more reach for its own sake, but reach you can grow on purpose because you can see what holds it up.

The agent's side of the same journey, session by session, is in [For agents](./agents.md).

## Why it compounds

Every capability reached moves the frontier, the edge of what the setup reaches, and that changes what is a next step. A step taken can make the next one cheaper, safer or newly visible, and can also add maintenance, coupling or expense. Each addition's benefits and costs need their own assessment, which is why B is a direction more than a destination. The map's eras, its columns, order capabilities by what they depend on, so the next steps on any route sit at the edge of the eras you have reached. The eras are not the route: B is a class of work you choose, and the last era on the map is a kind of capability, not the end of the road.

## Where the journey still has gaps

- **Step 4 is enforced where it can be.** Ambit's own `apply`, its control plane for execution routed through it, and Claude Code once the `ambit gate` hook is installed. Cursor and the other runtimes still choose whether to ask `ambit_can`, so there the gradual hand-over depends on the agent following its instructions.
- **Steps 6 and 7 need a record.** The OpenCode and Claude Code plugins record each time a person stepped in. Cursor's hook records tool runs and failures but no approvals, other runtimes record nothing yet, and the figures need weeks of history. On day one those steps say so.
- **Step 2 knows the curated tree.** A goal outside it needs the judgment model or an overlay in `.ambit/techtree.json`.
- **It is one person's journey.** The same path for a team, with shared thresholds and several approvers, is only partly built.
- **The map can be out of date.** Its figures are rebuilt from config files and the last check on each piece, and a passing check proves only what that check tests.
- **Verified is per piece.** Ambit says which capabilities are verified and which are not. It gives the setup no overall score.
- **An outage simulation has no clock.** It says what would stop, not how long you would have.

[The roadmap](./roadmap.md#status-at-a-glance) lists every gap of this kind, and [the ideas behind Ambit](./ideas.md) is the claim the journey rests on.

## Two views, one graph

**Between runs and during one.** Between runs you work in the map, My Setup and Proposals. There you see the whole setup, choose the next step and sign the change. During a run the agent works from its briefing. The briefing is in its context before its first tool call, `ambit_can` answers before a tool it has not used, and in Claude Code with the `ambit gate` hook installed, the gate answers every tool call. Both read the same graph and differ in what they can afford to show. The map shows all of it. The briefing gets about 1,200 tokens, trimmed from the bottom, so a line is there only if the agent can act on it. My Setup's Briefing section shows you that text as the agent receives it.

**The edge is what works.** The frontier leaves out anything that has failed its check, so you can lean on what is inside it. A capability whose check fails stays on the map, marked as failing, and is out of every plan until it passes again.

**Every tool server has a weight.** Every tool server a runtime starts puts its whole tool list into the agent's context before the first message, called or not, so each server added is carried into every session. `ambit weigh` measures each local server's list in tokens and adds up each runtime's total. Once the session history has a few weeks of calls, it also names the servers carried and never called. My Setup prints the same figures beside each tool server.

A list of the tools you own says little about what you can do: the reach is in how they combine and how well they answer.

