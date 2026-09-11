---
name: Bug
about: Something Ambit does that it shouldn't, or doesn't that it should
labels: bug
---

### What happened

What you expected, and what you got instead.

### How to reproduce it

The command, and its output:

```console
$ 
```

### Your setup

- How you installed it (Homebrew, or a checkout):
- Which version: `brew list --versions ambit` for Homebrew, `git rev-parse --short HEAD` in a checkout:
- OS:
- `node -v`:
- Agent runtime whose config it read (OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex CLI, none):

### Your graph

Attach one if the report is about what Ambit thinks your environment can do. `ambit status` covers most of it; `ambit share --redact --out=ambit.html` when the shape of the graph matters, which replaces every name outside the curated model with its category. Both describe your machine, so redact anything you would not publish. [What to include](https://github.com/zz-plant/ambit/blob/main/SUPPORT.md#what-to-include) has the rest.
