import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    // Replaces vite-tsconfig-paths plugin to fix ERR_MODULE_NOT_FOUND
    // and address Vite native path resolution warnings explicitly
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@cat-bot': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/unit/**/*.test.ts'],
    pool: 'forks',
    reporters: ['verbose'],
    bail: 0,
  },
});
