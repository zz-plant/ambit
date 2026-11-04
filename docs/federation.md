# Federation: sharing a read-only snapshot between machines

Ambit is local by design: one SQLite graph per machine, bound to `127.0.0.1`,
no central server. Federation does not change that. It lets a machine publish a
*signed summary* of what it can do, and another machine read it — without
merging, without trusting, and without anything executing.

## What travels

`ambit federation export` writes a signed summary: capability ids, kinds, states,
lifecycles, and authority modes. No commands, paths, tokens, or economics. The
same allow-list `ambit share` uses, plus a signature.

`ambit federation import <file>` reads it into `federation_imports`. The imported
rows are **read-only observations**: they never widen a grant on this machine,
never change a lifecycle, and never overwrite a local row. They exist so a
portfolio view can answer "what does the fleet look like?" without any machine
giving up authority over its own graph.

## A team workflow that needs no central server

1. Each engineer runs `ambit federation export --redact > ambit-summary.json`.
2. A platform lead collects them (email, a shared folder, a PR — the transport
   is not Ambit's business) and runs `ambit portfolio` against the directory.
3. The lead compares reach, failing checks, and single points of failure across
   machines, and writes a recommendation as a normal `ambit propose` on their
   own machine.

No machine's graph changes because another one was imported. A permissive
machine cannot widen a careful one by moving a file, and an authority grant
does not travel at all.

## What does not travel

- Commands, URLs, paths, descriptions, economics.
- Authority grants (a grant is a decision made on a machine holding the key).
- Declared checks (a check is a command; importing one would run on whoever
  opens it).

See `SECURITY.md` and AGENTS.md rule 7 for the invariants behind these.
