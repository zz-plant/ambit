# Engine guide

Read [the root guide](../../AGENTS.md) first: it has the commands, the check that says a change is done, and every rule in one line. This file is the full text for `src/engine`. The rule numbers are the root's, so `AGENTS.md rule 9` in a comment means Rule 9 here.

## Engine (handle and schema)

Opening the graph, the shape a row has, and how a database made last year reaches the shape this checkout expects.

```
src/engine/engine.ts       The executable the CLI runs
src/engine/paths.ts        Where the authored data lives, and which config to read
src/engine/db.ts           The handle, the schema, additive column migrations, backfills
src/engine/rows.ts         What a row of each table looks like — a query names its row type from here
src/engine/migrate.ts      Bringing a database up to the current schema — ADDED_COLUMNS lives here
src/engine/ontology.ts     Node kinds and edge kinds — what a thing is, what a relation means
src/engine/vocabulary.ts   The words the engine counts with — which states mean reached,
                           which lifecycles mean failing or recovering, which interventions are
                           middleware, which ledger actions are a check run, the audit
                           trail's outcome words, the one graph-summary query, `reachPhrase`
                           ("9 of 46 capabilities reached, and 9 of your own", the one way a
                           sentence states reach), and `DEFAULT_WINDOW_DAYS`, how far back a
                           report over the ledger looks
src/engine/schema.sql      SQLite schema (capabilities, dependencies, authority, catalog,
                           preferences, synergies, session_learning, frontier_snapshots,
                           proposals, proposal_rejections, schema_meta, work ledger,
                           economics, goals, budgets, federation_imports, failure_signals,
                           declared_checks, sandboxes, delegation_records,
                           delegation_sources, session_log_cursors, tool_listings)
```

## Engine (discovery and seeding)

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
                           Continue, Zed, VS Code, Copilot CLI, Amp, Goose and Kiro config readers:
                           every runtime besides OpenCode and Claude Code
src/engine/claude-code.ts  Reads a Claude Code install into the shape seedFromConfig accepts
src/engine/local-models.ts The models Ollama and LM Studio keep on disk, by folder and file name
                           only: never a model file, a manifest's contents, or a socket
```

## Engine (inference and assurance)

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
src/engine/weight.ts       What a loadout carries: `ambit weigh` starts each local tool server the
                           user-level configs declare, asks for its tools over MCP and records
                           what the list costs in context (`tool_listings`); `carryById` is what
                           the tree reads, and nothing but a typed command starts a server
src/engine/next.ts         What to reach next and why — observed blocks, then leverage, by the rule
                           in src/shared/nextSteps.ts, which the hosted page ranks a pasted config by
src/engine/council.ts      The first of those read five ways, one seat per engine question:
                           frontier, fragility, ledger, authority, checks. Each is a sentence,
                           a command and a stance; it writes nothing and runs nothing
```

## Engine (governance, economics, ledger)

Everything that can change the world, everything that prices it, and the records that say afterwards what it cost.

