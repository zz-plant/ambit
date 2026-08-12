import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/capability-graph/',
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
        // Three.js is ~2/3 of the bundle and only the 3D layouts need it, so
        // splitting it lets the ERAS/flat views cache and load independently.
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          react: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
});
