# Agent Guide

Ambit — the combined action space of the user, their agents, and their machines. See [the roadmap](./docs/roadmap.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, ERAS-era SVG and 3D constellation visualizers, MCP server, passive tracking plugin, consultant agent, and teachable skill.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, vanilla CSS
- **Store**: Zustand, persisted to browser localStorage
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `node:http` in `server.ts` — visualiser API, SSE stream, and static `dist/` in production. It is a reader of the graph: every projection comes from `src/engine/views.ts`, never from SQL written here
- **MCP Server**: JSON-RPC over stdio at `src/mcp/server.ts`, 48 tools
- **Plugin**: Hooks OpenCode config events from `~/.config/opencode/plugins/`

## Core Structure

```
src/engine/engine.ts       Entry point and public surface; re-exports the modules below
src/engine/paths.ts        Where the authored data lives, and which config to read
src/engine/db.ts           The handle, the schema, additive column migrations, backfills
src/engine/ontology.ts     Node kinds and edge kinds — what a thing is, what a relation means
src/engine/discovery.ts    Reading configs, runtimes, people, the curated tree, contracts
src/engine/inference.ts    What follows from the graph — providers, impact, bottlenecks
src/engine/assurance.ts    Verification, evidence, lifecycle, authority, actions, canExecute
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world
src/engine/ledger.ts       Frontier snapshots and how the frontier moved
src/engine/telemetry.ts    The work ledger: runs, events, interventions, consumption
src/engine/attention.ts    Human-agency accounting — what is reducible, what is keeper
src/engine/economics.ts    Declared costs and goal values (dollars declare, cents store)
src/engine/opportunities.ts The opportunity engine — ranked structural changes worth making
src/engine/approval.ts     The approval broker — signed artifacts the executor verifies
src/engine/roi.ts          Realized ROI — before/after windows, written back
src/engine/federation.ts   Signed summaries a portfolio layer reads; receipts, no merging
src/engine/cli.ts          Argument handling and human-readable output
src/control_plane/proxy.ts Autonomous control plane interceptor, DAG gate & OpenTelemetry trace logger
src/control_plane/cli.ts   Control plane CLI execution wrapper
src/engine/schema.sql      SQLite schema (capabilities, dependencies, authority,
                           session_learning, frontier_snapshots, proposals, schema_meta,
                           work ledger, economics, goals, budgets, federation_imports)
src/mcp/server.ts          MCP server exposing 47 tt_* tools to OpenCode sessions
tests/control_plane/       Pytest intervention trace test suite (TDD acceptance tests)
docs/incidents/            Forensic incident traces & asciinema terminal recordings
src/client/                React frontend
  components/
    CivTree.tsx            ERAS-era SVG tech tree with hover tooltips, prereq highlighting, tree filter, inline legend
    StarPanel.tsx          Node detail panel
    ToolchainPanel.tsx     Flat list of all capabilities
    DocsModal.tsx          Documentation overlay with node type legend, connection types, and usage guide
  store/toolchainStore.ts  All state, actions, demo data
  utils/
    civLayout.ts           ERAS column positioning engine
```

## Layout

One renderer: `CivTree.tsx` (SVG), era columns as filter metadata — the 3D modes and their Three.js bundle were sunset. The client is a view over the graph, and `/api/events` (AG-UI state + work/proposal events) keeps it live.

## Typechecking

Two configs, because the halves have different constraints:

- `tsconfig.json` — `src/client`, `strict`.
- `tsconfig.node.json` — engine, MCP server, control plane, `server.ts`, scripts. Also `strict`: `db.ts` narrows the `node:sqlite` handle once at the boundary, so nothing downstream needs the exemption this config used to carry.

Both must stay at zero errors. `npm run typecheck` runs both, and `npm run build` runs it first.

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
1. **Loopback only** — `server.listen(API_PORT, '127.0.0.1')`. Never bind `0.0.0.0`; the LAN and Tailscale must not reach this.
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
7. **Availability**: `state` is structural and is what the frontier ledger records — never change it to express verification. The gate is `lifecycle`: a capability whose lifecycle is `degraded` or `broken` is configured but not working, and every availability decision (plan, simulate, goal, authority, actions, canExecute, near, combos, bottlenecks, spof, deficits, opportunities, roi, status) must exclude it via `usable(lifecycle)`. Never write a state-only availability check; it silently re-admits broken capabilities. New snapshot columns (e.g. `lifecycles`) go through `ADDED_COLUMNS` in `migrate.ts`.
