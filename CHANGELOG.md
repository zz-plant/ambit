# Changelog

Written per release, on [the releases page](https://github.com/zz-plant/ambit/releases) — each one explains what changed and why, which is more use than a list of commits. This file is the index.

## [0.4.0](https://github.com/zz-plant/ambit/releases/tag/v0.4.0) — 2026-08-13

**Capability Graph became Ambit.** The old name described the data structure; the new one describes the subject — what you, your agents and your machines can jointly do. Mostly a repair release: the previous version documented a tool that did not run, so the claims it already made had to become true before anything could be built on them.

## Unreleased

- Capability, action, provider, resource, actor and runtime are now separate kinds of node, and `provides`, `contributes`, `requires`, `optional`, `authorizes` and `runs_on` separate kinds of edge. Redundancy analysis previously matched three English sentences to decide what supplied what, so an adapter phrasing one differently made a capability with two providers report as a single point of failure.
- Ids are unchanged, so no ledger history is lost. Existing graphs migrate by adding columns and backfilling once; `tt spof`, `tt impact`, `tt plan` and `tt since` return identical output against a graph seeded by the previous version.
- Capabilities can declare the concrete actions they confer. Ten do, and `tt actions version-control` reports that reading the repository and committing may run unattended while pushing a branch and merging to the default branch may not — a distinction the coarse node could not make.
- Authority is a table with a source, and both adapters now pass through what their runtime states about itself: Hermes's `approvals.mode` and `approvals.cron_mode`, Claude Code's `permissions.defaultMode`. Where the curated model and the runtime disagree the narrower wins, and `tt authority` names which one narrowed it. Nothing is enforced; Ambit describes authority.
- Each capability carries a lifecycle — unknown, detected, configured, verified, reliable, degraded, broken — derived from its providers and its recorded evidence. A capability whose check has started failing reads as broken and stays in the frontier, because reachable and working are different claims.
- `tt since` distinguishes an expanding vocabulary from an expanding frontier. Upgrading to this version would otherwise have reported a dozen capabilities gained on a machine where nothing happened.
- The engine is now modules named after what they do — discovery, inference, assurance, planning, governance, ledger — rather than one 1,864-line file.
- The graph an installed copy keeps now lives in `~/.local/share/ambit/graph.db` rather than inside the install directory, where `brew upgrade` deleted it. A checkout still keeps its graph in the checkout, and an existing graph is never moved. `tt where` prints the path.
- `tt seed` and `tt where` are documented in `tt --help`; the Homebrew and npm installs previously had no documented way to build a graph.
- An unseeded graph now says so instead of answering every question with "Nothing to report". Over MCP it returns an explicit notice, so an agent cannot mistake *not set up* for *an environment with no capabilities*.
- The MCP server introduces itself as `ambit` at the package version, rather than `tech-tree` at `1.0.0`.
- CI runs typecheck, tests, build, and a bootstrap against a machine with no agent config. The demo deploys from CI.
