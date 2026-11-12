import { defineConfig } from 'vitest/config';

// Unit tests: no database required.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
