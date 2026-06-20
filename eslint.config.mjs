import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No `any` — we have database.types.ts; lean on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // console.log/info/debug clutter logs. Allow .error and .warn (used in cron handlers, webhooks).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Hook deps regressions cause silent staleness; treat as error.
      'react-hooks/exhaustive-deps': 'error',
      // Catch await-on-non-promise (silent no-op bugs).
      '@typescript-eslint/await-thenable': 'error',
      // Flag unused vars (the prefix-with-_ escape is fine).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Test files: allow looser rules.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    '.vitest-cache/**',
  ]),
]);

export default eslintConfig;
