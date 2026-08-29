import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { editorText, openMenu } from './helpers';

test('export downloads a markdown file', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Export Me\n\nfile body');
	await page.waitForTimeout(700);

	await openMenu(page);
	page.once('dialog', (dialog) => dialog.accept());
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export note' }).click()
	]);
	expect(download.suggestedFilename()).toBe('export-me.md');
});

test('export all downloads a zip with one markdown file per note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# First Note\n\nfirst body');
	await page.waitForTimeout(700);

	await page.keyboard.press('Control+Alt+n');
	await editor.fill('# Second Note\n\nsecond body');
	await page.waitForTimeout(700);

	page.once('dialog', (dialog) => dialog.accept());
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.keyboard.press('Control+Shift+e')
	]);
	expect(download.suggestedFilename()).toBe('mynotes.zip');

	const unzipped = unzipSync(readFileSync(await download.path()));
	const names = Object.keys(unzipped).sort();
	expect(names).toEqual(['first-note.md', 'second-note.md']);
	expect(new TextDecoder().decode(unzipped['first-note.md'])).toBe('# First Note\n\nfirst body');
	expect(new TextDecoder().decode(unzipped['second-note.md'])).toBe('# Second Note\n\nsecond body');
});

test('import creates a note from a markdown file', async ({ page }) => {
	await page.goto('/');

	await openMenu(page);
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.getByRole('button', { name: 'Import note' }).click()
	]);
	await chooser.setFiles({
		name: 'imported.md',
		mimeType: 'text/markdown',
		buffer: Buffer.from('# Imported Title\n\nimported body')
	});

	await expect(page).toHaveURL(/\/s\/[\w-]+\?n=[\w-]+/);
	await expect.poll(() => editorText(page)).toBe('# Imported Title\n\nimported body');
	await expect(page.locator('header .title')).toHaveText('Imported Title');
});
