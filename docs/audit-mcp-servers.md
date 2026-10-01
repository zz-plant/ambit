# How to audit which MCP servers your coding agent has

An audit of an agent's MCP servers answers four questions: which servers are declared, which of them actually work, what each one lets the agent do without asking, and what the agent used that nobody declared. The first is a matter of reading files. The other three are what make it an audit.

## 1. Find every declaration

Servers are declared per runtime and sometimes per project, in files with different names, keys and formats. [Where each AI agent keeps its MCP config](./mcp-config-locations.md) lists them. A server can be declared in more than one, on in one project and off in another, or left in a file for a runtime you no longer use.

[Ambit](./README.md) reads them all into one local graph:

```bash
brew install zz-plant/tap/ambit
ambit seed      # reads every runtime's config that exists on this machine
ambit status    # what is reached, what is proven, what is failing
```

The map's **My Setup** view is the same list, one row per server, agent, model or command, with which runtime declared it and whether it is enabled.

## 2. Check which ones work

A server in a config file is configured, not working. Tokens expire, binaries move and services go offline, and the config file still says the same thing.

```bash
ambit verify            # run every declared check, and record the result
ambit doctor            # setup health, broken tools, and token-thrash risk
```

A capability with a passing check is **proven**; one with a failing check is configured and not working, and every plan and permission decision leaves it out until it passes again. `ambit verify <capability> --history` shows its past runs.

## 3. See what each one may do without asking

Being able to call a tool is not permission to call it. Each runtime has its own approval setting, and Ambit records each as one of three modes: runs without asking, asks first, or forbidden.

```bash
ambit authority                  # every capability's mode, per action
ambit can <capability>           # ALLOW, CONFIRM or DENY for one action
ambit credentials                # what revoking each credential would end
```

The map's **Authority** lens draws the same answer on every reached node.

## 4. Find what was used and never declared

An agent can reach a tool through a shell, a skill or another server. The declared list is then incomplete in the direction that matters.

```bash
ambit graph unmapped --days=30   # what the agents used that no node accounts for
ambit audit 30                   # who approved what, what ran, and what came of it
```

`ambit graph unmapped` reads the work ledger, which the telemetry plugin fills from real sessions, and lists each tool used with nothing on the map that accounts for it. `ambit audit` is the trail: proposals, approvals, check runs and every grant that narrowed itself because a check failed.

## Keeping it current

An audit is a snapshot. `ambit briefing` is the standing version: what an agent is told when it connects over MCP, before its first tool call, including what is broken and what waits on a person. Registering Ambit as an MCP server puts that briefing in front of every session, so the agent works from the audit and not from its own assumptions.

Nothing in any of this leaves the machine. The graph is a local SQLite file, and there is no telemetry.

Related: [what breaks if an MCP server goes down](./mcp-outage.md).
