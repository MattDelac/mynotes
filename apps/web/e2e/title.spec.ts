import { expect, test } from '@playwright/test';
import * as fs from 'node:fs/promises';
import { openMenu } from './helpers';

test('a plain first line shows title styling in the editor', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Meeting Notes\n\nBody text');

	const first = page.locator('.cm-line').first();
	await expect(first).toHaveText('Meeting Notes');
	await expect(first).toHaveClass(/cm-note-title/);
	await expect(first).toHaveCSS('font-weight', '700');
	await expect(first).toHaveCSS('font-size', '28.56px');
	await expect(page.locator('.cm-line').nth(2)).not.toHaveClass(/cm-note-title/);
});

test('an ATX heading first line is not re-styled as a title', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Title\n\nBody text');

	const first = page.locator('.cm-line').first();
	await first.click();
	await expect(first).toHaveText('# Title');
	await expect(first).not.toHaveClass(/cm-note-title/);
});

test('the preview wraps the first plain paragraph with title styling', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Meeting Notes\n\nBody text');
	await page.getByRole('button', { name: 'Toggle preview' }).click();

	const title = page.locator('.preview p.note-title');
	await expect(title).toHaveText('Meeting Notes');
	await expect(title).toHaveCSS('font-weight', '700');
	await expect(title).toHaveCSS('font-size', '28.56px');
	await expect(page.locator('.preview p')).toHaveCount(2);
	await expect(page.locator('.preview p').nth(1)).not.toHaveClass(/note-title/);
});

test('a heading note preview is unchanged', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Title\n\nBody text');
	await page.getByRole('button', { name: 'Toggle preview' }).click();

	await expect(page.locator('.preview p.note-title')).toHaveCount(0);
	await expect(page.locator('.preview h1')).toHaveText('Title');
});

test('a setext heading first line is left alone in editor and preview', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Title\n====\n\nBody text');
	const first = page.locator('.cm-line').first();
	await expect(first).not.toHaveClass(/cm-note-title/);
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(page.locator('.preview p.note-title')).toHaveCount(0);
	await expect(page.locator('.preview h1')).toHaveText('Title');
});

test('exporting a note with a plain first line is byte-identical to the stored content', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Meeting Notes\n\nBody text');
	await page.waitForTimeout(700);

	await openMenu(page);
	page.once('dialog', (dialog) => dialog.accept());
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export note' }).click()
	]);
	expect(download.suggestedFilename()).toBe('meeting-notes.md');
	const content = await fs.readFile(await download.path(), 'utf8');
	expect(content).toBe('Meeting Notes\n\nBody text');
});
