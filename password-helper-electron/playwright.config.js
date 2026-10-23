'use strict';

// End-to-end tests: launch the real Electron app and click through it.
// Run with `npm run test:e2e` (unit tests: `npm test`).

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // one Electron instance at a time
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
