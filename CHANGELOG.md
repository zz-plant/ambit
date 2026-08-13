# Changelog

Written per release, on [the releases page](https://github.com/zz-plant/ambit/releases) — each one explains what changed and why, which is more use than a list of commits. This file is the index.

## [0.4.0](https://github.com/zz-plant/ambit/releases/tag/v0.4.0) — 2026-08-13

**Capability Graph became Ambit.** The old name described the data structure; the new one describes the subject — what you, your agents and your machines can jointly do. Mostly a repair release: the previous version documented a tool that did not run, so the claims it already made had to become true before anything could be built on them.

## Unreleased

- The graph an installed copy keeps now lives in `~/.local/share/ambit/graph.db` rather than inside the install directory, where `brew upgrade` deleted it. A checkout still keeps its graph in the checkout, and an existing graph is never moved. `tt where` prints the path.
- `tt seed` and `tt where` are documented in `tt --help`; the Homebrew and npm installs previously had no documented way to build a graph.
- An unseeded graph now says so instead of answering every question with "Nothing to report". Over MCP it returns an explicit notice, so an agent cannot mistake *not set up* for *an environment with no capabilities*.
- The MCP server introduces itself as `ambit` at the package version, rather than `tech-tree` at `1.0.0`.
- CI runs typecheck, tests, build, and a bootstrap against a machine with no agent config. The demo deploys from CI.
