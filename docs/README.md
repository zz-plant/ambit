# Ambit documentation

[The README](../README.md) is the front door: what Ambit is, how to get it running, and what each command answers. These are the longer documents, grouped by the kind of claim each one makes, because whether a page describes the code, argues for it, runs ahead of it, or records what was said at the time is the thing a file listing cannot tell you. If you are reading rather than looking something up, start with [Why Ambit](./why-ambit.md).

## Description: true of the code today

- [FAQ](./faq.md) — the short answers, each pointing at the longer one.
- [Deep dive](./deep-dive.md) — the long-form reference: nodes, assurance checks, authority contracts, the work ledger, and every MCP tool.

## Argument: why the thing exists

- [Why Ambit](./why-ambit.md) — the argument for building it: what one agent stack looked like, and why effective agency should be a governed object.
- [The affordance frontier](./affordance-frontier.md) — the theory under that argument, and the two cases (robots, brain-computer interfaces) where it is tested.

## Intent: ahead of the code, on purpose

- [Roadmap](./roadmap.md) — design rationale, section by section: what each part decided and what it still lacks. Nothing in it has a date or an owner.

## Record: what was said at the time, not edited

- [Changelog](../CHANGELOG.md) — what changed per release, and why.
- [Incident trace](./incidents/INCIDENT_TRACE_001.md) — one blocked execution traced end to end, with the terminal recording of it.

Both record what was said when it was written, so neither is revised afterwards, and `scripts/check-prose.ts` excludes both paths for that reason.

## Changing it

Workflow and the checks CI runs: [CONTRIBUTING](../CONTRIBUTING.md). The invariants a change must not break: [AGENTS](../AGENTS.md). Reporting a vulnerability: [SECURITY](../SECURITY.md). Every other question: [SUPPORT](../SUPPORT.md). How to behave while doing it: [Code of Conduct](../CODE_OF_CONDUCT.md).
