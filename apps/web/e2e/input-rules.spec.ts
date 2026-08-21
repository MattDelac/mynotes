import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('enter after an opening fence closes it and parks the cursor between', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('```\n\n```');
	await page.keyboard.press('x');
	await expect.poll(() => editorText(page)).toBe('```\nx\n```');
});

test('enter after a fence with an info string keeps it on the opening fence only', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```js');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('```js\n\n```');
});

test('enter on the closing fence of a closed block adds a newline, not another fence', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```\n```');
	await page.keyboard.press('Enter');
	const text = await editorText(page);
	expect(text.split('```').length - 1).toBe(2);
	await expect(editor).toBeFocused();
});

test('typing ] after an empty [ pairs () with the cursor inside', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[');
	await page.keyboard.press(']');
	await page.keyboard.press('x');
	await expect.poll(() => editorText(page)).toBe('[](x)');
});

test('typing ] after non-empty brackets does not pair', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[a');
	await page.keyboard.press(']');
	await expect.poll(() => editorText(page)).toBe('[a]');
});

test('bracket pairing is disabled inside a fenced code block', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```\n[');
	await page.keyboard.press(']');
	await expect.poll(() => editorText(page)).toBe('```\n[]');
});

test('fence auto-close is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('```');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('```\n\n```');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('```');
});

test('bracket pairing is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('[');
	await page.keyboard.press(']');
	await expect.poll(() => editorText(page)).toBe('[]()');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('[');
});
