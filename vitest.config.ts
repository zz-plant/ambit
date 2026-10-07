import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Separate from vite.config.ts on purpose: that config sets `root: src/client`
// so the app builds from there, which would hide every backend test from the
// runner. The suite spans both halves of the repo, so it roots at the repo.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // The engine opens the graph through node:sqlite, which Node 22 keeps
    // behind a flag. Setting it here is what lets a test import an engine
    // module and call it, instead of spawning `node` and parsing stdout.
    pool: 'forks',
    execArgv: ['--experimental-sqlite'],
    // Engine tests seed real SQLite files in temp directories; a seed is
    // slower than a unit assertion and CI runners are not fast.
    // Every `ambit` command reads the Claude Code spool into its graph and
    // deletes it. A test that runs the CLI must never consume the developer's
    // own spool into a throwaway graph, so the whole suite points elsewhere.
    // Every seed also lists the models Ollama and LM Studio keep on disk, and
    // every command reads token counts from the session logs Codex, OpenCode
    // and Amp keep, so all of them point at folders that do not exist: the
    // developer's own models and sessions must never decide an assertion. A
    // test that wants models or logs makes them.
    env: {
      AMBIT_SPOOL: join(tmpdir(), `ambit-test-spool-${process.pid}.jsonl`),
      OLLAMA_MODELS: join(tmpdir(), `ambit-test-no-ollama-${process.pid}`),
      AMBIT_LMSTUDIO_MODELS: join(tmpdir(), `ambit-test-no-lmstudio-${process.pid}`),
      CODEX_HOME: join(tmpdir(), `ambit-test-no-logs-${process.pid}`, 'codex'),
      OPENCODE_DATA_DIR: join(tmpdir(), `ambit-test-no-logs-${process.pid}`, 'opencode'),
      AMP_DATA_DIR: join(tmpdir(), `ambit-test-no-logs-${process.pid}`, 'amp'),
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/engine/testing/**', 'src/client/vite-env.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // A floor, not a target. Set just under what the suite covers today so
      // it cannot quietly slide; raise it when a gap is closed rather than
      // treating the number as a goal in itself. The engine is well covered;
      // what these thresholds mostly hold is that the client and the two
      // servers do not get worse.
      thresholds: { statements: 55, branches: 47, functions: 55, lines: 57 },
    },
  },
});
