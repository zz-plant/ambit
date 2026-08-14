# Agent Guide

Ambit — the combined action space of the user, their agents, and their machines. See [ROADMAP.md](./ROADMAP.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, ERAS-era SVG and 3D constellation visualizers, MCP server, passive tracking plugin, consultant agent, and teachable skill.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Vanilla CSS, Three.js (React Three Fiber)
- **Store**: Zustand, persisted to browser localStorage
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `Bun.serve` in `server.ts` — visualizer API, consultant endpoints, and static `dist/` in production
- **MCP Server**: JSON-RPC over stdio at `src/mcp/server.ts`, 31 tools
- **Plugin**: Hooks OpenCode config events from `~/.config/opencode/plugins/`

## Core Structure

```
src/engine/engine.ts       Entry point and public surface; re-exports the modules below
src/engine/paths.ts        Where the authored data lives, and which config to read
src/engine/db.ts           The handle, the schema, additive column migrations, backfills
src/engine/ontology.ts     Node kinds and edge kinds — what a thing is, what a relation means
src/engine/discovery.ts    Reading configs, runtimes, people, the curated tree, contracts
src/engine/inference.ts    What follows from the graph — providers, impact, bottlenecks
src/engine/assurance.ts    Verification, evidence, lifecycle, authority, actions
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world
src/engine/ledger.ts       Frontier snapshots and how the frontier moved
src/engine/cli.ts          Argument handling and human-readable output
src/engine/schema.sql      SQLite schema (capabilities, dependencies, authority,
                           session_learning, frontier_snapshots, proposals, schema_meta)
src/mcp/server.ts          MCP server exposing 31 tt_* tools to OpenCode sessions
src/client/                React frontend
  components/
    Constellation.tsx       3D hex map (Three.js)
    CivTree.tsx             ERAS-era SVG tech tree with hover tooltips, prereq highlighting, tree filter, inline legend
    StarNode.tsx            3D node with hover/select states
    StarPanel.tsx           Node detail panel
    ToolchainPanel.tsx      Flat list of all capabilities
    ConsultantPanel.tsx     Runs diagnostic checks on selected nodes
    ConnectionLine.tsx      Dependency lines between nodes
    DocsModal.tsx           Documentation overlay with node type legend, connection types, and usage guide
  store/toolchainStore.ts  All state, actions, demo data, layout modes (constellation, civ)
  utils/
    civLayout.ts           ERAS column positioning engine
```

## Layout Modes

Four layout modes toggleable in the HUD: CIV (era columns), CONSTELLATION (3D hex map), ORBITAL (circular), FLAT (2D force-directed). CIV renders through `CivTree.tsx` (SVG); the other three share the Three.js `Constellation.tsx`, which is lazy-loaded so the default CIV view never downloads the 3D bundle.

## Typechecking

Two configs, because the halves have different constraints:

- `tsconfig.json` — `src/client`, full `strict`. Keep it at zero errors.
- `tsconfig.node.json` — engine, MCP server, `server.ts`, scripts. Relaxed, since `node:sqlite` is experimental and types every row as `unknown`.

`bun run typecheck` runs both, and `bun run build` runs it first.

## Concurrent sessions

This machine runs many interactive agent sessions at once, and at least one has
been scoped to this repository (`toolchain-visualizer-c7`). A concurrent session
committed and pushed to `main` mid-edit on 2026-08-12, which is how a database
of local capability data reached the public remote. Before committing, check
whether another session is working in this tree; for parallel work, use a git
worktree rather than sharing this one.

## Security posture

`server.ts` reads and writes `~/.config/opencode/opencode.json`, and `/api/config/apply` can add an MCP server — a command OpenCode will later execute. Two invariants protect that, and neither may be relaxed:

0. **No entry creation** — `/api/config/apply` may edit existing entries only, and only the fields in `AGENT_FIELDS`/`COMMAND_FIELDS`. It must never gain an "add" path: an MCP entry carries a `command` OpenCode executes, so creating one over HTTP is remote code execution. Adding a server goes through `/api/config/mcp-snippet`, which returns text for the user to paste. Entry lookups use `Object.hasOwnProperty` — a bare truth test accepts `__proto__` and pollutes every object in the process.
1. **Loopback only** — `Bun.serve({ hostname: '127.0.0.1' })`. Never bind `0.0.0.0`; the LAN and Tailscale must not reach this.
2. **Origin allowlist** — requests with a non-local `Origin` are rejected with 403 *before* routing. CORS response headers are not sufficient on their own: a simple request (`Content-Type: text/plain`) skips preflight and still reaches the handler, so the check must reject the request, not just omit the header.

## Infrastructure scan

`GET /api/infrastructure/scan` probes devices and services listed in a manifest at `INFRA_MANIFEST` (default `~/.config/opencode/infrastructure.json`). With no manifest the scan returns empty plus one informational finding — no host addresses are hardcoded.

## Rules

1. **CSS**: Vanilla CSS only. No frameworks.
2. **Git hygiene**: Never commit `node_modules/`, `.playwright-mcp/`, `.DS_Store`.
3. **Data schema**: Back-compatibility required for localStorage format. Changes to the schema require migration.
4. **Config mapping**: The engine accepts any JSON config via `CONFIG_MAPPING` env var. OpenCode format is the default.
5. **Domains**: `inferDomain` in `configImporter.ts` assigns every imported item a `meta.domain`, which decides its era column. An item with no domain collapses into `meta` and flattens the tree.
6. **Tracking model**: Configuration decisions, not invocation frequency. Plugin writes `built`, `removed`, `unlocked` actions — never `used` counts.
