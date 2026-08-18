import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('enter after a table header inserts a separator and an empty row', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| Name | Age |');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('| Name | Age |\n| --- | --- |\n|  |  |');
});

test('typing table rows: enter continues the table and lands in the first cell', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Ada');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| Ada |  |\n|  |  |');
});

test('enter on an empty table row removes the row', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Ada');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| Ada |  |\n|  |  |');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| Ada |  |');
});

test('enter outside a table keeps the default newline behavior', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('plain paragraph');
	await page.keyboard.press('Enter');
	await page.keyboard.type('second line');
	await expect.poll(() => editorText(page)).toBe('plain paragraph\nsecond line');
});
