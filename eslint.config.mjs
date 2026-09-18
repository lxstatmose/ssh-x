// ESLint flat config (ESLint 9+).
//
// Two very different runtime environments live in this repo:
//   - `src/main` + `scripts`  -> CommonJS in the Electron main process (Node globals)
//   - `src/renderer`          -> React + TypeScript in a sandboxed browser context
//
// Renderer linting is intentionally not type-aware (no project service) so that
// `npm run lint` stays fast; `npm run typecheck` covers types.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'release/**', 'assets/**'],
  },

  // ─── Main process, preload and tooling scripts ──────────────────────────────
  {
    files: ['src/main/**/*.js', 'scripts/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // ─── Renderer (React + TypeScript) ─────────────────────────────────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // Rules of hooks + exhaustive-deps only. v7 ships the compiler-aware
      // rules in every preset; they flag patterns this codebase uses
      // deliberately (refs written during render, setState inside effects that
      // sync with an external system), so they are disabled below and can be
      // switched back on rule by rule once those patterns are reworked.
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/void-use-memo': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
      // IPC payloads and catch clauses are deliberately loosely typed.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ─── Build config ──────────────────────────────────────────────────────────
  {
    files: ['vite.config.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
