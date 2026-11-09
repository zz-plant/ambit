import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { hasApi } from './scripts/lib/api-health.ts';

/** The released version, for the page's structured data, read from the one place it is written. */
const VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;
const API_ORIGIN = `http://127.0.0.1:${process.env.AMBIT_API_PORT || 3001}`;
const REVISION = process.env.AMBIT_SITE_REVISION;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ambit-build-info',
      transformIndexHtml: html => ({
        html: html.replace('%AMBIT_VERSION%', VERSION),
        tags:
          REVISION && /^[0-9a-f]{40}$/.test(REVISION)
            ? [
                {
                  tag: 'meta',
                  attrs: { name: 'ambit-revision', content: REVISION },
                  injectTo: 'head',
                },
              ]
            : [],
      }),
    },
    {
      name: 'ambit-dev-api',
      async configureServer() {
        if (process.env.AMBIT_DEV_WAIT_FOR_API !== '1') return;
        // The client probes once per page load. Serve the page only once that
        // probe can succeed, so a fast first visit sees the live graph.
        const deadline = Date.now() + 15_000;
        do {
          if (await hasApi(API_ORIGIN)) return;
          await setTimeout(200);
        } while (Date.now() < deadline);
        throw new Error(`Ambit API did not become ready at ${API_ORIGIN}/api/health`);
      },
    },
  ],
  // GitHub Pages serves the demo under /ambit/.
  base: '/ambit/',
  root: 'src/client',
  server: {
    // The API accepts a page's Origin only on a port it was told about, and
    // `npm run dev` tells both processes the same AMBIT_WEB_PORT. A Vite that
    // moved to the next free port would serve a page the API then refuses on
    // every write, so it takes this port or stops.
    port: Number(process.env.AMBIT_WEB_PORT || 3000),
    strictPort: true,
    proxy: {
      // The API server reads the same variable, so the two can move together.
      // It listens on 127.0.0.1 only, and `localhost` can resolve to ::1,
      // where another server may hold the same port.
      '/api': API_ORIGIN,
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    // One shared chunk for the framework, so the tree view (the whole
    // product, since the 3D modes were sunset) caches independently.
    //
    // Vite 8 bundles with rolldown rather than rollup, and rolldown accepts
    // `manualChunks` only as a function — the object form fails the build
    // outright with "Invalid type: Expected Function but received Object".
    // The function has to name scheduler too: rollup resolved react-dom's own
    // dependencies into the chunk for us, and matching by path does not.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
        },
      },
    },
  },
});
