'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, go, lastHud, hudWith, clipboardText, createVault, addItem, selectItem, MASTER } = require('./fixtures');
const totp = require('../../src/totp');

const titles = (page) => page.locator('#vault-list .list-title');
const editor = (page) => page.locator('#vault-detail form.editor');

test.beforeEach(async ({ page }) => {
  await createVault(page);
});

test('copy from the detail, the context menu and the keyboard — the password never appears', async ({ page, electronApp }) => {
  await addItem(page, { label: 'GitHub', username: 'radu-24', password: 'gh-Secret-123', url: 'github.com' });

  await page.locator('#vault-detail .field-row', { hasText: 'Password' }).getByRole('button', { name: 'Copy password' }).click();
  await expect(lastHud(page)).toContainText('Password copied — clears in 30 s');
  expect(await clipboardText(electronApp)).toBe('gh-Secret-123');
  expect(await page.content()).not.toContain('gh-Secret-123');

  await page.locator('#vault-list .list-item').click({ button: 'right' });
  await page.click('.menu .menu-item:has-text("Copy Username")');
  expect(await clipboardText(electronApp)).toBe('radu-24');

  await page.locator('#vault-list').focus();
  await page.keyboard.press('Control+c');
  expect(await clipboardText(electronApp)).toBe('gh-Secret-123');

  await page.locator('#vault-detail .field-row', { hasText: 'Website' }).getByRole('button', { name: 'Copy address' }).click();
  expect(await clipboardText(electronApp)).toBe('https://github.com/');
});

test('edit an item', async ({ page }) => {
  await addItem(page, { label: 'old-name', password: 'pw-1' });
  await page.click('#vault-detail button:has-text("Edit")');
  await expect(editor(page).locator('.editor-title-input')).toHaveValue('old-name');
  await expect(editor(page).locator('input[aria-label="Password"]')).toHaveValue('pw-1');
  await editor(page).locator('.editor-title-input').fill('new-name');
  await editor(page).locator('button[type="submit"]').click();
  await expect(titles(page)).toHaveText(['new-name']);
  await expect(hudWith(page, 'Changes saved')).toBeVisible();
});

test('leaving an edited item asks before discarding changes', async ({ page }) => {
  await addItem(page, { label: 'first', password: 'pw-1' });
  await addItem(page, { label: 'second', password: 'pw-2' });
  await page.click('#vault-detail button:has-text("Edit")');
  await editor(page).locator('.editor-title-input').fill('changed');
  await go(page, 'generator');
  await expect(page.locator('.alert h2')).toHaveText('Discard your changes?');
  await page.click('.alert button:has-text("Cancel")');
  await expect(page.locator('#view-vault')).toBeVisible();
  await expect(editor(page).locator('.editor-title-input')).toHaveValue('changed');
  await go(page, 'generator');
  await page.click('.alert button:has-text("Discard")');
  await expect(page.locator('#view-generator')).toBeVisible();
});

test('search, sort and keyboard navigation', async ({ page }) => {
  await addItem(page, { label: 'bravo.com', username: 'radu', password: 'password123' });
  await addItem(page, { label: 'alpha.org', password: 'password123' });
  await addItem(page, { label: 'charlie.net', password: 'Lantern-Orbit-Velvet-Cactus-71' });

  await expect(titles(page)).toHaveText(['alpha.org', 'bravo.com', 'charlie.net']);
  await page.click('.list-header .popup-button');
  await page.click('.menu .menu-item:has-text("Sorted by Date Modified")');
  await expect(titles(page)).toHaveText(['charlie.net', 'alpha.org', 'bravo.com']);

  await page.keyboard.press('Control+f');
  await expect(page.locator('#vault-search')).toBeFocused();
  await page.keyboard.type('radu');
  await expect(titles(page)).toHaveText(['bravo.com']);
  await expect(page.locator('#vault-subtitle')).toHaveText('1 of 3 items');
  await page.keyboard.press('Escape'); // clears the search
  await expect(titles(page)).toHaveCount(3);

  await page.locator('#vault-list').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#vault-detail .detail-title')).toHaveText('charlie.net');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#vault-detail .detail-title')).toHaveText('alpha.org');
  await page.keyboard.press('Enter'); // edit
  await expect(editor(page).locator('.editor-title-input')).toHaveValue('alpha.org');
});

