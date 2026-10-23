'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, launchApp, go, lastHud, hudWith, createVault, addItem, selectItem, secretText, MASTER } = require('./fixtures');

test('the master password must pass the policy', async ({ page }) => {
  await go(page, 'items');
  await page.fill('#create-password', 'too short');
  await page.fill('#create-confirm', 'too short');
  await page.click('#create-submit');
  await expect(lastHud(page)).toContainText('at least 15 characters');

  await page.fill('#create-password', 'Password1!Password1!');
  await page.fill('#create-confirm', 'Password1!Password1!');
  await page.click('#create-submit');
  await expect(lastHud(page)).toContainText(/too easy to guess|data breaches/);
  await expect(page.locator('#create-form')).toBeVisible();
});

test('“Suggest One” fills a passphrase and leaves the confirmation to the user', async ({ page }) => {
  await go(page, 'items');
  await page.click('#create-suggest');
  const suggestion = await page.locator('#create-password').inputValue();
  expect(suggestion.split('-')).toHaveLength(6);
  await expect(page.locator('#create-password')).toHaveAttribute('type', 'text');
  await expect(page.locator('#create-confirm')).toHaveValue('');
  await expect(page.locator('#create-confirm')).toBeFocused();
});

test('items are encrypted on disk and passwords reach the page only on demand', async ({ page, userDataDir }) => {
  await createVault(page);
  await addItem(page, { label: 'GitHub', username: 'radu-24', password: 'gh-Secret-123', url: 'github.com', notes: 'recovery codes in drawer' });

  const raw = fs.readFileSync(path.join(userDataDir, 'vault.json'), 'utf8');
  for (const secret of ['gh-Secret-123', 'GitHub', 'radu-24', 'recovery', 'github.com', MASTER]) expect(raw).not.toContain(secret);
  expect(JSON.parse(raw).kdf).toMatchObject({ name: 'PBKDF2-HMAC-SHA256', iterations: 600000 });

  // The list the page holds has no passwords.
  const listed = await page.evaluate(() => window.PH.Vault.entries.map((entry) => Object.keys(entry)));
  expect(listed[0]).not.toContain('password');
  expect(await page.content()).not.toContain('gh-Secret-123');

  const passwordRow = page.locator('#vault-detail .field-row', { hasText: 'Password' });
  await passwordRow.getByRole('button', { name: 'Show password' }).click();
  expect(await secretText(passwordRow.locator('.secret'))).toBe('gh-Secret-123');
  await passwordRow.getByRole('button', { name: 'Hide password' }).click();
  await expect(passwordRow.locator('.secret')).toHaveCount(0);
  expect(await page.content()).not.toContain('gh-Secret-123');
});

test('old unencrypted items are moved into the new vault and wiped', async ({ page, userDataDir }) => {
  await page.evaluate(() => {
    localStorage.setItem('vaultEntries', JSON.stringify([
      { label: 'old-site', type: 'Website', user: 'radu', pass: 'old-pass', notes: '' },
      { label: 'old-app', type: 'App', user: '', pass: 'x', notes: '' },
    ]));
  });
  await page.reload();
  await go(page, 'items');
  await expect(page.locator('#legacy-note')).toContainText('2 items saved by an earlier version');
  await page.fill('#create-password', MASTER);
  await page.fill('#create-confirm', MASTER);
  await page.click('#create-submit');
  await expect(hudWith(page, '2 old items moved in')).toBeVisible();
  await expect(page.locator('#vault-list .list-item')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('vaultEntries'))).toBeNull();
  expect(fs.readFileSync(path.join(userDataDir, 'vault.json'), 'utf8')).not.toContain('old-pass');
});

