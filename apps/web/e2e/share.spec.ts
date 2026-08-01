import { expect, test } from '@playwright/test';

test('share creates an encrypted link that decrypts in a fresh browser', async ({
	page,
	browser
}) => {
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

test('re-sharing pushes updated content to the same link', async ({ page, browser }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('version one');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share note' }).click();
	const linkInput = page.locator('.sharebar input');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	const link = await linkInput.inputValue();

	await editor.fill('version two');
	await page.waitForTimeout(700);
	await page.getByRole('button', { name: 'Close share panel' }).click();
	await page.getByRole('button', { name: 'Share note' }).click();
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	expect(await linkInput.inputValue()).toBe(link);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.preview')).toContainText('version two');
	await context.close();
});
