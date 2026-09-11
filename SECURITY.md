# Security

## Reporting

Report vulnerabilities privately through GitHub: **[Security → Report a vulnerability](https://github.com/zz-plant/ambit/security/advisories/new)**. Private reporting is enabled on this repository. Please do not open a public issue for anything exploitable.

Ambit is a personal project, not a staffed one — expect a first response in days rather than hours.

## What is worth reporting

Ambit reads your agent configuration and, through the visualizer, writes back to it. Four invariants hold that surface, and a break in any of the four is a vulnerability. [AGENTS.md](./AGENTS.md#security-posture) says where each of the four is enforced in code.

- **Loopback only.** The API server binds `127.0.0.1`. Nothing on your LAN and nothing through a tunnel can reach it, and any path that widens that bind is in scope.
- **Origin allowlist.** A request with a non-local `Origin` is rejected with 403 *before routing*. CORS headers alone would be insufficient, because a simple request skips preflight and reaches the handler regardless. Anything that lets a page you visit reach the API is in scope.
- **No entry creation over HTTP.** An MCP entry carries a command your agent runtime executes, so creating one over HTTP would be remote code execution. The API can toggle an existing MCP server's `enabled`, edit an existing agent's `description` or `model`, and edit an existing command's `description`; adding a server produces a snippet you paste yourself. Any path that turns an HTTP request into a new executable config entry is in scope.
- **No egress you did not type.** The graph is a local SQLite file and there is no telemetry. The only outbound calls in the engine are `ambit notify` and `ambit notify-approvals`, each of which needs a topic argument before it sends anything, and `ambit incidents`, which probes the service URLs your own manifest names with an empty GET. Any other path that moves the graph off the machine is in scope, and an exfiltration path is high severity.

Also in scope: anything that causes the engine to execute content from a scanned configuration or infrastructure manifest.

## What is not

- The declared verification checks run commands from the capability model by design. That model is code in this repository; changing it is equivalent to changing any other source file.
- `ambit apply <id>` and the visualizer's config editing modify your configuration on purpose, writing a `.bak` first.
- Findings against a fork's own capability model, or against a configuration you supplied yourself, are not vulnerabilities in Ambit.

## Where your data is

The graph is a local SQLite file whose path `ambit where` prints, and it describes your machines, your credentials-adjacent tooling, and your network reach. `ambit graph` and `ambit status` describe your machine too, so redact before pasting either into a report; [the FAQ](./docs/faq.md#does-anything-leave-my-machine) lists the commands that can move data and what each one sends.