```
src/engine/governance.ts   Approval, apply, rollback — everything that can change the world.
                           `addPerson` is `ambit people add`: a name budgets and approvals can
                           carry, declared from the terminal, granting nothing
                           `decideShown` decides a queue of drafts the page showed, each in its
                           own transaction and bound to the hash it showed. `applyProposal`
                           writes the runtime `--to` names, or the one found, through the
                           shapes in connect.ts, and prints each runtime's own command where
                           it cannot write; `applied_to` keeps that file's inverse
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
                           command but `gate` and `statusline`, and the MCP server on open,
                           reads it in
src/engine/tracker-spool.ts  What OpenCode's tracker saw change in its config, read in from
                           `trackerSpoolPath()` alongside the Claude Code spool
src/engine/session-logs.ts The tokens Codex, OpenCode and Amp sessions used, read at the same
                           two places from the logs those agents keep: counts, model names,
                           session ids and times, never content. A cursor per file makes a read
                           that finds nothing new a `stat` per log, and stays out of `ambit sync`
src/engine/attention.ts    Human-agency accounting — what is reducible, what is keeper
src/engine/economics.ts    Declared costs and goal values (dollars declare, cents store), and
                           `recordTokens`, the one rule a session's tokens are priced and spent by
src/engine/opportunities.ts The opportunity engine — ranked structural changes worth making
src/engine/catalog.ts      The acquisition catalog — the supply side for a ranked opportunity;
                           `installText` says what a way to acquire would write, from the tree,
                           and `shippedPatch` is the one patch `ambit apply` will write for it
src/engine/roi.ts          Realized ROI — before/after windows, written back
src/engine/audit.ts        The trail: who approved what, what ran, and whether it held;
                           `auditStream` merges its four sources, newest first, under one limit
src/engine/machines.ts     What an agent may do on each device the scan found: the gate asked
                           with the device as the target, read only
src/engine/wiring.ts       What is wired into each agent here: the MCP server, the bridge into the
                           ledger, the gate. Reads files and writes nothing; `setupSteps` is what
                           bare `ambit`, `status`, `doctor` and `connect` say is still missing
src/engine/gate.ts         The gate on a runtime's tool call: the Claude Code PreToolUse hook
                           `ambit gate`, which maps a call to its capabilities and denies or asks,
                           and never allows. `decideCall` is `ambit can` asked with a tool's own
                           name (`Bash`, `mcp__github__create_issue`, `Bash(git push)`): the same
                           questions, the narrowest answer, and beside it the Claude Code rule
                           that names the call (`claudeRuleFor` in wiring.ts) and the failures
                           the ledger holds against what it exercises
src/engine/tool-names.ts   What a runtime's own tool is, by the name that runtime gives it
                           (Claude Code's `Write`, Codex's `apply_patch`), and whether the gate
                           asks about it as reading or acting; and what a shell command's
                           programs exercise (`git push`, `npx wrangler deploy`, `op read`),
                           which the gate reads from the call and keeps nowhere
src/engine/statusline.ts   `ambit statusline`, the line Claude Code's status line shows after each
                           message: what fails its check, the proposals to decide, the verified
                           count. The graph opened read-only, nothing written; cli.js imports it
                           in its own process, so the command is one Node start
src/engine/incident.ts     The incident loop: a work run per offline declared service, and
                           each probe recorded as a check run on what it asked, with
                           `last_seen_at` stamped on an answer
src/engine/federation.ts   Signed summaries a portfolio layer reads; receipts, no merging
src/engine/portfolio.ts    What the imported environments look like taken together
src/engine/sync.ts         The graph and ledger as one file — no commands, no grants
```

## Engine (planning, projections, CLI)

The distance to a capability, the projections every surface reads, and the dispatch that turns a typed verb into one of them.

```
src/engine/planning.ts     The gap to a capability, and simulating closing it
src/engine/resolve.ts      Which node an id means: normalises, and never guesses. A sentence is
                           offered what the goal router says its words cover, as candidates
src/engine/plan/           deficits.ts (what keeps stopping work, and whether it is structural)
                           propose.ts (what a change would buy, as something approvable)
                           route.ts (the order of the missing steps, and who each inconveniences)
src/engine/goals.ts        Routing a free-form goal into the graph, and comparing its paths
src/engine/judge.ts        Asking a judgment model on this machine which node an unmatched goal
                           means: a Choice over the tree, loopback only, suggestion only. With
                           no judge answering, an embedding model there names the nearest nodes
src/engine/spec.ts         `ambit goal --spec`: a Spec Kit or OpenSpec spec read as data, each
                           task routed by `routeSentence` and the plan's tools by `detects`,
                           and every need's plan merged into one ordered gap
src/engine/views.ts        The projections the visualizer reads — the server writes no SQL.
                           `loopView` composes status, attention, opportunities, ROI, authority,
                           what to reach next, the council on it and the week's movement into the one payload
                           /api/loop serves, so the page and the CLI report one ledger; the tree
                           carries each node's providers, authority, reliability, failures and
                           last fourteen check runs. The trail, the frontier's history, one run
                           and each machine's modes are `auditView`, `frontierHistoryView`
                           (each tick naming what emerged), `runView` and `machineView`;
                           `ladderOf` reads where each reached capability's execute grant
                           stands on the five rungs and what moves it, and `blocks` is how
                           often work was recorded blocked on a missing node; `infraRecordView` reads when each device
                           and service the scan found was last seen, and its tags
src/engine/share.ts        The allow-listed, self-contained HTML snapshot of the map
src/engine/cli.ts          Command dispatch; the five groups resolve to flat verbs
src/engine/cli/            groups.ts (the five nouns, and `ALIASES`, the one place an old
                           command name maps to the canonical one) · help.ts · seed.ts
                           output.ts (the colour gate, and the generic formatter, which returns
                           lines) · reports.ts (`renderStatus`, and the move `ambit status`
                           ends on; `renderBrief`, the short screen bare `ambit` shows; and
                           the layouts of `next`, `goal`, `impact` and `doctor`). A command that
                           takes a capability reads it through `named` in cli.ts, the one
                           resolver `ambit can`, the MCP tools and the gate use
src/engine/testing/        The shared test harness: a throwaway graph, driven in-process;
                           terminal.ts runs a function as if on a terminal, or piped
```

## Rules

**Rule 2.** **A schema change is additive, and goes through `ADDED_COLUMNS`.** `src/engine/schema.sql` is the shape a fresh graph gets; `ADDED_COLUMNS` in `migrate.ts` is how an existing one reaches it. A column added to the schema and not to that list exists on new machines only, and every read of it fails on the graphs that have the history worth keeping.