test('favourites', async ({ page }) => {
  await addItem(page, { label: 'starred', password: 'a' });
  await addItem(page, { label: 'plain', password: 'b' });
  await selectItem(page, 'starred');
  await page.click('#vault-detail .star-btn');
  await expect(page.locator('#vault-detail .star-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-count="favorites"]')).toHaveText('1');
  await go(page, 'favorites');
  await expect(titles(page)).toHaveText(['starred']);
  await page.click('#vault-detail .star-btn');
  await expect(titles(page)).toHaveCount(0);
});

test('saving warns about duplicates and reused passwords', async ({ page }) => {
  await addItem(page, { label: 'mail.com', username: 'me', password: 'same-password' });
  await page.click('#vault-new');
  await editor(page).locator('.editor-title-input').fill('MAIL.com');
  await editor(page).locator('input[aria-label="Username"]').fill('me');
  await editor(page).locator('input[aria-label="Password"]').fill('same-password');
  await editor(page).locator('button[type="submit"]').click();
  await expect(page.locator('.alert h2')).toHaveText('Possible duplicate');
  await page.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(hudWith(page, 'also used by 1 other item')).toBeVisible();
});

test('the wand button fills a strong password into the editor', async ({ page }) => {
  await page.click('#vault-new');
  await editor(page).getByRole('button', { name: 'Generate a strong password' }).click();
  const field = editor(page).locator('input[aria-label="Password"]');
  expect(await field.inputValue()).toHaveLength(20);
  await expect(field).toHaveAttribute('type', 'text');
  await expect(editor(page).locator('.edit-strength p')).toContainText('Very Strong');
});

