# Ambit documentation

[The README](../README.md) is the front door: what Ambit is, how to get it running, and what each command answers. The claim under all of it is that what an agent setup can do is not written in any config file: it is composed, it has to be proven, and it differs from what the setup is allowed to do. [The ideas behind Ambit](./ideas.md) says what is new in that, in one page. These are the longer documents, grouped by the kind of claim each one makes, because whether a page describes the code, argues for it, runs ahead of it, or records what was said at the time is the thing a file listing cannot tell you. If you are reading rather than looking something up, start with [Why Ambit](./why-ambit.md).

## Description: true of the code today

- [Building alone](./solo.md) — for a one-person company: the checklist between you and launch, what an agent may do to production without asking, and how you hear when it breaks.
- [FAQ](./faq.md) — the short answers, each pointing at the longer one.
- [Where each AI agent keeps its MCP config](./mcp-config-locations.md) — the file and the key for Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, Codex CLI, OpenCode, Cline, Roo Code, Continue and Zed.
- [What breaks if an MCP server goes down](./mcp-outage.md) — single points of failure in an agent setup, and how to find them before an agent does.
- [Auditing which MCP servers a coding agent has](./audit-mcp-servers.md) — what is declared, what works, what may run without asking, and what was used but never declared.
- [Ambit and MCP gateways](./compare.md) — which questions a gateway on the call path answers, which ones Ambit answers, and how the two compose.
- [Glossary](https://zz-plant.github.io/ambit/docs/glossary/) — every word the map and the CLI use, defined once, from the same file the app reads.
- [Ambit and Jev](./jev.md) — how TypeSafe's Jev and its local clones sit on the map, how a goal routes through one, and where its probabilities stop.
- [Deep dive](./deep-dive.md) — the long-form reference: nodes, assurance checks, authority contracts, the work ledger, delegation records, every MCP tool, and the map in full.
- [llms.txt](../src/client/public/llms.txt) — the project on one page for an agent deciding whether to recommend it, served at [zz-plant.github.io/ambit/llms.txt](https://zz-plant.github.io/ambit/llms.txt).

## Argument: why the thing exists

- [Your loadout, from A to B](./loadout.md) — one person's setup from a pile of configs to work done without them, in seven legs, with the command for each. Start here if you want to know what using it is like.
- [The ideas behind Ambit](./ideas.md) — the claim, what is new in it, its nearest prior work, and what it does not claim. The short version of the two below.
- [Why Ambit](./why-ambit.md) — the argument for building it: what one agent stack looked like, and why effective agency should be a governed object.
- [The affordance frontier](./affordance-frontier.md) — the theory under that argument, and the two cases (robots, brain-computer interfaces) where it is tested.

## Intent: ahead of the code, on purpose

- [Roadmap](./roadmap.md) — design rationale, section by section: what each part decided and what it still lacks. Nothing in it has a date or an owner.
- [Interface specs](./interface-specs.md) — sixteen changes to the surfaces, each with what it reads, the rules it touches and what done means. Fifteen have a built slice, and the **Built** paragraph under each says what shipped and where it departs from the text.

## Record: what was said at the time, not edited

- [Changelog](../CHANGELOG.md) — what changed per release, and why.
- [Incident trace](./incidents/INCIDENT_TRACE_001.md) — one blocked execution traced end to end, with the terminal recording of it.

Both record what was said when it was written, so neither is revised afterwards, and `scripts/check-prose.ts` excludes both paths for that reason.

## Changing it

Workflow and the checks CI runs: [CONTRIBUTING](../CONTRIBUTING.md). The invariants a change must not break: [AGENTS](../AGENTS.md). Reporting a vulnerability: [SECURITY](../SECURITY.md). Every other question: [SUPPORT](../SUPPORT.md). How to behave while doing it: [Code of Conduct](../CODE_OF_CONDUCT.md).
