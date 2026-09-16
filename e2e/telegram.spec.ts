import { expect, test, type Page } from '@playwright/test';
import { alice, bob, carol } from '../tests/fake-telegram.js';

test.use({ baseURL: 'http://127.0.0.1:3002' });

async function sendCode(page: Page, user: typeof alice) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in with Telegram' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Phone number' }).fill(user.phone);
  await page.getByRole('button', { name: 'Send login code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
}

async function verifyCode(page: Page, user: typeof alice) {
  await page.getByRole('textbox', { name: 'Login code' }).fill(user.code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}

test('separate browsers sign in independently and switching accounts clears the previous drive', async ({ page, browser }) => {
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3002' });
  const other = await otherContext.newPage();
  try {
    await Promise.all([sendCode(page, alice), sendCode(other, bob)]);
    await Promise.all([verifyCode(page, alice), verifyCode(other, bob)]);
    await expect(page.locator('.mode-sub')).toContainText('Alice');
    await expect(other.locator('.mode-sub')).toContainText('Bob');

    const folderName = `Alice folder ${Date.now()}`;
    await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
    await page.getByPlaceholder('Folder name').fill(folderName);
    await page.getByRole('button', { name: 'Create folder' }).click();
    await expect(page.locator('.card', { hasText: folderName })).toBeVisible();
    await other.reload();
    await expect(other.locator('.view-title')).toHaveText('My Files');
    await expect(other.locator('.card', { hasText: folderName })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in with Telegram' })).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
    await sendCode(page, bob);
    await verifyCode(page, bob);
    await expect(page.locator('.mode-sub')).toContainText('Bob');
    await expect(page.locator('.card', { hasText: folderName })).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('two-step verification accepts a retry and offers a way to restart sign-in', async ({ page }) => {
  await sendCode(page, carol);
  await verifyCode(page, carol);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start again / use a different number' })).toBeEnabled();
  await page.getByLabel('Two-step verification password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.form-error')).toContainText('Incorrect');
  await page.getByLabel('Two-step verification password').fill(carol.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.mode-sub')).toContainText('Carol');
  await page.reload();
  await expect(page.locator('.mode-sub')).toContainText('Carol');
});
