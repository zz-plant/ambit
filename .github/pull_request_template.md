**What this changes, and why.**

**Checks** — CI runs these; running them locally first is faster than a round trip:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- [ ] `bootstrap.sh` still works on a machine with no agent config (CI covers this; break it and the first run of a new user is a stack trace)
- [ ] If this touches `src/server/api.ts`: it still binds loopback only, rejects non-local origins before routing, and cannot create configuration entries — see [AGENTS.md](../AGENTS.md)
- [ ] If this touches where the graph is stored: the engine, MCP server, and visualizer API all resolve `src/shared/db-path.ts`
