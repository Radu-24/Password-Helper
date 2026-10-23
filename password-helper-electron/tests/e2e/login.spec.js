'use strict';

const { test, expect } = require('./fixtures');

const lastToast = (page) => page.locator('.toast').last();

test('login mode submits (no hidden required field blocks it)', async ({ page }) => {
  await page.fill('#email', 'radu@example.com');
  await page.fill('#password', 'anything');
  await page.click('#submitBtn');
  await expect(lastToast(page)).toContainText('Account server isn’t connected yet');
});

test('register mode enforces the shared password policy', async ({ page }) => {
  await page.click('#toggleMode');
  await page.fill('#email', 'radu@example.com');

  await page.fill('#password', 'Abcdef1 ');
  await page.fill('#confirmPassword', 'Abcdef1 ');
  await page.click('#submitBtn');
  await expect(lastToast(page)).toContainText('at least 15 characters');

  // contains the e-mail → guessable
  await page.fill('#password', 'radu@example.com2026');
  await page.fill('#confirmPassword', 'radu@example.com2026');
  await expect(page.locator('[data-check="length"]')).toHaveClass(/ok/);
  await expect(page.locator('[data-check="guess"]')).not.toHaveClass(/ok/);

  await page.fill('#password', 'Lantern-Orbit-Velvet-Cactus-71');
  await page.fill('#confirmPassword', 'Lantern-Orbit-Velvet-Cactus-71');
  await expect(page.locator('#passwordRequirements li.ok')).toHaveCount(4);
  await page.click('#submitBtn');
  await expect(lastToast(page)).toContainText('Account server isn’t connected yet');
});

test('skip goes to the main menu', async ({ page }) => {
  await page.click('#skipBtn');
  await page.waitForURL(/index\.html/);
  await expect(page.locator('#main-menu')).toHaveClass(/active/);
});
