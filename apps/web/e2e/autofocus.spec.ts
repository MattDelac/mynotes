import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('typing works immediately after load, with zero clicks', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/s\/[\w-]+/);
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('instant start');
	await expect.poll(() => editorText(page)).toBe('instant start');
});

test('switching notes refocuses the editor', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('alpha note');
	await expect.poll(() => editorText(page)).toBe('alpha note');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('beta note');
	await expect.poll(() => editorText(page)).toBe('beta note');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.locator('aside a', { hasText: 'alpha note' }).click();
	await expect.poll(() => editorText(page)).toBe('alpha note');
	await page.keyboard.type('!');
	await expect.poll(() => editorText(page)).toBe('alpha note!');
});

test('a read-only shared view does not autofocus the editor', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared autofocus note');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared autofocus note', {
		timeout: 10_000
	});
	await expect
		.poll(() => viewer.evaluate(() => document.activeElement?.tagName ?? 'none'))
		.toBe('BODY');
	await context.close();
});