**Rule 3.** **A domain reaches an item by one of two paths.** The engine accepts any JSON config through the `CONFIG_MAPPING` env var, with the OpenCode format as the default, and `domain`, `domain_field` and `domain_map` in `src/engine/seed/writers.ts` are where a seeded item gets its domain. That is the path the CLI and every runtime reader take. `inferDomain` in `src/client/utils/configImporter.ts` is the other one, and only a config dropped into the browser ever reaches it. An item with no domain collapses into `meta` and flattens the tree, so debugging that starts at the wrong one of the two is reading a function that never ran.

**Rule 4.** **Tracking model**: Configuration decisions, not invocation frequency. Plugin writes `built`, `removed`, `unlocked` actions — never `used` counts.

**Rule 5.** **The engine counts with one vocabulary**: which states mean *reached*, which lifecycles mean *failing*, *recovering* or *verified*, which intervention kinds are middleware, and the counts every summary reports all live in `src/engine/vocabulary.ts`. Take the SQL fragment from there instead of spelling the list again — the summary query had five copies and the visualizer's differed, agreeing with the rest only because a third state has never been added. `CHECK_RUN_SQL` is the fragment for which ledger actions are a check run, and `CHECK_RUN` holds the two words. The same file holds the not-seeded message, which had four wordings offering three different fixes.

**Rule 6.** **Availability**: `state` is structural and is what the frontier ledger records — never change it to express verification. The gate is `lifecycle`, and the latest check decides: a capability whose lifecycle is `broken`, its last check failed, is configured but not working, and every availability decision (plan, simulate, goal, authority, actions, canExecute, near, combos, bottlenecks, spof, deficits, opportunities, roi, status) must exclude it via `usable(lifecycle)`. A `recovering` capability is one whose last check passed after recent failures (graphs seeded earlier still carry the same state as `degraded`): usable, and neither verified nor failing, so every summary counts it with the unverified, and a surface that names it says how its recent runs went ("2 of the last 5 passed"). Holding it out until five passes in a row protected nothing: the most recent run is the best evidence of whether it works now. Never write a state-only availability check; it silently re-admits broken capabilities. A new snapshot column such as `lifecycles` is a schema change, and rule 2 governs it. The era ladder keeps to this: `rungOf` and `columnProgress` in `civ/layout.ts` count a node whose last check failed apart from reached and apart from blocked, and a recovering one as reached.

**Rule 7.** **Nothing that travels may execute.** A registered skill's check is a command, so `ambit sync export` carries the skill node and not its check, and `ambit sync import` never writes `declared_checks`. The same rule already keeps `config_patch` declarative and keeps entry creation off the HTTP API: a command inside a data file is a command that runs on whoever opens it. An authority grant does not travel either — importing one would let a permissive machine widen a careful one by moving a file. A tree overlay is such a file, since a cloned repository can ship `.ambit.json`: `mergeTrees` in `src/engine/paths.ts` keeps every curated authority mode, takes the narrower of curated and overlay per key (`override: true` included), and caps a mode the curated tree never stated at `confirm`, so an overlay narrows and never widens. What the loop page shows of a way to acquire a capability is `installText`, written from the shipped tree and never from an overlay or an imported row, and `ambit apply` writes a step's patch only when it is the shipped tree's (`shippedPatch`), since a plan reads alternatives from the merged tree and an overlay's patch names a command. A spec is one too, committed by whoever wrote the repository: `ambit goal --spec` opens markdown only, skips fenced blocks, keeps a link's words and drops its target, and strips control characters from the text it prints back. Every id that enters a command Ambit prints for someone to paste goes through `shellQuote` in `src/shared/shell.ts`: an id is whatever an agent or a sync file's author typed, and `skill:x$(rm -rf ~)` pasted into a terminal is a file that travelled and then executed.

**Rule 8.** **Classification belongs to the engine, not the bridge.** A telemetry bridge reports what a runtime said about a failure — exit code, message, error kind — and `src/engine/failures.ts` decides what it means. A bridge that judges for itself what counts as a permission error is a second copy of that rule, and the two will disagree within a release. A failure whose shape says nothing stays unclassified; never guess.

