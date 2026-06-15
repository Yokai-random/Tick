import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// Build time is written by bat before each build to guarantee freshness
let buildTime;
try {
  buildTime = JSON.parse(readFileSync('./src/buildtime.json', 'utf-8')).buildTime;
} catch {
  buildTime = new Date().toISOString();
}

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
