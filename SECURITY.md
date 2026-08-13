# Security

## Reporting

Report vulnerabilities privately through GitHub: **[Security → Report a vulnerability](https://github.com/zz-plant/ambit/security/advisories/new)**. Private reporting is enabled on this repository. Please do not open a public issue for anything exploitable.

Ambit is a personal project, not a staffed one — expect a first response in days rather than hours.

## What is worth reporting

Ambit reads your agent configuration and, through the visualizer, writes back to it. Two invariants hold that surface, and a break in either is a vulnerability:

- **The server is loopback only.** It binds `127.0.0.1` and rejects non-local origins *before routing*. CORS headers alone would be insufficient, because a simple request skips preflight and reaches the handler regardless. Anything that lets a page you visit reach the API is in scope.
- **The API cannot create configuration entries.** An MCP entry carries a command your agent runtime executes, so creating one over HTTP would be remote code execution. The API can toggle an existing MCP server and edit an existing agent's description or model; adding a server produces a snippet you paste yourself. Any path that turns an HTTP request into a new executable config entry is in scope.

Also in scope: anything that causes the engine to execute content from a scanned configuration or infrastructure manifest, and anything that transmits the graph off the machine. There is no telemetry, and the graph describes your machines, credentials-adjacent tooling, and network reach — treat an exfiltration path as high severity.

## What is not

- The declared verification checks run commands from the capability model by design. That model is code in this repository; changing it is equivalent to changing any other source file.
- `tt prune <id>` and the visualizer's config editing modify your configuration on purpose, writing a `.bak` first.
- Findings against a fork's own capability model, or against a configuration you supplied yourself, are not vulnerabilities in Ambit.

## Where your data is

The graph is a local SQLite file — `tt where` prints its path. Nothing is uploaded. `tt export` and `tt stats` describe your machine, so redact before pasting either into an issue.
