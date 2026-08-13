import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    modulePreload: {
      // Without this Vite preloads the three chunk from index.html, which
      // downloads the whole 3D renderer even though ERAS is the default view.
      resolveDependencies: (_url, deps) => deps.filter(d => !d.includes('three')),
    },
    rollupOptions: {
      output: {
        // Rollup defaults this to true: the static imports of a dynamically
        // imported chunk get hoisted into the entry as bare side-effect
        // imports, to warm the graph. Here that meant the entry contained
        // `import "./three-*.js"` and every visitor fetched the whole 3D
        // renderer on first paint — the one thing lazy-loading Constellation
        // was supposed to prevent.
        hoistTransitiveImports: false,
        // Three.js is ~2/3 of the bundle and only the 3D layouts need it, so
        // splitting it lets the ERAS/flat views cache and load independently.
        // Assign by module id rather than by package name. The object form
        // pulled react/jsx-runtime into the three chunk — as a dependency of
        // @react-three/fiber it was claimed there first — so the entry chunk
        // statically imported 1MB of 3D renderer just to get the JSX runtime.
        // Every visitor downloaded it before a single 2D view rendered, and
        // Constellation being lazy() made no difference while that held.
        manualChunks(id) {
          // Vite's dynamic-import preload helper is a virtual module, so it
          // fell through to whichever chunk claimed it — the three chunk. One
          // 300-byte helper the entry needs was enough to make the entry
          // statically import the entire 3D renderer.
          if (id.includes('vite/preload-helper')) return 'react';
          if (!id.includes('node_modules')) return;
          // An allowlist, not a denylist. Sorting by "is it 3D?" left drei's
          // transitive dependencies — camera-controls, troika, meshline and
          // friends — in the shared chunk, and each of them imports three's
          // classes, so the shared chunk dragged the renderer back in.
          // Only what every view needs is shared; everything else follows
          // whichever chunk imports it, which for the 3D libraries is the
          // lazily loaded one.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](three|@react-three)[\\/]/.test(id)) return 'three';
          return;
        },
      },
    },
  },
});
