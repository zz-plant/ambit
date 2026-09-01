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
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
