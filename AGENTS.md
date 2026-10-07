# Agent Guide

Ambit — what you, your agents, and your machines can jointly do — and where your own time is going. [README.md](./README.md) says what it does, [docs/deep-dive.md](./docs/deep-dive.md) says what the model means, this file says what must not break, and [CONTRIBUTING.md](./CONTRIBUTING.md) says how to get a pull request merged. [SECURITY.md](./SECURITY.md) is the same posture written for someone reviewing it from outside. See [the roadmap](./docs/roadmap.md) for where the data model is heading; treat it as direction, not as description of what exists.

Capability graph engine, an SVG map of the curated tree in era columns, MCP server, control plane interceptor, and the plugins that feed the work ledger from OpenCode and Claude Code.

## Running it

```bash
./bootstrap.sh                          # seed a graph and link the ambit command
./bootstrap.sh web                      # the same, then open the map on :3000
npm run dev                             # API on :3001 and Vite on :3000, together
./cli.js status                         # the CLI from a checkout, nothing installed
npx vitest run src/engine/cli.test.ts   # one test file
./cli.js where                          # which graph is open, and whether it is seeded
```

`ambit web` runs Vite in a checkout. An installed copy has no Vite: it serves the page it shipped with (`dist/index.html` and `dist/assets`, built by `prepack`) from the compiled API server, on the first free loopback port from 3001.

