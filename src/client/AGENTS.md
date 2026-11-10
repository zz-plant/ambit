# Client guide

Read [the root guide](../../AGENTS.md) first: it has the commands, the check that says a change is done, and every rule in one line. This file is the full text for `src/client`. The rule numbers are the root's, so `AGENTS.md rule 9` in a comment means Rule 9 here.

## Drawing the map

Work on how the map draws starts at the specimen page: `npx vite`, or the `ambit-specimen` launch configuration, then `/ambit/dev/specimen.html`. It draws every node state at three times its size through the map's own code, beside the key entry for it, and `?still` draws them as a saved file does. `npm run render:images` writes the files the Image menu saves, and the specimen page whole, from a headless Chrome: this checkout's graph, or the demo with `--demo`. The demo carries a failing check and a recovering one, so the stripes and the waver show without a graph of your own. `npm run shots` photographs every view at 1440×900, 1280×720 and a phone, with a contact sheet, and flags the frames a machine can fault: a status pill that wraps, a map column cut at the left edge or under the panel, a simulation's banner over an era name, an outage's callout off the map, a view still loading. Look at it before a pull request that changes how a view looks; `--live --home <dir>` adds the machine's own views from a fixture's configs.

## Client

One renderer: `CivTree.tsx` (SVG, drawn by `civ/MapScene.tsx`, which also draws a saved map), the curated tree in era columns — the 3D modes and their Three.js bundle were sunset, and so was the second map that drew the machine's entries in domain columns; those are the rows of My Setup. The store holds one list, the engine's tree merged with the config read-out by id, so every view counts and lists the same things. The client is a view over the graph, and `/api/events` (AG-UI state + work/proposal events) keeps it live.

