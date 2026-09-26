import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
