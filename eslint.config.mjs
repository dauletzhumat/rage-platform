// Root ESLint flat config for Node/TS workspaces (api, db, api-client, tools).
// apps/web has its own config extending eslint-config-next.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '.local/**',
      'apps/web/**',
      'packages/db/src/generated/**',
      'packages/api-client/src/schema.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['tools/**/*.mjs', '**/*.config.{js,mjs,ts}', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
