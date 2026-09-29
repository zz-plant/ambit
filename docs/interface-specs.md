# Interface specs

> This is intent, not description. [The roadmap](./roadmap.md) says what each part of Ambit decided and what it still lacks. This page takes sixteen changes to the surfaces and says, for each, what it would do, what it has to read, and how anyone would know it was finished. Nothing here is built unless its section says so. The "Today" paragraphs describe the code at the time of writing, so check one against the file before relying on it.

## Where these came from

A scan of the interfaces people already use to see, gate and price an agent stack. Two kinds turned up. **Competitors** are what a person uses today in Ambit's place: editor panels that list MCP servers, server directories, workflow canvases, trace viewers, and the permission prompts in coding agents. **Neighbors** solved one sub-problem Ambit shares: dependency graphs, service scorecards, deployment approvals, usage pages, machine lists.

Each spec credits where the idea was seen and takes one behavior from it. Nothing is copied. The behavior is described in Ambit's words and would be drawn from Ambit's own data and [glossary](../src/shared/concepts.json).

## How to read a spec

Each one answers the four questions [the feature-request template](../.github/ISSUE_TEMPLATE/feature_request.md) asks: what the person is trying to find out, where the answer would live, what it has to read, and what they would do differently once they had it. Then it says what is true today, what changes, which rules and checks it touches, and what done means in terms a test can hold. "Rule N" is a rule in [AGENTS.md](../AGENTS.md#rules).

The status is one of three:

- **Ready.** Buildable from the spec as written.
- **Decision first.** One call by the owner, named in the spec, comes before code. Each has a recommended answer, collected [at the end](#decisions-with-recommendations).
- **Data first.** The graph does not record something the surface needs, so a producer changes before the page can show it.

Size is loose. S is a file and its test. M is a projection, a route or a component with new tests. L crosses the engine, the wire contract and the client, or waits on new recording.

## At a glance

| ID | Change | Lands in | Size | Status |
| :--- | :--- | :--- | :--- | :--- |
| [M1](#m1-collapse-to-the-neighborhood) | Collapse the map to a node's neighborhood | Map | M | Decision first |
| [M2](#m2-a-minimap-that-carries-the-alarm) | A minimap that carries the alarm | Map | M | Ready |
| [M3](#m3-scrub-the-frontier-through-time) | Scrub the frontier through time | Map | L | Ready live, Data first for the demo |
| [S1](#s1-the-row-is-the-report) | A check-history strip on each row | My Setup | M | Decision first |
| [S2](#s2-switch-tool-count-show-output) | An MCP switch, and the output of a failing check | My Setup | L | Decision first |
| [S3](#s3-a-ladder-made-of-named-rules) | An era ladder of named rules | Map | M | Ready |
| [S4](#s4-what-it-needs-and-is-it-met-here) | What an option needs, met here | Time & cost | L | Data first |
| [G1](#g1-plan-first-then-apply) | Plan first, then apply | Proposals | S | Ready |
| [G2](#g2-review-the-queue-sign-once-each) | Review the queue, sign once each | Proposals | M | Decision first |
| [G3](#g3-once-here-or-never) | A scoped grant, proposed from what interrupts you | Authority | L | Decision first |
| [G4](#g4-the-trail-one-line-per-event) | The trail, one line per event | Audit | M | Decision first |
| [L1](#l1-spans-with-a-lane-for-you) | A run's spans with a lane for you | Time & cost | L | Data first |
| [L2](#l2-a-ceiling-with-a-forecast-tick) | A budget ceiling with a forecast tick | Time & cost | M | Ready |
| [L3](#l3-one-row-per-machine) | One row per machine | My Setup, Infra | L | Data first |
| [K1](#k1-a-palette-that-speaks-verbs) | A palette that speaks verbs | Finder | M | Ready |
| [K2](#k2-the-terminal-is-a-surface-too) | `ambit status` as a designed surface | CLI | S | Ready |

## Suggested order

The order that follows dependency and risk, not the IDs.

1. **Nothing to decide, no schema change.** K2, G1, S3, L2 and K1. Each is a projection or a component over data that already ships. K2 regenerates the README's console blocks, and L2 wants `period_start` on the wire.
2. **A read-only projection or route.** M2, M3 on a live graph, the first slice of G4, and S1 once its series is chosen. Each needs a `views.ts` projection, a wire type and a demo branch.
3. **Decisions before code.** M1, G2, G3 and S2. After them come the three that wait on recording: L1, L3 and S4.

M2 has the weakest case at today's 35 nodes, and the roadmap plans for hundreds. Build it with M1, or when a graph outgrows one screen.

## Map

### M1. Collapse to the neighborhood

*Seen in Nx's project graph. Size M. Status: decision first.*

**The question.** What does this one node touch, on a map too big to read at once?

**Today.** Selecting a node lights its one-hop neighbors and dims the rest, and nothing is hidden (`buildAdjacency` in `src/client/components/civ/layout.ts`, drawn by `CivTree.tsx`). The multi-hop walks exist for the simulations only. `outageSplit`, `unlockCascade` and `gapOf` carry the simulation rules, and `cascadeDepths` counts downstream hops. None takes a depth or a direction. The demo tree is 35 curated nodes in seven era columns, so a three-hop focus on a busy node still shows about half of it. The case grows with the graph.

**The change.** A Focus toggle on the selected node keeps only its neighborhood on the map. Beside it sit a direction (Needs, Both, Enables), a depth (1 to 3, default 2), and a pill that says how many nodes are hidden and clears the focus.

- A pure `neighbourhood(connections, id, depth, direction, within)` in `layout.ts` returns the ids to draw. `within` is the set of drawn ids. The edge list holds edges to nodes the map does not draw (the demo has 97 edges, and 42 of them join two drawn nodes), and counting hops through them would show a neighborhood the person cannot see.
- Hidden nodes are skipped where position is derived, in three places in `CivTree.tsx`, and never removed from the index. Columns keep their positions, so the map does not jump. A true collapse that reorders rows comes later, because `ColumnCount` and fit-zoom both assume the full column.
- Simulations ignore the focus. "Losing Shell Execution stops 9" counts the whole cascade and says so when part of it is hidden.
- Focus keys on the selection, never on hover, and `j` and `k` skip hidden nodes.

**Decision.** Default on, or opt in. Every existing `focus` link, the tour and the hero recording select nodes, so a default that hides things changes all of them.

**Rules and checks.** Reload state lives in the URL only, so `src/client/linkState.ts` gains a collapse flag, `depth` and `dir`, with defaults omitted. `focus` already means selected, and letting it imply collapse would change every existing link. Header counts stay whole-map. Client only, no demo path. Tests: `layout.test.ts`, `linkState.test.ts` (make the new field optional, or the fixture `base` stops typechecking) and `reachable.test.tsx` for a way in.

**Done when.** `neighbourhood` is tested per direction and depth, including edges that leave the drawn set. The counter equals total minus drawn. A link without the new keys opens today's map, and a link with them opens the same view. Escape and the pill both clear it. The outage banner still reports the full cascade.

### M2. A minimap that carries the alarm

*Seen in workflow canvases such as n8n and Flowise. Size M. Status: ready.*

**The question.** Where am I on this map, and is anything wrong out of sight?

**Today.** No viewport state exists to read. Zoom is local to `CivTree.tsx`, and pan is the native scroll of the `.civ-scroll` container. Nothing in `src/client` listens to scroll or resize. The failing row already exists (`MapFinding.tsx`). Its Show button selects the node and recenters, but the row hides while anything is selected or simulated, and it names no direction. Corner room is tight: the top row holds the zoom HUD, the finding and the tour, the legend sits bottom-left, and the 340px detail panel takes the right edge, becoming a 60% sheet at 768px and below. At 35 nodes the need is weak.

**The change.** A thumbnail at the bottom-right of the canvas area, left of the detail panel. It shows seven era bars with a dot per node, failing dots red (`isFailing`), and the viewport outlined and draggable. It draws only when the whole map does not fit, so today's demo shows none. The failing row names its direction, as in "off-screen left".

- `CivTree` passes `containerRef`, `zoom`, the content size and `nodePositionMap` down. The minimap owns its scroll and resize subscription, so the tree does not re-render per scroll event.
- Scene units are pixels divided by zoom, less the offsets that fit-zoom subtracts (`civ/ZoomHud.tsx`). The rectangle math is a pure function with tests.
- Drag has keyboard equivalents.

**Rules and checks.** Vanilla CSS (rule 1). `absence.test.tsx` renders `CivTree` on the server, so anything read from `window` needs a guard. No URL state, no schema, no demo path. `reachable.test.tsx` for a way in.

**Done when.** The rectangle function is tested at several zooms and scroll offsets. A failing node outside the viewport shows red in the thumbnail, and the finding names the direction. Nothing renders when the map fits.

### M3. Scrub the frontier through time

*Seen in LangGraph Studio's time travel and n8n's execution history. Size L. Status: ready on a live graph, data first for the hosted demo.*

**The question.** What could this machine do last week, and what changed since?

**Today.** A frontier snapshot stores counts plus JSON maps from capability id to state, kind and lifecycle (`frontier_snapshots`; kind and lifecycle are null on older rows). It stores no edges, names, eras, authority or evidence times, and its counts are not the map's counts. Only a seed writes a snapshot, and only when something changed. `verify` writes none, so the newest snapshot can trail the live graph. `ledgerSince` in `src/engine/ledger.ts` diffs one snapshot against the live `capabilities` table, and `ledgerHistory` reads the series for the CLI and MCP. No snapshot-to-snapshot diff and no HTTP route exists. "Emergent" and "went failing" (`diminished`) are already defined there.

**The change.** A timeline under the map, one tick per snapshot, and a playhead that redraws the map as it was. States and next steps come from the snapshot. Names, eras and edges come from the current tree, because past edges are not stored. One sentence says what moved: "Sep 26: reached 12 to 14, 1 emergent, 1 went failing."

- A `views.ts` projection returns the series (the server writes no SQL), with a wire type and an `ApiRoutes` entry in `src/shared/api.ts`, and a `loadHistory` in the store with a live path and a demo path.
- A pair diff in `ledger.ts`, so the CLI, MCP and the page share one definition of a step.
- What a snapshot cannot supply is dropped while scrubbing and never printed as zero (rule 16). That covers authority, attention and providers, and with them the outage simulation.
- The timeline is offered with two or more snapshots. With fewer, the page says how history begins.
- The playhead is a timestamp in the URL (`at`), not a snapshot id, so a link works on another machine. An unknown value falls back to live.
- The detail panel and the header count read live items today. Thread the scrubbed items through, or label them "as of".

**Rules and checks.** Rules 5 and 6: failing is `usable(lifecycle)`, and `state` stays structural. Rules 2 and 12 if a column is added. The demo has no history in `demo-data.json`, so a series needs deliberate `recordFrontier` calls on fixed dates, or `demo:check` fails. Tests: `linkState.test.ts`, `api.test.ts`, `views.test.ts` and the ledger tests.

**Done when.** The same two snapshots give the same sentence in the CLI, over MCP and on the page. Scrubbing to the oldest tick draws only what that snapshot held. A graph with one snapshot shows the explanation and no timeline. The demo shows a deterministic series.

## My Setup

### S1. The row is the report

*Seen in Uptime Kuma's heartbeat bars and Sentry's issue stream. Size M. Status: decision first.*

**The question.** Is this entry working, and has it been for a while?

**Today.** A My Setup row is a tree item merged by id with the config read-out. It draws the name, a Disabled badge, the `lifecycle` text and chips for the nodes it provides, and it has no slot for an action. Only a registered skill has check runs of its own, so every other entry's lifecycle is `unknown` and a strip has to summarize the nodes the entry provides (the tree caps providers at six per node). The history exists. Each `verify` run writes a `session_learning` row, action `verified` or `failed`, one per run per node. Nothing deletes them, and only `evidenceFor` reads them, ten at a time.

**The change.** A strip of the last 14 outcomes per row: pass, fail, no run. It comes from a new `meta.history` beside `reliability` in the tree projection (`views.ts`), holding the last 14 outcomes ordered by row id and not by timestamp (rule 11: `datetime('now')` resolves to the second). No schema change. A failing row leads to its reason through S2. Until then it copies `ambit verify`, because the page cannot run checks.

**Decision.** What "last 14" means for an entry that provides several nodes: every run of every node merged, the worst node's series, or one strip per node.

**Rules and checks.** Rule 16: an entry with no runs shows "no check", as it does today, and no strip. Rule 5: no eleventh list of the words `verified` and `failed`. Rule 6. Every new `meta` key needs a `TreeItemMeta` field, an entry in `saidElsewhere` in `NodeDetailPanel.tsx` (or the Details list prints it) and one in `unstatedNode` in `absence.test.tsx`. `demo:check`: the demo fixture has one run per node, so its strips show one bar in fourteen, and `demo-data.json` needs regenerating.

**Done when.** A row with runs draws them oldest to newest, and a failure differs from a pass in height or mark, not in hue alone. A row with none draws no strip. The demo regenerates, and `findings.test.tsx` still passes.

### S2. Switch, tool count, show output

*Seen in the MCP panels of Cursor and VS Code. Size L, in three parts that ship separately. Status: decision first.*

**The question.** Why is this red, and can I turn it off without opening a file?

**Today.** Check output survives only as the first 160 characters in `session_learning.notes`, and a missing binary or a timeout is stored as "exit null" because `verifyCheck` never reads the error. The shipped checks are nearly all silent on failure, but `git diff --exit-code` and any agent-registered check can print source or secrets. `notes` already leaves the graph through `sync export`, `ambit audit` and the evidence MCP tool, so storing more widens that. No route serves it. Enabling and disabling an MCP server already works through `enableMcp` and `disableMcp` behind `ownEntry`, and no other kind of entry has an enabled state. Ambit never lists a server's tools, so a tool count has no source.

**The change.**

1. **A switch for MCP servers.** Reuse `enableMcp` and `disableMcp`. Creation stays impossible. Gate on `configMcp`, because an unknown name currently returns ok as a no-op. Size S, and ready once the `.bak` question below is settled.
2. **Show output.** A nullable `session_learning.output` added through `ADDED_COLUMNS` (rule 2), capped and redacted, left out of `TABLES` in `sync.ts` and out of `share`. It is read over a new entry in `CONFIG_ROUTES` (exact match, token gated), because `/api/tech-tree` needs no token. The route never re-runs a check. `verifyCheck` starts reading `out.error`.
3. **Tool count.** Drop it. If a number is wanted, `provides.length` is how many nodes the entry supplies.

**Decision.** The storage policy for check output: the cap, the redaction, the retention, and who can read it. `docs/faq.md` and `schema.sql` both say the graph holds names and structure, so reword them in the same change.

**A finding to settle first.** SECURITY.md says the visualizer's config editing writes a `.bak` first. `writeConfig` in `src/server/config.ts` does not. Only `ambit apply` and rollback do (`governance.ts`). Fix the code or the sentence before a second control that writes config ships.

**Rules and checks.** Rules 2, 5, 7 (the output is text and is never run), 11 and 16. `reachable.test.tsx` pins switch gating, and `findings.test.tsx` pins "check failing" and "check passed".

**Done when.** A failed check with output shows its tail behind Show output, and a check with none says so. The tail never appears in a sync file, a share file or an unauthenticated route. The switch changes an existing MCP entry and never creates one.

### S3. A ladder made of named rules

*Seen in the scorecards of Cortex, OpsLevel and Port. Size M. Status: ready.*

**The question.** What stands between me and the next era?

**Today.** Nothing new needs projecting. Tree nodes already carry era, era name, state, next, setup seconds and lifecycle, and "blocked by" is `gapOf`, already shown in the detail panel. The "3 of 6, 35m left" line is computed inside the SVG component (`CivTree.tsx`) and is untested. Time comes from the tech tree's `setup_seconds`, and built-ins carry 0 and stay absent (rule 16). Two traps under rule 6: the era header counts degraded and broken nodes as reached, and `isNext` in `views.ts` is state-only, unlike `next.ts`.

**The change.** Clicking an era header opens its ladder in the detail panel: a progress bar, then one row per node showing reached, next step with its time, or blocked with what it waits for. Failing nodes show as failing and never as reached. Extract the era math from `CivTree.tsx` into `civ/layout.ts`, test it, and use `isFailing` so the count and the rows agree.

**Rules and checks.** Rules 6 and 16, and the glossary terms Era, Reached, next step and blocked. A component that reads `.meta` joins the sweep in `absence.test.tsx`. Tests: `layout.test.ts` and `reachable.test.tsx`.

**Done when.** The era count and the rows agree for a graph with one failing node. A node with no time estimate shows none, not zero.

### S4. What it needs, and is it met here?

*Seen in Smithery, Glama and PulseMCP. Size L. Status: data first; the reduced slice is ready.*

**The question.** Before I take this on, what does it need that I already have?

**Today.** The acquisition catalog (`catalog.ts`) holds provider, kind, setup, costs, privacy, verification (as prose), runtimes (free text, never matched), reliability and rollback. It holds no tool list, install line, prerequisite, credential or network need. Four of the 21 tree alternatives carry a `config_patch`, the only basis for an install line, and that would be text to copy, as `mcp-snippet` already is. The only surface is the four options per opportunity in `/api/loop`, drawn as `OptionCompare` under "What would pay back". The graph can answer required prerequisites (`gapOf`, `planFor`), declared credential nodes, and people and devices. It cannot say whether a binary is installed, which only a `verify` check can, or whether a network is reachable, which is never probed.

**The change.** The reduced slice (M): each option in "What would pay back" gains a Needs line naming its required prerequisites and declared credentials, each marked met or missing, with a count such as "2 of 3 met here". It comes from `gapOf` and `planFor().degraded`. There are no tool chips, because only `meta.actions` exists, and no network mark. An install line appears only where a `config_patch` exists, as copyable text.

**Data first.** Everything else needs a structured `needs` field on catalog entries. Binaries and networks stay unanswerable until a check exists for them.

**Rules and checks.** Rule 7 (the install line is text, and nothing that travels may execute), rule 16, and the glossary term Required.

**Done when.** An option with two required prerequisites, one reached, reads "1 of 2 met here" and names the missing one. An option with no `config_patch` shows no install line.

## Proposals

### G1. Plan first, then apply

*Seen in Terraform's plan. Size S, or M with the binding. Status: ready for the render-only slice; the binding waits on its decision.*

**The question.** What exactly am I about to approve, and can it be undone?

**Today.** The modal shows the goal, Saves (net hours), Costs, Undo, Unlocks, Precedent, and each step with "via provider" (`ApprovalModal.tsx`). Every input a tally needs already ships in `src/shared/api.ts`. A step's inverse is stored on live proposals (`plan/propose.ts`), but the modal's `StepLike` type drops it, and the demo's hand-written steps carry none while its second proposal says reversible. `reversible` is true when every step has any truthy inverse (`views.ts`), but `apply` also needs a `config_patch` per step (`governance.ts`). A proposal drafted by the control-plane proxy carries an inverse and no patch, so it reads reversible and apply refuses it.

**The change.**

- A tally line above the steps: step count, reversible or not, needs a person, setup time.
- Steps listed with a "no inverse" mark where a step has none.
- The forecast (hours a month before and after) and the precedent, one line each.
- An approve button that names its proposal: "Approve this proposal".
- The bound slice (M): the row carries `proposalHash` (`approval.ts`) and the click sends it, so the route refuses if the proposal changed after it was shown.

**Decision.** Whether to show "no inverse" and "cannot be applied by `ambit apply`" as two separate facts, or to redefine `reversible`.

**Rules and checks.** `views.test.ts` pins `reversible`, `reachable.test.tsx` pins the modal, and `api.test.ts` covers the route. Give the demo's steps inverses that match its `reversible` claim. The glossary term is Proposal.

**Done when.** A proposal with one step lacking an inverse shows the tally "not reversible" and marks that step. The demo's two proposals agree with their marks.

### G2. Review the queue, sign once each

*Seen in GitHub's deployment reviews. Size M. Status: decision first.*

**The question.** Several proposals are waiting: which do I approve, and what does each cost me?

**Today.** The web approves one id per call (`POST /api/proposals/:id/approve`). The engine can approve several (`approveProposals`), from the CLI only. Each approval is its own signed artifact: hash, actor, budget, scope, a 24 hour expiry and an HMAC. Approving stores no comment, while rejecting has a `reason` column. Approval never writes authority, so no approval widens it.

**The change.** A queue sheet with a checkbox per waiting proposal, select all, one comment, and two buttons, "Reject N" and "Approve N and sign". Bulk means N independent approvals that never apply, and applying stays a command the person runs. Items whose precedent leans refused (`decision.precedent`) start unchecked. Bulk reject is for drafts only, because `rejectProposal` accepts approved rows and keeps their artifact, and `verifyApproval` ignores status.

**Decision.** The decision routes are not in `CONFIG_ROUTES`, so a script with no browser headers can call them without the token, and they honor a `body.actor`. One POST that signs N raises that from one signature to N. Fix the actor to `human:web` for bulk, list explicit ids, bind each id to the hash that was shown, report per id (the engine call is not atomic), and amend the "two decision routes" line in AGENTS.md. A comment on approval has no home yet.

**Rules and checks.** The security posture in AGENTS.md, item 3. SECURITY.md's four invariants are unchanged. `api.test.ts` covers reject only, so add approve and bulk cases.

**Done when.** Approving three of four leaves the fourth a draft. A stale hash is refused for that id and the rest still sign. Nothing is applied.

### G3. Once, here, or never

*Seen in the permission prompts of Claude Code and Cursor. Size L. Status: decision first, and data first.*

**The question.** Why am I being asked this again, and can I stop it safely?

**Today.** Ambit does not draw a runtime's prompt. The OpenCode plugin records that a prompt happened, by permission name only, with no command, scope or reply. The attention digest groups by capability and kind, so a count per command does not exist. A grant is a row of scope, mode, source and promotion fields (`promote_after`, `promote_set_by`, `promoted_at`). A scoped autonomous grant with a promotion watermark narrows on any later failed check (`assure/promote.ts`), but nothing writes that shape. `setPromotion` writes confirm rows with a floor of 2, and `grantAuthority` writes autonomous rows with no watermark. `canExecute` is enforced in two places only, the apply path and the control-plane proxy, so a grant cannot silence a runtime's own prompt. No web route sets a grant, and none should be an unauthenticated one, because any local process, including the agent being gated, could grant itself.

**The change.** Ambit's part is the step before the prompt. From the attention digest, propose a scoped grant as an ordinary Proposal: "Shell Execution asked you 9 times this week, about 4 minutes. Grant it in this repo, narrowing on any failed check." The person approves, the CLI writes the grant, and the runtime stops asking once it consults the gate.

**Decisions.**

- Record which command and scope asked, in the plugin, and let the engine classify it (rules 8 and 15).
- Add an engine verb that writes a scoped autonomous grant with a watermark. Demotion keeps `promote_after`, so the row can re-widen with no person. Decide whether a demoted grant needs a new decision.
- Decide whether a click may widen with no threshold set in advance (rule 11).

**Rules and checks.** Rule 9 holds today, but `grantAuthority` ignores a forbidden row and should refuse it. Rule 10: only failed check rows demote, and narrowing on tool errors or refused prompts would break it. Rule 2. Re-seeding deletes the tech tree and runtime grant sources, so the new grant needs a source that survives it.

**Done when.** Not until the decisions are made. The first slice that stands alone is recording which command asked.

### G4. The trail, one line per event

*Seen in GitHub's audit log. Size M, or L if chained or if refusals must be recorded. Status: decision first; the read-only slice is ready.*

**The question.** Who approved what, what ran, and did it hold?

**Today.** `ambit audit` and the audit MCP tool are the only readers, and no `/api` route exists. `auditRecent` returns three newest-first lists capped at 40, 20 and 20. Acts carry a session, an action, `capability_id` as the target, a time and a note, with no actor field and no outcome. The person is inside `capability_id` for approvals and free text or absent elsewhere. Narrowing is recorded as a demotion and a delegation revision. Apply refusals are not recorded, and "held" is computed at promotion time. Only `delegation_records` is hash-chained. Timestamps mix ISO with a `T` and SQLite's space form, so a string sort misorders them.

**The change.** The first slice is one stream from the three lists, newest first, with the time normalized, the actor parsed where present, the verb from `action`, the target from `capability_id`, and an outcome only where one was recorded, such as "signed" or "grant narrowed". A query bar takes `actor:`, `action:` and `target:` qualifiers, parsed in the client on the first colon only, since an actor id contains colons. The second slice records refusals and "held" and gives an event a structured actor column.

**Decision.** What the hash chain covers.

**Rules and checks.** Rule 2, rule 5 (outcome words live in `vocabulary.ts`) and rule 16 (no empty outcome cell). It needs a projection in `views.ts`, since the server writes no SQL, a wire type and `ApiRoutes` entry, and a `VIEWS` entry in `linkState.ts`. `reports-cli.test.ts` pins today's audit shape.

**Done when.** A mixed set of approvals, demotions and delegation revisions merges in true time order. `actor:human:web` returns only that actor's events. An event with no recorded outcome shows none.

## Ledger

### L1. Spans with a lane for you

*Seen in the trace views of Langfuse and LangSmith. Size L, with an as-recorded slice at M. Status: data first.*

**The question.** Where did this run's time go, and how much of it was mine?

**Today.** A run has a start and an end. Events are points, with an `at` and no duration or parent. Tool uses have `used_at` and `duration_seconds`. Interventions have `started_at`, `ended_at`, `active_seconds` and `waiting_seconds`, and the person's total is the sum of the last two. There is no per-run read: `auditRun` drops intervention times and `used_at`, `/api/loop` is aggregates, and `ApiRoutes` has no run. The producers write points. The OpenCode plugin logs the ask and cannot observe the reply, so the intervention never ends. MCP cannot pass a start and an end, the control-plane proxy writes 0 seconds, and only `/api/telemetry` accepts `startedAt` and `endedAt`. `work_events` never syncs (rule 12).

**The change.** The as-recorded slice (M) draws a run from what was recorded: the run bar, tool uses with their durations, events as points, and interventions as amber spans where both times exist or as a marked point, "not timed", where they do not. An unmeasured ask never draws as zero (rule 16). Amber kinds come from `GATE_KINDS` in `vocabulary.ts` (rule 5). It needs a run projection in `views.ts`, a wire type and a route, and a way in from the Time & cost page.

The full slice (L) adds nesting, which needs a parent id or an event-to-use link plus event durations, and every producer has to record them. A bridge that cannot observe the reply reports the ask, and the engine infers an end, because a bridge that judges is a second copy of the rule (rule 8).

**Decision.** Where a person's wait is recorded. Ship the as-recorded slice first.

**Rules and checks.** Rules 2, 5, 8, 12, 15 (the plugin transcribes and does not decide) and 16, plus `absence.test.tsx`.

**Done when.** A run with one timed and one untimed ask draws one amber span and one marked point, and its total counts only the timed one and says so.

### L2. A ceiling with a forecast tick

*Seen in the billing pages of Vercel and OpenAI. Size M. Status: ready.*

**The question.** Will this budget last the period?

**Today.** The bar exists (`LoopDashboard.tsx`, "Spend delegated in advance"). A budget row holds a ceiling, spent, a period and a nullable `period_start`. The period rolls from `period_start`, and a month is 30 days (`PERIOD_DAYS` in `budgets.ts`). `/api/loop` sends neither `period_start` nor the gate's elapsed-period rule, which is private to `assure/decide.ts` with its own day table. There is no spend history, only one running total, and nothing shipped calls `recordSpend`, so on a stock install spent is whatever was declared. When spent reaches the ceiling, the action asks a person again until the period turns over. A single spend larger than what remains is refused.

**The change.** Draw the ceiling on the bar. Draw a tick where the period lands at the current pace (linear: spent divided by the elapsed fraction of the period). When the tick passes the ceiling, show the date the ceiling is expected to be hit, with "asks you again after that".

- Export the elapsed-period rule from one place (`budgets.ts` already exports `PERIOD_DAYS`) and add `period_start` to the `/api/loop` budgets payload. Cents inside, dollars at the wire.
- Read only. `rollPeriods` writes, so it stays out of `/api/loop`, and rule 13 keeps the read path clean.
- With no spend recorded, draw no tick and no date (rule 16) and say what records spend. That producer is a gap in roadmap section 14.

**Rules and checks.** Rules 13 and 16, and the consistency test that guards rule 13. The budgets branch of `views.ts` has no test today, so add one.

**Done when.** A budget at 60% of its ceiling after half the period shows a tick past the ceiling and a date. A budget with no recorded spend shows neither.

### L3. One row per machine

*Seen in Tailscale's machines list. Size L. Status: data first.*

**The question.** Which of my machines can do what, and which have gone quiet?

**Today.** A machine is a `device:` resource node built from the infrastructure manifest, always unlocked, with its `meta` dropped (`seed/structure.ts`). The server's scan adds scan-only nodes (`server/infrastructure.ts`). The node type has no tags, last seen or authority. Authority is per capability and scoped `device:x`, so "what may this machine do without asking" is a `canExecute` question with a target (`incident.ts` is the precedent), not a stored column. `scopeReport.effective` is narrowest-wins, which rule 9 rules out as the answer. Last seen is never stored: the scan runs per request, and `ambit graph capacity` runs only when typed and drops it. The portfolio is CLI and MCP only, with one row per import and no dedupe. Grants never travel (rule 7), so a portfolio can show modes only as aggregate counts, and import stays receipt-only.

**The change.** Three slices.

1. **The live table (M).** The Infra tab from the live scan: status dot, name, "probed just now", and per machine the modes `canExecute` gives for a small fixed set of actions. The local machine only.
2. **Tags and last seen (data first).** Carry manifest tags into the node's `meta` at seed, and store a last-probe time where a probe actually runs. A new column needs `ADDED_COLUMNS` and the sync column list (rules 2 and 12).
3. **The team view.** Aggregate counts from imports: how many machines, how many stale, how many with a grant in each mode. Never a machine's grants.

**Rules and checks.** Rules 2, 7, 9 and 12, and the egress rule in AGENTS.md: a probe runs only from a typed command or from the server's own scan of the manifest.

**Done when.** For slice 1, a manifest with two machines shows each with its modes and never with a stale seen time.

## Keyboard and terminal

### K1. A palette that speaks verbs

*Seen in Linear, Raycast and VS Code. Size M. Status: ready.*

**The question.** Can I drive the map without leaving the keyboard?

**Today.** The Finder only navigates: choosing a result calls `onShow`. There are four fixed hotkeys, ignored inside inputs (`useHotkeys.ts`), and no action registry. The store already has outage, unlock, gap, approve and reject actions with demo paths. `view` lives in `App.tsx`, so a verb that changes view needs a callback, the way `showOnMap` works. There is no verify action or route. The detail panel only copies `ambit verify`, and a route would run agent-registered check commands from a server that is meant to be a reader.

**The change.** An action registry (id, label, group, run) that Finder lists beside nodes. The actions are simulate outage of X, simulate unlocking X, focus X (with M1), switch lens, open Proposals, approve or reject one through the existing routes (which open the decision panel), and "Copy the verify command for X", which touches only the clipboard. Verify never runs from the browser.

**Rules and checks.** `vocabulary.test.ts` bans retired terms and requires every glossary key to stay in use. Nothing persists beyond the URL. Finder has no test today, so add reachable-style ones.

**Done when.** Typing "shell" lists the node and the actions for it. Enter on an outage action starts the simulation and changes nothing on disk. The verify action copies the command and runs nothing.

### K2. The terminal is a surface too

*Seen in the output of gh, uv and Vite. Size S. Status: ready.*

**The question.** What does a first `ambit status` tell someone, and what should they type next?

**Today.** `ambit status` goes through the generic formatter (`emit(statusReport(db))`): scalars first, then objects, then arrays, with no TTY check and no dimming. Tests read the data at the sink, so anything designed must render only on the human path. Status has no final "Next" line. Its nearest neighbors are the evidence note that names `ambit verify`, `nextSteps` (which builds `propose` and `plan` commands), and the static hints in `cli.js` and `bootstrap.sh`. The README holds the first 14 lines of the output, with ANSI stripped, captured by `scripts/capture-doc-examples.ts`.

**The change.** A human renderer for status: a summary line with the two numbers that matter, a rule, the three evidence counts aligned with the one that needs action in the accent color, and a final `Next` line taken from data. The report gains a `next` field that the human renderer prints last and that JSON carries as data. Color appears only on a TTY and when `NO_COLOR` is unset.

**Rules and checks.** `npm run docs:examples` re-captures the README blocks, and `docs:examples:check` fails until it does. A trailing `Next` falls outside the README's 14-line window, so choose whether to widen the window. `output.test.ts` and `reports-cli.test.ts` pin the format.

**Done when.** The status of a fresh install prints the aligned block with a `Next` line. Piped output is plain and carries the same content. JSON output is unchanged apart from the new field.

## Decisions, with recommendations

| Spec | Decision | Recommended |
| :--- | :--- | :--- |
| M1 | Focus on by default, or opt in | Opt in, a Focus button on the selected node |
| G1 | What "reversible" means | Two facts: "no inverse" and "cannot be applied by `ambit apply`" |
| G2 | Bulk approval, and where an approval comment lives | N independent approvals with a fixed actor and shown hashes; drop the comment until the receipt has a field for it |
| G3 | Record the asking command, add a watermarked grant verb, and decide whether a click may widen | Record first, then CLI only with no web route |
| G4 | What the hash chain covers | Delegation records only; record the rest as plain rows |
| S1 | One series for an entry that provides several nodes | The worst node in the row, one strip per node in the panel |
| S2 | How check output is stored and read | A 2 KB tail per run, redacted, on a token-gated route, never in sync or share; settle the `.bak` claim first |
| S4 | A structured `needs` field on catalog entries | Later; ship the graph-answerable slice first |
| L1 | Where a person's wait is recorded | Ship the as-recorded slice; the engine infers an end |
| L3 | Where tags and last seen live | Manifest tags in `meta`, a last-probe time stored only where a probe runs |

## Found while checking

Writing these against the code turned up four places where a document and the code disagree. The first two are corrected in the roadmap alongside this page. The last two are left for their owners.

- The roadmap said the ledger produces hash-chained records (section 16) and that a break-glass override writes hash-chained records (section 15). Only `delegation_records` is chained, as section 9b says. An override is a plain `break_glass` work event.
- SECURITY.md says the visualizer's config editing writes a `.bak` first. `writeConfig` in `src/server/config.ts` does not, and only `ambit apply` and rollback do.
- AGENTS.md says `civ/layout.ts` holds "the two cascade walks". It holds `outageSplit`, `unlockCascade` and `gapOf`, which carry simulation rules, and `cascadeDepths`, which counts downstream hops.
- AGENTS.md describes "the two decision routes". G2's bulk approval would add a third caller of the same engine call, and the line needs amending when it lands.
