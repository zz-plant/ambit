**What changed, and why.**

**Checks.** CI runs [the same gate](https://github.com/zz-plant/ambit/blob/main/CONTRIBUTING.md#the-checks-ci-runs) on every push; running it locally first is faster than a round trip.

- [ ] If this touches `src/server/api.ts`: it still binds loopback only. The origin check and the no-entry-creation rule have tests; the bind address does not.
- [ ] If this touches where the graph is stored: the engine, MCP server, and visualizer API all resolve `src/shared/db-path.ts`
- [ ] If this edits `src/engine/techtree.json`: it links the capability-model issue where the era or prerequisite was argued
- [ ] If this adds a runtime reader or a declared check: it ships with a test
