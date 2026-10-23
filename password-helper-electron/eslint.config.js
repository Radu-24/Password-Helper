'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**', 'test-results/**', 'playwright-report/**', 'public/js/wordlist-eff.js'],
  },
  js.configs.recommended,
  {
    // Main process, preload, tests and tooling (Node / CommonJS)
    files: ['*.js', 'src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Pages (classic browser scripts sharing window.PH)
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
  },
  {
    // Code inside page.evaluate(() => …) runs in the page, so browser globals are fine here.
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-empty-pattern': 'off' }, // Playwright fixtures use `async ({}, use) => …`
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
