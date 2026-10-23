'use strict';

const { test, expect, skipLogin } = require('./fixtures');

async function openGenerator(page) {
  await skipLogin(page);
  await page.click('[data-screen="generator-screen"]');
  await expect(page.locator('#generator-screen')).toHaveClass(/active/);
}

const clipboardText = (electronApp) => electronApp.evaluate(({ clipboard }) => clipboard.readText());

test('generates a 20-character password with every character type by default', async ({ page }) => {
  await openGenerator(page);
  const value = await page.locator('#gen-output').textContent();
  expect(value).toHaveLength(20);
  expect(value).toMatch(/[a-z]/);
  expect(value).toMatch(/[A-Z]/);
  expect(value).toMatch(/[0-9]/);
  await expect(page.locator('#gen-strength')).toContainText('bits of entropy — Very Strong');

  await page.click('#gen-refresh');
  expect(await page.locator('#gen-output').textContent()).not.toBe(value);
});

test('length and character options apply and are remembered', async ({ page }) => {
  await openGenerator(page);
  await page.locator('#gen-length').fill('32');
  await page.click('label:has(#gen-symbols)');
  await page.click('label:has(#gen-uppercase)');
  const value = await page.locator('#gen-output').textContent();
  expect(value).toMatch(/^[a-z0-9]{32}$/);

  await page.waitForTimeout(600); // settings are saved after a short pause
  await page.reload();
  await page.click('[data-screen="generator-screen"]');
  expect(await page.locator('#gen-output').textContent()).toMatch(/^[a-z0-9]{32}$/);
});

test('the last character type cannot be switched off', async ({ page }) => {
  await openGenerator(page);
  for (const id of ['uppercase', 'digits', 'symbols']) await page.click(`label:has(#gen-${id})`);
  await page.click('label:has(#gen-lowercase)');
  await expect(page.locator('#gen-lowercase')).toBeChecked();
  await expect(page.locator('.toast').last()).toContainText('at least one character type');
});

test('passphrase mode uses words and the chosen separator', async ({ page }) => {
  await openGenerator(page);
  await page.click('.segment[data-mode="passphrase"]');
  await page.selectOption('#gen-separator', '.');
  const value = await page.locator('#gen-output').textContent();
  const words = value.split('.');
  expect(words).toHaveLength(6);
  for (const word of words) expect(word).toMatch(/^[A-Z][a-z-]+$/);
  await expect(page.locator('#gen-strength')).toContainText('≈ 78 bits');
});

test('copy goes through the clipboard guard; Analyze hands the value over', async ({ page, electronApp }) => {
  await openGenerator(page);
  const value = await page.locator('#gen-output').textContent();
  await page.click('#gen-copy');
  await expect(page.locator('.toast').last()).toContainText('clipboard clears in 30 s');
  expect(await clipboardText(electronApp)).toBe(value);

  await page.click('#gen-analyze');
  await expect(page.locator('#analyzer-screen')).toHaveClass(/active/);
  await expect(page.locator('#password')).toHaveValue(value);
  await expect(page.locator('#result')).toContainText('Strength:');
});
