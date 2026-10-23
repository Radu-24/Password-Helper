'use strict';

const { test, expect } = require('./fixtures');

test('the page has no Node.js access, only the window.api bridge', async ({ page }) => {
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.process)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys(window.api).sort())).toEqual(
    ['analyze', 'app', 'clipboard', 'csvImport', 'hibpRange', 'platform', 'settings', 'vault', 'window'].sort(),
  );
});

test('API errors reach the page with their code', async ({ page }) => {
  const error = await page.evaluate(() => window.api.vault.unlock('anything').catch((e) => ({ code: e.code, message: e.message })));
  expect(error).toEqual({ code: 'NO_VAULT', message: 'No vault has been created yet.' });
});

test('only web addresses can be opened from the page', async ({ page }) => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:privacy', 'not a url']) {
    const error = await page.evaluate((target) => window.api.app.openUrl(target).catch((e) => e.code), url);
    expect(error, url).toBe('INVALID');
  }
});

test('the window is sandboxed with context isolation', async ({ electronApp }) => {
  const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const { sandbox, contextIsolation, nodeIntegration, webSecurity } = win.webContents.getLastWebPreferences();
    return { sandbox, contextIsolation, nodeIntegration, webSecurity, minSize: win.getMinimumSize() };
  });
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, minSize: [820, 600] });
});

test('navigating away from the app is blocked', async ({ page }) => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^file:\/\/.*\/public\/index\.html$/);
  const opened = await page.evaluate(() => window.open('https://example.com/') === null);
  expect(opened).toBe(true);
});

test('the page ships a strict Content-Security-Policy and no inline code', async ({ page }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  for (const rule of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "connect-src 'none'", "object-src 'none'"]) {
    expect(csp).toContain(rule);
  }
  expect(await page.locator('script:not([src])').count()).toBe(0);
  expect(await page.locator('style').count()).toBe(0);
});
