import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    // Integration tests share one real database; run files sequentially.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    globalSetup: ['test/integration/global-setup.ts'],
  },
});
