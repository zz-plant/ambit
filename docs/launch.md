# Ambit launch kit

## Positioning

**Ambit is the meta-MCP capability graph:** the MCP server that maps, audits, and plans across your other MCP servers, agents, credentials, skills, and machines.

Short directory description:

> Map your agent stack as a capability graph. Find broken dependencies, shared credential risks, near-miss unlocks, attention costs, and actions that still require human approval.

## Show HN draft

**Title:** Show HN: Ambit – A Civilization-style capability graph and meta-MCP server

I built Ambit after my agent setup grew from a few tools into a stack of MCP servers, local scripts, skills, credentials, and runtimes. I could see each config file, but not what the whole system could do, what would fail together, or what one missing dependency was blocking.

Ambit is MIT-licensed and local-first. Its Node 22 SQLite engine maps the stack into a capability DAG; the React SVG view renders it as a Civilization-style tech tree; and 48 MCP tools let an agent query the same model.

The parts I use most:

- Blast-radius and single-point-of-failure analysis for tools and credentials.
- Near-miss detection for capabilities that are one or two prerequisites away.
- An attention ledger for permission prompts and other human interventions.
- Reviewable config proposals with signed approval receipts. Agents may propose changes over MCP, but approval and apply stay outside the MCP surface.
- Automatic discovery for OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, and Codex CLI. A server two clients both list stays one capability with two sources.

Zero-install demo: https://zz-plant.github.io/ambit/?demo=1

Repository: https://github.com/zz-plant/ambit

I would especially value feedback on whether the capability model matches how larger agent stacks fail in practice.

## Repository metadata

Suggested GitHub topics:

`mcp`, `modelcontextprotocol`, `claude-code`, `cursor`, `windsurf`, `opencode`, `ai-agents`, `agent-infrastructure`, `dependency-graph`, `tech-tree`, `sqlite`, `developer-tools`

Upload [`docs/assets/ambit-social-preview.png`](./assets/ambit-social-preview.png) in **Settings → General → Social preview**. The asset is 1280×640.

## Directory submissions

Use the short description above for MCP directories and curated lists. Before submitting, confirm each directory's current category names and submission rules. A useful category is **Control Plane / Meta Tools** where the directory supports one; otherwise use developer tools or monitoring.

Where to submit, in the order the traffic justifies:

| Directory | How | Status |
| :--- | :--- | :--- |
| [Official MCP registry](https://registry.modelcontextprotocol.io) | `server.json` at the repo root is written against the 2025-09-29 schema and `package.json` carries the matching `mcpName`. Publishing needs `ambit-cli` on npm first: the registry verifies the package exists and that its `mcpName` matches. Then `mcp-publisher login github` and `mcp-publisher publish` from the repo root. | Waiting on the npm publish |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request adding one line under the developer-tools category, using the short description. | Not yet submitted |
| [Glama](https://glama.ai/mcp/servers) | Claim the server from the GitHub repo; it reads the README and the MCP tool list. | Not yet submitted |
| [PulseMCP](https://www.pulsemcp.com/servers) | Submission form; link the hosted demo as the homepage. | Not yet submitted |
| [mcp.so](https://mcp.so) | Submission form. | Not yet submitted |

Keep the table current: an entry that says "submitted" is the one thing that stops the same directory being submitted twice.

## After the first release on npm

1. Remove the npm note from the README's Get started section and add `npx ambit-cli` beside the Homebrew line. CI's "Check adoption copy" step blocks the change until the package exists on the registry.
2. Publish `server.json` to the MCP registry (above).
3. Re-run the Show HN draft with the one-line install in it.
