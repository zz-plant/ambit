# Ambit and MCP gateways

An MCP gateway sits on the path of every tool call and decides whether it goes ahead. Ambit sits beside the agent, reads its configs into one local map, and says what the setup can do, whether it works, and what breaks if a piece goes. The two answer different questions and work together.

## MCP gateways and governance proxies

A gateway sits between an agent and its MCP servers, on the path every tool call takes. Each call passes through it, and depending on the product it can allow the call, refuse it, hold it for a person, and log what happened. [Lunar's MCPX](https://docs.lunar.dev/mcpx) is a gateway in that sense, with scoped permissions and an audit trail. [AgentWard](https://github.com/agentward-ai/agentward) proxies each call and can allow it, block it or hold it for approval, and logs all three. [Obsigno](https://pypi.org/project/obsigno/) proxies calls to allow or deny them and records each decision in a signed ledger; it calls itself an evidence layer, not a general gateway. [Diagrid's Catalyst](https://www.diagrid.io/blog/governing-mcp-access-across-the-enterprise) puts a policy proxy in front of each MCP server.

A gateway answers **may this call go ahead, now?** It sees calls as they happen, so it knows what was attempted.

A third kind, discovery tools, answers which servers exist at all: [Akto](https://www.akto.io/blog/mcp-discovery-tools) finds MCP servers across an organization's networks, cloud and registries.

## Ambit

Ambit works beside the agent and does not need to be on the call path. It reads the configs of Claude Code, Cursor, OpenCode, Windsurf, Gemini CLI, Claude Desktop, Codex CLI and others into one local graph, and answers questions about the setup as a whole:

- **What can this setup do?** Capabilities are composed: version control plus a review agent is a review loop. Ambit maps what the servers, models, skills and commands add up to, against a curated tree of what agent setups grow into.
- **Does it work?** A capability with a declared check is verified or failing, and a failing one is left out of every plan and permission decision until it passes.
- **What breaks if one piece goes?** [The blast radius](./mcp-outage.md) of a server, model or credential: what would stop, and what would only lose one of its providers.
- **What should change next, and was it worth it?** Ranked by what has actually blocked work, drafted as a proposal a person approves, and, once the session history (Ambit's local record of agent runs) holds a few weeks of them, measured against the hours it was forecast to save.

Ambit has a gate too, and it is the guardrail, not the center. `ambit can` returns ALLOW, CONFIRM or DENY for an action, approvals are signed artifacts the executor verifies, and a grant narrows itself on one failing check. Two parts sit on the call path when you route calls through them: the control plane, and in Claude Code the `ambit gate` hook, which answers every tool call and can only deny or ask, never allow. The center is the map and the session history.

## Side by side

| | A gateway | Ambit |
| :--- | :--- | :--- |
| Where it runs | On the path of every tool call | Beside the agent; reads configs and records work |
| What it sees | Calls as they are made | The whole setup, including what was never called |
| Main question | May this call go ahead? | What can this setup do, does it work, and what breaks if a piece goes? |
| Approvals | Per call, as it happens | Per change to the setup, as a signed, reviewable proposal |
| Where data lives | Varies: some run on your machine, others as a hosted or self-hosted service | One local SQLite file; nothing leaves except through a command you typed |

## Using both

They compose. A gateway decides call by call; Ambit says which calls are worth allowing without asking, from evidence that a capability has passed its check and been used without trouble. A person sets the threshold once, and the grant widens when the evidence reaches it and narrows again on one failing check.

To try Ambit, [open the hosted demo](https://zz-plant.github.io/ambit/?demo=1), or run `npx ambit-cli` on your machine (`brew install zz-plant/tap/ambit` keeps the command). [Where each AI agent keeps its MCP config](./mcp-config-locations.md) lists what it reads.
