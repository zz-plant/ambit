# Agent Guide

Ambit — what you, your agents, and your machines can jointly do — and where your own time is going. See [the roadmap](./docs/roadmap.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, ERAS-era SVG visualiser, MCP server, control plane interceptor, and passive tracking plugins for OpenCode.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, vanilla CSS
- **Store**: Zustand, persisted to browser localStorage
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `node:http` in `src/server/api.ts` — visualiser API, SSE stream, and static `dist/` in production. It is a reader of the graph: every projection comes from `src/engine/views.ts`, never from SQL written here
- **MCP Server**: JSON-RPC over stdio in `src/mcp/`, 48 `ambit_*` tools
- **Plugins**: `plugins/ambit-telemetry.js` (tool executions and permission prompts → the work ledger) and `plugins/ambit-tracker.js` (configuration changes), both copied to `~/.config/opencode/plugins/`

## Core Structure

```
src/engine/engine.ts       Entry point and public surface; re-exports the modules below
src/engine/paths.ts        Where the authored data lives, and which config to read
src/engine/db.ts           The handle, the schema, additive column migrations, backfills
src/engine/rows.ts         What a row of each table looks like — a query names its row type from here
src/engine/migrate.ts      Bringing a database up to the current schema — ADDED_COLUMNS lives here
src/engine/ontology.ts     Node kinds and edge kinds — what a thing is, what a relation means
src/engine/discovery.ts    Orchestrates the seed: which passes run, in what order
src/engine/seed/           What each pass actually writes
  writers.ts               Kind-stamping writers, and the config mapping
  structure.ts             Runtimes, models, dependencies, combos, infrastructure
  declared.ts              Actors, authority, catalog, credentials, economics
  techtree.ts              The curated tree
src/engine/mcp-clients.ts  Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex config readers
src/engine/claude-code.ts  Reads a Claude Code install into the shape seedFromConfig accepts
src/engine/inference.ts    The seam over graph/ — four questions about one structure
src/engine/graph/          frontier.ts (near misses, decay) · health.ts (domains, bottlenecks)
                           fragility.ts (providers, credentials, blast radius, spofs)
                           surface.ts (full export, runtime vocabulary, affordance domains)
src/engine/assurance.ts    The seam over assure/ — does it work, and may it be used
src/engine/assure/         lifecycle.ts (what the evidence puts it in, and `usable`)
                           verify.ts (running a declared check) · decide.ts (canExecute)
                           reports.ts (the authority model as a person reads it)
                           promote.ts (a grant that widens on evidence, narrows on one failure)
src/engine/briefing.ts     What an agent knows before its first tool call — also the MCP
                           resource ambit://briefing
src/engine/next.ts         What to reach next and why — observed blocks, then leverage
src/engine/failures.ts     Failures the runtime already reported, classified and attributed
src/engine/skills.ts       Skills the agent wrote, registered with the check that proves them
src/engine/sync.ts         The graph and ledger as one file — no commands, no grants
src/engine/budgets.ts      Standing spend: delegated authority with a ceiling
src/engine/objects.ts      What may be done to what, and what is proved there
src/engine/observed.ts     What a person actually approves, from approvals and refusals
src/engine/reversibility.ts  What could be acquired without a person, and what could not
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/goals.ts        Routing a free-form goal into the graph, and comparing its paths
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world
src/engine/approval.ts     The approval broker — signed artifacts the executor verifies
src/engine/ledger.ts       Frontier snapshots and how the frontier moved
src/engine/telemetry.ts    The work ledger: runs, events, interventions, consumption
src/engine/attention.ts    Human-agency accounting — what is reducible, what is keeper
src/engine/economics.ts    Declared costs and goal values (dollars declare, cents store)
src/engine/opportunities.ts The opportunity engine — ranked structural changes worth making
src/engine/catalog.ts      The acquisition catalog — the supply side for a ranked opportunity
src/engine/roi.ts          Realized ROI — before/after windows, written back
src/engine/audit.ts        The trail: who approved what, what ran, and whether it held
src/engine/incident.ts     The incident loop — a work run per offline declared service
src/engine/federation.ts   Signed summaries a portfolio layer reads; receipts, no merging
src/engine/portfolio.ts    What the imported environments look like taken together
src/engine/views.ts        The projections the visualiser reads — the server writes no SQL
src/engine/share.ts        The allow-listed, self-contained HTML snapshot of the map
src/engine/cli.ts          Command dispatch; the five groups resolve to flat verbs
src/engine/cli/            groups.ts (the five nouns) · help.ts · output.ts · reports.ts · seed.ts
src/engine/testing/        The shared test harness: a throwaway graph, driven in-process
src/engine/schema.sql      SQLite schema (capabilities, dependencies, authority,
                           session_learning, frontier_snapshots, proposals, schema_meta,
                           work ledger, economics, goals, budgets, federation_imports,
                           failure_signals, declared_checks, sandboxes,
                           proposal_rejections)
src/control_plane/proxy.ts Autonomous control plane interceptor, DAG gate & OpenTelemetry trace logger
src/control_plane/cli.ts   Control plane CLI execution wrapper
src/mcp/tools.ts           What a tool is — the catalogue, as pure data. No engine imports
src/mcp/server.ts          What a tool does — a warm handle and the dispatch switch
src/mcp/protocol.ts        JSON-RPC over stdio: how a result or an error leaves the process
docs/incidents/            Forensic incident traces & asciinema terminal recordings
src/client/                React frontend
  App.tsx                  The shell: which view is showing, and how the hooks and panels fit
  linkState.ts             What a URL asks the app to open on — pure, tested without a window
  hooks/                   useViewport (narrow screens, the console) · useHotkeys · useGraphStream
                           (the AG-UI state stream) · useGuide · useToast · useLatest
  components/
    AppDeck.tsx            The top bar: list toggle, view tabs, proposals, docs
    WelcomeScreen.tsx      What an empty graph shows — the pitch and the ways in
    GettingStartedGuide.tsx  The first-run card
    Toast.tsx              A transient notice from the graph stream
    CivTree.tsx            ERAS-era SVG tech tree with hover tooltips, prereq highlighting, tree filter, inline legend
    civ/layout.ts          ERAS column positioning — pure, and tested apart from the renderer
    civ/ZoomHud.tsx        Zoom and lens controls, lifted out of the tree
    civ/SimulationBanner.tsx  The outage / unlock simulation banner
    NodeDetailPanel.tsx    Node detail panel
    CapabilityListPanel.tsx   Flat list of all capabilities
    ApprovalModal.tsx      The proposal diff, and the one-click approval receipt
    DocsModal.tsx          Documentation overlay with node type legend, connection types, and usage guide
    DemoDashboard.tsx      The hosted demo's landing view
  store/ambitStore.ts      All state and actions; each loader has a live path and a demo path
  store/demo.ts            The demo path's data — graphs, proposals, the placeholder receipt
  store/toolchainStore.ts  The store's former name, re-exported so old imports keep working
  utils/
    configImporter.ts      inferDomain, and mapping an imported config onto the graph
    demoSnapshot.ts        The fixture the hosted demo renders
```

## Layout

One renderer: `CivTree.tsx` (SVG), era columns as filter metadata — the 3D modes and their Three.js bundle were sunset. The client is a view over the graph, and `/api/events` (AG-UI state + work/proposal events) keeps it live.

## Typechecking

Two configs, because the halves have different constraints:

- `tsconfig.json` — `src/client`, `strict`.
- `tsconfig.node.json` — engine, MCP server, control plane, the API server, scripts. Also `strict`: `db.ts` narrows the `node:sqlite` handle once at the boundary, so nothing downstream needs the exemption this config used to carry.

Both must stay at zero errors. `npm run typecheck` runs both, and `npm run build` runs it first.

## Concurrent sessions

This machine runs many interactive agent sessions at once, and at least one has
been scoped to this repository (`toolchain-visualizer-c7`). A concurrent session
committed and pushed to `main` mid-edit on 2026-08-12, which is how a database
of local capability data reached the public remote. Before committing, check
whether another session is working in this tree; for parallel work, use a git
worktree rather than sharing this one.

## Security posture

`src/server/api.ts` reads and writes `~/.config/opencode/opencode.json`, and `/api/config/apply` can add an MCP server — a command OpenCode will later execute. Two invariants protect that, and neither may be relaxed:

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
8. **Nothing that travels may execute.** A registered skill's check is a command, so `ambit sync export` carries the skill node and not its check, and `ambit sync import` never writes `declared_checks`. The same rule already keeps `config_patch` declarative and keeps entry creation off the HTTP API: a command inside a data file is a command that runs on whoever opens it. An authority grant does not travel either — importing one would let a permissive machine widen a careful one by moving a file.
9. **Classification belongs to the engine, not the bridge.** A telemetry bridge reports what a runtime said about a failure — exit code, message, error kind — and `src/engine/failures.ts` decides what it means. A bridge that judges for itself what counts as a permission error is a second copy of that rule, and the two will disagree within a release. A failure whose shape says nothing stays unclassified; never guess.
10. **Authority resolution is two rules, in order.** A forbidden grant wins outright at any specificity — a narrower scope must never be a route to something refused. Among what is left, the most specific covering scope governs, ties going to the narrower mode. Never collapse this back to narrowest-wins alone: under that rule a grant saying "autonomous on staging" can never beat a standing "confirm everywhere", and the trade of blast radius for autonomy becomes inexpressible. A sandbox relaxes confirmation and never a refusal, for the same reason.
11. **Only checks count as failures.** Promotion counts passing checks and successful uses; a failed run is not evidence that a capability failed, and attributing a run's outcome to everything it touched would demote whatever a bad afternoon went near. Use carries no object, so it never counts toward a scoped threshold.
12. **Promotion needs a person; demotion needs nobody.** A grant only widens against a threshold someone set in advance (`promote_set_by` records who), never against evidence alone, and never on a `forbidden` grant. It narrows on a single failing check with no one asked. Compare the failing evidence against the row id recorded at promotion, not the timestamp — `datetime('now')` resolves to the second, and a check that fails in the same second would compare as "not after it".
