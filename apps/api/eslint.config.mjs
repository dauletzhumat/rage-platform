// API lint config: root rules + Nest-specific overrides.
import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['**/*.ts'],
    rules: {
      // Nest DI and ValidationPipe need runtime class references (emitDecoratorMetadata);
      // `import type` on DTOs/services would silently disable validation/injection.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
];
