import { defineConfig } from 'vite';

// Dedicated port for Viral so it coexists with the rest of the suite.
export default defineConfig({
  cacheDir: './.vite-cache',
  server: {
    port: 5177,
    host: '127.0.0.1',
    open: true
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false
  }
});
