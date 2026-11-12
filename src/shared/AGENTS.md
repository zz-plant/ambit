# Shared, scripts and plugins guide

Read [the root guide](../../AGENTS.md) first: it has the commands, the check that says a change is done, and every rule in one line. This file is the full text for `src/shared`, `scripts` and `plugins`. The rule numbers are the root's, so `AGENTS.md rule 9` in a comment means Rule 9 here.

## Shared, scripts and plugins

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
src/shared/carry.ts        `carryByRuntime`: each runtime's total over its weighed servers, the one
                           sum `ambit weigh` and My Setup both print
src/shared/placement.ts    `placeOnTree`: where a setup stands on the curated tree, from the ids
                           its config turned up. The seed and the page's paste box both place by it
src/shared/nextSteps.ts    What to reach next, by one rule: which capabilities are one step away,
                           their order (blocked work, then leverage per hour), what each reaches
                           with it, and the sentence that says so. `ambit` and the page rank by it.
                           `stepEffect` is what one step brings, what it reaches and the next steps
                           that leaves, which the map lights and the sentence names
src/shared/runtimes.ts     What every runtime brings (`BUILT_INS`) and the hosted model a runtime
                           runs on when its config names none (`RUNTIME_MODEL`)
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
scripts/windows-smoke.ts   The CLI on Windows, in a throwaway home with no HOME set: it finds the
                           configs there and writes nothing under the current directory. CI runs it
scripts/check-reach.ts     That merged work reaches main: a pull request's base has to be on
                           its way there, and every merged one has to have arrived. reach.yml
                           runs it on pull requests, on each push to main and daily
scripts/release-tag.ts     Release's guard: on a push to main, whether package.json's version has
                           its tag, and if not, the commit that set it, tagged and pushed so the
                           same run releases it. A tag pushed by hand passes straight through
scripts/check-demo-data.ts That demo-data.json still matches what the engine builds from the fixture
scripts/shots.ts           Every view as a screenshot, from a production build in a headless Chrome,
                           with the checks a machine can make of a frame and a contact sheet
scripts/render-images.ts   The saved images, from the page's own code in a headless Chrome: the API
                           server and Vite on loopback for the run, Chrome's own traffic off, and
                           the files never under dist/ or src/. scripts/lib/chrome.ts is the
                           DevTools client it shares with record-hero-gif.ts
scripts/build-docs.ts      The docs as static pages under /ambit/docs/, and the sitemap written
                           from the same list; `npm run build` runs it after Vite
scripts/adapters/          Deeper runtime readers than mcp-clients.ts: hermes.ts · surface.ts (a
                           published capability surface) · telemetry.ts (work events piped to
                           /api/telemetry)
plugins/ambit-telemetry.js Tool executions and permission prompts, into the work ledger
plugins/ambit-tracker.js   Configuration changes, appended to a spool that src/engine/tracker-spool.ts
                           reads into whichever graph the engine opens next
plugins/cursor/ambit-ledger.mjs  Cursor's hook: each conversation's shell commands, MCP calls,
                           failures and end, appended to the Claude Code spool and marked
                           `src: "cursor"`. It is on no permission hook and answers `{}`
plugins/claude-code/       The Claude Code plugins the root .claude-plugin/marketplace.json lists:
                           `ambit` (MCP server, session-start briefing, a skill, and
                           scripts/spool.mjs, the hooks' one-line append to the spool) and
                           `ambit-gate` (the PreToolUse gate). Their versions follow
                           package.json; scripts/claude-plugin.test.ts holds that
```

## Rules

**Rule 15.** **The plugin transcribes, it does not decide.** `plugins/ambit-tracker.js` is plain JavaScript in another program's process and cannot import the engine, so it repeats `trackerSpoolPath` and nothing else: it appends each change to that spool, and the engine reads it into the graph it opens, stamping kinds with `kindOf` itself. It used to repeat `resolveDbPath` too, and from OpenCode's plugins directory that found an old graph beside it or none, which is why a plugin never chooses the graph. `plugins/claude-code/ambit/scripts/spool.mjs` and `plugins/cursor/ambit-ledger.mjs` repeat `spoolPath` the same way, and `plugins/ambit-telemetry.js` repeats `readApiToken`. Those are transcriptions and must be kept in step; do not let them become second opinions.

**Rule 17.** **The prose has an accent; keep it in check.** Most of what is written here was written by a machine, and a machine reaches for the same few constructions until a reader can hear them. Measured over every comment and document that ships, the em dash runs several times the 1 to 3 per thousand words of edited English, and "rather than" an order of magnitude above the 0.3 it runs there. The two want different answers. Almost every dash sits in a sentence already holding two or more commas, where it outranks them and earns its place: when they were audited, ten could become a comma without loss, and flattening the rest would read worse. "rather than" has no such defense, being one phrase standing in for "instead of", "not", "never" or a rewritten clause, so vary it. `npm run prose:check` holds a ceiling on both, which CI runs; it fails on the corpus drifting up, never on one sentence, and the numbers are meant to come down. A changelog and an incident trace are records of what was said at the time, so they are excluded and not edited.
