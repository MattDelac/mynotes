import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('strikethrough shows raw marks while its line is active', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('~~gone~~');
	await expect(page.locator('.cm-line').first()).toHaveText('~~gone~~');
});

test('strikethrough is concealed and struck through on inactive lines', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('~~gone~~\nsecond line');
	await page.locator('.cm-line', { hasText: 'second line' }).click();

	const line = page.locator('.cm-line').first();
	await expect(line).toHaveText('gone');
	await expect(line.locator('span', { hasText: 'gone' })).toHaveCSS(
		'text-decoration-line',
		'line-through'
	);
});

test('clicking a concealed strikethrough reveals the raw marks without changing the document', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('~~gone~~\nsecond line');
	await page.locator('.cm-line', { hasText: 'second line' }).click();
	await page.locator('.cm-line', { hasText: 'gone' }).first().click();
	await expect(page.locator('.cm-line').first()).toHaveText('~~gone~~');
	await expect.poll(() => editorText(page)).toBe('~~gone~~\nsecond line');
});

test('the preview renders strikethrough with a line through', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('~~gone~~\nsecond line');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(page.locator('.preview del', { hasText: 'gone' })).toBeVisible();
	await expect(page.locator('.preview del', { hasText: 'gone' })).toHaveCSS(
		'text-decoration-line',
		'line-through'
	);
});
