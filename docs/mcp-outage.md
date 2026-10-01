# What breaks if an MCP server goes down

An agent setup is a stack of dependencies nobody wrote down. A GitHub MCP server provides version control; version control is half of a review loop; the review loop is what lets an agent open a pull request on its own. When that server's token expires, the agent does not report a missing server. It reports that it cannot open a pull request, or it quietly does something else.

This page is about answering the question before that happens: if this one server, model or credential went away, what would stop? It is the guardrail half of widening what a setup can do. Every new capability rests on pieces that already exist, and knowing which ones carry the most is what makes adding to them safe to lean on.

## Three answers, not one

Losing a piece of the setup does one of three things to each capability that depended on it:

- **It stops.** Nothing else provides it, so it goes with the piece you removed. A server that is the only provider of something is a **single point of failure**.
- **It weakens.** Another server, model or tool still provides it, so it keeps working with one fewer way to do it. That is worth knowing and is not an outage.
- **It was already broken.** It was configured and failing its check before anything went down. Counting it as a loss would overstate the damage, and leaving it out would hide that it was never working.

A list of MCP servers cannot give any of these answers, because the dependency is not in any one config file. It is in how the servers, models, skills and commands combine.

## Asking from the terminal

[Ambit](./README.md) reads every agent config on the machine into one graph ([where each runtime keeps it](./mcp-config-locations.md)) and answers from the graph:

```bash
ambit status               # what is failing, and what has a single provider
ambit impact mcp:github    # what stops, and what only weakens, if this one goes
ambit credentials          # what revoking each credential would end
```

`ambit status` lists the sole providers in the setup, which are the single points of failure. `ambit impact <id>` takes any node, a server, a model, a credential or a capability, and splits what depends on it into what would stop and what would keep another provider. `ambit credentials` asks the same question of each token and key, since an expired token is the commonest way a server goes down.

## Seeing it on the map

The [hosted demo](https://zz-plant.github.io/ambit/?demo=1) draws the same answer. Select a node and press **Simulate an outage**: what stops turns red, what keeps another provider turns amber, and the node that went down is labelled with how many capabilities stop. Its headline names the one piece whose loss would stop the most, with a button that simulates it.

## Acting on the answer

A single point of failure is fixed one of two ways: add a second provider, or make the one you have harder to lose. `ambit next` ranks what to set up next by what has actually blocked work, and `ambit propose <capability>` drafts the change for you to approve before anything is applied. A check declared for a capability turns "configured" into "proven", so a server that has quietly stopped working shows up as failing before an agent finds out.

Related: [where each AI agent keeps its MCP config](./mcp-config-locations.md) and [auditing which MCP servers a coding agent has](./audit-mcp-servers.md).
