import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    // Integration tests share one real database; run files sequentially.
    fileParallelism: false,
    // Worker threads instead of child-process forks: on Windows (Node 24) fork workers running the
    // M2 concurrency tests died sporadically with native exit code 0xC0000409 (≈20–30 % of runs,
    // ~6 s into a file, independent of the test). Threads: 0 crashes in 10 + 3 full runs.
    pool: 'threads',
    hookTimeout: 120_000,
    testTimeout: 30_000,
    globalSetup: ['test/integration/global-setup.ts'],
  },
});
