# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The web UI runs in two places from one build: the hosted demo on GitHub Pages (static, sample data, `?demo=1`) and `ambit web` on the person's own machine, served on loopback against their own graph. The CLI and the MCP server are sibling surfaces over the same engine; this record governs the web UI and the copy all three share.

## Users

Three audiences, none outranking the others by default. A surface brief names which one it serves first.

- **The owner on their own machine.** A developer running one or more agent runtimes (Claude Code, Cursor, OpenCode, Codex and the others Ambit reads), a set of MCP servers, often local models and sometimes a second machine. They open `ambit web` against their own graph and come back to it: to see what one more step would open, which configured tools fail their checks, which proposals wait for a decision, and what the trail says happened.
- **The first-time visitor.** Someone on the hosted demo, arriving from the README, a docs page found through search, or a shared link, deciding whether Ambit is worth installing. They meet a sample setup first, and can paste their own agent's config or tick the servers they run to see where they stand, with nothing uploaded.
- **The solo builder.** A one-person company running a product, with a CTO's questions and nobody to ask: what to set up before real users arrive, what an agent may do to production without asking, how a failure reaches them before a customer does. The Product and Operations eras and the Launch Ready capstone exist for them.

Agents are a fourth reader of the same graph, over MCP. They never see the UI, but the UI shows what they recorded and proposed.

## Product Purpose

Ambit computes what a person, their agents and their machines can jointly do, which no configuration file states, and helps them widen it. It reads the configs of every agent runtime on a machine into one capability graph, places that graph on a curated tree of capabilities in eras, and answers four questions: what is one step away, what is worth setting up next, what actually works, and what breaks if a dependency fails. A work ledger adds where the person's own time goes.

Success is a person who takes a next step with confidence and sees it reached and then verified, and an agent that knows what it may do before it tries.

## Positioning

Ambit widens an ambit. Verification, grants and blast radius are the guardrail that makes widening safe to lean on; they are never the headline. Small setups have the most ground ahead and are in the audience.

What a neighbouring product could not truthfully claim: reach composed across every runtime on the host, ordered by prerequisite, with `installed ≠ working ≠ authorized` kept apart. Catalogs find a tool by name, tool RAG by similarity, workflow engines know order within one task, package managers know it for binaries. None tells a working tool from a configured one or prices the human attention a change would save. Ambit is also an MCP server itself, so an agent asks the same graph the person reads.

The word *ambit* is unfamiliar to most readers. It is defined wherever a reader first meets it.

## Operating Context

- **Views.** The map (the curated tree in era columns), My Setup (Entries, Environment, Briefing), Audit (the trail), Proposals (the decision desk) and Time & cost (the work ledger). Search, the finder and keyboard navigation reach all of them.
- **Arrival.** Search visitors land on the docs pages under `/ambit/docs/`, not the home tour. The demo's tour is reachable directly through `?tour=outage|failing|yours`.
- **Decisions.** Agents draft changes; a person approves or rejects each one, on the page or with `ambit approve`. An approval mints a signed artifact that only `ambit apply` and the control plane spend.
- **Artifacts that leave the page.** The Image menu saves the map, the relief and a finding card for posting; `ambit share` writes a self-contained HTML snapshot. The README's images come from `npm run render:images` and `npm run shots`.
- **The terminal beside it.** `ambit status`, `ambit next`, `ambit goal` and the rest report the same ledger in the same words, and the page often ends on a command to paste.

## Capabilities and Constraints

- **The page is a reader.** It never runs a declared check (it copies `ambit verify <id>`), never creates a config entry (adding a server returns a snippet to paste), and writes a config only to flip `enabled` on an entry the config already holds. The API binds to loopback and refuses any other origin or host. These are security invariants in AGENTS.md and are not design choices.
- **Nothing leaves the machine unasked.** A config pasted into the hosted demo is read in the tab and uploaded nowhere. There is no telemetry.
- **One glossary.** `src/shared/concepts.json` holds one name per concept, and `src/client/vocabulary.test.ts` fails on a retired synonym. Interface labels use the glossary's plain words. The map's era columns are its only game metaphor; the Eva framing in the docs stays in prose, explained, and is never a label.
- **The latest check decides.** A capability whose last check failed is failing, one whose last check passed after recent failures is recovering, and every surface counts them the same way.
- **Absence is shown as absence.** An unstated value is never drawn as a zero or a placeholder figure; an empty ledger explains how to start recording.
- **Demo numbers are labelled.** Every figure on the hosted demo is the sample's and says so on the figure.
- **Undecided:** whether the ledger should record prompt text (a privacy question), and whether Time & cost should merge "What to reach next" with "What would pay back".

## Brand Commitments

- **Name.** Ambit, after the word: *ambitus*, circuit, sphere of action. Taught where first met ("That is your *ambit*").
- **Voice.** Plain and specific. A sentence says what was found and what to do next, survives a skeptical first read, and does not repeat another. No filler ("simply", "just", "easily") and no generic startup language. A page does not narrate itself: where a heading says what a section does, no sentence repeats it.
- **Prose ceilings.** `npm run prose:check` holds the em dash and "rather than" below a ceiling across every comment and document that ships, and the numbers are meant to come down.
- **One meaning per mark.** Each visual mark on the map stands for exactly one fact; a new use has to fit that fact or get its own mark.

## Evidence on Hand

- The hosted demo at `https://zz-plant.github.io/ambit/?demo=1`, built from a fixture (`demo-data.json`, `src/client/utils/demoSnapshot.ts`, `src/client/utils/demoRun.ts`), with a failing check and a recovering one so every state shows.
- README images in `docs/assets/`: `capability-graph-demo.gif`, `screenshot-tree.png`, `screenshot-config.png`.
- Releases: `ambit-cli` on npm (0.6.0), the Homebrew tap `zz-plant/tap/ambit`, the MCP registry entry, and a Glama score badge.
- Long-form writing: `docs/deep-dive.md`, `docs/loadout.md`, `docs/solo.md`, `docs/why-ambit.md`, `docs/faq.md`, `docs/compare.md`, and the three search pages on MCP config locations, outages and auditing servers.
- **Absent, and not to be invented:** customers, testimonials, case studies, user or install counts, benchmarks, press, and pricing. Ambit is free and MIT-licensed.

## Product Principles

1. **Widen first, guard second.** Lead with what is one step away and what it would open; show what could break as the reason a step is safe, not as the pitch.
2. **One ledger, one vocabulary.** The map, My Setup, the CLI, the MCP answers and the demo's readout rank and name things by the same rules; a surface that disagrees with another is a bug.
3. **Evidence over assertion.** Configured, working and permitted are three facts. Show which one is known and how recently, and never let one stand in for another.
4. **A person decides.** Agents propose and record; a person approves. The page reads, explains and hands over a command; it does not act on the machine.
5. **Local by default.** The person's setup stays on their machine. Anything that would leave it is typed by them, named, and explained first.

## Accessibility & Inclusion

WCAG 2.2 AA across the web UI. Every map state is carried by shape, texture or a mark as well as colour, so it reads in greyscale and to a colour-blind viewer. Every view is reachable and operable by keyboard, dialogs hold and return focus, counts that change reach a screen reader, and `prefers-reduced-motion` stops non-essential motion.
