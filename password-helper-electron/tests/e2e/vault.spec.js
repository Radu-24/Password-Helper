'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, launchApp, skipLogin, createVault, addEntry, MASTER } = require('./fixtures');

const lastToast = (page) => page.locator('.toast').last();

test('the master password must pass the policy', async ({ page }) => {
  await skipLogin(page);
  await page.click('[data-page="vault.html"]');
  await page.fill('#create-password', 'too short');
  await page.fill('#create-confirm', 'too short');
  await page.click('#create-submit');
  await expect(lastToast(page)).toContainText('at least 15 characters');

  await page.fill('#create-password', 'Password1!Password1!');
  await page.fill('#create-confirm', 'Password1!Password1!');
  await page.click('#create-submit');
  await expect(lastToast(page)).toContainText(/too easy to guess|data breaches/);
  await expect(page.locator('#create-screen')).toHaveClass(/active/);
});

test('entries are encrypted on disk and passwords only reach the page on demand', async ({ page, userDataDir }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'github.com', username: 'radu-24', password: 'gh-Secret-123', notes: 'recovery codes in drawer' });

  const raw = fs.readFileSync(path.join(userDataDir, 'vault.json'), 'utf8');
  for (const secret of ['gh-Secret-123', 'github.com', 'radu-24', 'recovery', MASTER]) expect(raw).not.toContain(secret);
  expect(JSON.parse(raw).kdf).toMatchObject({ name: 'PBKDF2-HMAC-SHA256', iterations: 600000 });

  await page.click('#btn-view');
  await page.waitForURL(/vault_view\.html/);
  const values = await page.locator('.entry input').evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(values).not.toContain('gh-Secret-123');

  await page.click('.entry-header');
  const field = page.locator('.entry.expanded input[aria-label="Password"]');
  await page.click('.entry.expanded .reveal-btn');
  await expect(field).toHaveValue('gh-Secret-123');
  await page.click('.entry.expanded .reveal-btn');
  await expect(field).toHaveValue('');
});

test('old unencrypted entries are moved into the new vault and wiped', async ({ page, userDataDir }) => {
  await page.evaluate(() => {
    localStorage.setItem('vaultEntries', JSON.stringify([
      { label: 'old-site', type: 'Website', user: 'radu', pass: 'old-pass', notes: '' },
      { label: 'old-app', type: 'App', user: '', pass: 'x', notes: '' },
    ]));
  });
  await skipLogin(page);
  await page.click('[data-page="vault.html"]');
  await expect(page.locator('#legacy-note')).toContainText('2 entries saved by the previous version');
  await page.fill('#create-password', MASTER);
  await page.fill('#create-confirm', MASTER);
  await page.click('#create-submit');
  await expect(page.locator('.toast').first()).toContainText('2 old entries moved in');
  expect(await page.evaluate(() => localStorage.getItem('vaultEntries'))).toBeNull();
  expect(fs.readFileSync(path.join(userDataDir, 'vault.json'), 'utf8')).not.toContain('old-pass');
});

test('delete asks first and removes the right entry', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'keep-me', password: 'one' });
  await addEntry(page, { label: 'delete-me', password: 'two' });
  await page.click('#btn-view');
  await page.waitForURL(/vault_view\.html/);

  await page.locator('.entry-header', { hasText: 'delete-me' }).click();
  await page.click('.entry.expanded .entry-btn.delete');
  await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.entry')).toHaveCount(2);

  await page.click('.entry.expanded .entry-btn.delete');
  await page.click('.modal .btn.danger');
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(page.locator('.entry-title')).toHaveText(['keep-me']);
});

test('long notes are never cut off', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  const notes = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
  await addEntry(page, { label: 'notes', password: 'x', notes });
  await page.click('#btn-view');
  await page.click('.entry-header');
  await page.waitForTimeout(600);
  const sizes = await page.locator('.entry.expanded textarea').evaluate((t) => ({ scroll: t.scrollHeight, client: t.clientHeight }));
  expect(sizes.client).toBe(sizes.scroll);
  const inner = await page.locator('.entry.expanded .entry-body-inner').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(inner.client).toBe(inner.scroll);
});

test('lock, wrong password, unlock — and the vault survives a restart', async ({ page, electronApp, userDataDir }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'persisted', password: 'p' });

  await page.click('#btn-lock');
  await expect(page.locator('#unlock-screen')).toHaveClass(/active/);
  await page.fill('#unlock-password', 'not the master password');
  await page.press('#unlock-password', 'Enter');
  await expect(lastToast(page)).toContainText('Wrong master password');
  await page.fill('#unlock-password', MASTER);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#vault-menu-screen')).toHaveClass(/active/);

  await electronApp.close();
  const { app, page: second } = await launchApp(userDataDir);
  try {
    await skipLogin(second);
    await second.click('[data-page="vault.html"]');
    await expect(second.locator('#unlock-screen')).toHaveClass(/active/);
    await second.fill('#unlock-password', MASTER);
    await second.press('#unlock-password', 'Enter');
    await second.click('#btn-view');
    await expect(second.locator('.entry-title')).toHaveText(['persisted']);
  } finally {
    await app.close();
  }
});

test('the list page leaves as soon as the vault locks', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'x', password: 'y' });
  await page.click('#btn-view');
  await page.waitForURL(/vault_view\.html/);
  await page.evaluate(() => window.api.vault.lock());
  await page.waitForURL(/vault\.html/);
  await expect(page.locator('#unlock-screen')).toHaveClass(/active/);
});
