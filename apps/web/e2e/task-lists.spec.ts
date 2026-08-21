import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

async function clickChar(page: Page, linePrefix: string, index: number): Promise<void> {
	const point = await page.evaluate(
		({ prefix, index }: { prefix: string; index: number }): { x: number; y: number } | null => {
			const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).find((el) =>
				(el.textContent ?? '').startsWith(prefix)
			);
			if (!line) return null;
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			let offset = 0;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.textContent ?? '';
				if (index < offset + text.length) {
					const at = index - offset;
					const range = document.createRange();
					range.setStart(node, at);
					range.setEnd(node, at + 1);
					const rect = range.getBoundingClientRect();
					if (rect.width === 0) return null;
					return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
				}
				offset += text.length;
			}
			return null;
		},
		{ prefix: linePrefix, index }
	);
	if (!point) throw new Error(`could not locate char ${index} in line "${linePrefix}"`);
	await page.mouse.click(point.x, point.y);
}

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

test('clicking the bracket toggles an unchecked task to checked and back', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await clickChar(page, '- [ ] buy milk', 3);
	await expect.poll(() => editorText(page)).toBe('- [x] buy milk');
	await clickChar(page, '- [x] buy milk', 3);
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk');
});

test('clicking the word does not toggle and places the caret there', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await clickChar(page, '- [ ] buy milk', 12);
	await expect(editorText(page)).resolves.toBe('- [ ] buy milk');
	await page.keyboard.type('X');
	await expect.poll(() => editorText(page)).toMatch(/^- \[ \] buy mi(lXk|Xlk)$/);
});

test('clicking a nested task bracket toggles only that item', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] first\n  - [ ] second');
	await clickChar(page, '  - [ ] second', 5);
	await expect.poll(() => editorText(page)).toBe('- [ ] first\n  - [x] second');
});

test('a bracket click is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await clickChar(page, '- [ ] buy milk', 3);
	await expect.poll(() => editorText(page)).toBe('- [x] buy milk');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk');
});

test('clicking a bracket in a read-only shared session does nothing', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('- [ ] shared task');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('- [ ] shared task', {
		timeout: 10_000
	});

	await clickChar(viewer, '- [ ] shared task', 3);
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('.cm-content')).toContainText('- [ ] shared task');
	await expect(viewer.locator('.cm-content')).not.toContainText('[x]');
	await context.close();
});
