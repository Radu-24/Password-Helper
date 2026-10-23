'use strict';

const { test, expect } = require('./fixtures');

test('pages have no Node.js access, only the window.api bridge', async ({ page }) => {
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.process)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys(window.api).sort())).toEqual(
    ['analyze', 'app', 'clipboard', 'hibpRange', 'settings', 'vault', 'window'].sort(),
  );
});

test('API errors reach the page with their code', async ({ page }) => {
  const error = await page.evaluate(() => window.api.vault.unlock('anything').catch((e) => ({ code: e.code, message: e.message })));
  expect(error).toEqual({ code: 'NO_VAULT', message: 'No vault has been created yet.' });
});

test('the window is sandboxed with context isolation', async ({ electronApp }) => {
  const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const { sandbox, contextIsolation, nodeIntegration, webSecurity } = win.webContents.getLastWebPreferences();
    return { sandbox, contextIsolation, nodeIntegration, webSecurity, minSize: win.getMinimumSize() };
  });
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, minSize: [800, 600] });
});

test('navigating away from the app is blocked', async ({ page }) => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^file:\/\/.*\/public\/login\.html$/);
  const opened = await page.evaluate(() => window.open('https://example.com/') === null);
  expect(opened).toBe(true);
});

test('every page ships a strict Content-Security-Policy', async ({ page }) => {
  for (const file of ['login.html', 'index.html', 'vault.html', 'vault_view.html']) {
    await page.evaluate((name) => {
      window.location.href = name;
    }, file);
    await page.waitForURL(new RegExp(file.replace('.', '\\.')));
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(await page.locator('script:not([src])').count(), `${file} has no inline scripts`).toBe(0);
  }
});
