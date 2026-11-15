import { defineConfig } from 'vitest/config';

// Integration tests: run against TEST_DATABASE_URL (database name must end with "_test").
// The global setup drops/recreates the `public` schema and applies all migrations.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/helpers/global-setup.ts'],
    fileParallelism: false,
    // Forked workers intermittently crash on Windows with 0xC0000409 at startup (runner-level,
    // seen in M2/M3); worker threads do not (same choice as apps/api).
    pool: 'threads',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
