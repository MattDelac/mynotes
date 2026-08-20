import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('tab indents a list item and keeps focus in the editor', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- x');
	await page.keyboard.press('Tab');
	await expect.poll(() => editorText(page)).toBe('  - x');
	await expect(editor).toBeFocused();
});

test('tab on the second list item nests it under the first', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- a\n- b');
	await page.locator('.cm-line', { hasText: '- b' }).click();
	await page.keyboard.press('Tab');
	await expect.poll(() => editorText(page)).toBe('- a\n  - b');
	await expect(editor).toBeFocused();
});

test('shift+tab dedents a nested list item back to a sibling', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- a\n  - b');
	await page.locator('.cm-line', { hasText: '- b' }).click();
	await page.keyboard.press('Shift+Tab');
	await expect.poll(() => editorText(page)).toBe('- a\n- b');
});

test('tab on a plain line inserts four spaces', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('plain text');
	await page.keyboard.press('Tab');
	await expect.poll(() => editorText(page)).toBe('    plain text');
	await expect(editor).toBeFocused();
});

test('tab and shift+tab never move focus out of the editor', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- x');
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press('Tab');
		await expect(editor).toBeFocused();
	}
	for (let i = 0; i < 4; i++) {
		await page.keyboard.press('Shift+Tab');
		await expect(editor).toBeFocused();
	}
});
