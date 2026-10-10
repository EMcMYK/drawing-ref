import { defineConfig } from 'vite';

export default defineConfig({
  // three.js alone is ~550 kB minified (~145 kB gzipped); that's expected.
  build: { chunkSizeWarningLimit: 700 },
});
