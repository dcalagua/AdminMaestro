import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // `supabase/.temp` es scratch del CLI (código generado y minificado del edge
    // runtime), no fuente del proyecto. `database.types.ts` es generado desde la DB.
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'src/types/database.types.ts',
      'supabase/.temp/**',
      'playwright-report',
      'test-results',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // La `service_role` key nunca puede aparecer en el cliente. Esta regla es
      // un cinturón extra sobre el scan de secretos.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/service_role/i]",
          message: 'La service_role key jamás debe aparecer en el código del cliente.',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['e2e/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
