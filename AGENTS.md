# Agent Guide

Ambit — what you, your agents, and your machines can jointly do — and where your own time is going. [README.md](./README.md) says what it does, [docs/deep-dive.md](./docs/deep-dive.md) says what the model means, this file says what must not break, and [CONTRIBUTING.md](./CONTRIBUTING.md) says how to get a pull request merged. [SECURITY.md](./SECURITY.md) is the same posture written for someone reviewing it from outside. See [the roadmap](./docs/roadmap.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, ERAS-era SVG visualizer, MCP server, control plane interceptor, and passive tracking plugins for OpenCode.

## Running it

```bash
./bootstrap.sh                          # seed a graph and link the ambit command
./bootstrap.sh web                      # the same, then open the map on :3000
npm run dev                             # API on :3001 and Vite on :3000, together
./cli.js status                         # the CLI from a checkout, nothing installed
npx vitest run src/engine/cli.test.ts   # one test file
./cli.js where                          # which graph is open, and whether it is seeded
```

A checkout keeps its graph in the checkout (`toolchain-viz.db`), so the graph you are working on is never the one an installed copy uses; `AMBIT_DB` overrides both. What CI requires before a change lands is in [CONTRIBUTING.md](./CONTRIBUTING.md#the-checks-ci-runs). How to run something belongs where an agent reads, what must pass belongs where a contributor reads.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, vanilla CSS
- **Store**: Zustand, in memory. What survives a reload lives in the URL (`src/client/linkState.ts`), not in storage; the one localStorage key records that the first-run card was seen
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `node:http` in `src/server/api.ts` — visualizer API, SSE stream, and static `dist/` in production. It is a reader of the graph: every projection comes from `src/engine/views.ts`, never from SQL written here
- **MCP Server**: JSON-RPC over stdio in `src/mcp/`, one `ambit_*` tool per question the engine answers. The roster is in [the deep dive](./docs/deep-dive.md#the-full-mcp-surface); no test holds a count, so do not write one down here
- **Plugins**: `plugins/ambit-telemetry.js` (tool executions and permission prompts → the work ledger) and `plugins/ambit-tracker.js` (configuration changes), both copied to `~/.config/opencode/plugins/`

## Core Structure

### Engine (handle and schema)

Opening the graph, the shape a row has, and how a database made last year reaches the shape this checkout expects.

```
src/engine/engine.ts       Entry point and public surface; re-exports the modules below
src/engine/paths.ts        Where the authored data lives, and which config to read
src/engine/db.ts           The handle, the schema, additive column migrations, backfills
src/engine/rows.ts         What a row of each table looks like — a query names its row type from here
src/engine/migrate.ts      Bringing a database up to the current schema — ADDED_COLUMNS lives here
src/engine/ontology.ts     Node kinds and edge kinds — what a thing is, what a relation means
src/engine/vocabulary.ts   The words the engine counts with — which states mean reached,
                           which lifecycles mean failing, which interventions are
                           middleware, and the one graph-summary query
src/engine/schema.sql      SQLite schema (capabilities, dependencies, authority, catalog,
                           preferences, synergies, session_learning, frontier_snapshots,
                           proposals, proposal_rejections, schema_meta, work ledger,
                           economics, goals, budgets, federation_imports, failure_signals,
                           declared_checks, sandboxes, delegation_records,
                           delegation_sources)
```

### Engine (discovery and seeding)

How a machine becomes a graph: which passes run, what each one writes, and which runtimes are read to get there.

```
src/engine/discovery.ts    Orchestrates the seed: which passes run, in what order
src/engine/seed/           What each pass actually writes
  writers.ts               Kind-stamping writers, and the config mapping
  structure.ts             Runtimes, models, dependencies, combos, infrastructure
  declared.ts              Actors, authority, catalog, credentials, economics
  techtree.ts              The curated tree
src/engine/techtree.json   The curated tree itself: authored content, the same for everyone,
                           matched against a machine's capabilities by `detect` patterns
src/engine/mcp-clients.ts  Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex config readers
src/engine/claude-code.ts  Reads a Claude Code install into the shape seedFromConfig accepts
```

### Engine (inference and assurance)

Four questions about one structure, and the second question every answer has to survive: does it work, and may it be used.

```
src/engine/inference.ts    The seam over graph/ — four questions about one structure
src/engine/graph/          frontier.ts (near misses, decay) · health.ts (domains, bottlenecks)
                           fragility.ts (providers, credentials, blast radius, spofs)
                           surface.ts (full export, runtime vocabulary, affordance domains)
src/engine/assurance.ts    The seam over assure/ — does it work, and may it be used
src/engine/assure/         lifecycle.ts (what the evidence puts it in, and `usable`)
                           verify.ts (running a declared check) · decide.ts (canExecute)
                           reports.ts (the authority model as a person reads it)
                           promote.ts (a grant that widens on evidence, narrows on one failure)
src/engine/failures.ts     Failures the runtime already reported, classified and attributed
src/engine/skills.ts       Skills the agent wrote, registered with the check that proves them
src/engine/objects.ts      What may be done to what, and what is proved there
src/engine/observed.ts     What a person actually approves, from approvals and refusals
src/engine/reversibility.ts  What could be acquired without a person, and what could not
src/engine/briefing.ts     What an agent knows before its first tool call — also the MCP
                           resource ambit://briefing
src/engine/next.ts         What to reach next and why — observed blocks, then leverage
```

### Engine (governance, economics, ledger)

Everything that can change the world, everything that prices it, and the records that say afterwards what it cost.

```
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world
src/engine/approval.ts     The approval broker — signed artifacts the executor verifies
src/engine/delegation.ts   STD-07 revisable delegation records: which capability failed, which
                           grant rested on it, and what the grant became. The gate enforces
                           with no help from here; this explains, afterwards, to whoever asks
src/engine/budgets.ts      Standing spend: delegated authority with a ceiling
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
src/engine/sync.ts         The graph and ledger as one file — no commands, no grants
```

### Engine (planning, projections, CLI)

The distance to a capability, the projections every surface reads, and the dispatch that turns a typed verb into one of them.

```
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/plan/           deficits.ts (what keeps stopping work, and whether it is structural)
                           propose.ts (what a change would buy, as something approvable)
                           route.ts (the order of the missing steps, and who each inconveniences)
src/engine/goals.ts        Routing a free-form goal into the graph, and comparing its paths
src/engine/views.ts        The projections the visualizer reads — the server writes no SQL.
                           `loopView` composes status, attention, opportunities and ROI into the
                           one payload /api/loop serves, so the page and the CLI report one ledger
src/engine/share.ts        The allow-listed, self-contained HTML snapshot of the map
src/engine/cli.ts          Command dispatch; the five groups resolve to flat verbs
src/engine/cli/            groups.ts (the five nouns) · help.ts · output.ts · reports.ts · seed.ts
src/engine/testing/        The shared test harness: a throwaway graph, driven in-process
```

### Servers

Three processes put the graph in front of something else: a browser, an agent session, and an intercepted tool call.

```
src/server/api.ts          The visualizer API and SSE stream: reads views, writes config
src/server/config.ts       The agent config this server will touch: `ownEntry`, and the
                           AGENT_FIELDS / COMMAND_FIELDS allow-lists. It cannot create an entry
src/server/repos.ts        How far each repository's config has drifted from the global one
src/server/infrastructure.ts  The device and service topology, probed from INFRA_MANIFEST
src/mcp/tools.ts           What a tool is — the catalogue, as pure data. No engine imports
src/mcp/server.ts          What a tool does — a warm handle and the dispatch switch
src/mcp/protocol.ts        JSON-RPC over stdio: how a result or an error leaves the process
src/control_plane/proxy.ts Autonomous control plane interceptor, DAG gate & OpenTelemetry trace logger
src/control_plane/cli.ts   Control plane CLI execution wrapper
```

### Client

One renderer: `CivTree.tsx` (SVG), era columns as filter metadata — the 3D modes and their Three.js bundle were sunset. The client is a view over the graph, and `/api/events` (AG-UI state + work/proposal events) keeps it live.

```
src/client/                React frontend
  App.tsx                  The shell: which view is showing, and how the hooks and panels fit
  linkState.ts             The URL in both directions — what it asks for, and how a view is written
                           back to it. Pure, tested without a window
  hooks/                   useViewport (narrow screens, the console) · useHotkeys · useGraphStream
                           (the AG-UI state stream, and whether it is attached) · useUrlSync (the
                           address bar follows the view) · useGuide · useToast · useLatest
  components/
    AppDeck.tsx            The top bar: list toggle, view tabs, live indicator, share, proposals, docs
    WelcomeScreen.tsx      What an empty graph shows — the pitch, two real figures, and the ways in
    figures.tsx            The sparkline, era strip and reach bar every surface draws the same way
    Term.tsx               A house word with its definition attached — one glossary, two renderings
                           (a popover in HTML, a <title> in the SVG map)
    GettingStartedGuide.tsx  The first-run card
    Toast.tsx              A transient notice from the graph stream
    CivTree.tsx            ERAS-era SVG tech tree with hover tooltips, prereq highlighting, tree filter, inline legend
    civ/layout.ts          ERAS column positioning — pure, and tested apart from the renderer
    civ/ZoomHud.tsx        Zoom and lens controls, lifted out of the tree
    civ/SimulationBanner.tsx  The outage / unlock simulation banner
    NodeDetailPanel.tsx    Node detail panel
    CapabilityListPanel.tsx   Capabilities, repo drift and infrastructure — one panel, three tabs
    EnvironmentPanels.tsx  What /api/repos/scan and /api/infrastructure/scan return, drawn
    ApprovalModal.tsx      The proposal diff, and the one-click approval receipt
    DocsModal.tsx          Documentation overlay with node type legend, connection types, and usage guide
    LoopDashboard.tsx      The Time & cost view — the work ledger on shared scales, from /api/loop
                           on a real machine and from the fixture on the hosted demo
  store/ambitStore.ts      All state and actions; each loader has a live path and a demo path
  store/demo.ts            The demo path's data — graphs, proposals, the placeholder receipt
  vocabulary.test.ts       One name per concept: fails if a surface uses a retired synonym
  utils/
    configImporter.ts      inferDomain, and mapping an imported config onto the graph
    demoSnapshot.ts        The hosted demo's LoopSnapshot — the shape /api/loop returns
```

### Shared, scripts and plugins

What both halves import, what CI checks, and the two files that run inside another program's process.

```
src/shared/db-path.ts      `resolveDbPath`, the one answer to where the graph is, imported by
                           the engine, the MCP server and the API server
src/shared/authority.ts    Runtime approval settings, translated into the three modes Ambit
                           records; an unrecognized setting becomes `confirm`, never `autonomous`
src/shared/types.ts        The ontology and domain types every half agrees on
src/shared/api.ts          The wire contract between the API server and the client. Importing it
                           is what makes a rename a compile error instead of an empty panel
src/shared/format.ts       Timestamps, currency and relative time, formatted one way
src/shared/concepts.json   The glossary: one name per concept, read by the CLI and the map
scripts/capture-doc-examples.ts  The marked console blocks, captured from real engine
                           runs; `--check` is what fails CI when one drifts. README is
                           the only file with any, deliberately: see the file's header
scripts/check-prose.ts     The em dash and "rather than" ceilings, over every comment and
                           document that ships
scripts/check-assets.ts    That every shipped image is the size the page claims
scripts/check-demo-data.ts That demo-data.json still matches what the engine builds from the fixture
scripts/adapters/          Deeper runtime readers than mcp-clients.ts: claude-code.ts · hermes.ts ·
                           surface.ts (a published capability surface) · telemetry.ts (work events
                           piped to /api/telemetry)
plugins/ambit-telemetry.js Tool executions and permission prompts, into the work ledger
plugins/ambit-tracker.js   Configuration changes: plain JavaScript, transcribing the engine
```

## Typechecking

Two configs, because the halves have different constraints:

- `tsconfig.json` — `src/client`, `strict`.
- `tsconfig.node.json` — engine, MCP server, control plane, the API server, scripts. Also `strict`: `db.ts` narrows the `node:sqlite` handle once at the boundary, so nothing downstream needs the exemption this config used to carry.

Both must stay at zero errors. `npm run typecheck` runs both, and `npm run build` runs it first.

## Working in this tree

More than one agent session may be working in this checkout. Before committing, check whether the tree has changes that are not yours; for parallel work, use a git worktree, never this one. A concurrent session committed and pushed mid-edit on 2026-08-12, which is how a database of local capability data reached the public remote. `*.db` is ignored now, and that is the class of accident a worktree prevents.

## Security posture

The reviewer-facing statement of these is [SECURITY.md](./SECURITY.md); below is what the code must do.

`src/server/api.ts` reads and writes `~/.config/opencode/opencode.json`, and `/api/config/apply` can enable an MCP server — a command OpenCode will later execute. Four invariants protect that, and none may be relaxed:

1. **Loopback only** — `server.listen(API_PORT, '127.0.0.1')`. Never bind `0.0.0.0`; the LAN and Tailscale must not reach this.
2. **Origin allowlist** — requests with a non-local `Origin` are rejected with 403 *before* routing. CORS response headers are not sufficient on their own: a simple request (`Content-Type: text/plain`) skips preflight and still reaches the handler, so the check must reject the request, not just omit the header.
3. **No entry creation over HTTP** — `/api/config/apply` may edit existing entries only, and only the fields in `AGENT_FIELDS`/`COMMAND_FIELDS`. It must never gain an "add" path: an MCP entry carries a `command` OpenCode executes, so creating one over HTTP is remote code execution. Adding a server goes through `/api/config/mcp-snippet`, which returns text for the user to paste. Entry lookups go through `ownEntry` in `src/server/config.ts`, which requires `Object.hasOwn` and a non-null object value; a bare truth test accepts `__proto__` and pollutes every object in the process. No host addresses are hardcoded either: `GET /api/infrastructure/scan` probes only what the manifest at `INFRA_MANIFEST` names, and returns an empty scan plus one informational finding when there is none.
4. **No egress you did not type** — the graph is a local SQLite file and there is no telemetry. Three commands open a socket at all: `ambit notify` and `ambit notify-approvals`, each of which refuses to send without the topic argument you type, and `ambit incidents`, which probes the hosts that same manifest names and uploads nothing. `runCommand` in `src/engine/cli.ts` is declared `async` for those three alone; every other command finishes before the call returns.

## One glossary

`src/shared/concepts.json` is the glossary, read by the Docs overlay, the `Term` popovers and `ambit help <term>`. Two rules keep it honest, and `src/client/vocabulary.test.ts` enforces both: the word a surface shows is the concept's exact `term` — the ● circle was a Possibility in the detail panel, a Combo in the legend and a Tech tree node in the docs — and a term in the file is a term some surface actually uses. The entries are ordered the way a reader meets them, so the overlay reads as an introduction, not a dictionary.

Where the CLI and the map differ on purpose, the glossary says so instead of picking a winner: the map's keystone is `ambit status`'s bottlenecks, counted differently, and required/optional prerequisites are hard/soft in the data model.

## Rules

1. **CSS**: Vanilla CSS only. No frameworks.
2. **A schema change is additive, and goes through `ADDED_COLUMNS`.** `src/engine/schema.sql` is the shape a fresh graph gets; `ADDED_COLUMNS` in `migrate.ts` is how an existing one reaches it. A column added to the schema and not to that list exists on new machines only, and every read of it fails on the graphs that have the history worth keeping.
3. **A domain reaches an item by one of two paths.** The engine accepts any JSON config through the `CONFIG_MAPPING` env var, with the OpenCode format as the default, and `domain`, `domain_field` and `domain_map` in `src/engine/seed/writers.ts` are where a seeded item gets its domain. That is the path the CLI and every runtime reader take. `inferDomain` in `src/client/utils/configImporter.ts` is the other one, and only a config dropped into the browser ever reaches it. An item with no domain collapses into `meta` and flattens the tree, so debugging that starts at the wrong one of the two is reading a function that never ran.
4. **Tracking model**: Configuration decisions, not invocation frequency. Plugin writes `built`, `removed`, `unlocked` actions — never `used` counts.
5. **The engine counts with one vocabulary**: which states mean *reached*, which lifecycles mean *failing* or *proven*, which intervention kinds are middleware, and the counts every summary reports all live in `src/engine/vocabulary.ts`. Take the SQL fragment from there instead of spelling the list again — the summary query had five copies and the visualizer's differed, agreeing with the rest only because a third state has never been added. The same file holds the not-seeded message, which had four wordings offering three different fixes.
6. **Availability**: `state` is structural and is what the frontier ledger records — never change it to express verification. The gate is `lifecycle`: a capability whose lifecycle is `degraded` or `broken` is configured but not working, and every availability decision (plan, simulate, goal, authority, actions, canExecute, near, combos, bottlenecks, spof, deficits, opportunities, roi, status) must exclude it via `usable(lifecycle)`. Never write a state-only availability check; it silently re-admits broken capabilities. A new snapshot column such as `lifecycles` is a schema change, and rule 2 governs it.
7. **Nothing that travels may execute.** A registered skill's check is a command, so `ambit sync export` carries the skill node and not its check, and `ambit sync import` never writes `declared_checks`. The same rule already keeps `config_patch` declarative and keeps entry creation off the HTTP API: a command inside a data file is a command that runs on whoever opens it. An authority grant does not travel either — importing one would let a permissive machine widen a careful one by moving a file.
8. **Classification belongs to the engine, not the bridge.** A telemetry bridge reports what a runtime said about a failure — exit code, message, error kind — and `src/engine/failures.ts` decides what it means. A bridge that judges for itself what counts as a permission error is a second copy of that rule, and the two will disagree within a release. A failure whose shape says nothing stays unclassified; never guess.
9. **Authority resolution is two rules, in order.** A forbidden grant wins outright at any specificity — a narrower scope must never be a route to something refused. Among what is left, the most specific covering scope governs, ties going to the narrower mode. Never collapse this back to narrowest-wins alone: under that rule a grant saying "autonomous on staging" can never beat a standing "confirm everywhere", and the trade of blast radius for autonomy becomes inexpressible. A sandbox relaxes confirmation and never a refusal, for the same reason.
10. **Only checks count as failures.** Promotion counts passing checks and successful uses; a failed run is not evidence that a capability failed, and attributing a run's outcome to everything it touched would demote whatever a bad afternoon went near. Use carries no object, so it never counts toward a scoped threshold.
11. **Promotion needs a person; demotion needs nobody.** A grant only widens against a threshold someone set in advance (`promote_set_by` records who), never against evidence alone, and never on a `forbidden` grant. It narrows on a single failing check with no one asked. Compare the failing evidence against the row id recorded at promotion, not the timestamp — `datetime('now')` resolves to the second, and a check that fails in the same second would compare as "not after it".
12. **A sync file carries every row its rows point at.** Interventions and capability use hold a foreign key to a work run; exporting the observation without the run meant every one was silently skipped on import, and the import counts it as skipped, not failed. When adding a table to `TABLES` in `sync.ts`, place it after anything it references.
13. **Never write a budget row to record a spend.** `recordSpend` updates a budget that exists and reports that none does otherwise. Inserting one with a zero ceiling made a single recorded cent refuse every later spend, through a row the budget report does not list.
14. **One resolver decides where the graph is.** `resolveDbPath` in `src/shared/db-path.ts` is the only answer, imported by the engine, the MCP server and the API server. Each used to carry its own default, so a correctly seeded install queried over MCP reported an empty environment. An installed copy must never store the graph inside its own install directory: under Homebrew that is the Cellar, which `brew upgrade` deletes.
15. **The plugin transcribes, it does not decide.** `plugins/ambit-tracker.js` is plain JavaScript in another program's process and cannot import the engine, so it repeats `resolveDbPath`, the two pragmas `getDb` sets, and `kindOf`. Those are transcriptions and must be kept in step; do not let them become second opinions.
16. **An absent value is never rendered as a value.** `era`, `eraName` and `lastChecked` are optional in `TreeItemMeta` because absence is a real answer about a machine; what it looks like is the renderer's to decide. Drop a row or clause that exists only to carry the fact — the Details list filters unstated values, and the evidence banner gates its interval on the computed label, because a `lastChecked` the writing and reading clocks disagree about names none. Keep the slot and print `—` where the slot is structural: a KPI, an aligned `<dt>`. Never unify the two; each is the other's bug. The same rule at the API: `/api/loop` marks its payload `source: 'ledger'` and sets `empty: true` when nothing has been recorded, so the page explains the two telemetry bridges instead of drawing a figure of zeroes, and the hosted demo builds the same `LoopSnapshot` by hand and labels it a sample. `src/client/components/absence.test.tsx` holds the rule.
17. **The prose has an accent; keep it in check.** Most of what is written here was written by a machine, and a machine reaches for the same few constructions until a reader can hear them. Measured over every comment and document that ships, the em dash runs several times the 1 to 3 per thousand words of edited English, and "rather than" an order of magnitude above the 0.3 it runs there. The two want different answers. Almost every dash sits in a sentence already holding two or more commas, where it outranks them and earns its place: when they were audited, ten could become a comma without loss, and flattening the rest would read worse. "rather than" has no such defense, being one phrase standing in for "instead of", "not", "never" or a rewritten clause, so vary it. `npm run prose:check` holds a ceiling on both, which CI runs; it fails on the corpus drifting up, never on one sentence, and the numbers are meant to come down. A changelog and an incident trace are records of what was said at the time, so they are excluded and not edited.
