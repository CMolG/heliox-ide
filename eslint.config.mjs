// eslint.config.mjs — ESLint v10 flat config for the Fluxor IDE.
//
// ESLint 10 dropped eslintrc + `--ext`; this is the flat-config replacement.
// Non-type-checked TypeScript linting (fast, no tsconfig project wiring) — type
// correctness is already enforced separately by `tsc --noEmit`. Rules are tuned
// to the codebase's existing conventions so `npm run lint` is a useful, green
// baseline rather than a flood.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Build output, vendored, and generated artifacts — never linted.
  {
    ignores: [
      '.vite/**',
      'dist/**',
      'dist-bridge/**',
      'out/**',
      'node_modules/**',
      '.fluxor/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'assets/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      // The codebase uses `_`-prefixed args/vars to mark intentional non-use
      // (e.g. `_event`, `_windowId`); keep that convention exempt.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Pre-existing debt that surfaced when ESLint was first wired up. Kept
      // visible as warnings so `npm run lint` is a green, usable gate (new
      // violations of the rest of `recommended` still fail). Ratchet these to
      // 'error' as the codebase is cleaned up.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'preserve-caught-error': 'warn',
      'prefer-const': 'warn',
    },
  },
);
