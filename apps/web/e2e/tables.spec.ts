import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

const TABLE_MD = ['| Name | Age |', '| --- | --- |', '| Ada | 36 |'].join('\n');

async function showPreview(page: Page, md: string): Promise<void> {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await editor.fill(md);
	await page.locator('button[aria-label="Toggle preview"]').click();
	await page.locator('article.preview').waitFor({ state: 'visible', timeout: 15000 });
}

async function cellMetrics(page: Page, selector: string) {
	return page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const s = getComputedStyle(el);
			return {
				paddingTop: parseFloat(s.paddingTop),
				paddingLeft: parseFloat(s.paddingLeft),
				borderTopWidth: s.borderTopWidth,
				borderTopStyle: s.borderTopStyle
			};
		});
}

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

test('tab moves to the next cell', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|  |x  |');
	await expect(editor).toBeFocused();
});

test('tab in the last cell creates a new row and lands in its first cell', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Tab');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|  |  |\n|x  |  |');
	await expect(editor).toBeFocused();
});

test('tab in the last cell of a lone header row builds a valid table', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Tab');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|  |  |');
});

test('shift+tab moves to the previous cell', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|x  |  |');
	await expect(editor).toBeFocused();
});

test('shift+tab in the first cell keeps the cursor in place', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| x |  |');
	await expect(editor).toBeFocused();
});

test('backspace in an empty cell merges with the previous cell', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.type('x');
	await page.keyboard.press('Tab');
	await page.keyboard.type('y');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('z');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| xz |  |');
	await expect(editor).toBeFocused();
});

test('backspace in an empty cell with an empty previous cell lands before its pipe', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('y');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|  x|  |');
	await expect(editor).toBeFocused();
});

test('backspace in a table cell with content deletes the character', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('| a | b |');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('y');
	await page.keyboard.press('Backspace');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n|  |  |');
});

test('backspace outside a table still deletes a character', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('hello');
	await page.keyboard.press('Backspace');
	await expect.poll(() => editorText(page)).toBe('hell');
	await expect(editor).toBeFocused();
});

test('tab outside a table still indents', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('plain line');
	await page.keyboard.press('Tab');
	await expect.poll(() => editorText(page)).toBe('    plain line');
	await expect(editor).toBeFocused();
});

test('preview table cells have borders and comfortable padding', async ({ page }) => {
	await showPreview(page, TABLE_MD);
	for (const selector of ['article.preview th', 'article.preview td']) {
		const m = await cellMetrics(page, selector);
		expect(m.paddingTop).toBeGreaterThanOrEqual(6);
		expect(m.paddingLeft).toBeGreaterThanOrEqual(6);
		expect(m.borderTopWidth).toBe('1px');
		expect(m.borderTopStyle).toBe('solid');
	}
});

test('wide preview tables scroll within the table instead of overflowing the page', async ({
	page
}) => {
	const browser = page.context().browser();
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const mobile = await context.newPage();
	const cells = Array.from({ length: 10 }, (_, i) => `Col ${i + 1}`);
	const wide = [
		`| ${cells.join(' | ')} |`,
		`| ${cells.map(() => '---').join(' | ')} |`,
		`| ${cells.map(() => 'x').join(' | ')} |`
	].join('\n');
	await mobile.goto('/');
	const editor = mobile.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await editor.fill(wide);
	await mobile.locator('button[aria-label="Toggle preview"]').click();
	const table = mobile.locator('article.preview table').first();
	await table.waitFor({ state: 'visible', timeout: 15000 });
	expect(await table.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
	const { scrollWidth, clientWidth } = await table.evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth
	}));
	expect(scrollWidth).toBeGreaterThan(clientWidth);
	const box = await table.boundingBox();
	expect(box.width).toBeLessThanOrEqual(390);
	expect(await mobile.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);
	await context.close();
});
