import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const longText = lines.join('\n');

async function scrollTop(page: Page): Promise<number> {
	return page.locator('.cm-scroller').evaluate((el) => el.scrollTop);
}

test('selection survives a reload', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('hello world');
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.keyboard.press('End');
	for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowLeft');

	await page.waitForTimeout(700);
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await expect.poll(() => editorText(page)).toBe('hello world');
	await page.waitForTimeout(300);

	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('**hello world**');
});

test('caret and scroll survive a reload on a tall note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await editor.fill(longText);
	await editor.click();
	await page.keyboard.press('Control+End');
	await page.waitForTimeout(700);

	await page.reload();
	await expect(editor).toBeVisible();
	await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

	await page.keyboard.type('X');
	const text = await editorText(page);
	expect(text.endsWith('line 40X')).toBe(true);
});
