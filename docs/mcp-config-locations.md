# Where each AI agent keeps its MCP config

Every agent runtime stores its MCP servers in its own file, under its own key, and a config copied from one into another usually fails without an error. Some runtimes also read a second file inside the repository, for servers that belong to one project. The user-level files and keys below come from Ambit's readers, [`src/engine/mcp-clients.ts`](../src/engine/mcp-clients.ts) and [`src/engine/claude-code.ts`](../src/engine/claude-code.ts), so they are the paths Ambit actually opens.

Paths are for macOS and Linux, with `~` as your home directory. Windows keeps these files elsewhere, and Ambit does not read Windows paths yet; the runtime's own documentation has them.

## User files

| Runtime | File | Where the servers are |
| :--- | :--- | :--- |
| [Claude Code](#claude-code) | `~/.claude.json` | `mcpServers` for user scope, and `projects.<path>.mcpServers` for local scope |
| [Claude Desktop](#claude-desktop) | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `~/.config/Claude/claude_desktop_config.json` (Linux) | `mcpServers` |
| [Cursor](#cursor) | `~/.cursor/mcp.json` | `mcpServers` |
| [Windsurf](#windsurf) | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| [Gemini CLI](#gemini-cli) | `~/.gemini/settings.json` | `mcpServers` |
| [Codex CLI](#codex-cli) | `~/.codex/config.toml` | `[mcp_servers.<name>]` tables |
| [OpenCode](#opencode) | `~/.config/opencode/opencode.json`, or `opencode.jsonc` | `mcp` |
| [Cline](#cline-and-roo-code) | VS Code's `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `mcpServers` |
| [Roo Code](#cline-and-roo-code) | VS Code's `globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json` | `mcpServers` |
| [Continue](#continue) | `~/.continue/config.json` | `mcpServers`, or `experimental.modelContextProtocolServers` |
| [Zed](#zed) | `~/.config/zed/settings.json`, or `~/Library/Application Support/Zed/settings.json` | `context_servers` |
| [VS Code](#vs-code) | `~/Library/Application Support/Code/User/mcp.json` (macOS), `~/.config/Code/User/mcp.json` (Linux) | `servers` |

VS Code's `globalStorage` directory is `~/Library/Application Support/Code/User/globalStorage` on macOS and `~/.config/Code/User/globalStorage` on Linux.

## Project files

Each is read only when the runtime works in that repository, and is usually checked in with it. Ambit does not read these yet, so a server declared only in one does not reach its graph.

| Runtime | Project file | Where the servers are |
| :--- | :--- | :--- |
| [Claude Code](#claude-code) | `.mcp.json` at the repository root | `mcpServers` |
| [Cursor](#cursor) | `.cursor/mcp.json` | `mcpServers` |
| [Gemini CLI](#gemini-cli) | `.gemini/settings.json` | `mcpServers` |
| [OpenCode](#opencode) | `opencode.json` at the project root | `mcp` |
| [VS Code](#vs-code) | `.vscode/mcp.json` | `servers` |

## Why the same server breaks when you copy it

Three differences account for most failed copies:

- **The key.** Most runtimes use `mcpServers`. OpenCode uses `mcp`, Zed uses `context_servers`, VS Code uses `servers`, and Codex CLI uses TOML tables named `mcp_servers`. A block pasted under the wrong key is valid JSON that the runtime ignores.
- **The file format.** Codex CLI reads TOML, OpenCode accepts JSON with comments, and the rest read plain JSON. A trailing comma or a comment breaks a plain JSON file.
- **Where a project's servers live.** A server in a project file exists only in that repository, and Claude Code also keeps private per-project servers inside `~/.claude.json`, keyed by the project's path. The same server can be on in one repository and absent in another.

## Claude Code

Claude Code has three scopes. User servers, available in every project, are the top-level `mcpServers` in `~/.claude.json`. Local servers, for one project and visible only to you, are in the same file under `projects.<path>.mcpServers`, keyed by the project's path. Project servers, shared with everyone who clones the repository, are in a `.mcp.json` at its root.

Ambit reads the user and local servers and counts a server once, wherever it is declared; it does not read `.mcp.json` yet. It also reads skills, agents and settings under `~/.claude/`. `CLAUDE_CONFIG` and `CLAUDE_HOME` point Ambit at a different file or directory.

## Claude Desktop

One JSON file with a top-level `mcpServers` object. The macOS path is under `~/Library/Application Support/Claude/`, and the Linux path under `~/.config/Claude/`. `CLAUDE_DESKTOP_CONFIG` overrides it for Ambit.

## Cursor

`~/.cursor/mcp.json`, with `mcpServers` at the top, for servers in every project. A project can add its own in `.cursor/mcp.json`, in the same shape, which Ambit does not read. `CURSOR_MCP_CONFIG` overrides the global path for Ambit.

## Windsurf

`~/.codeium/windsurf/mcp_config.json`, with `mcpServers` at the top. `WINDSURF_MCP_CONFIG` overrides it for Ambit.

## Gemini CLI

`~/.gemini/settings.json`. The servers are under `mcpServers`, beside Gemini CLI's other settings. A project's `.gemini/settings.json` can declare more, in the same shape, and Ambit does not read it. `GEMINI_MCP_CONFIG` overrides the global path for Ambit.

## Codex CLI

`~/.codex/config.toml`, where each server is a table:

```toml
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
```

`CODEX_MCP_CONFIG` overrides it for Ambit.

## OpenCode

`~/.config/opencode/opencode.json`, or `opencode.jsonc` when that is the one present. Servers are under `mcp`, and each can carry `enabled: false` to stay declared and off. OpenCode is the format Ambit's own config switch writes, and `OPENCODE_CONFIG` points Ambit at a different file.

OpenCode also reads an `opencode.json` at a project's root. Ambit does not put its servers on the graph; the **Repos** tab in My Setup reads the project configs of repositories under `REPO_PATH` and says how far each has drifted from the global one.

## Cline and Roo Code

Both are VS Code extensions and keep their servers in the extension's global storage, in a file named `cline_mcp_settings.json` with `mcpServers` at the top. `CLINE_MCP_CONFIG` and `ROO_CODE_MCP_CONFIG` override them for Ambit.

## Continue

`~/.continue/config.json`. Newer versions use `mcpServers`; older ones nest servers under `experimental.modelContextProtocolServers`. Ambit reads either. `CONTINUE_MCP_CONFIG` overrides it.

## Zed

Zed's `settings.json`, under `context_servers`. Linux keeps it in `~/.config/zed/`, macOS in `~/Library/Application Support/Zed/`. `ZED_MCP_CONFIG` overrides it for Ambit.

## VS Code

VS Code's user-level `mcp.json`, under `servers`. Linux keeps it in `~/.config/Code/User/mcp.json`, macOS in `~/Library/Application Support/Code/User/mcp.json`. A workspace can carry its own in `.vscode/mcp.json`, in the same shape, which Ambit does not read. `VSCODE_MCP_CONFIG` overrides the user-level path for Ambit.

## Seeing every runtime's servers at once

Each file answers for one runtime. To see all of them together, with which servers are on, which are failing a check, and what stops working if one goes down:

```bash
npx ambit-cli          # reads every user-level file above that exists, and says what it found
npx ambit-cli status   # which servers are on, what is failing, what has one provider
```

The first run reads every file under [user files](#user-files) that exists, and `status` reports on the result. Nothing leaves the machine, and `npm install -g ambit-cli` or `brew install zz-plant/tap/ambit` keeps the `ambit` command. Or [open the hosted demo](https://zz-plant.github.io/ambit/?demo=1&tour=yours) and paste one of the JSON files into the page, where it is read in the tab and never uploaded.

Related: [what breaks if an MCP server goes down](./mcp-outage.md) and [auditing which MCP servers a coding agent has](./audit-mcp-servers.md).
