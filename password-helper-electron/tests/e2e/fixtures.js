'use strict';

/**
 * Shared Playwright fixtures: every test gets a fresh Electron app with its
 * own temporary data folder, and the Pwned Passwords API replaced by an
 * offline fake (so tests are fast and never touch the network).
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
  return { app, page };
}

const test = base.extend({
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-e2e-'));
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

/** Active screen id (pages show one .screen.active at a time). */
const activeScreen = (page) => page.locator('.screen.active').first().getAttribute('id');

async function skipLogin(page) {
  await page.click('#skipBtn');
  await page.waitForURL(/index\.html/);
  await expect(page.locator('#main-menu')).toHaveClass(/active/);
}

/** From the main menu: open the vault and create it with MASTER. */
async function createVault(page) {
  await page.click('[data-page="vault.html"]');
  await page.waitForURL(/vault\.html/);
  await expect(page.locator('#create-screen')).toHaveClass(/active/);
  await page.fill('#create-password', MASTER);
  await page.fill('#create-confirm', MASTER);
  await page.click('#create-submit');
  await expect(page.locator('#vault-menu-screen')).toHaveClass(/active/);
}

async function addEntry(page, { label, username = '', password, notes = '' }) {
  await page.click('#btn-add');
  await expect(page.locator('#entry-screen')).toHaveClass(/active/);
  await page.fill('#label', label);
  await page.fill('#username', username);
  await page.fill('#vault-password', password);
  await page.fill('#notes', notes);
  await page.press('#label', 'Enter');
  await expect(page.locator('#vault-menu-screen')).toHaveClass(/active/);
}

module.exports = { test, expect, launchApp, activeScreen, skipLogin, createVault, addEntry, MASTER, BREACHED };
