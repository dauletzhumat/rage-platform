import { defineConfig } from 'vitest/config';

// Integration tests: run against TEST_DATABASE_URL (database name must end with "_test").
// The global setup drops/recreates the `public` schema and applies all migrations.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
