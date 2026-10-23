'use strict';

const { test, expect, launchApp, lastHud } = require('./fixtures');

test.use({ startInApp: false });

test('first launch: welcome once, then sign-in, then the main window', async ({ page, electronApp, userDataDir }) => {
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await page.click('#welcome-continue');
  await expect(page.locator('#screen-signin')).toBeVisible();
  await page.click('#signin-skip');
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#create-form')).toBeVisible(); // no vault yet

  await electronApp.close();
  const { app, page: second } = await launchApp(userDataDir);
  try {
    // The welcome screen doesn't come back; sign-in does (it's on by default).
    await expect(second.locator('#screen-signin')).toBeVisible();
    await expect(second.locator('#screen-welcome')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('signing in validates the form and explains that the server isn’t connected', async ({ page }) => {
  await page.click('#welcome-continue');
  await page.click('#signin-submit');
  await expect(lastHud(page)).toContainText('Enter your email address.');
  await page.fill('#signin-email', 'radu@example.com');
  await page.fill('#signin-password', 'anything');
  await page.click('#signin-submit');
  await expect(lastHud(page)).toContainText('account server isn’t connected yet');
  await expect(page.locator('#screen-signin')).toBeVisible();
});

test('creating an account uses the shared password policy', async ({ page }) => {
  await page.click('#welcome-continue');
  await page.click('#signin-toggle');
  await expect(page.locator('#signin-confirm')).toBeVisible();
  await page.fill('#signin-email', 'radu@example.com');

  await page.fill('#signin-password', 'Abcdef1 ');
  await page.fill('#signin-confirm', 'Abcdef1 ');
  await page.click('#signin-submit');
  await expect(lastHud(page)).toContainText('at least 15 characters');

  // contains the email → easy to guess
  await page.fill('#signin-password', 'radu@example.com2026');
  await page.fill('#signin-confirm', 'radu@example.com2026');
  await expect(page.locator('#signin-checks [data-check="length"]')).toHaveClass(/ok/);
  await expect(page.locator('#signin-checks [data-check="guess"]')).not.toHaveClass(/ok/);

  await page.fill('#signin-password', 'Lantern-Orbit-Velvet-Cactus-71');
  await page.fill('#signin-confirm', 'Lantern-Orbit-Velvet-Cactus-71');
  await expect(page.locator('#signin-checks li.ok')).toHaveCount(4);
  await page.click('#signin-submit');
  await expect(lastHud(page)).toContainText('account server isn’t connected yet');
});
