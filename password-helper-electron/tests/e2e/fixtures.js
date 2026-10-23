'use strict';

/**
 * Shared Playwright fixtures: every test gets a fresh Electron app with its
 * own temporary data folder, and the Pwned Passwords API replaced by an
 * offline fake (so tests are fast and never touch the network).
 *
 * By default the app starts straight in the main window (welcome and
 * sign-in already done); use `test.use({ startInApp: false })` to test them.
 */

const { test: base, expect, _electron: electron } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', '..');
const MASTER = 'Correct-Horse-Battery-Staple-2026';
/** Passwords the fake HIBP API reports as breached. */
const BREACHED = ['Password1!', 'hunter2', 'password123'];
const sha1 = (text) => crypto.createHash('sha1').update(text, 'utf8').digest('hex').toUpperCase();

async function launchApp(userDataDir) {
  const args = [APP_DIR, `--user-data-dir=${userDataDir}`];
  // Chromium's sandbox can't start as root (e.g. CI containers).
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox', '--disable-gpu');
  const env = { ...process.env };
  delete env.NODE_OPTIONS; // Electron refuses some Node flags

  const app = await electron.launch({ executablePath: require('electron'), args, env, cwd: APP_DIR });
  await app.evaluate(({ net }, breachedHashes) => {
    net.fetch = async (url) => {
      const prefix = String(url).slice(-5);
      const lines = breachedHashes.filter((hash) => hash.startsWith(prefix)).map((hash) => `${hash.slice(5)}:4242`);
      lines.push('00000000000000000000000000000000000:0'); // a padding row
      return new Response(lines.join('\r\n'), { status: 200 });
    };
  }, BREACHED.map(sha1));
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Test machines have no GPU; don't let the "glass is slow" hint cover buttons.
  await page.evaluate(() => localStorage.setItem('ph.performanceHintShown', 'true'));
  return { app, page };
}

const test = base.extend({
  startInApp: [true, { option: true }],
  userDataDir: async ({ startInApp }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-e2e-'));
    if (startInApp) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboarded: true, showLoginOnStart: false }));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  electronApp: async ({ userDataDir }, use) => {
    const { app } = await launchApp(userDataDir);
    await use(app);
    await app.close().catch(() => {});
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await use(page);
    expect(errors, 'no errors in the page console').toEqual([]);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The newest notification. */
const lastHud = (page) => page.locator('.hud:not(.leaving)').last();
const hudWith = (page, text) => page.locator('.hud', { hasText: text });

/** Clicks a sidebar destination ('analyzer', 'generator', 'items', …). */
async function go(page, name) {
  await page.click(`.sidebar-item[data-nav="${name}"]`);
}

const clipboardText = (electronApp) => electronApp.evaluate(({ clipboard }) => clipboard.readText());

/** Creates the vault from the gate shown on the vault views. */
async function createVault(page) {
  await go(page, 'items');
  await expect(page.locator('#create-form')).toBeVisible();
  await page.fill('#create-password', MASTER);
  await page.fill('#create-confirm', MASTER);
  await page.click('#create-submit');
  await expect(page.locator('#view-vault')).toBeVisible();
}

/** Adds an item through the editor (vault must be unlocked and showing). */
async function addItem(page, { label, username = '', password, url = '', notes = '' }) {
  await page.click('#vault-new');
  const editor = page.locator('#vault-detail form.editor');
  await editor.locator('.editor-title-input').fill(label);
  await editor.locator('input[aria-label="Username"]').fill(username);
  await editor.locator('input[aria-label="Password"]').fill(password);
  await editor.locator('input[aria-label="Website"]').fill(url);
  await editor.locator('textarea[aria-label="Notes"]').fill(notes);
  await editor.locator('button[type="submit"]').click();
  await expect(page.locator('#vault-detail .detail-title')).toHaveText(label);
}

/** Selects an item in the list by its title. */
async function selectItem(page, label) {
  await page.locator('#vault-list .list-item', { has: page.locator('.list-title', { hasText: new RegExp(`^${label}$`) }) }).click();
  await expect(page.locator('#vault-detail .detail-title')).toHaveText(label);
}

/** Text of a secret once the decode animation has finished. */
async function secretText(locator) {
  await expect(locator).toBeVisible();
  await expect(locator.locator('.scramble')).toHaveCount(0);
  return locator.textContent();
}

module.exports = {
  test,
  expect,
  launchApp,
  lastHud,
  hudWith,
  go,
  clipboardText,
  createVault,
  addItem,
  selectItem,
  secretText,
  MASTER,
  BREACHED,
};