test('delete moves to Recently Deleted; Undo, Recover and Delete Now work', async ({ page }) => {
  await createVault(page);
  await addItem(page, { label: 'keep-me', password: 'one-1' });
  await addItem(page, { label: 'delete-me', password: 'two-2' });

  await selectItem(page, 'delete-me');
  await page.click('#vault-detail button:has-text("Delete Item")');
  await expect(page.locator('.alert')).toBeVisible();
  await page.keyboard.press('Escape'); // cancel
  await expect(page.locator('.alert')).toHaveCount(0);
  await expect(page.locator('#vault-list .list-item')).toHaveCount(2);

  await page.click('#vault-detail button:has-text("Delete Item")');
  await page.click('.alert button:has-text("Delete")');
  await expect(page.locator('#vault-list .list-title')).toHaveText(['keep-me']);
  await hudWith(page, 'Moved to Recently Deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#vault-list .list-title')).toHaveText(['delete-me', 'keep-me']);

  // Delete again, then recover from Recently Deleted.
  await selectItem(page, 'delete-me');
  await page.click('#vault-detail button:has-text("Delete Item")');
  await page.click('.alert button:has-text("Delete")');
  await expect(page.locator('#nav-deleted-row')).toBeVisible();
  await go(page, 'deleted');
  await expect(page.locator('#vault-list .list-title')).toHaveText(['delete-me']);
  await expect(page.locator('#vault-list .list-subtitle')).toHaveText('Removed for good in 30 days');
  await page.click('#vault-detail button:has-text("Recover")');
  await expect(page.locator('#vault-list .list-item')).toHaveCount(0);
  await go(page, 'items');
  await expect(page.locator('#vault-list .list-item')).toHaveCount(2);

  // Delete Now is permanent.
  await selectItem(page, 'delete-me');
  await page.click('#vault-detail button:has-text("Delete Item")');
  await page.click('.alert button:has-text("Delete")');
  await go(page, 'deleted');
  await page.click('#vault-detail button:has-text("Delete Now")');
  await page.click('.alert button:has-text("Delete")');
  await expect(hudWith(page, 'Deleted permanently')).toBeVisible();
  expect(await page.evaluate(() => window.PH.Vault.entries.map((entry) => entry.label))).toEqual(['keep-me']);
});

test('long notes are never cut off', async ({ page }) => {
  await createVault(page);
  const notes = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
  await addItem(page, { label: 'notes', password: 'x', notes });
  const notesValue = page.locator('#vault-detail .notes-value');
  await expect(notesValue).toHaveText(notes);
  const sizes = await notesValue.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sizes.client).toBe(sizes.scroll);
});

test('lock, wrong password, unlock — and the vault survives a restart', async ({ page, electronApp, userDataDir }) => {
  await createVault(page);
  await addItem(page, { label: 'persisted', password: 'p' });

  await page.click('#vault-lock-btn');
  await expect(page.locator('#unlock-form')).toBeVisible();
  await expect(page.locator('#vault-status-text')).toHaveText('Vault locked');
  await page.fill('#unlock-password', 'not the master password');
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#unlock-message')).toHaveText('Wrong master password.');
  await page.fill('#unlock-password', MASTER);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#view-vault')).toBeVisible();
  await expect(page.locator('#vault-list .list-title')).toHaveText(['persisted']);

  await electronApp.close();
  const { app, page: second } = await launchApp(userDataDir);
  try {
    await expect(second.locator('#unlock-form')).toBeVisible();
    await second.fill('#unlock-password', MASTER);
    await second.press('#unlock-password', 'Enter');
    await expect(second.locator('#vault-list .list-title')).toHaveText(['persisted']);
  } finally {
    await app.close();
  }
});

test('locking clears the vault views at once and returns there after unlocking', async ({ page }) => {
  await createVault(page);
  await addItem(page, { label: 'x', password: 'y' });
  await go(page, 'security');
  await page.evaluate(() => window.api.vault.lock());
  await expect(page.locator('#unlock-form')).toBeVisible();
  await expect(page.locator('#gate-title')).toHaveText('Security');
  expect(await page.evaluate(() => window.PH.Vault.entries.length)).toBe(0);
  await expect(page.locator('#vault-list .list-item')).toHaveCount(0);

  await page.fill('#unlock-password', MASTER);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#view-security')).toBeVisible();
});
