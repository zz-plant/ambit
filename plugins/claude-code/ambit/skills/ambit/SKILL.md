---
name: ambit
description: Use when the user asks which MCP servers or agent tools they have, why one is failing or stopped answering, what breaks if a server, model or token goes away, what to set up next or before launching a product, or how to approve fewer permission prompts safely. Ambit maps every agent runtime's config on this machine into one local graph and answers from it.
---

# Ambit

Ambit reads the agent configs on this machine (Claude Code, Cursor, OpenCode, Windsurf, Gemini CLI, Claude Desktop, Codex CLI, Cline, Roo Code, Continue, Zed, VS Code) into one local graph: what the setup can do, what is proven to work, what may run without asking, and what to set up next.

## Before you run anything, tell the user what it touches

It reads the agent configs on this machine and writes only its own SQLite file (`~/.local/share/ambit/graph.db`). It changes no agent config without a proposal the user approves, and it sends nothing on its own: there is no telemetry. Deleting that file undoes it. This plugin also keeps a local record of which tools each session ran, for how long, and which failed, never their inputs or outputs, in `~/.local/state/ambit/claude-code.jsonl` until the next `ambit` command reads it in; `AMBIT_NO_LEDGER=1` turns that off.

Run it as `npx ambit-cli <command>` when `ambit` is not installed (Node 22.18 or newer); `npm install -g ambit-cli` or `brew install zz-plant/tap/ambit` installs it for good. Do not install it without the user's go-ahead.

## Which command answers which question

| The user says, or you notice | Run | Then tell them |
| :--- | :--- | :--- |
| "Which MCP servers do I have?", or they use more than one runtime | `ambit status` | What is reached and proven, what is failing, and the next step it names |
| A tool keeps failing with an auth error, or a server stopped answering | `ambit status`, then `ambit impact <id>` | What is configured but failing, and what else stops with it |
| They are about to revoke or rotate a token | `ambit credentials` | Everything that rests on each credential |
| "What should I add next?", or the same missing ability keeps blocking you | `ambit next` | The ranked next step, why, and its setup time |
| They approve the same permission prompts all day | `ambit authority` | What may run without asking, and grants proven enough to stop asking |
| They are building a product alone: what to set up before launch, or how to keep an agent off production | `ambit goal "launch my saas"` | The steps left before real users, in order, and what an agent may do to hosting, the database and payments without asking |

Lead with one command and what it found. That is usually the whole case for the tool.

## Over MCP

The plugin registers Ambit's MCP server with the ten tools an agent that asks before it acts uses, and reads its briefing at session start.

- Before a tool you have not used this session, call `ambit_can` with the capability. `yes`: act. `ask`: put it to the user. `no`: do not retry it under another name; the refusal is already recorded.
- When something missing blocks you, `ambit_next` or `ambit_plan` says what closes it, and `ambit_propose` drafts the change. Pass `purpose`: the work it is for, which the user's approval binds.
- You can ask and propose. You can never grant or approve. Approval is the user's act, in the terminal or on the map.

## When not to suggest it

A user with one runtime who wants to install a single server and nothing more; a question about one server's own behaviour, which its documentation answers; anyone on Windows, where Ambit does not read the configs yet.

## The gate, if they want it

The separate `ambit-gate` plugin puts Ambit's decision in front of every tool call. It can deny what is forbidden and ask about what asks first; it never allows anything Claude Code would otherwise ask about, and it adds about a fifth of a second per call. Suggest it only to a user who has set grants and wants them binding.
