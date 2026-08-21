import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('Enter continues a task item with an unchecked marker', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await page.locator('.cm-line', { hasText: 'buy milk' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk\n- [ ] ');
	await page.keyboard.type('eggs');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk\n- [ ] eggs');
});

test('Enter on a checked task item continues it unchecked', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [x] done');
	await page.locator('.cm-line', { hasText: 'done' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('- [x] done\n- [ ] ');
});

test('Enter on an empty task item exits the list', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] ');
	await page.locator('.cm-line').click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('fresh start');
	await expect.poll(() => editorText(page)).toBe('fresh start');
});

test('an empty task item in a tight list takes a blank line before it exits', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await page.locator('.cm-line', { hasText: 'buy milk' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk\n- [ ] ');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk\n\n- [ ] ');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk\n\n');
});

test('Enter inside a fenced code block does not continue the task marker', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```\n- [ ] x\n```');
	await page.locator('.cm-line', { hasText: 'x' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('```\n- [ ] x\n\n```');
});
