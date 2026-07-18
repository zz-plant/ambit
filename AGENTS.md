# Agent Guide

Capability graph engine, ERAS-era SVG and 3D constellation visualizers, MCP server, passive tracking plugin, consultant agent, and teachable skill.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Vanilla CSS, Three.js (React Three Fiber)
- **Store**: Zustand, persisted to browser localStorage
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: Express, serves visualizer API and consultant endpoints
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

Four layout modes toggleable in the HUD: CIV (era columns), CONSTELLATION (3D hex map), ORBITAL (circular), FLAT (2D force-directed).

## Rules

1. **CSS**: Vanilla CSS only. No frameworks.
2. **Git hygiene**: Never commit `node_modules/`, `.playwright-mcp/`, `.DS_Store`.
3. **Data schema**: Back-compatibility required for localStorage format. Changes to the schema require migration.
4. **Config mapping**: The engine accepts any JSON config via `CONFIG_MAPPING` env var. OpenCode format is the default.
5. **Tracking model**: Configuration decisions, not invocation frequency. Plugin writes `built`, `removed`, `unlocked` actions — never `used` counts.
