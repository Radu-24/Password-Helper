'use strict';

const { test, expect, skipLogin } = require('./fixtures');

async function openAnalyzer(page) {
  await skipLogin(page);
  await page.click('[data-screen="analyzer-screen"]');
  await expect(page.locator('#analyzer-screen')).toHaveClass(/active/);
}

const barFill = async (page) => 100 - parseFloat(await page.locator('#bar-mask').evaluate((el) => el.style.width));

test('strength bar and text agree (both come from zxcvbn)', async ({ page }) => {
  await openAnalyzer(page);

  await page.fill('#password', 'Password1!');
  await expect(page.locator('#result')).toContainText('Strength: Weak');
  expect(await barFill(page)).toBe(40);

  await page.fill('#password', 'correct horse battery staple');
  await expect(page.locator('#result')).toContainText('Very Strong');
  expect(await barFill(page)).toBe(100);
  await expect(page.locator('#req-length')).toHaveClass(/fulfilled/);
  await expect(page.locator('#req-guess')).toHaveClass(/fulfilled/);
});

test('length is counted in characters, not bytes', async ({ page }) => {
  await openAnalyzer(page);
  await page.fill('#password', 'ăîș🔐');
  await expect(page.locator('#char-count')).toHaveText('4 characters');
});

test('breached passwords are flagged and still show their pattern strength', async ({ page }) => {
  await openAnalyzer(page);
  await page.click('#masterToggle');
  await page.click('label[for="opt-breach"]');
  await page.fill('#password', 'Password1!');
  await expect(page.locator('#result')).toContainText('Seen in data breaches 4,242 times');
  await expect(page.locator('#result-detail')).toContainText('Pattern strength alone: Weak');
  await expect(page.locator('#req-breach')).toHaveClass(/failed/);
  expect(await barFill(page)).toBe(20);

  await page.fill('#password', 'a-much-better-unique-passphrase-91');
  await expect(page.locator('#req-breach')).toHaveClass(/fulfilled/);
});

test('a slow old breach result never overwrites a newer one', async ({ page, electronApp }) => {
  await openAnalyzer(page);
  await electronApp.evaluate(({ net }) => {
    const previous = net.fetch;
    net.fetch = async (url, init) => {
      if (String(url).endsWith('F3BBB')) await new Promise((resolve) => setTimeout(resolve, 1500)); // prefix of "hunter2"
      return previous(url, init);
    };
  });
  await page.click('#masterToggle');
  await page.click('label[for="opt-breach"]');
  await page.fill('#password', 'hunter2');
  await page.waitForTimeout(600); // the slow request is now in flight
  await page.fill('#password', 'hunter2-Long&Unique-9x!');
  await page.waitForTimeout(2000);
  await expect(page.locator('#result')).toContainText('Strength:');
  await expect(page.locator('#req-breach')).toHaveClass(/fulfilled/);
});

test('going back clears the password and every check', async ({ page }) => {
  await openAnalyzer(page);
  await page.fill('#password', 'secret value');
  await page.click('#togglePwd');
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.click('#analyzer-back');
  await page.click('[data-screen="analyzer-screen"]');
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await expect(page.locator('#result')).toHaveText('');
  await expect(page.locator('.requirements li.fulfilled')).toHaveCount(0);
});

test('advanced toggles are remembered', async ({ page }) => {
  await openAnalyzer(page);
  await page.click('#masterToggle');
  await page.click('label[for="opt-insights"]');
  await page.fill('#password', 'ploiesti2026');
  await expect(page.locator('#insights')).toHaveClass(/visible/);
  await expect(page.locator('#insights')).toHaveValue(/Patterns found/);
  await page.reload();
  await page.click('[data-screen="analyzer-screen"]');
  await page.click('#masterToggle');
  await expect(page.locator('#opt-insights')).toBeChecked();
});
