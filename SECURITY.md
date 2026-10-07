# Security

## Reporting

Report vulnerabilities privately through GitHub: **[Security → Report a vulnerability](https://github.com/zz-plant/ambit/security/advisories/new)**. Private reporting is enabled on this repository. Please do not open a public issue for anything exploitable.

Ambit is a personal project, not a staffed one — expect a first response in days rather than hours.

## What is worth reporting

Ambit reads your agent configuration and, through the visualizer, writes back to it. Four invariants hold that surface, and a break in any of the four is a vulnerability. [AGENTS.md](./AGENTS.md#security-posture) says where each of the four is enforced in code.

- **Loopback only.** The API server binds `127.0.0.1`. Nothing on your LAN and nothing through a tunnel can reach it, and any path that widens that bind is in scope.
- **Origin allowlist.** A request whose `Origin` is not this app's own page is rejected with 403 *before routing*. The Origin has to name `localhost`, `127.0.0.1` or `[::1]` on a port the page is served from, which is the API's own and, in a checkout, the dev port `npm run dev` passes to both processes; a page on any other local port is refused, token or not. CORS headers alone would be insufficient, because a simple request skips preflight and reaches the handler regardless. Every request also has to be addressed to `localhost`, `127.0.0.1` or `[::1]`, and any other name is a 403 before routing: a page that rebinds its own name to this address is the same origin as the server, so the origin check cannot stop it, and the name it asked for gives it away. Anything that lets a page you visit reach the API is in scope.
- **No entry creation over HTTP.** An MCP entry carries a command your agent runtime executes, so creating one over HTTP would be remote code execution. Any path that turns an HTTP request into a new executable config entry is in scope. What the API may do instead:
  - Toggle an existing MCP server's `enabled`, edit an existing agent's `description` or `model`, and edit an existing command's `description`. Every edit copies the config to `<config>.bak` first and is refused if the copy cannot be made. Adding a server produces a snippet you paste yourself.
  - Decide proposals, which writes to the graph and never to a config. An approval is a signed artifact that only `ambit apply`, or a control-plane call presenting it, can spend, and a rejection is a row that withdraws any approval before it.
  - Every decision is made as the person at the page and never as an actor the request names. It is bound to the hash the page showed and refused if the proposal has changed since. The two routes that decide a queue of drafts at once, `/api/proposals/approve` and `/api/proposals/reject`, take an explicit list of at most fifty.
  - A request to any of these routes with no browser behind it must present the API token. So must a post to `/api/telemetry`, because work recorded there counts toward a promotion threshold a person set.
  - The page never runs a check. It copies `ambit verify <id>` for you to type, because a declared check is a command, and the id in it is quoted, since an id can be anything an agent or a sync file's author typed.
- **No egress you did not type.** The graph is a local SQLite file and there is no telemetry. Any other path that moves the graph off the machine is in scope, and an exfiltration path is high severity. What reaches the network from Ambit's own code, and when:
  - `ambit notify` and `ambit notify-approvals`, each only with a topic argument.
  - `ambit dispatch` (and `propose`/`approve` with `--dispatch`), only with a webhook URL from `--to` or `AMBIT_APPROVAL_WEBHOOK`. It sends one proposal's summary or signed artifact, never a command.
  - `ambit incidents`, an empty GET to each service URL your own manifest names.
  - `ambit goal --judge`, the goal you typed, to a judgment model on this machine. A URL whose host is not `127.0.0.1`, `localhost` or `[::1]`, or that carries credentials, is refused.
  - A declared check, because a check is a command. `ambit verify` runs them, `ambit apply` runs the check of what it applied, and so does an agent calling `ambit_verify` over MCP; the curated check for Web Research fetches `https://example.com`. Checks run only when you type one of those commands or an agent calls that tool, never from the server, whose page copies `ambit verify <id>` for you to type.

  What stays on the machine:
  - The server reads the local Docker socket when one exists, over a unix socket and read-only. It never starts or stops anything.
  - `ambit graph capacity` runs `tailscale status --json`, `sysctl` and `nvidia-smi` when you type it, with fixed arguments and no shell. The first asks the local Tailscale daemon, none sends anything, the report leaves out addresses, and nothing is written. The server never runs them.
  - The Claude Code plugin's hooks append which tool ran, Claude Code's id for the call and the time each hook ran, which failed and its error text, and when a person was asked, to `~/.local/state/ambit/claude-code.jsonl`, never a tool's input or output. The next `ambit` command reads it into the graph and deletes it, writing back only the line of a call still running so its end can be paired with it, and from the transcript of a session that ended it reads the token counts and model name and nothing else. `AMBIT_NO_LEDGER=1` stops the hooks writing.
  - Cursor's hook, which `ambit connect cursor --ledger` adds to `~/.cursor/hooks.json`, appends to the same file the time it ran and the conversation's id; for a shell command or MCP call that ran, the server's and tool's names and the length Cursor states; for a failed call, Cursor's id for it, its error text, failure kind and whether it was interrupted; and why a conversation ended. Never a command's text or output, an MCP call's arguments or result, file contents, a prompt or the user's email. It is on no permission hook and prints `{}`, so it can neither block a call nor allow one. `AMBIT_NO_LEDGER=1` stops it writing.
  - The map's page loads nothing from another origin, fonts included, so opening it, locally or on the hosted demo, sends no request anywhere but the server that served it.

Also in scope: anything that causes the engine to execute content from a scanned configuration or infrastructure manifest, and any path by which `ambit gate`, the Claude Code PreToolUse hook, answers *allow*, or by which Cursor's ledger hook blocks or allows a call. The gate may only narrow what Claude Code would do: it denies what is forbidden or over budget, asks about the rest of what it can name, and otherwise prints nothing. It reads the call from stdin and the local graph, writes nothing, opens no socket, and on any error prints nothing, so a broken gate leaves Claude Code's own permissions in charge.

A tech tree overlay (`.ambit/techtree.json` or `.ambit.json` in the directory `ambit` runs from, or `AMBIT_OVERLAY_TECHTREE`) may add nodes and detection patterns and may narrow the authority the curated tree states, never widen it. A cloned repository can ship either file, so the merge keeps every curated mode, takes the narrower of the curated and the overlay's for each key (`forbidden` over `confirm` over `autonomous`, with `override: true` no exception), and caps at `confirm` any mode the curated tree never stated, a node only the overlay names included. Any overlay that yields a grant wider than the shipped tree's is in scope.

## What is not

- The declared verification checks run commands from the capability model by design. That model is code in this repository; changing it is equivalent to changing any other source file.
- `ambit apply <id>`, `ambit connect` and the visualizer's config editing modify your configuration on purpose, each writing a backup first: `<config>.ambit-<id>.bak` for `ambit apply`, and `<file>.bak` for the other two, which every write replaces, so it holds the file as it stood before the most recent one. Each backup is a byte copy renamed over the old one, so a link planted at that name is replaced and never followed, and `ambit connect` says which files it changed and where each backup is. `ambit apply` and `ambit rollback` change only the entries they add or remove, so a config's comments and layout survive both, and a rollback gives back the file's own bytes.
- Findings against a fork's own capability model, or against a configuration you supplied yourself, are not vulnerabilities in Ambit.

## Known limits

- The token rule stops a page you visit and a script acting casually. It is not a boundary against a determined process running as you, which can read the token file, record work toward a promotion threshold with it, or open the graph directly; loopback binding and the token file's `0600` permissions carry that weight.

## Where your data is

The graph is a local SQLite file whose path `ambit where` prints, and it describes your machines, your credentials-adjacent tooling, and your network reach. `ambit graph` and `ambit status` describe your machine too, so redact before pasting either into a report; [the FAQ](./docs/faq.md#does-anything-leave-my-machine) lists the commands that can move data and what each one sends. The server's read routes (`/api/loop`, `/api/audit`, `/api/frontier` and `/api/run`) answer from the graph under the same loopback and origin rules, and `/api/loop` also carries the text of a few install patches shipped in this repository's tree. The infrastructure scan probes only what your own manifest names, as described above.
