# How to audit which MCP servers your coding agent has

An audit of an agent's MCP servers answers four questions: which servers are declared, which of them actually work, what each one lets the agent do without asking, and what the agent used that nobody declared. The first is a matter of reading files. The other three are what make it an audit.

## 1. Find every declaration

Servers are declared per runtime and sometimes per project, in files with different names, keys and formats. [Where each AI agent keeps its MCP config](./mcp-config-locations.md) lists them. A server can be declared in more than one, on in one project and off in another, or left in a file for a runtime you no longer use.

[Ambit](./README.md) reads every runtime's user-level file into one local graph, with the servers each enabled Claude Code plugin brings and, by name, the servers each project Claude Code knows commits in its `.mcp.json`. It does not read other runtimes' project files, such as `.cursor/mcp.json`, yet, so check those by hand in each repository you audit.

```bash
npx ambit-cli              # reads every runtime's user-level config on this machine
npm install -g ambit-cli   # keeps the `ambit` command the steps below use
ambit status               # what is reached, what is verified, what is failing
```

`ambit web` opens the map in a browser. Its **My Setup** view is the same list, one row per server, agent, model or command, with which runtime declared it and whether it is enabled.

## 2. Check which ones work

A server in a config file is configured, not working. Tokens expire, binaries move and services go offline, and the config file still says the same thing.

```bash
ambit verify                  # run every declared check, and record the result
ambit verify --mcp --remote   # start each local server, and ask each remote one whether it answers
ambit doctor                  # setup health: what works, what fails, what rests on one piece
```

A capability with a passing check is **verified**; one with a failing check is configured and not working, and every plan, permission and ranking leaves it out until it passes again. `ambit verify <capability> --history` shows its past runs.

A check exists only where one is declared: the curated tree declares some, and a skill registered with `ambit record skill:` carries its own. Most MCP servers a person adds have none. Those read as reached and unverified. `ambit verify --mcp` checks them as servers: a local one is started and asked for its tools, and with `--remote` a remote one is sent one request with no sign-in. A remote server that answers passes, and one that is gone, moved or erroring fails. One that asks for a sign-in has proved nothing either way, since your runtime's own sign-in is never sent, so calling one of its tools from your agent is still the check for that.

## 3. See what each one may do without asking

Being able to call a tool is not permission to call it. Ambit records one of three modes for each capability and action: runs without asking, asks first, or forbidden.

```bash
ambit authority                  # every capability's mode, per action
ambit can <capability>           # ALLOW, CONFIRM or DENY for one action
ambit credentials                # what revoking each credential would end
```

The map's **Authority** lens draws the same answer on every reached node. The answer is enforced in three places: `ambit apply`, always; the control plane interceptor, when execution is routed through it (its executor is simulated unless a person opts in to the Docker adapter); and the Claude Code `ambit gate` hook, an opt-in plugin that can only deny or ask. Anywhere else it is a record of what should happen, and the runtime's own approval setting decides.

`ambit authority` also lists Claude Code's own permission rules, each beside what Ambit's gate would answer for the call it names, and says which one holds where they disagree.

`ambit credentials` knows only the credentials a `credentials` block in the config declares; Ambit does not infer which servers share a token. Until you write one, it says none are declared.

## What this audit does not cover

Ambit does not read a server's tool descriptions for prompt injection, tool poisoning or a definition that changed between sessions. A scanner does that: [Snyk Agent Scan](https://github.com/snyk/agent-scan), formerly mcp-scan, finds the MCP configs, agent tools and skills on a machine and checks them for those. It sends tool names and descriptions to Snyk for analysis and needs a Snyk token, which is a different trade from Ambit's, where nothing leaves the machine. Run it beside this audit, not in place of it.

## 4. Find what was used and never declared

An agent can reach a tool through a shell, a skill or another server. The declared list is then incomplete in the direction that matters.

```bash
ambit graph unmapped --days=30   # what the agents used that no node accounts for
ambit audit 30                   # who approved what, what ran, and what came of it
```

Both read the session history, Ambit's local record of what agents ran and who was asked. Five things fill it: the OpenCode telemetry plugin, the Claude Code plugin's hooks, Cursor's hook (`ambit connect cursor --ledger` adds it), the control plane, and MCP calls. Other runtimes do not feed it yet, so for an agent on Windsurf or Gemini CLI, `ambit graph unmapped` comes back empty or nearly so, because its tool calls were never recorded, not because none were made.

`ambit graph unmapped` lists each tool used with nothing on the map that accounts for it. `ambit audit` is the trail: proposals, approvals, check runs, the runs the session history recorded, and every grant that narrowed itself because a check failed.

## Keeping it current

An audit is a snapshot. `ambit briefing` is the standing version. It is what an agent is told when it connects over MCP, before its first tool call, including what is broken and what waits on a person. Registering Ambit as an MCP server puts that briefing in front of every session, so the agent works from the audit and not from its own assumptions.

The graph is a local SQLite file, and there is no telemetry. A declared check is a command and can reach the network; [the FAQ](./faq.md#does-anything-leave-my-machine) lists every command that can.

Related: [what breaks if an MCP server goes down](./mcp-outage.md).
