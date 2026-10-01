# Ambit and MCP gateways

Two kinds of tool answer questions about an agent's MCP servers, and they answer different ones. This page says which is which, so you can tell whether you need one, the other, or both.

## MCP gateways and governance proxies

A gateway sits between an agent and its MCP servers, on the path every tool call takes. Each call passes through it, and it can allow the call, hold it for a person, or refuse it, and it logs what happened. Obsigno, Agentward, MCPX and Catalyst describe themselves this way, as do the enterprise MCP gateways. Enterprise discovery tools such as Akto's inventory the servers connected across a fleet.

A gateway answers **may this call go ahead, now?** It sees calls as they happen, so it knows what was attempted.

## Ambit

Ambit is not on the call path. It reads the configs of Claude Code, Cursor, OpenCode, Windsurf, Gemini CLI, Claude Desktop, Codex CLI and others into one local graph, and answers questions about the setup as a whole:

- **What can this setup do?** Capabilities are composed: version control plus a review agent is a review loop. Ambit maps what the servers, models, skills and commands add up to, against a curated tree of what agent setups grow into.
- **Does it work?** A capability with a declared check is proven or failing, and a failing one is left out of every plan and permission decision until it passes.
- **What breaks if one piece goes?** [The blast radius](./mcp-outage.md) of a server, model or credential: what would stop, and what would only lose one of its providers.
- **What should change next, and was it worth it?** Ranked by what has actually blocked work, drafted as a proposal a person approves, and measured afterwards against the hours it was forecast to save.

Ambit does have a gate. `ambit can` returns ALLOW, CONFIRM or DENY for an action, approvals are signed artifacts the executor verifies, and a grant narrows itself on one failing check. Its control plane can sit on the call path, and in Claude Code the `ambit gate` hook puts the same answer in front of every tool call, though it can only deny or ask, never allow. But its center is the map and the ledger, not the proxy.

## Side by side

| | A gateway | Ambit |
| :--- | :--- | :--- |
| Where it runs | On the path of every tool call | Beside the agent; reads configs and records work |
| What it sees | Calls as they are made | The whole setup, including what was never called |
| Main question | May this call go ahead? | What can this setup do, does it work, and what breaks if a piece goes? |
| Approvals | Per call, as it happens | Per change to the setup, as a signed, reviewable proposal |
| Where data lives | Varies; often a hosted service | One local SQLite file; nothing leaves the machine |

## Using both

They compose. A gateway decides call by call; Ambit says which calls are worth allowing without asking, from evidence that a capability has passed its check and been used without trouble. A person sets the threshold once, and the grant widens when the evidence reaches it and narrows again on one failing check.

To try Ambit, [open the hosted demo](https://zz-plant.github.io/ambit/?demo=1), or install it with `brew install zz-plant/tap/ambit` and run `ambit`. [Where each AI agent keeps its MCP config](./mcp-config-locations.md) lists what it reads.
