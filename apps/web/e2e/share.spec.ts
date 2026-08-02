import { expect, test } from '@playwright/test';

test('dismissing the share confirmation aborts sharing', async ({ page }) => {
	page.on('dialog', (dialog) => dialog.dismiss());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('do not share me');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share note' }).click();
	await expect(page.locator('.sharebar')).toHaveCount(0);
});

test('share creates an encrypted link that decrypts in a fresh browser', async ({
	page,
	browser
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Secret plans\n\nencrypted body');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share note' }).click();
	const linkInput = page.locator('.sharebar input');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	const link = await linkInput.inputValue();
	expect(link).toMatch(/\/n\/[\w-]+#[\w-]+$/);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('header .title')).toHaveText('Shared note (read-only)');
	await expect(viewer.locator('.preview')).toContainText('Secret plans');
	await expect(viewer.locator('.preview')).toContainText('encrypted body');
	await context.close();
});

test('edits auto-sync to the shared link within seconds', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('version one');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share note' }).click();
	const linkInput = page.locator('.sharebar input');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	const link = await linkInput.inputValue();

	await page.getByRole('button', { name: 'Close share panel' }).click();
	await editor.fill('version two');
	await expect(page.locator('header .sync')).toHaveText('shared ✓', { timeout: 15_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.preview')).toContainText('version two');
	await context.close();
});

test('an open shared view pulls new content automatically', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('live v1');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share note' }).click();
	const linkInput = page.locator('.sharebar input');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	const link = await linkInput.inputValue();
	await page.getByRole('button', { name: 'Close share panel' }).click();

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.preview')).toContainText('live v1');

	await editor.fill('live v2');
	await expect(page.locator('header .sync')).toHaveText('shared ✓', { timeout: 15_000 });
	await expect(viewer.locator('.preview')).toContainText('live v2', { timeout: 20_000 });
	await context.close();
});
