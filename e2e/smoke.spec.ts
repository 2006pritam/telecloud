import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.view-title, .crumb.root').first()).toBeVisible();
});

test('create a folder, upload a file, rename, and trash it', async ({ page }) => {
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByPlaceholder('Folder name').fill('Playwright folder');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByText('Playwright folder')).toBeVisible();

  await page.setInputFiles('#file-input', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded by playwright'),
  });
  const card = page.locator('.card', { hasText: 'notes.txt' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.upload-item', { hasText: 'notes.txt' })).toContainText('Uploaded');

  await card.hover();
  await card.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.locator('.modal input').fill('renamed-notes.txt');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.card', { hasText: 'renamed-notes.txt' })).toBeVisible();

  await page.locator('.card', { hasText: 'renamed-notes.txt' }).hover();
  await page.locator('.card', { hasText: 'renamed-notes.txt' }).getByLabel('More actions').click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.locator('.card', { hasText: 'renamed-notes.txt' })).toHaveCount(0);
});

test('trash shows deleted items and the sidebar navigates', async ({ page }) => {
  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(page.locator('.view-title')).toHaveText('Trash');
  await page.getByRole('button', { name: 'My Files' }).click();
  await expect(page.locator('.view-title')).toHaveText('My Files');
});
