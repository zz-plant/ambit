# Where each AI agent keeps its MCP config

Every agent runtime stores its MCP servers in its own file, under its own key, and a config copied from one into another usually fails without an error. The file and the key for each runtime Ambit reads come from the readers in [`src/engine/mcp-clients.ts`](../src/engine/mcp-clients.ts) and [`src/engine/claude-code.ts`](../src/engine/claude-code.ts), so the table stays as current as the code that uses it.

The paths are the ones Ambit reads on macOS and Linux, with `~` as your home directory. Windows keeps these files elsewhere, and Ambit does not read Windows paths yet; the runtime's own documentation has them.

## The table

| Runtime | File | Where the servers are |
| :--- | :--- | :--- |
| [Claude Code](#claude-code) | `~/.claude.json` | `mcpServers`, and `projects.<path>.mcpServers` for each project |
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

VS Code's `globalStorage` directory is `~/Library/Application Support/Code/User/globalStorage` on macOS and `~/.config/Code/User/globalStorage` on Linux.

## Why the same server breaks when you copy it

Three differences account for most failed copies:

- **The key.** Most runtimes use `mcpServers`. OpenCode uses `mcp`, Zed uses `context_servers`, and Codex CLI uses TOML tables named `mcp_servers`. A block pasted under the wrong key is valid JSON that the runtime ignores.
- **The file format.** Codex CLI reads TOML, OpenCode accepts JSON with comments, and the rest read plain JSON. A trailing comma or a comment breaks a plain JSON file.
- **Where a project's servers live.** Claude Code keeps per-project servers inside `~/.claude.json`, keyed by the project's path, so the same server can be on in one repository and absent in another.

## Claude Code

`~/.claude.json` holds both the global `mcpServers` and a `projects` map whose entries each carry their own `mcpServers`. Skills, agents and settings live under `~/.claude/`. Ambit reads both and counts a server once, wherever it is declared. `CLAUDE_CONFIG` and `CLAUDE_HOME` point Ambit at a different file or directory.

## Claude Desktop

One JSON file with a top-level `mcpServers` object. The macOS path is under `~/Library/Application Support/Claude/`, and the Linux path under `~/.config/Claude/`. `CLAUDE_DESKTOP_CONFIG` overrides it for Ambit.

## Cursor

`~/.cursor/mcp.json`, with `mcpServers` at the top. `CURSOR_MCP_CONFIG` overrides it for Ambit.

## Windsurf

`~/.codeium/windsurf/mcp_config.json`, with `mcpServers` at the top. `WINDSURF_MCP_CONFIG` overrides it for Ambit.

## Gemini CLI

`~/.gemini/settings.json`. The servers are under `mcpServers`, beside Gemini CLI's other settings. `GEMINI_MCP_CONFIG` overrides it for Ambit.

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

## Cline and Roo Code

Both are VS Code extensions and keep their servers in the extension's global storage, in a file named `cline_mcp_settings.json` with `mcpServers` at the top. `CLINE_MCP_CONFIG` and `ROO_CODE_MCP_CONFIG` override them for Ambit.

## Continue

`~/.continue/config.json`. Newer versions use `mcpServers`; older ones nest servers under `experimental.modelContextProtocolServers`. Ambit reads either. `CONTINUE_MCP_CONFIG` overrides it.

## Zed

Zed's `settings.json`, under `context_servers`. Linux keeps it in `~/.config/zed/`, macOS in `~/Library/Application Support/Zed/`. `ZED_MCP_CONFIG` overrides it for Ambit.

## Seeing every runtime's servers at once

Each file answers for one runtime. To see all of them together, with which servers are on, which are failing a check, and what stops working if one goes down:

```bash
brew install zz-plant/tap/ambit
ambit seed
ambit status
```

`ambit seed` reads every file above that exists, and `ambit status` reports on the result. Nothing leaves the machine. Or [open the hosted demo](https://zz-plant.github.io/ambit/?demo=1) and paste one config into the page, where it is read in the tab and never uploaded.

Related: [what breaks if an MCP server goes down](./mcp-outage.md) and [auditing which MCP servers a coding agent has](./audit-mcp-servers.md).
