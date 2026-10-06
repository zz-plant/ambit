import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** The released version, for the page's structured data, read from the one place it is written. */
const VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ambit-version',
      transformIndexHtml: html => html.replace('%AMBIT_VERSION%', VERSION),
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
      '/api': `http://127.0.0.1:${process.env.AMBIT_API_PORT || 3001}`,
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