```
src/client/                React frontend
  App.tsx                  The shell: which view is showing, which section of My Setup, and how
                           the hooks and panels fit; Back and Forward re-enter through `popstate`,
                           applying what the address says the same way a first visit does
  fonts.ts                 The three faces, from this origin and latin only: Hubot Sans reads out
                           (titles and figures wide, labels narrow), Mona Sans is the text, Monaspace
                           Neon is code. Which selectors take Hubot is listed once, under TYPE ROLES
                           at the end of App.css; the saved images embed the same files
  linkState.ts             The URL in both directions — which view, which section of My Setup,
                           node, lens, focus and timeline moment it asks for, and how a view is
                           written back to it. A change of view or section is a navigation and is
                           pushed, so Back and Forward step between them (`addressMode` draws the
                           line); the rest replaces, and `writeAddress` skips a write the browser
                           refuses. Old view words (`tree`, `config`, `loop`) read as aliases, so a
                           link written before the rename still lands. A bare visit to the hosted
                           site is the demo, on the map. `linkFocus` says which node a link selects
                           once the graph is read and whether to collapse to it. Pure, tested
                           without a window
  hooks/                   useViewport (narrow screens, and how much a card laid over the map
                           covers at its bottom or its right) · useHotkeys · useGraphStream (the AG-UI
                           state stream, and whether it is attached) · useUrlSync (the address bar
                           follows the view, pushing a change of place and replacing the rest) ·
                           useGuide · useToast · useLatest · useConfigImport
                           (a pasted or dropped config, read in the tab) · useDialogFocus (a dialog
                           takes the focus when it opens, keeps Tab inside, and gives it back) ·
                           usePressAway (a panel opened from a button closes on a press elsewhere)
  components/
    AppDeck.tsx            The top bar: search, the count for the view, the five view tabs, live
                           indicator, share, docs; the map's own tools sit on the map, and the
                           waiting-draft count sits on the Proposals tab. `mapCounts`
                           counts reached, unverified (a recovering node among them), and a failing
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
                           it provides. Three sections, owned by the shell so the address bar can
                           name one: Entries, closing with what was used but is on no node of the
                           map and, behind a fold, the Journey; Environment (repo drift, infrastructure with what an agent may do
                           on each machine); Briefing (what an agent is told at connect)
    Journey.tsx            Where a setup is headed, at the end of My Setup's entries: the loadout's
                           seven legs from A to B, each read from the graph and the ledger, with the
                           one command that moves it
    AuditView.tsx          The Audit view: the trail as one stream, newest first, with a query bar
    ActorMark.tsx          Who acted: a shape for the kind (person, agent, machine, Ambit) and a
                           monogram; drawn only for an id whose prefix says what it is
    WelcomeScreen.tsx      What an empty graph shows: what you and your agents can do and what one
                           step would open, the word *ambit* defined, one number from the demo's
                           best next step with a button that plays it, and the intake
    ConfigIntake.tsx       Which agent you use, asked first (`AGENTS` in hooks/useConfigImport.ts),
                           then its config pasted or picked, with the path to copy; or the servers
                           it runs, ticked (`PICKS`). The agent names the runtime a bare file omits
    YourAmbit.tsx          The readout: what was read, how much of the tree it reaches, the next
                           steps by the engine's rule, what is not verified yet, and one command. For
                           a config read in the tab when it is read, and for the machine's own graph
                           on the first visit to `ambit web`, where the steps are `/api/loop`'s.
                           readout-parity.test.ts holds the tab to what `ambit` says of one config
    Tour.tsx               The demo narrated, on the hosted site's first visit: the sample's next
                           step lit, with the intake under it, then for whoever asks an outage as
                           the guardrail, a failing check and the approval gate
    MapYours.tsx           The intake and the install line (`YourSetup`), in the dialog the demo
                           header's Map yours opens
    figures.tsx            The sparkline, reach bar and check-run strip every surface draws the same
                           way, and the seal on something signed
    Command.tsx            A command as a person will paste it, broken across lines only at its
                           spaces: an id broken at its hyphen read as two ids
    Term.tsx               A house word with its definition attached — one glossary, two renderings
                           (a popover in HTML, a <title> in the SVG map)
    Icon.tsx               A line icon: the text's colour on a square grid, hidden from a screen
                           reader, since the control around it carries the name
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
                           it, with `reachedQuote`, the tree's own line for one node), `eurekaOf`
                           (how full the asks draw a next step), the era ladder, label
                           wrapping, and where a frame starts so it cuts no column
                           (`snapToBand`, `wholeColumnZoom`) — pure, and tested apart from
                           the renderer
    civ/viewport.ts        The minimap's arithmetic, which way a failing node lies off screen, and
                           a zoom about a point: the range, and what one wheel event scales by
    civ/usePinchZoom.ts    Every way a zoom arrives, anchored where it was asked for: a trackpad
                           pinch (Ctrl+wheel in Chrome and Firefox, gesture events in Safari), two
                           fingers on a touch screen, and the keys and buttons about the middle
    civ/Minimap.tsx        The thumbnail of the whole map when it does not fit, and its outline
    civ/history.ts         The map as of one observation, with today's names and edges, and the
                           stops Play walks and how long it holds each: pure
    civ/Timeline.tsx       The scrub bar under the map: the frontier's observations (a diamond
                           over one that reached something emergent), a playhead, and Play,
                           which steps it on a timer the store keeps
    civ/ZoomHud.tsx        Zoom and lens controls, lifted out of the tree, and the map's tools
                           beside zoom: the key, the timeline, the saved image
    civ/MapKey.tsx         The key, opened from those tools; it opens itself under a lens
    civ/ImageMenu.tsx      What Image offers, opened where the key opens: the finding as a card to
                           post, the whole map as an SVG or a PNG at twice its size, or the relief
    civ/Relief.tsx         The map as a plate in relief, saved and never drawn on the page: what is
                           reached raised as ground and lit from the first era, the frontier cut as
                           one line, the era names and one line of counts, and no node named
    civ/marks.tsx          The drawings the map and its key share: corner brackets for what the
                           map points at, the keystone wedge, the part fill inside a next step
                           that was asked for, stripes for what refuses, the joint mark, each
                           swatch, and the spec-sheet callout. `MapFilters` holds the two
                           textures, each over one half of a node: a ring that slips off its fill
                           for what is recovering, and a fill eaten through for what an outage stops.
                           `mapKeys` is each key entry, which the key, the strip and the specimens read
    civ/SimulationBanner.tsx  The outage / unlock simulation banner. An outage's has a track: play,
                           drag or step the cascade a hop at a time, with what each hop takes
                           named beside it, and the sentence ends on `outageRemedy`
    civ/useOutagePlayhead.ts  Which hop of an outage the map has drawn up to, and whether it is
                           playing. An outage already running when the map mounts is drawn whole,
                           and under reduced motion nothing plays
    civ/MapFinding.tsx     The map's one sentence: a failing check, else the best next step. On
                           the demo the next step leads and the failing check is the line under it
    NodeDetailPanel.tsx    Node detail panel: evidence, the impact stated, the ladder its grant
                           stands on and the one command that moves it, needs and enables
    EraLadder.tsx          An era opened from its header: reached, next and blocked, in order
    FocusControls.tsx      Focus, from the panel of a selected node: which way, how far, and the
                           pill that says what it hides and ends it; clearing the selection ends it too
    EnvironmentPanels.tsx  What /api/repos/scan and /api/infrastructure/scan return, drawn
    ApprovalModal.tsx      The approval gate as the demo's tour narrates it over the map: a dialog
                           over the desk the Proposals view draws, so the narration and the page
                           can never disagree about what approving does
    ProposalsView.tsx      The Proposals view: the desk as a page, named by the address bar and
                           reached by `g` and `]`
    ProposalsDesk.tsx      The decisions, drawn once: the waiting drafts as a queue, each draft as
                           a plan (what it does, what undoes it, what it forecasts), the one-click
                           approval receipt, and the queue of drafts to decide together
    DocsModal.tsx          Documentation overlay with node type legend, connection types, and usage guide
    Council.tsx            The council: the first step to reach, read by five seats, each a
                           sentence with its command and a stance; it says when they are split
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
  testing/page.ts          `seed`, the store as a server render reads it, and `stubBrowser`, a
                           window and localStorage for one test file
  dev/                     Pages Vite serves in a checkout and the build never reads.
                           specimen.html: every node state, drawn by MapScene (`specimens.ts` is
                           the list). render.html: what `npm run render:images` drives
  utils/
    configImporter.ts      inferDomain, and mapping an imported config onto the graph
    placeInTab.ts          A config read in the tab placed on the curated tree, by the engine's
                           rule: whose file it is, what every runtime brings, and its model
    demoSnapshot.ts        The hosted demo's LoopSnapshot — the shape /api/loop returns
    demoRun.ts             The hosted demo's sample runs
    checkHistory.ts        Which node's runs a My Setup row shows, and the one `ambit verify` command
                           the page copies and never runs
    configSwitch.ts        Whether a row may offer a switch, and the flip it writes
    palette.ts             The finder's actions and how a key chooses one
    auditQuery.ts          The Audit query bar: actor:, action:, target: and free words
    journey.ts             The seven legs as data: what each says, its state, and its command
    carry.ts               A tool server's carry weight as a row, the Tool servers heading and the
                           panel say it, with each runtime's total from `src/shared/carry.ts`
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
    mapFile.tsx            The whole map, or the relief, as the file the Image menu saves
```

