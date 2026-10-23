'use strict';

const { test, expect, go } = require('./fixtures');

const litSegments = (page) => page.locator('#an-meter > span.on').count();

test.beforeEach(async ({ page }) => {
  await go(page, 'analyzer');
  await expect(page.locator('#view-analyzer')).toBeVisible();
});

test('the meter and the verdict agree (both come from zxcvbn)', async ({ page }) => {
  await page.fill('#an-input', 'Password1!');
  await expect(page.locator('#an-verdict-title')).toHaveText('Weak');
  expect(await litSegments(page)).toBe(2);

  await page.fill('#an-input', 'correct horse battery staple');
  await expect(page.locator('#an-verdict-title')).toHaveText('Very Strong');
  expect(await litSegments(page)).toBe(5);
  await expect(page.locator('#an-check-length')).toHaveAttribute('data-status', 'done');
  await expect(page.locator('#an-check-guess')).toHaveAttribute('data-status', 'done');
  await expect(page.locator('#an-times')).toBeVisible();
  await expect(page.locator('#an-time-slow')).not.toBeEmpty();
});

test('length is counted in characters, not bytes', async ({ page }) => {
  await page.fill('#an-input', 'ăîș🔐');
  await expect(page.locator('#an-count')).toHaveText('4 characters');
  await expect(page.locator('#an-check-length')).toContainText('11 to go');
});

test('breached passwords are flagged', async ({ page }) => {
  await expect(page.locator('#an-check-breach')).toHaveAttribute('data-status', 'off');
  await page.click('#an-breach-on');
  await expect(page.locator('#an-opt-breach')).toBeChecked();
  await page.fill('#an-input', 'Password1!');
  await expect(page.locator('#an-verdict-title')).toHaveText('Found in data breaches');
  await expect(page.locator('#an-verdict-detail')).toContainText('Seen 4,242 times');
  await expect(page.locator('#an-check-breach')).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('#an-meter')).toHaveAttribute('data-level', 'breached');

  await page.fill('#an-input', 'a-much-better-unique-passphrase-91');
  await expect(page.locator('#an-check-breach')).toHaveAttribute('data-status', 'done');
});

test('a slow old breach result never overwrites a newer one', async ({ page, electronApp }) => {
  await electronApp.evaluate(({ net }) => {
    const previous = net.fetch;
    net.fetch = async (url, init) => {
      if (String(url).endsWith('F3BBB')) await new Promise((resolve) => setTimeout(resolve, 1500)); // prefix of "hunter2"
      return previous(url, init);
    };
  });
  await page.click('#an-breach-on');
  await page.fill('#an-input', 'hunter2');
  await page.waitForTimeout(600); // the slow request is now in flight
  await page.fill('#an-input', 'hunter2-Long&Unique-9x!');
  await page.waitForTimeout(2000);
  await expect(page.locator('#an-check-breach')).toHaveAttribute('data-status', 'done');
  await expect(page.locator('#an-verdict-title')).not.toHaveText('Found in data breaches');
});

test('leaving the Analyzer clears the password and every check', async ({ page }) => {
  await page.fill('#an-input', 'secret value');
  await page.click('[data-reveal="an-input"]');
  await expect(page.locator('#an-input')).toHaveAttribute('type', 'text');
  await go(page, 'generator');
  await go(page, 'analyzer');
  await expect(page.locator('#an-input')).toHaveValue('');
  await expect(page.locator('#an-input')).toHaveAttribute('type', 'password');
  await expect(page.locator('#an-verdict-title')).toHaveText('Nothing to check yet');
  await expect(page.locator('#an-checks [data-status="done"]')).toHaveCount(0);
});

test('options are remembered', async ({ page }) => {
  await page.click('label.row:has(#an-opt-insights)');
  await page.fill('#an-input', 'ploiesti2026');
  await expect(page.locator('#an-insights')).toBeVisible();
  await expect(page.locator('#an-insights .pattern').first()).toBeVisible();
  await page.click('label.row:has(#an-opt-hash)');
  await expect(page.locator('#an-hash-value')).toHaveText(/^[0-9a-f]{64}$/);

  await page.reload();
  await expect(page.locator('#view-analyzer')).toBeVisible(); // reopens the last view
  await expect(page.locator('#an-opt-insights')).toBeChecked();
  await expect(page.locator('#an-opt-hash')).toBeChecked();
});
