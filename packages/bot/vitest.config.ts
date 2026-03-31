import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })], // Use test tsconfig so @/ resolves to both src/ and tests/ for test files
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts', 'tests/platforms/**/*.test.ts'],
    pool: 'forks',
    reporters: ['verbose'],
    bail: 0,
  },
});