## One glossary

`src/shared/concepts.json` is the glossary, read by the Docs overlay, the `Term` popovers and `ambit help <term>`. Two rules keep it honest, and `src/client/vocabulary.test.ts` enforces both: the word a surface shows is the concept's exact `term` — the ● circle was a Possibility in the detail panel, a Combo in the legend and a Tech tree node in the docs — and a term in the file is a term some surface actually uses. The entries are ordered the way a reader meets them, so the overlay reads as an introduction, not a dictionary.

Where the CLI and the map differ on purpose, the glossary says so instead of picking a winner: the map's keystone is `ambit status`'s bottlenecks, counted differently, and required/optional prerequisites are hard/soft in the data model.

## Rules

**Rule 1.** **CSS**: Vanilla CSS only. No frameworks.

**Rule 16.** **An absent value is never rendered as a value.** `era`, `eraName` and `lastChecked` are optional in `TreeItemMeta` because absence is a real answer about a machine; what it looks like is the renderer's to decide. Drop a row or clause that exists only to carry the fact — the Details list filters unstated values, and the evidence banner gates its interval on the computed label, because a `lastChecked` the writing and reading clocks disagree about names none. Keep the slot and print `—` where the slot is structural: a KPI, an aligned `<dt>`. Never unify the two; each is the other's bug. The same rule at the API: `/api/loop` marks its payload `source: 'ledger'` and sets `empty: true` when nothing has been recorded, so the page explains the two telemetry bridges instead of drawing a figure of zeroes, and the hosted demo builds the same `LoopSnapshot` by hand and labels it a sample. A recorder's zero with no end is not a measurement: the control plane writes 0 for a wait it did not time, and the run view counts it as untimed. A new `meta` key goes in three places: `TreeItemMeta`, the panel's `saidElsewhere` when a figure already draws it, and `unstatedNode` in `src/client/components/absence.test.tsx`, which holds the rule.

**Rule 21.** **A page does not narrate itself.** Where an outline, a table legend or a heading already says what a page or section does, the sentence repeating it goes: a count of what follows is the version that needs editing every time the list changes. What no heading can carry stays: positioning ("This is intent, not description"), provenance (that the numbers are the hosted demo's, that the table comes from the readers in src), and reading warnings. Covers the docs and the client's copy.
