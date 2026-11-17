---
name: ambit
description: Use before calling a tool you have not used this session, when a tool or MCP server fails or stops answering, when the user asks which MCP servers or agent tools they have, what breaks if a server, model or token goes away, or what to set up next. Ambit maps every agent config on this machine into one local graph and answers from the command line, so it works in any agent that can run a shell command.
---

# Ambit

Ambit reads the agent configs on this machine (Claude Code and its plugins, Codex CLI, Cursor, OpenCode, Gemini CLI, Copilot CLI and the others it lists) into one local graph. It keeps three facts apart: what is configured, what has passed a check, and what may run without asking. This skill reaches it through the `ambit` command, so it needs no MCP connection.

## Before you run anything, tell the user what it touches

It reads the agent configs on this machine and the token counts in the session logs Claude Code, Codex, OpenCode and Amp keep, and writes only its own SQLite file (`~/.local/share/ambit/graph.db`). It changes no agent config without a proposal the user approves, and it sends nothing on its own: there is no telemetry. Deleting that file undoes it.

If `ambit` is not on the PATH, run each command as `npx -y ambit-cli <command>` (Node 22.18 or newer). Do not install it without the user's go-ahead.

## Before a tool you have not used this session

```bash
ambit can "<the tool's name>" --exit-code
```

Name the tool as your runtime names it: `Bash(git push origin main)`, `mcp__github__create_issue`, or a capability such as `shell-execution`. Exit 0 means go ahead, 1 means put it to the user first, 2 means do not; a refusal is already recorded, so do not retry the same call under another name.

Before a task, `ambit briefing --task="<the task in a sentence>"` says which capabilities it touches, whether each passed its last check, whether acting on it is allowed, and which providers to use.

## Which command answers which question

| The user says, or you notice | Run | Then tell them |
| :--- | :--- | :--- |
| "Which MCP servers do I have?" | `ambit status` | What is reached, what is proven, what is failing, and the next step it names |
| A tool fails with an auth error, or a server stopped answering | `ambit verify --mcp <server>`, then `ambit impact <id>` | Whether it answers, and what else stops with it |
| They fixed something that was failing | `ambit verify --failing` | What passes again |
| They are about to revoke or rotate a token | `ambit credentials` | Everything that rests on each credential |
| "What should I add next?", or the same missing ability keeps blocking you | `ambit next` | The ranked next step, why, and its setup time |
| "What tools should my agent have for this project?" | `ambit repo` | The stack it found, and what to add for it |
| They approve the same permission prompts all day | `ambit authority` | What may run without asking, and where their runtime's own rules and Ambit's grants disagree |

Lead with one command and what it found. Keep its numbers and its wording. `--json` after any command prints the answer as data.

## What you can and cannot do

You can ask, and you can draft a change with `ambit propose <capability>`. You can never grant or approve: `ambit approve` is the user's act, and an approved change is written by `ambit apply`.

## When not to suggest it

A user with one runtime who wants to install a single server and nothing more, or a question about one server's own behaviour, which its documentation answers.