**Rule 9.** **Authority resolution is two rules, in order.** A forbidden grant wins outright at any specificity — a narrower scope must never be a route to something refused. Among what is left, the most specific covering scope governs, ties going to the narrower mode. Never collapse this back to narrowest-wins alone: under that rule a grant saying "autonomous on staging" can never beat a standing "confirm everywhere", and the trade of blast radius for autonomy becomes inexpressible. A sandbox relaxes confirmation and never a refusal, for the same reason. A question that names no target is inside no scope, so a scoped grant may narrow it and never widen it: "autonomous on staging" used to answer yes for an untargeted call, and a Claude Code tool call names no target. `scope.effective`, the narrowest covering grant that `ambit authority scope` reports, is never a surface's answer to what may be done: ask `canExecute`, as `machines.ts` does with a device as the target. Before either rule, a person's live grant takes the place of the curated tree's default for the same capability, scope and holder (`standing` in `decide.ts`), because the default is a suggestion and the grant is the person's decision about it; left to tie, the narrower default won and `ambit authority grant` changed nothing. It never displaces a curated refusal or a runtime's own setting, and once an elevation expires the default decides again. The gate, `authorityReport` and the map all resolve through it.

**Rule 10.** **Only checks count as failures.** Promotion counts passing checks and successful uses; a failed run is not evidence that a capability failed, and attributing a run's outcome to everything it touched would demote whatever a bad afternoon went near. Use carries no object, so it never counts toward a scoped threshold.

**Rule 11.** **Promotion needs a person; demotion needs nobody.** A grant only widens against a threshold someone set in advance (`promote_set_by` records who), never against evidence alone, and never on a `forbidden` grant. It narrows on a single failing check with no one asked. Compare the failing evidence against the row id recorded at promotion, not the timestamp — `datetime('now')` resolves to the second, and a check that fails in the same second would compare as "not after it".

**Rule 12.** **A sync file carries every row its rows point at.** Interventions and capability use hold a foreign key to a work run; exporting the observation without the run meant every one was silently skipped on import, and the import counts it as skipped, not failed. When adding a table to `TABLES` in `sync.ts`, place it after anything it references.

**Rule 13.** **Never write a budget row to record a spend.** `recordSpend` updates a budget that exists and reports that none does otherwise. Inserting one with a zero ceiling made a single recorded cent refuse every later spend, through a row the budget report does not list.

**Rule 14.** **One resolver decides where the graph is.** `resolveDbPath` in `src/shared/db-path.ts` is the only answer, imported by the engine, the MCP server and the API server. Each used to carry its own default, so a correctly seeded install queried over MCP reported an empty environment. An installed copy must never store the graph inside its own install directory: under Homebrew that is the Cellar, which `brew upgrade` deletes.

**Rule 18.** **Colour goes only to a terminal, and is never the only signal.** `colorOn` in `src/engine/cli/output.ts` allows escapes when stdout is a TTY and `NO_COLOR` is unset (an empty value counts as unset), so a pipe, a file and a CI log read what was written and not what was painted. A formatter takes a palette and returns lines, and the data sink and `--json` never see one. A row that wants a person carries a `›` that survives a pipe. Every surface follows this: `renderStatus`, the generic formatter, `seed`, `explain` and the first-run and unknown-command lines take their palette from `terminalPalette`, which asks stdout, or stderr for a line written there. `cli.js` is plain JavaScript and loads no engine module for the lines `ambit web` prints, so it transcribes `colorOn` for them, and the two must stay in step. The status line is the one surface painted on a pipe: Claude Code reads its stdout and renders ANSI there, so `statusPalette` in `src/engine/statusline.ts` paints a call that carries Claude Code's payload, `NO_COLOR` still wins, and `!` and `›` say the same with no colour. The same reader that sets a colour sets an exit code: a command whose answer is a top-level string `error` exits 1 (`raiseExitCode` in `output.ts`, never on the sink), an unknown command exits 2, and `--exit-code` on `can` and `verify` maps the decision or the check to a code.

**Rule 20.** **The gate only narrows.** `ambit gate` answers a Claude Code PreToolUse hook with *deny* (forbidden, or over a budget), *ask* (asks first, no grant yet, or a last check that failed; a recovering capability is decided by its grant) or nothing (allowed, or a tool the graph cannot name), so Claude Code's own permission settings decide what remains. It never answers *allow*: that would let the graph widen what a person set in their runtime, and the runtime's own settings are the person's last word on what runs without asking. A call it cannot read, or a graph it cannot open, is no answer, and it exits 0 so a broken gate never blocks the person's work. It maps a tool to capabilities with `attribute` in `failures.ts`, the matching failures and the unmapped report use, so the three cannot disagree about what a tool is. A runtime's own tool is what `builtInTool` in `tool-names.ts` says it is, and is asked about as `observe` when it only reads, so `Read` stays no answer when `Write` asks. A shell call is also asked about as each program its command runs (`commandExercises`), so a grant on Version Control reaches `git push`. The command is read from the call and kept nowhere; the hooks write no tool's input, so the ledger records a shell call as Shell Execution alone. A program goes in that table only when the tree takes a stance on its node, because the gate asks about a capability with no grant.
