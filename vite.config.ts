import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the demo under /ambit/.
  base: '/ambit/',
  root: 'src/client',
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
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