test('verification codes: set up, show, copy, and the Codes view', async ({ page, electronApp }) => {
  await addItem(page, { label: 'GitHub', username: 'radu-24', password: 'gh-pass' });
  await page.click('#vault-detail button:has-text("Edit")');
  await editor(page).locator('button:has-text("Set Up…")').click();
  const sheet = page.locator('.sheet');
  await sheet.locator('textarea').fill('not a key!');
  await expect(sheet.locator('.otp-hint[role="status"]')).toContainText('A–Z');
  await expect(sheet.locator('button:has-text("Add Code")')).toBeDisabled();
  await sheet.locator('textarea').fill('otpauth://totp/GitHub:radu-24?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
  await expect(sheet.locator('.otp-preview')).toBeVisible();
  await expect(sheet.locator('.otp-preview .code-digits')).toHaveText(/^\d{3} \d{3}$/);
  await sheet.locator('button:has-text("Add Code")').click();
  await expect(editor(page)).toContainText('New code — saved with the item');
  await editor(page).locator('button[type="submit"]').click();

  const codeRow = page.locator('#vault-detail .field-row', { hasText: 'Verification code' });
  await expect(codeRow.locator('.code-digits')).toHaveText(/^\d{3} \d{3}$/);
  await codeRow.getByRole('button', { name: 'Copy code' }).click();
  const copied = await clipboardText(electronApp);
  const expected = [totp.generate({ secret: 'JBSWY3DPEHPK3PXP' }, Date.now()).code, totp.generate({ secret: 'JBSWY3DPEHPK3PXP' }, Date.now() - 2000).code];
  expect(expected).toContain(copied);
  // The secret itself never reaches the page.
  expect(await page.evaluate(() => JSON.stringify(window.PH.Vault.entries))).not.toContain('JBSWY3DP');

  await go(page, 'codes');
  await expect(page.locator('.code-tile')).toHaveCount(1);
  await expect(page.locator('.code-tile .code-digits')).toHaveText(/^\d{3} \d{3}$/);
  await page.click('.code-tile');
  await expect(lastHud(page)).toContainText('Code copied');
});

test('import passwords from a browser CSV export', async ({ page, electronApp, userDataDir }) => {
  const csv = path.join(userDataDir, 'Chrome Passwords.csv');
  fs.writeFileSync(
    csv,
    'name,url,username,password,note\n' +
      'GitHub,https://github.com/login,radu,gh-pass-1,\n' +
      'YouTube,https://youtube.com,radu@gmail.com,yt-pass-2,watch later\n' +
      'Broken,https://x.com,radu,,\n',
  );
  await electronApp.evaluate(({ dialog, shell }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    shell.trashItem = async (target) => {
      globalThis.trashedForTest = target; // don't touch the real Trash
    };
  }, csv);

  await go(page, 'settings');
  await page.click('#set-import-csv');
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Chrome / Edge / Brave');
  await expect(sheet).toContainText('Chrome Passwords.csv');
  await sheet.locator('button:has-text("Import 2 Items")').click();
  await expect(page.locator('.alert h2')).toHaveText('Imported 2 items');
  await page.click('.alert button:has-text("Move to Trash")');
  await expect(hudWith(page, 'moved to the Trash')).toBeVisible();
  expect(await electronApp.evaluate(() => globalThis.trashedForTest)).toBe(csv);
  await expect(page.locator('#view-vault')).toBeVisible();
  await expect(titles(page)).toHaveText(['GitHub', 'YouTube']);
});

test('Security lists weak and reused passwords, and the breach check flags breached ones', async ({ page }) => {
  await addItem(page, { label: 'old', password: 'password123' }); // "breached" in the fake API
  await addItem(page, { label: 'twin', password: 'password123' });
  await addItem(page, { label: 'fresh', password: 'Lantern-Orbit-Velvet-Cactus-71' });
  await go(page, 'security');
  await expect(page.locator('.security-count', { hasText: 'Reused' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.security-count', { hasText: 'Weak' }).locator('strong')).toHaveText('2');
  await expect(page.locator('.security-count', { hasText: 'Breached' }).locator('strong')).toHaveText('0');

  await page.click('#security-scan');
  await expect(hudWith(page, 'found in data breaches')).toBeVisible();
  await expect(page.locator('.security-count', { hasText: 'Breached' }).locator('strong')).toHaveText('2');
  await expect(page.locator('[data-count="security"]')).toHaveClass(/is-alert/);
  await page.locator('.issue-row', { hasText: 'old' }).first().getByRole('button', { name: 'Show' }).click();
  await expect(page.locator('#vault-detail .detail-title')).toHaveText('old');
  await expect(page.locator('#vault-detail .callout', { hasText: 'Found in data breaches' })).toBeVisible();
});

test('change the master password from Settings', async ({ page }) => {
  await go(page, 'settings');
  await page.click('#set-change-master');
  const sheet = page.locator('.sheet');
  const next = 'Velvet-Lantern-Orbit-Cactus-2027';
  await sheet.locator('#cm-current').fill('wrong current password');
  await sheet.locator('#cm-new').fill(next);
  await sheet.locator('#cm-confirm').fill(next);
  await sheet.locator('button:has-text("Change Password")').click();
  await expect(lastHud(page)).toContainText('current master password is wrong');

  await sheet.locator('#cm-current').fill(MASTER);
  await sheet.locator('button:has-text("Change Password")').click();
  await expect(hudWith(page, 'Master password changed')).toBeVisible();
  await page.keyboard.press('Control+l');
  await go(page, 'items');
  await page.fill('#unlock-password', MASTER);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#unlock-message')).toHaveText('Wrong master password.');
  await page.fill('#unlock-password', next);
  await page.press('#unlock-password', 'Enter');
  await expect(page.locator('#view-vault')).toBeVisible();
});

test('export a backup and restore it', async ({ page, electronApp, userDataDir }) => {
  const backup = path.join(userDataDir, 'backup.phvault');
  await electronApp.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backup);
  await addItem(page, { label: 'kept-in-backup', password: 'b1' });

  await go(page, 'settings');
  await page.click('#set-export');
  await expect(lastHud(page)).toContainText('Backup saved as backup.phvault');
  expect(fs.readFileSync(backup, 'utf8')).not.toContain('kept-in-backup');

  // Delete it for good, then restore it from the backup.
  await page.evaluate(async () => {
    const [entry] = window.PH.Vault.entries;
    await window.api.vault.purge(entry.id);
    await window.PH.Vault.refresh();
  });
  await page.click('#set-import-backup');
  const sheet = page.locator('.sheet');
  await sheet.locator('input[type="password"]').fill('not it');
  await sheet.locator('button:has-text("Restore")').click();
  await expect(sheet.locator('.gate-message')).toHaveText('Wrong master password for that backup.');
  await sheet.locator('input[type="password"]').fill(MASTER);
  await sheet.locator('button:has-text("Restore")').click();
  await expect(hudWith(page, 'Restored 1 item')).toBeVisible();
  await go(page, 'items');
  await expect(titles(page)).toHaveText(['kept-in-backup']);
});

test('Ctrl+L locks from anywhere and the sidebar shows the vault state', async ({ page }) => {
  await expect(page.locator('#vault-status-text')).toHaveText('Vault unlocked');
  await go(page, 'generator');
  await page.keyboard.press('Control+l');
  await expect(page.locator('#vault-status-text')).toHaveText('Vault locked');
  await expect(page.locator('#vault-lock-btn')).toBeHidden();
  await go(page, 'codes');
  await expect(page.locator('#unlock-form')).toBeVisible();
});
