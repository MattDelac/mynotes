import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('export downloads a markdown file', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Export Me\n\nfile body');
	await page.waitForTimeout(700);

	page.once('dialog', (dialog) => dialog.accept());
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export note' }).click()
	]);
	expect(download.suggestedFilename()).toBe('export-me.md');
});

test('import creates a note from a markdown file', async ({ page }) => {
	await page.goto('/');

	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.getByRole('button', { name: 'Import note' }).click()
	]);
	await chooser.setFiles({
		name: 'imported.md',
		mimeType: 'text/markdown',
		buffer: Buffer.from('# Imported Title\n\nimported body')
	});

	await expect(page).toHaveURL(/\/n\/[\w-]+/);
	await expect.poll(() => editorText(page)).toBe('# Imported Title\n\nimported body');
	await expect(page.locator('header .title')).toHaveText('Imported Title');
});