A checkout keeps its graph in the checkout (`toolchain-viz.db`), so the graph you are working on is never the one an installed copy uses; `AMBIT_DB` overrides both. What CI requires before a change lands is in [CONTRIBUTING.md](./CONTRIBUTING.md#the-checks-ci-runs). How to run something belongs where an agent reads, what must pass belongs where a contributor reads.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, vanilla CSS
- **Store**: Zustand, in memory. What survives a reload lives in the URL (`src/client/linkState.ts`), not in storage; the one localStorage key records that the first-run card was seen
- **Engine**: Node.js with `--experimental-sqlite`, schema at `src/engine/schema.sql`
- **Backend**: `node:http` in `src/server/api.ts` — visualizer API, SSE stream, and static `dist/` in production. It is a reader of the graph: every projection comes from `src/engine/views.ts`, never from SQL written here
- **MCP Server**: JSON-RPC over stdio in `src/mcp/`, one `ambit_*` tool per question the engine answers. The roster is in [the deep dive](./docs/deep-dive.md#the-full-mcp-surface); no test holds a count, so do not write one down here
- **Plugins**: `plugins/ambit-telemetry.js` (tool executions and permission prompts → the work ledger) and `plugins/ambit-tracker.js` (configuration changes), both copied to `~/.config/opencode/plugins/`. Each default-exports `{ id, setup, server }`: OpenCode 2 runs `setup` and OpenCode 1 calls `server`, and neither version runs the other's half. Claude Code's are under `plugins/claude-code/`: `ambit`, whose hooks spool tool runs, failures and asks into the same ledger (`src/engine/spool.ts`), and `ambit-gate`

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
                           which lifecycles mean failing or recovering, which interventions are
                           middleware, which ledger actions are a check run, the audit
                           trail's outcome words, and the one graph-summary query
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
                           matched against a machine's capabilities by `detect` patterns. Eras 8
                           and 9 (Product, Operations) are what running a product needs; Launch
                           Ready is a capstone (`detect.requires_met`), reached by its steps
src/engine/mcp-clients.ts  Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex CLI, Cline, Roo Code,
                           Continue, Zed and VS Code config readers: the ten besides OpenCode and Claude Code
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
src/engine/assure/         lifecycle.ts (what the evidence puts it in, `usable`, and what is recovering)
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
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world.
                           `addPerson` is `ambit people add`: a name budgets and approvals can
                           carry, declared from the terminal, granting nothing
                           `decideShown` decides a queue of drafts the page showed, each in its
                           own transaction and bound to the hash it showed
src/engine/approval.ts     The approval broker — signed artifacts the executor verifies
src/engine/delegation.ts   STD-07 revisable delegation records: which capability failed, which
                           grant rested on it, and what the grant became. The gate enforces
                           with no help from here; this explains, afterwards, to whoever asks
src/engine/budgets.ts      Standing spend: a ceiling a person sets on it, and the one rule
                           for when a period has elapsed, which the reset, the gate and the
                           budget view all read
src/engine/ledger.ts       Frontier snapshots and how the frontier moved: one comparison for
                           snapshot to snapshot or to now, and one tick per second as a series
src/engine/telemetry.ts    The work ledger: runs, events, interventions, consumption, and
                           `runTimeline`, one run laid out in time
src/engine/spool.ts        What a Claude Code session did, read into that ledger: the plugin's
                           hooks append to `spoolPath()` (src/shared/db-path.ts), and every CLI
                           command but `gate`, and the MCP server on open, reads it in
src/engine/attention.ts    Human-agency accounting — what is reducible, what is keeper
src/engine/economics.ts    Declared costs and goal values (dollars declare, cents store)
src/engine/opportunities.ts The opportunity engine — ranked structural changes worth making
src/engine/catalog.ts      The acquisition catalog — the supply side for a ranked opportunity;
                           `installText` says what a way to acquire would write, from the tree
src/engine/roi.ts          Realized ROI — before/after windows, written back
src/engine/audit.ts        The trail: who approved what, what ran, and whether it held;
                           `auditStream` merges its four sources, newest first, under one limit
src/engine/machines.ts     What an agent may do on each device the scan found: the gate asked
                           with the device as the target, read only
src/engine/gate.ts         The gate on a runtime's tool call: the Claude Code PreToolUse hook
                           `ambit gate`, which maps a call to its capabilities and denies or asks,
                           and never allows
src/engine/incident.ts     The incident loop — a work run per offline declared service
src/engine/federation.ts   Signed summaries a portfolio layer reads; receipts, no merging
src/engine/portfolio.ts    What the imported environments look like taken together
src/engine/sync.ts         The graph and ledger as one file — no commands, no grants
```

### Engine (planning, projections, CLI)

The distance to a capability, the projections every surface reads, and the dispatch that turns a typed verb into one of them.

```
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/resolve.ts      Which node an id means: normalises, and never guesses
src/engine/plan/           deficits.ts (what keeps stopping work, and whether it is structural)
                           propose.ts (what a change would buy, as something approvable)
                           route.ts (the order of the missing steps, and who each inconveniences)
src/engine/goals.ts        Routing a free-form goal into the graph, and comparing its paths
src/engine/judge.ts        Asking a judgment model on this machine which node an unmatched goal
                           means: a Choice over the tree, loopback only, suggestion only
src/engine/views.ts        The projections the visualizer reads — the server writes no SQL.
                           `loopView` composes status, attention, opportunities, ROI, authority,
                           what to reach next and the week's movement into the one payload
                           /api/loop serves, so the page and the CLI report one ledger; the tree
                           carries each node's providers, authority, reliability, failures and
                           last fourteen check runs. The trail, the frontier's history, one run
                           and each machine's modes are `auditView`, `frontierHistoryView`,
                           `runView` and `machineView`
src/engine/share.ts        The allow-listed, self-contained HTML snapshot of the map
src/engine/cli.ts          Command dispatch; the five groups resolve to flat verbs
src/engine/cli/            groups.ts (the five nouns) · help.ts · seed.ts
                           output.ts (the colour gate, and the generic formatter, which returns
                           lines) · reports.ts (`renderStatus`, and the move `ambit status`
                           ends on; `renderBrief`, the short screen bare `ambit` shows)
src/engine/testing/        The shared test harness: a throwaway graph, driven in-process;
                           terminal.ts runs a function as if on a terminal, or piped
```

### Servers

Three processes put the graph in front of something else: a browser, an agent session, and an intercepted tool call.

```
src/server/api.ts          The visualizer API and SSE stream: reads views, writes config;
                           approves and rejects proposals as the web actor, one at a time or
                           as a queue of shown drafts; serves the audit trail, the frontier's
                           history and one run, read only, and the briefing, which applies any
                           threshold a person already set
src/server/config.ts       The agent config this server will touch: `ownEntry`, the
                           AGENT_FIELDS / COMMAND_FIELDS allow-lists, `writeConfig` (which keeps
                           the file it replaces in `<config>.bak` and refuses the write when it
                           cannot) and the token gate. It cannot create an entry
src/server/repos.ts        How far each repository's config has drifted from the global one
src/server/infrastructure.ts  The device and service topology, probed from INFRA_MANIFEST
src/mcp/tools.ts           What a tool is — the catalogue, as pure data: each tool's schema, what it
                           changes (annotations), and the ten-tool agent profile. No engine imports
src/mcp/validate.ts        A call's arguments checked against the schema the tool advertised
src/mcp/server.ts          What a tool does — a warm handle and the dispatch switch, the handshake
                           (instructions, version negotiation, ping) and the profile it was started with
src/mcp/protocol.ts        JSON-RPC over stdio: how a result or an error leaves the process, and
                           which answers are `isError`
src/control_plane/proxy.ts Autonomous control plane interceptor, DAG gate & OpenTelemetry trace logger
src/control_plane/cli.ts   Control plane CLI execution wrapper
```

### Client

One renderer: `CivTree.tsx` (SVG, drawn by `civ/MapScene.tsx`, which also draws a saved map), the curated tree in era columns — the 3D modes and their Three.js bundle were sunset, and so was the second map that drew the machine's entries in domain columns; those are the rows of My Setup. The store holds one list, the engine's tree merged with the config read-out by id, so every view counts and lists the same things. The client is a view over the graph, and `/api/events` (AG-UI state + work/proposal events) keeps it live.

```
src/client/                React frontend
  App.tsx                  The shell: which view is showing, and how the hooks and panels fit
  fonts.ts                 The three faces, from this origin and latin only: Hubot Sans reads out
                           (titles and figures wide, labels narrow), Mona Sans is the text, Monaspace
                           Neon is code. Which selectors take Hubot is listed once, under TYPE ROLES
                           at the end of App.css; the saved images embed the same files
  linkState.ts             The URL in both directions — which view, node, lens, focus and timeline
                           moment it asks for, and how a view is written back to it. A bare visit
                           to the hosted site is the demo, on the map. `linkFocus` says which node a
                           link selects once the graph is read and whether to collapse to it, and
                           `writeAddress` skips a write the browser refuses. Pure, tested without a
                           window
  hooks/                   useViewport (narrow screens) · useHotkeys · useGraphStream (the AG-UI
                           state stream, and whether it is attached) · useUrlSync (the address bar
                           follows the view) · useGuide · useToast · useLatest · useConfigImport
                           (a pasted or dropped config, read in the tab) · useDialogFocus (a dialog
                           takes the focus when it opens, keeps Tab inside, and gives it back) ·
                           usePressAway (a panel opened from a button closes on a press elsewhere)
  components/
    AppDeck.tsx            The top bar: search, the count for the view, view tabs, live indicator,
                           share, proposals, docs; the map's own tools sit on the map. `mapCounts`
                           counts reached, unproven (a recovering node among them), and a failing
                           node apart from both; the pill
                           shows verified, failing and next steps, and its tooltip the rest. On
                           the demo it adds the Sample tag (which replays the tour) and Map yours.
                           The view tabs are icons with an `aria-label` up to 1270px and the
                           buttons up to 1420px (1520px on the demo), so every control stays on
                           screen from 769px
    Finder.tsx             Search by name; a node opens on the map, an entry in My Setup. The same
                           list holds actions (utils/palette.ts), and Enter runs the one chosen. Its
                           hooks are apart from a hook-free `FinderView`, so a test presses keys on
                           the dialog's own handler
    SetupView.tsx          My Setup: one row per entry, with its evidence, the strip of its last
                           check runs, a switch for a tool server the config holds, and the nodes
                           it provides; repo drift, infrastructure (with what an agent may do on
                           each machine), the agent's briefing and what was used but is on no
                           node of the map as its other tabs
    Journey.tsx            My Setup's opening readout: the loadout's seven legs from A to B, each
                           read from the graph and the ledger, with the one command that moves it
    AuditView.tsx          The Audit view: the trail as one stream, newest first, with a query bar
    ActorMark.tsx          Who acted: a shape for the kind (person, agent, machine, Ambit) and a
                           monogram; drawn only for an id whose prefix says what it is
    WelcomeScreen.tsx      What an empty graph shows: what you and your agents can do and what one
                           step would open, the word *ambit* defined, one number from the demo's
                           best next step with a button that plays it, and the paste box
    ConfigIntake.tsx       Paste a config or pick the file, and where each runtime keeps it
    Tour.tsx               The demo narrated, on the hosted site's first visit: the next step and
                           what it opens, then an outage as the guardrail, a failing check, the
                           approval gate, your config
    MapYours.tsx           The two ways onto the map, paste or install (`YourSetup`), shared by the
                           tour's last card and the dialog the demo header's Map yours opens
    figures.tsx            The sparkline, reach bar and check-run strip every surface draws the same
                           way, and the seal on something signed
    Term.tsx               A house word with its definition attached — one glossary, two renderings
                           (a popover in HTML, a <title> in the SVG map)
    GettingStartedGuide.tsx  The first-run card on a real graph; the demo gets the tour instead
    Toast.tsx              A transient notice from the graph stream
    CivTree.tsx            The map on the page: zoom, selection, one-hop highlighting of what a node
                           needs and enables, focus, the lenses, the two simulations, and the tools
    civ/MapScene.tsx       What the map draws: era heads, edges, nodes and their marks, and the
                           callout on an outage's root. CivTree draws it live; `MapStill` draws it
                           whole, at rest and in the standard lens, for a saved file, with no
                           control, tooltip or class in it
    civ/layout.ts          Column and row placement, the cascade walks (an outage, an unlock, a
                           focus's neighbourhood), `routeTo` (the gap numbered in the order it
                           closes), `unlockedSince` (what a rebuild reached, as the toast says
                           it), the era ladder, label wrapping — pure, and tested apart from
                           the renderer
    civ/viewport.ts        The minimap's arithmetic, which way a failing node lies off screen, and
                           a zoom about a point: the range, and what one wheel event scales by
    civ/usePinchZoom.ts    Every way a zoom arrives, anchored where it was asked for: a trackpad
                           pinch (Ctrl+wheel in Chrome and Firefox, gesture events in Safari), two
                           fingers on a touch screen, and the keys and buttons about the middle
    civ/Minimap.tsx        The thumbnail of the whole map when it does not fit, and its outline
    civ/history.ts         The map as of one observation, with today's names and edges, and the
                           stops Play walks and how long it holds each: pure
    civ/Timeline.tsx       The scrub bar under the map: the frontier's observations, a playhead,
                           and Play, which steps it on a timer the store keeps
    civ/ZoomHud.tsx        Zoom and lens controls, lifted out of the tree, and the map's tools
                           beside zoom: the key, the timeline, the saved image
    civ/MapKey.tsx         The key, opened from those tools; it opens itself under a lens
    civ/ImageMenu.tsx      What Image offers, opened where the key opens: the finding as a card to
                           post, or the whole map as an SVG or a PNG at twice its size
    civ/marks.tsx          The drawings the map and its key share: corner brackets for what the
                           map points at, the keystone wedge, stripes for what refuses, the joint
                           mark, each swatch, and the spec-sheet callout
    civ/SimulationBanner.tsx  The outage / unlock simulation banner
    civ/MapFinding.tsx     The map's one sentence: a failing check, else the best next step. On
                           the demo the next step leads and the failing check is the line under it
    NodeDetailPanel.tsx    Node detail panel: evidence, the impact stated, needs and enables
    EraLadder.tsx          An era opened from its header: reached, next and blocked, in order
    FocusControls.tsx      Focus, from the panel of a selected node: which way, how far, and the
                           pill that says what it hides and ends it; clearing the selection ends it too
    EnvironmentPanels.tsx  What /api/repos/scan and /api/infrastructure/scan return, drawn
    ApprovalModal.tsx      The proposal as a plan (what it does, what undoes it, what it forecasts),
                           the one-click approval receipt, and the queue of drafts to decide together
    DocsModal.tsx          Documentation overlay with node type legend, connection types, and usage guide
    LoopDashboard.tsx      The Time & cost view — the work ledger on shared scales, what may act
                           without asking, what to reach next, and the week's movement, from
                           /api/loop on a real machine and from the fixture on the hosted demo;
                           budgets draw a ceiling and a forecast tick, and an opportunity says what
                           its capability needs
    RunTimeline.tsx        One run in time, with a lane for the person who was asked, and each ask
                           as an exchange: the recorded request, and the answer or that none was
  store/ambitStore.ts      All state and actions; each loader has a live path and a demo path
  store/demo.ts            The demo path's data — graphs, proposals, the placeholder receipt
  vocabulary.test.ts       One name per concept: fails if a surface uses a retired synonym
  testing/elements.ts      `findAll`, how a component test with no DOM finds the element in a
                           hook-free view's drawing and calls the handler it carries
  utils/
    configImporter.ts      inferDomain, and mapping an imported config onto the graph
    demoSnapshot.ts        The hosted demo's LoopSnapshot — the shape /api/loop returns
    demoRun.ts             The hosted demo's sample runs
    checkHistory.ts        Which node's runs a My Setup row shows, and the one `ambit verify` command
                           the page copies and never runs
    configSwitch.ts        Whether a row may offer a switch, and the flip it writes
    palette.ts             The finder's actions and how a key chooses one
    auditQuery.ts          The Audit query bar: actor:, action:, target: and free words
    journey.ts             The seven legs as data: what each says, its state, and its command
    actors.ts              What an actor id names: its kind, its monogram, how it is read aloud
    budgetBar.ts           Where a budget's fill, ceiling and forecast tick sit on its bar
    needs.ts               What a capability needs and whether each need is in place
    runTimeline.ts         One run's lanes, and what its totals say, and how long the record says it
                           lasted (null when nothing does, so no length is stated and no axis drawn)
    keys.ts                What one press of Escape closes, where the page's keys stand aside, where
                           Tab goes in a dialog, and the shell's, the map's and the timeline's own
                           keys, held apart from a modified press. Pure, free of DOM types
    saveImage.ts           A drawing made into a file: `standalone` writes the page's custom
                           properties out and embeds the faces, `svgToPng` draws it on a canvas,
                           `pngScale` keeps a PNG inside every browser's canvas limit
```

### Shared, scripts and plugins

What both halves import, what CI checks, and the two files that run inside another program's process.

```
src/shared/db-path.ts      `resolveDbPath`, the one answer to where the graph is, imported by
                           the engine, the MCP server and the API server
src/shared/opencode.ts     An OpenCode config of either major version, with or without comments,
                           read into the V1 shape every reader uses; and where an edit goes
                           back in the file's own shape (`mcpEntries`, `configSection`)
src/shared/authority.ts    Runtime approval settings, translated into the three modes Ambit
                           records; an unrecognized setting becomes `confirm`, never `autonomous`
src/shared/types.ts        The ontology and domain types every half agrees on
src/shared/api.ts          The wire contract between the API server and the client. Importing it
                           is what makes a rename a compile error instead of an empty panel
src/shared/format.ts       Timestamps, currency and relative time, formatted one way
src/shared/shell.ts        `shellQuote`: an id made safe to put in a command someone will paste
src/shared/nearest.ts      The few names a mistyped one was probably meant to be: it suggests, never decides
src/shared/jsonEdit.ts     `setIn` and `removeIn`: a member spliced into or out of a JSON or JSONC file's
                           text, so `ambit apply` keeps comments and layout and a rollback gives the bytes back
src/shared/backup.ts       `keepBackup`: the `<file>.bak` a config write keeps first, a copy renamed over
                           the old one so a planted link is replaced. `writeConfig` and `ambit connect` use it
src/shared/concepts.json   The glossary: one name per concept, read by the CLI and the map
scripts/capture-doc-examples.ts  The marked console blocks, captured from real engine
                           runs; `--check` is what fails CI when one drifts. README is
                           the only file with any, deliberately: see the file's header
scripts/check-prose.ts     The em dash and "rather than" ceilings, over every comment and
                           document that ships
scripts/check-assets.ts    That every shipped image is the size the page claims
scripts/check-demo-data.ts That demo-data.json still matches what the engine builds from the fixture
scripts/build-docs.ts      The docs as static pages under /ambit/docs/, and the sitemap written
                           from the same list; `npm run build` runs it after Vite
scripts/adapters/          Deeper runtime readers than mcp-clients.ts: claude-code.ts · hermes.ts ·
                           surface.ts (a published capability surface) · telemetry.ts (work events
                           piped to /api/telemetry)
plugins/ambit-telemetry.js Tool executions and permission prompts, into the work ledger
plugins/ambit-tracker.js   Configuration changes: plain JavaScript, transcribing the engine
plugins/claude-code/       The Claude Code plugins the root .claude-plugin/marketplace.json lists:
                           `ambit` (MCP server, session-start briefing, a skill, and
                           scripts/spool.mjs, the hooks' one-line append to the spool) and
                           `ambit-gate` (the PreToolUse gate). Their versions follow
                           package.json; scripts/claude-plugin.test.ts holds that
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
2. **Origin allowlist** — a request whose `Origin` is not this app's page is rejected with 403 *before* routing. The Origin has to name `localhost`, `127.0.0.1` or `[::1]` on a port the page is served from: the API's own, and in a checkout the Vite port `npm run dev` gives both processes as `AMBIT_WEB_PORT` (`pagePorts` in `src/server/config.ts`). A hostname alone is not enough, since every page on this machine is on `localhost` and another project's dev server is not this one. CORS response headers are not sufficient on their own: a simple request (`Content-Type: text/plain`) skips preflight and still reaches the handler, so the check must reject the request, not just omit the header. The `Host` is checked the same way: a request addressed to any name but `localhost`, `127.0.0.1` or `[::1]` is a 403 before routing (`isAllowedHost` in `src/server/config.ts`), because a page that rebinds its own name to loopback is the same origin as the server and passes an origin check by construction. `/api/telemetry` is held to the token rule with the config and decision routes, because a use recorded in a run that succeeded counts toward a promotion threshold; the server writes the token when it starts, and the bridges read it with `readApiToken`.
3. **No entry creation over HTTP** — `/api/config/apply` may edit existing entries only, and only the fields in `AGENT_FIELDS`/`COMMAND_FIELDS`. It copies the file to `<config>.bak` first, by a copy made beside it and renamed over it so a link planted at that name is replaced and never followed, and refuses the write when it cannot. The My Setup switch calls it to write `enabled`, and the page offers the switch only for a name the config read-out already holds. The decision routes write to the graph and never to a config: an approval mints an artifact that only `ambit apply` and the control plane can spend, and a rejection is a row that withdraws it. `/api/proposals/:id/approve` and `/api/proposals/:id/reject` decide one proposal. `/api/proposals/approve` and `/api/proposals/reject` are the queue: an explicit list of at most fifty, answered per id. All four are one guarded decision (`decideDraft` in `governance.ts`): a draft only, bound to the `proposal_hash` the page showed and refused if the row changed, in a transaction of its own. All four decide as `human:web` and none reads an actor from the body, because an approval signed as any person the graph knows is one the control plane accepts, and all four are behind the token rule (`CONFIG_ROUTES` and `DECISION_ROUTE` in `src/server/config.ts`), so a request with no browser behind it must present the API token. A rejection clears the approval artifact, and `verifyApproval` refuses a rejected row. All four declare the `human:web` actor through `ensureActor` before deciding, because the engine refuses a decision from a person the graph does not know and the person at a loopback port is the machine's own; declaring is not granting, and the actor holds no authority. No route runs a declared check: the page copies `ambit verify <id>` and stops, because a check is a command an agent may have registered, and a server that is meant to be a reader must not run it. It must never gain an "add" path: an MCP entry carries a `command` OpenCode executes, so creating one over HTTP is remote code execution. Adding a server goes through `/api/config/mcp-snippet`, which returns text for the user to paste. Entry lookups go through `ownEntry` in `src/server/config.ts`, which requires `Object.hasOwn` and a non-null object value; a bare truth test accepts `__proto__` and pollutes every object in the process. No host addresses are hardcoded either: `GET /api/infrastructure/scan` probes only what the manifest at `INFRA_MANIFEST` names, plus the local Docker socket (`DOCKER_HOST=unix://…` or the daemon and desktop-runtime paths) with one read-only `GET /containers/json`; a TCP `DOCKER_HOST` is never probed. With neither it returns an empty scan plus one informational finding. The scan also asks the gate what this machine's grants let an agent do on each device the scan found, which is a read and writes nothing.
4. **No egress you did not type** — the graph is a local SQLite file and there is no telemetry. Five commands open a socket from Ambit's own code: `ambit notify` and `ambit notify-approvals`, each of which refuses to send without the topic argument you type; `ambit dispatch`, which refuses without a webhook URL from `--to` or `AMBIT_APPROVAL_WEBHOOK` and sends one proposal's summary or signed artifact and never a command (`propose --dispatch` and `approve --dispatch` are the same push); `ambit incidents`, which probes the hosts that same manifest names and uploads nothing; and `ambit goal --judge`, which asks a judgment model on this machine to route a goal the vocabulary could not, only then, and only to a URL `judgeUrl` in `src/engine/judge.ts` parses as loopback with no credentials. Parse the URL, never prefix-match it: `http://127.0.0.1:1@host` passes a prefix test and is a request to `host`. Its answer is a suggestion with a probability and writes nothing. A webhook is one-way: nothing that arrives on it can mint an approval, which only `ambit approve` on a machine holding the key can do. A declared check is the other way out. `ambit verify` runs one, or all of them, `ambit apply` runs the check of what it just applied, and an agent's `ambit_verify` call over MCP does the same; a check is a command, and a curated one may reach the network (Web Research's check fetches `https://example.com`). So a check runs only when a person types the command or an agent calls the tool, and never from the server, which copies `ambit verify <id>` for someone to type. `ambit graph capacity` opens no socket of its own: it runs `tailscale status --json`, `sysctl` and `nvidia-smi` with fixed arguments and no shell, when typed and never from the server, and the first of those asks the local daemon; it sends nothing and writes nothing. `runCommand` in `src/engine/cli.ts` is declared `async` for those alone; every other command finishes before the call returns.

## One glossary

`src/shared/concepts.json` is the glossary, read by the Docs overlay, the `Term` popovers and `ambit help <term>`. Two rules keep it honest, and `src/client/vocabulary.test.ts` enforces both: the word a surface shows is the concept's exact `term` — the ● circle was a Possibility in the detail panel, a Combo in the legend and a Tech tree node in the docs — and a term in the file is a term some surface actually uses. The entries are ordered the way a reader meets them, so the overlay reads as an introduction, not a dictionary.

Where the CLI and the map differ on purpose, the glossary says so instead of picking a winner: the map's keystone is `ambit status`'s bottlenecks, counted differently, and required/optional prerequisites are hard/soft in the data model.

## Rules

1. **CSS**: Vanilla CSS only. No frameworks.
2. **A schema change is additive, and goes through `ADDED_COLUMNS`.** `src/engine/schema.sql` is the shape a fresh graph gets; `ADDED_COLUMNS` in `migrate.ts` is how an existing one reaches it. A column added to the schema and not to that list exists on new machines only, and every read of it fails on the graphs that have the history worth keeping.
3. **A domain reaches an item by one of two paths.** The engine accepts any JSON config through the `CONFIG_MAPPING` env var, with the OpenCode format as the default, and `domain`, `domain_field` and `domain_map` in `src/engine/seed/writers.ts` are where a seeded item gets its domain. That is the path the CLI and every runtime reader take. `inferDomain` in `src/client/utils/configImporter.ts` is the other one, and only a config dropped into the browser ever reaches it. An item with no domain collapses into `meta` and flattens the tree, so debugging that starts at the wrong one of the two is reading a function that never ran.
4. **Tracking model**: Configuration decisions, not invocation frequency. Plugin writes `built`, `removed`, `unlocked` actions — never `used` counts.
5. **The engine counts with one vocabulary**: which states mean *reached*, which lifecycles mean *failing*, *recovering* or *proven*, which intervention kinds are middleware, and the counts every summary reports all live in `src/engine/vocabulary.ts`. Take the SQL fragment from there instead of spelling the list again — the summary query had five copies and the visualizer's differed, agreeing with the rest only because a third state has never been added. `CHECK_RUN_SQL` is the fragment for which ledger actions are a check run, and `CHECK_RUN` holds the two words. The same file holds the not-seeded message, which had four wordings offering three different fixes.
6. **Availability**: `state` is structural and is what the frontier ledger records — never change it to express verification. The gate is `lifecycle`, and the latest check decides: a capability whose lifecycle is `broken`, its last check failed, is configured but not working, and every availability decision (plan, simulate, goal, authority, actions, canExecute, near, combos, bottlenecks, spof, deficits, opportunities, roi, status) must exclude it via `usable(lifecycle)`. A `degraded` capability is recovering: its last check passed and some of its recent ones did not. It is usable, and neither proven nor failing, so every summary counts it with the unproven, and a surface that names it says how its recent runs went ("2 of the last 5 passed"). Holding it out until five passes in a row protected nothing: the most recent run is the best evidence of whether it works now. Never write a state-only availability check; it silently re-admits broken capabilities. A new snapshot column such as `lifecycles` is a schema change, and rule 2 governs it. The era ladder keeps to this: `rungOf` and `columnProgress` in `civ/layout.ts` count a node whose last check failed apart from reached and apart from blocked, and a recovering one as reached.
7. **Nothing that travels may execute.** A registered skill's check is a command, so `ambit sync export` carries the skill node and not its check, and `ambit sync import` never writes `declared_checks`. The same rule already keeps `config_patch` declarative and keeps entry creation off the HTTP API: a command inside a data file is a command that runs on whoever opens it. An authority grant does not travel either — importing one would let a permissive machine widen a careful one by moving a file. A tree overlay is such a file, since a cloned repository can ship `.ambit.json`: `mergeTrees` in `src/engine/paths.ts` keeps every curated authority mode, takes the narrower of curated and overlay per key (`override: true` included), and caps a mode the curated tree never stated at `confirm`, so an overlay narrows and never widens. What the loop page shows of a way to acquire a capability is `installText`, written from the shipped tree and never from an overlay or an imported row. Every id that enters a command Ambit prints for someone to paste goes through `shellQuote` in `src/shared/shell.ts`: an id is whatever an agent or a sync file's author typed, and `skill:x$(rm -rf ~)` pasted into a terminal is a file that travelled and then executed.
8. **Classification belongs to the engine, not the bridge.** A telemetry bridge reports what a runtime said about a failure — exit code, message, error kind — and `src/engine/failures.ts` decides what it means. A bridge that judges for itself what counts as a permission error is a second copy of that rule, and the two will disagree within a release. A failure whose shape says nothing stays unclassified; never guess.
9. **Authority resolution is two rules, in order.** A forbidden grant wins outright at any specificity — a narrower scope must never be a route to something refused. Among what is left, the most specific covering scope governs, ties going to the narrower mode. Never collapse this back to narrowest-wins alone: under that rule a grant saying "autonomous on staging" can never beat a standing "confirm everywhere", and the trade of blast radius for autonomy becomes inexpressible. A sandbox relaxes confirmation and never a refusal, for the same reason. A question that names no target is inside no scope, so a scoped grant may narrow it and never widen it: "autonomous on staging" used to answer yes for an untargeted call, and a Claude Code tool call names no target. `scope.effective`, the narrowest covering grant that `ambit authority scope` reports, is never a surface's answer to what may be done: ask `canExecute`, as `machines.ts` does with a device as the target. Before either rule, a person's live grant takes the place of the curated tree's default for the same capability, scope and holder (`standing` in `decide.ts`), because the default is a suggestion and the grant is the person's decision about it; left to tie, the narrower default won and `ambit authority grant` changed nothing. It never displaces a curated refusal or a runtime's own setting, and once an elevation expires the default decides again. The gate, `authorityReport` and the map all resolve through it.
10. **Only checks count as failures.** Promotion counts passing checks and successful uses; a failed run is not evidence that a capability failed, and attributing a run's outcome to everything it touched would demote whatever a bad afternoon went near. Use carries no object, so it never counts toward a scoped threshold.
11. **Promotion needs a person; demotion needs nobody.** A grant only widens against a threshold someone set in advance (`promote_set_by` records who), never against evidence alone, and never on a `forbidden` grant. It narrows on a single failing check with no one asked. Compare the failing evidence against the row id recorded at promotion, not the timestamp — `datetime('now')` resolves to the second, and a check that fails in the same second would compare as "not after it".
12. **A sync file carries every row its rows point at.** Interventions and capability use hold a foreign key to a work run; exporting the observation without the run meant every one was silently skipped on import, and the import counts it as skipped, not failed. When adding a table to `TABLES` in `sync.ts`, place it after anything it references.
13. **Never write a budget row to record a spend.** `recordSpend` updates a budget that exists and reports that none does otherwise. Inserting one with a zero ceiling made a single recorded cent refuse every later spend, through a row the budget report does not list.
14. **One resolver decides where the graph is.** `resolveDbPath` in `src/shared/db-path.ts` is the only answer, imported by the engine, the MCP server and the API server. Each used to carry its own default, so a correctly seeded install queried over MCP reported an empty environment. An installed copy must never store the graph inside its own install directory: under Homebrew that is the Cellar, which `brew upgrade` deletes.
15. **The plugin transcribes, it does not decide.** `plugins/ambit-tracker.js` is plain JavaScript in another program's process and cannot import the engine, so it repeats `resolveDbPath`, the two pragmas `getDb` sets, and `kindOf`. `plugins/claude-code/ambit/scripts/spool.mjs` repeats `spoolPath` the same way, and `plugins/ambit-telemetry.js` repeats `readApiToken`. Those are transcriptions and must be kept in step; do not let them become second opinions.
16. **An absent value is never rendered as a value.** `era`, `eraName` and `lastChecked` are optional in `TreeItemMeta` because absence is a real answer about a machine; what it looks like is the renderer's to decide. Drop a row or clause that exists only to carry the fact — the Details list filters unstated values, and the evidence banner gates its interval on the computed label, because a `lastChecked` the writing and reading clocks disagree about names none. Keep the slot and print `—` where the slot is structural: a KPI, an aligned `<dt>`. Never unify the two; each is the other's bug. The same rule at the API: `/api/loop` marks its payload `source: 'ledger'` and sets `empty: true` when nothing has been recorded, so the page explains the two telemetry bridges instead of drawing a figure of zeroes, and the hosted demo builds the same `LoopSnapshot` by hand and labels it a sample. A recorder's zero with no end is not a measurement: the control plane writes 0 for a wait it did not time, and the run view counts it as untimed. A new `meta` key goes in three places: `TreeItemMeta`, the panel's `saidElsewhere` when a figure already draws it, and `unstatedNode` in `src/client/components/absence.test.tsx`, which holds the rule.
17. **The prose has an accent; keep it in check.** Most of what is written here was written by a machine, and a machine reaches for the same few constructions until a reader can hear them. Measured over every comment and document that ships, the em dash runs several times the 1 to 3 per thousand words of edited English, and "rather than" an order of magnitude above the 0.3 it runs there. The two want different answers. Almost every dash sits in a sentence already holding two or more commas, where it outranks them and earns its place: when they were audited, ten could become a comma without loss, and flattening the rest would read worse. "rather than" has no such defense, being one phrase standing in for "instead of", "not", "never" or a rewritten clause, so vary it. `npm run prose:check` holds a ceiling on both, which CI runs; it fails on the corpus drifting up, never on one sentence, and the numbers are meant to come down. A changelog and an incident trace are records of what was said at the time, so they are excluded and not edited.
18. **Colour goes only to a terminal, and is never the only signal.** `colorOn` in `src/engine/cli/output.ts` allows escapes when stdout is a TTY and `NO_COLOR` is unset (an empty value counts as unset), so a pipe, a file and a CI log read what was written and not what was painted. A formatter takes a palette and returns lines, and the data sink and `--json` never see one. A row that wants a person carries a `›` that survives a pipe. Every surface follows this: `renderStatus`, the generic formatter, `seed`, `explain` and the first-run and unknown-command lines take their palette from `terminalPalette`, which asks stdout, or stderr for a line written there. `cli.js` is plain JavaScript and cannot import it, so it transcribes `colorOn` for its own help lines, and the two must stay in step. The same reader that sets a colour sets an exit code: a command whose answer is a top-level string `error` exits 1 (`raiseExitCode` in `output.ts`, never on the sink), an unknown command exits 2, and `--exit-code` on `can` and `verify` maps the decision or the check to a code.

19. **The MCP contract is checked, not described.** A call is validated against the schema the tool advertised (`src/mcp/validate.ts`), so an argument the schema does not declare is refused with the names it does, and a new argument is declared in `tools.ts` before the server will take it. A failed call is `isError: true`, by the one rule the CLI's exit code also follows: a top-level string `error` in the answer, never one nested inside a report. A tool is annotated read-only only if calling it changes no table, and `server.test.ts` calls every tool that says so against a copy of a seeded graph and compares them all; a tool that writes a row of Ambit's own bookkeeping, as `ambit_can` and `ambit_briefing` do, is listed as a write. Every tool that takes a capability goes through `resolveCapability`, which normalises a prefix, a case or a display name and never picks between two nodes or invents one for an id the graph does not hold. The listing has a byte budget, 20,000 for all of it and 5,000 for the agent profile, so a new tool or a longer description may have to shorten another.

20. **The gate only narrows.** `ambit gate` answers a Claude Code PreToolUse hook with *deny* (forbidden, or over a budget), *ask* (asks first, no grant yet, or a last check that failed; a recovering capability is decided by its grant) or nothing (allowed, or a tool the graph cannot name), so Claude Code's own permission settings decide what remains. It never answers *allow*: that would let the graph widen what a person set in their runtime, and the runtime's own settings are the person's last word on what runs without asking. A call it cannot read, or a graph it cannot open, is no answer, and it exits 0 so a broken gate never blocks the person's work. It maps a tool to capabilities with `attribute` in `failures.ts`, the matching failures and the unmapped report use, so the three cannot disagree about what a tool is.

21. **A page does not narrate itself.** Where an outline, a table legend or a heading already says what a page or section does, the sentence repeating it goes: a count of what follows is the version that needs editing every time the list changes. What no heading can carry stays: positioning ("This is intent, not description"), provenance (that the numbers are the hosted demo's, that the table comes from the readers in src), and reading warnings. Covers the docs and the client's copy.
