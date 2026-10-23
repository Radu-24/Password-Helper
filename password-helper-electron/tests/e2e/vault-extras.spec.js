'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, skipLogin, createVault, addEntry, MASTER } = require('./fixtures');

const lastToast = (page) => page.locator('.toast').last();
const clipboardText = (electronApp) => electronApp.evaluate(({ clipboard }) => clipboard.readText());

async function openList(page) {
  await page.click('#btn-view');
  await page.waitForURL(/vault_view\.html/);
}

test('copy buttons use the clipboard without showing the password', async ({ page, electronApp }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'github.com', username: 'radu-24', password: 'gh-Secret-123' });
  await openList(page);
  await page.click('.entry-header');
  await page.click('.entry.expanded >> text=📋 Password');
  await expect(lastToast(page)).toContainText('Password copied — clipboard clears in 30 s');
  expect(await clipboardText(electronApp)).toBe('gh-Secret-123');
  await expect(page.locator('.entry.expanded input[aria-label="Password"]')).toHaveValue('');
  await page.click('.entry.expanded >> text=📋 Username');
  expect(await clipboardText(electronApp)).toBe('radu-24');
});

test('edit an entry from the list', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'old-name', password: 'pw-1' });
  await openList(page);
  await page.click('.entry-header');
  await page.click('.entry.expanded >> text=✏️ Edit');
  await page.waitForURL(/vault\.html/);
  await expect(page.locator('#entry-title')).toHaveText('✏️ Edit Entry');
  await expect(page.locator('#label')).toHaveValue('old-name');
  await expect(page.locator('#vault-password')).toHaveValue('pw-1');
  await page.fill('#label', 'new-name');
  await page.click('#entry-submit');
  await page.waitForURL(/vault_view\.html/);
  await expect(page.locator('.entry-title')).toHaveText(['new-name']);
});

test('search, sort and health filters', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'bravo.com', username: 'radu', password: 'password123' });
  await addEntry(page, { label: 'alpha.org', password: 'password123' });
  await addEntry(page, { label: 'charlie.net', password: 'Lantern-Orbit-Velvet-Cactus-71' });
  await openList(page);

  await expect(page.locator('.entry-title')).toHaveText(['alpha.org', 'bravo.com', 'charlie.net']);
  await page.selectOption('#sort', 'recent');
  await expect(page.locator('.entry-title')).toHaveText(['charlie.net', 'alpha.org', 'bravo.com']);

  await page.keyboard.press('Control+f');
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.type('radu');
  await expect(page.locator('.entry-title')).toHaveText(['bravo.com']);
  await page.keyboard.press('Escape'); // clears the search, stays on the page
  await expect(page.locator('.entry')).toHaveCount(3);
  expect(page.url()).toMatch(/vault_view\.html/);

  await expect(page.locator('[data-filter="reused"]')).toHaveText('♻ 2 reused');
  await expect(page.locator('[data-filter="weak"]')).toHaveText('⚠ 2 weak');
  await page.click('[data-filter="reused"]');
  await expect(page.locator('.entry')).toHaveCount(2);
  await expect(page.locator('.entry .badge.reused').first()).toHaveText('Reused ×2');
});

test('breach scan flags breached passwords', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'old', password: 'password123' }); // "breached" in the fake API
  await addEntry(page, { label: 'fresh', password: 'Lantern-Orbit-Velvet-Cactus-71' });
  await openList(page);
  await page.click('#btn-breach-scan');
  await expect(page.locator('.toast').filter({ hasText: 'found in data breaches' })).toBeVisible();
  await expect(page.locator('[data-filter="breached"]')).toHaveText('✖ 1 breached');
  await expect(page.locator('.entry')).toHaveCount(1); // filter switched to breached
  await expect(page.locator('.entry .badge.breached')).toHaveText('Breached');
});

test('saving warns about duplicates and reused passwords', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'mail.com', username: 'me', password: 'same-password' });

  await page.click('#btn-add');
  await page.fill('#label', 'MAIL.com');
  await page.fill('#username', 'me');
  await page.fill('#vault-password', 'same-password');
  await page.click('#entry-submit');
  await expect(page.locator('.modal h2')).toHaveText('Possible duplicate');
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'also used by 1 other entry' })).toBeVisible();
});

test('the 🎲 button fills a strong password into the entry form', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await page.click('#btn-add');
  await page.click('#vault-generate');
  const value = await page.locator('#vault-password').inputValue();
  expect(value).toHaveLength(20);
  await expect(page.locator('#vault-password')).toHaveAttribute('type', 'text');
  await expect(page.locator('#entry-strength')).toContainText('Very Strong');
});

test('change the master password', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await page.click('#btn-change');
  const next = 'Velvet-Lantern-Orbit-Cactus-2027';
  await page.fill('#change-current', 'wrong current password');
  await page.fill('#change-new', next);
  await page.fill('#change-confirm', next);
  await page.click('#change-submit');
  await expect(lastToast(page)).toContainText('current master password is wrong');

  await page.fill('#change-current', MASTER);
  await page.click('#change-submit');
  await expect(lastToast(page)).toContainText('Master password changed');
  await page.click('#btn-lock');
  await page.fill('#unlock-password', MASTER);
  await page.press('#unlock-password', 'Enter');
  await expect(lastToast(page)).toContainText('Wrong master password');
  await page.fill('#unlock-password', next);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#vault-menu-screen')).toHaveClass(/active/);
});

test('export a backup and import it back', async ({ page, electronApp, userDataDir }) => {
  const backup = path.join(userDataDir, 'backup.phvault');
  await electronApp.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backup);

  await skipLogin(page);
  await createVault(page);
  await addEntry(page, { label: 'kept-in-backup', password: 'b1' });
  await page.click('#btn-export');
  await expect(lastToast(page)).toContainText('Backup saved as backup.phvault');
  expect(fs.readFileSync(backup, 'utf8')).not.toContain('kept-in-backup');

  // Delete the entry, then restore it from the backup.
  await openList(page);
  await page.click('.entry-header');
  await page.click('.entry.expanded .entry-btn.delete');
  await page.click('.modal .btn.danger');
  await expect(page.locator('.entry')).toHaveCount(0);
  await page.click('#btn-back');

  const openInput = page.locator('.modal-backdrop.show .modal-input');
  await page.click('#btn-import');
  await openInput.fill('not it');
  await openInput.press('Enter');
  await expect(page.locator('.toast').filter({ hasText: 'Wrong master password for that backup' })).toBeVisible();
  await openInput.fill(MASTER); // asked again after a wrong password
  await openInput.press('Enter');
  await expect(page.locator('.toast').filter({ hasText: 'Imported 1 entry' })).toBeVisible();
  await openList(page);
  await expect(page.locator('.entry-title')).toHaveText(['kept-in-backup']);
});

test('Ctrl+L locks from any page and the titlebar shows the vault state', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await expect(page.locator('.tb-lock')).toBeVisible();
  await page.click('#btn-view');
  await page.waitForURL(/vault_view\.html/);
  await page.keyboard.press('Control+l');
  await page.waitForURL(/vault\.html/);
  await expect(page.locator('#unlock-screen')).toHaveClass(/active/);
  await expect(page.locator('.tb-lock')).toBeHidden();
});

test('log out locks the vault and returns to the login screen', async ({ page }) => {
  await skipLogin(page);
  await createVault(page);
  await page.click('[data-action="home"] >> nth=-1');
  await page.waitForURL(/index\.html/);
  await page.click('#logout');
  await page.waitForURL(/login\.html/);
  expect(await page.evaluate(() => window.api.vault.status())).toMatchObject({ unlocked: false });
});
