'use strict';

const { test, expect, go, lastHud, clipboardText, secretText, MASTER } = require('./fixtures');

const output = (page) => page.locator('#gen-output');

test.beforeEach(async ({ page }) => {
  await go(page, 'generator');
  await expect(page.locator('#view-generator')).toBeVisible();
});

test('generates a 20-character password with every character type by default', async ({ page }) => {
  const value = await secretText(output(page));
  expect(value).toHaveLength(20);
  expect(value).toMatch(/[a-z]/);
  expect(value).toMatch(/[A-Z]/);
  expect(value).toMatch(/[0-9]/);
  await expect(page.locator('#gen-strength-text')).toHaveText(/^Very strong, about \d+ bits of entropy$/);

  await page.click('#gen-refresh');
  expect(await secretText(output(page))).not.toBe(value);
});

test('length and character options apply and are remembered', async ({ page }) => {
  await page.locator('#gen-length').fill('32');
  await page.click('label.row:has(#gen-symbols)');
  await page.click('label.row:has(#gen-uppercase)');
  expect(await secretText(output(page))).toMatch(/^[a-z0-9]{32}$/);

  await page.waitForTimeout(600); // options are saved after a short pause
  await page.reload();
  await expect(page.locator('#view-generator')).toBeVisible();
  expect(await secretText(output(page))).toMatch(/^[a-z0-9]{32}$/);
});

test('the last kind of character can’t be switched off', async ({ page }) => {
  for (const id of ['uppercase', 'digits', 'symbols']) await page.click(`label.row:has(#gen-${id})`);
  await page.click('label.row:has(#gen-lowercase)');
  await expect(page.locator('#gen-lowercase')).toBeChecked();
  await expect(lastHud(page)).toContainText('Keep at least one kind of character');
});

test('passphrase mode uses words and the chosen separator', async ({ page }) => {
  await page.click('#gen-mode .segment[data-value="passphrase"]');
  await expect(page.locator('#gen-passphrase-options')).toBeVisible();
  await page.click('#gen-passphrase-options .popup-button');
  await page.click('.menu .menu-item:has-text("Period")');
  const words = (await secretText(output(page))).split('.');
  expect(words).toHaveLength(6);
  for (const word of words) expect(word).toMatch(/^[A-Z][a-z-]+$/);
  await expect(page.locator('#gen-strength-text')).toContainText('about 78 bits');
});

test('copy goes through the clipboard guard; Analyze hands the value over', async ({ page, electronApp }) => {
  const value = await secretText(output(page));
  await page.click('#gen-copy');
  await expect(lastHud(page)).toContainText('Password copied — clears in 30 s');
  expect(await clipboardText(electronApp)).toBe(value);

  await page.click('#gen-analyze');
  await expect(page.locator('#view-analyzer')).toBeVisible();
  await expect(page.locator('#an-input')).toHaveValue(value);
  await expect(page.locator('#an-verdict-title')).toHaveText(/Strong/);
});

test('Save to Vault opens a new item with the password — after creating the vault if needed', async ({ page }) => {
  const value = await secretText(output(page));
  await page.click('#gen-save');
  await expect(page.locator('#create-form')).toBeVisible();
  await page.fill('#create-password', MASTER);
  await page.fill('#create-confirm', MASTER);
  await page.click('#create-submit');
  const editor = page.locator('#vault-detail form.editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[aria-label="Password"]')).toHaveValue(value);
  await expect(editor.locator('input[aria-label="Password"]')).toHaveAttribute('type', 'text');
});
