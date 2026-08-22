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

test('Enter on an ordered task item continues the marker, visible in the preview', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. [ ] buy milk');
	await page.locator('.cm-line', { hasText: 'buy milk' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n2. [ ] ');
	await page.keyboard.type('eggs');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n2. [ ] eggs');

	await openPreview(page);
	const boxes = page.locator('article.preview input[data-task-line]');
	await expect(boxes).toHaveCount(2);
	await expect(boxes.nth(0)).toHaveAttribute('data-task-line', '1');
	await expect(boxes.nth(1)).toHaveAttribute('data-task-line', '2');
});

test('Enter on an empty ordered task item exits the list', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. [ ] ');
	await page.locator('.cm-line').click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('fresh start');
	await expect.poll(() => editorText(page)).toBe('fresh start');
});

test('an empty ordered task item in a tight list takes a blank line before it exits', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. [ ] buy milk');
	await page.locator('.cm-line', { hasText: 'buy milk' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n2. [ ] ');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n\n2.  ');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n\n');
});

test('ordered task continuation is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. [ ] buy milk');
	await page.locator('.cm-line').click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk\n2. [ ] ');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('1. [ ] buy milk');
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

async function openPreview(page: Page): Promise<void> {
	await page.locator('button[aria-label="Toggle preview"]').click();
	await expect(page.locator('article.preview')).toBeVisible();
}

test('clicking a preview checkbox flips the stored markdown line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] alpha\n- [x] beta');
	await openPreview(page);

	const boxes = page.locator('article.preview input[data-task-line]');
	await expect(boxes).toHaveCount(2);
	await expect(boxes.nth(0)).toHaveAttribute('data-task-line', '1');
	await expect(boxes.nth(1)).toHaveAttribute('data-task-line', '2');
	await expect(boxes.nth(0)).not.toBeChecked();
	await expect(boxes.nth(1)).toBeChecked();

	await boxes.nth(0).click();
	await expect(boxes.nth(0)).toBeChecked();
	await expect(boxes.nth(1)).toBeChecked();

	await page.keyboard.press('Control+Alt+p');
	await expect.poll(() => editorText(page)).toBe('- [x] alpha\n- [x] beta');
});

test('clicking a checked preview checkbox unchecks it', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [x] done');
	await openPreview(page);

	const box = page.locator('article.preview input[data-task-line]');
	await expect(box).toHaveCount(1);
	await expect(box).toBeChecked();

	await box.click();
	await expect(box).not.toBeChecked();

	await page.keyboard.press('Control+Alt+p');
	await expect.poll(() => editorText(page)).toBe('- [ ] done');
});

test('clicking a nested preview checkbox toggles only that line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] first\n  - [x] second');
	await openPreview(page);

	const boxes = page.locator('article.preview input[data-task-line]');
	await expect(boxes).toHaveCount(2);
	await expect(boxes.nth(1)).toHaveAttribute('data-task-line', '2');

	await boxes.nth(1).click();
	await expect(boxes.nth(0)).not.toBeChecked();
	await expect(boxes.nth(1)).not.toBeChecked();

	await page.keyboard.press('Control+Alt+p');
	await expect.poll(() => editorText(page)).toBe('- [ ] first\n  - [ ] second');
});

test('task-like lines in a fence get no preview checkbox', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```\n- [ ] fake\n```\n- [ ] real');
	await openPreview(page);

	const boxes = page.locator('article.preview input[data-task-line]');
	await expect(boxes).toHaveCount(1);
	await expect(boxes).toHaveAttribute('data-task-line', '4');

	await boxes.click();

	await page.keyboard.press('Control+Alt+p');
	await expect.poll(() => editorText(page)).toBe('```\n- [ ] fake\n```\n- [x] real');
});

test('a read-only shared view has no interactive preview checkboxes', async ({ page, browser }) => {
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
	await expect(viewer.locator('button[aria-label="Toggle preview"]')).toHaveCount(0);
	await expect(viewer.locator('input[data-task-line]')).toHaveCount(0);
	await context.close();
});

test('Mod+Alt+L turns a plain line into a task, visible in the preview', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('hello world');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('- [ ] hello world');

	await openPreview(page);
	const box = page.locator('article.preview input[data-task-line]');
	await expect(box).toHaveCount(1);
	await expect(box).toHaveAttribute('data-task-line', '1');
	await expect(box).not.toBeChecked();
});

test('Mod+Alt+L on a task line strips the marker, and again restores it', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [x] done');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('- done');
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('- [ ] done');
});

test('a task toggle is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('- [ ] buy milk');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('- buy milk');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk');
});

test('Mod+Alt+L strips the marker from an ordered task, visible in the preview', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. [ ] buy milk');
	await openPreview(page);
	const box = page.locator('article.preview input[data-task-line]');
	await expect(box).toHaveCount(1);
	await expect(box).toHaveAttribute('data-task-line', '1');
	await expect(box).not.toBeChecked();

	await page.keyboard.press('Control+Alt+p');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('1. buy milk');

	await openPreview(page);
	await expect(page.locator('article.preview input[data-task-line]')).toHaveCount(0);
});

test('Mod+Alt+L strips the marker from a blockquoted task, visible in the preview', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('> - [ ] buy milk');
	await openPreview(page);
	const box = page.locator('article.preview input[data-task-line]');
	await expect(box).toHaveCount(1);
	await expect(box).toHaveAttribute('data-task-line', '1');
	await expect(box).not.toBeChecked();

	await page.keyboard.press('Control+Alt+p');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect.poll(() => editorText(page)).toBe('> - buy milk');

	await openPreview(page);
	await expect(page.locator('article.preview input[data-task-line]')).toHaveCount(0);
});

test('Mod+Alt+L is a no-op on a plain ordered line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('1. first step');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect(editorText(page)).resolves.toBe('1. first step');
});

test('Mod+Alt+L is a no-op on a plain blockquote line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('> a quoted thought');
	await page.locator('.cm-line').click();
	await page.keyboard.press('Control+Alt+l');
	await expect(editorText(page)).resolves.toBe('> a quoted thought');
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

test('Mod+Alt+L does nothing in a read-only shared view', async ({ page, browser }) => {
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

	await viewer.keyboard.press('Control+Alt+l');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('.cm-content')).toContainText('- [ ] shared task');
	await expect(viewer.locator('.cm-content')).not.toContainText('- shared');
	await context.close();
});
