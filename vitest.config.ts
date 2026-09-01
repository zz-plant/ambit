import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts on purpose: that config sets `root: src/client`
// so the app builds from there, which would hide every backend test from the
// runner. The suite spans both halves of the repo, so it roots at the repo.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // The engine opens the graph through node:sqlite, which Node 22 keeps
    // behind a flag. Setting it here is what lets a test import an engine
    // module and call it, instead of spawning `node` and parsing stdout.
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--experimental-sqlite'] } },
    // Engine tests seed real SQLite files in temp directories; a seed is
    // slower than a unit assertion and CI runners are not fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
