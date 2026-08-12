# Agent Guide

Capability graph engine, ERAS-era SVG and 3D constellation visualizers, MCP server, passive tracking plugin, consultant agent, and teachable skill.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Vanilla CSS, Three.js (React Three Fiber)
- **Store**: Zustand, persisted to browser localStorage
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `Bun.serve` in `server.ts` — visualizer API, consultant endpoints, and static `dist/` in production
- **MCP Server**: JSON-RPC over stdio at `src/mcp/server.ts`, 17 tools
- **Plugin**: Hooks OpenCode config events from `~/.config/opencode/plugins/`

## Core Structure

```
src/engine/engine.ts       Capability discovery, graph seeding, all analytical functions
src/engine/schema.sql      SQLite schema (capabilities, dependencies, session_learning)
src/mcp/server.ts          MCP server exposing 17 tt_* tools to OpenCode sessions
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

## Security posture

`server.ts` reads and writes `~/.config/opencode/opencode.json`, and `/api/config/apply` can add an MCP server — a command OpenCode will later execute. Two invariants protect that, and neither may be relaxed:

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
