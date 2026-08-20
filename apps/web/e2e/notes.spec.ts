import { expect, test } from '@playwright/test';
import { editorText, openMenu, revealSidebar } from './helpers';

test('home redirects to a session and typing updates the title bar', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/s\/[\w-]+/);

	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# Shopping List\n\n- milk');
	await expect(page.locator('header .title')).toHaveText('Shopping List');
});

test('editor is auto-focused on load so typing starts immediately', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible' });
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement === document.querySelector('.cm-content'))
		)
		.toBe(true);
});

test('editor regains focus after switching notes', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('alpha note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();

	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement === document.querySelector('.cm-content'))
		)
		.toBe(true);
});

test('editor is not auto-focused on touch devices', async ({ browser }) => {
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 390, height: 844 }
	});
	const page = await context.newPage();
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible' });
	await page.waitForTimeout(300);
	expect(
		await page.evaluate(() => document.activeElement === document.querySelector('.cm-content'))
	).toBe(false);
	await context.close();
});

test('editor renders markdown headings as styled text', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('## My Section');
	const heading = page.locator('.cm-line', { hasText: 'My Section' });
	await expect(heading).toBeVisible();
	const maxFontSize = await heading.evaluate((el) =>
		Math.max(
			...Array.from(el.querySelectorAll('span')).map((span) =>
				parseFloat(getComputedStyle(span).fontSize)
			)
		)
	);
	expect(maxFontSize).toBeGreaterThan(20);
});

test('markdown marks are concealed except on the cursor line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('## Hidden Marks\n\nplain line');

	const firstLine = page.locator('.cm-line').first();
	await expect(firstLine).toHaveText('Hidden Marks');

	await firstLine.click();
	await expect(firstLine).toHaveText('## Hidden Marks');
});

test('cmd+click on a link opens it in a new tab', async ({ page, context }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[Example](https://example.com/page)');

	const link = page.locator('.cm-line .tok-link').first();
	await expect(link).toBeVisible();

	const [popup] = await Promise.all([
		context.waitForEvent('page'),
		(async () => {
			await page.keyboard.down('Meta');
			await link.click();
			await page.keyboard.up('Meta');
		})()
	]);
	expect(popup.url()).toBe('https://example.com/page');
	await popup.close();
});

test('plain click on a link places the cursor without navigating', async ({ page, context }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[Example](https://example.com/page)');

	const link = page.locator('.cm-line .tok-link').first();
	await link.click();
	await page.waitForTimeout(300);
	expect(context.pages()).toHaveLength(1);
	await expect(page).toHaveURL(/\/s\/[\w-]+/);
});

test('preview links open in a new tab', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('[Example](https://example.com)');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const link = page.locator('.preview a', { hasText: 'Example' });
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', /noopener/);
});

test('preview preserves single line breaks like the editor does', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Hello\nyou');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const preview = page.locator('.preview p');
	await expect(preview).toContainText('Hello');
	const breaks = await preview.locator('br').count();
	expect(breaks).toBe(1);
});

test('desktop: note list toggle button opens the list and switches notes', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('desktop alpha');
	await page.waitForTimeout(700);

	const toggle = page.getByRole('button', { name: 'Note list' });
	await expect(toggle).toBeVisible();

	const aside = page.locator('aside');
	await expect(aside).not.toHaveClass(/open/);

	await toggle.click();
	await expect(aside).toHaveClass(/open/);
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');

	await page.getByRole('button', { name: 'New note' }).click();
	await editor.fill('desktop beta');
	await page.waitForTimeout(700);
	await expect(aside).not.toHaveClass(/open/);

	await toggle.click();
	await expect(aside).toHaveClass(/open/);
	await expect(page.locator('aside a')).toHaveCount(2);

	await page.keyboard.press('Escape');
	await expect(aside).not.toHaveClass(/open/);

	await toggle.click();
	await page.locator('aside a', { hasText: 'desktop alpha' }).click();
	await expect(aside).not.toHaveClass(/open/);
	await expect.poll(() => editorText(page)).toBe('desktop alpha');
	await expect(page).toHaveURL(/\?n=[\w-]+/);
});

test('mobile: note list drawer opens from the header and switches notes', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('mobile first note');
	await page.waitForTimeout(700);

	const toggle = page.getByRole('button', { name: 'Note list' });
	await expect(toggle).toBeVisible();

	const aside = page.locator('aside');
	await expect(aside).not.toHaveClass(/open/);

	await toggle.click();
	await expect(aside).toHaveClass(/open/);
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('aside a')).toHaveText('mobile first note');

	await page.locator('aside a').first().click();
	await expect(aside).not.toHaveClass(/open/);
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page).toHaveURL(/\?n=[\w-]+/);
});

test('mobile: drawer creates a new note and deletes one', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('keep me');
	await page.waitForTimeout(700);

	const toggle = page.getByRole('button', { name: 'Note list' });
	await toggle.click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).toHaveURL(/\?n=[\w-]+/);
	await expect(page.locator('aside')).not.toHaveClass(/open/);

	await toggle.click();
	await expect(page.locator('aside a')).toHaveCount(2);

	const doomed = page.locator('aside li', { hasText: 'Untitled' });
	await doomed.hover();
	await doomed.getByRole('button', { name: 'Delete note' }).click();
	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('keep me');
});

test('mobile: current note can be deleted from the more menu', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('keep me');
	await page.waitForTimeout(700);

	const toggle = page.getByRole('button', { name: 'Note list' });
	await toggle.click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).toHaveURL(/\?n=[\w-]+/);
	await expect(page.locator('aside')).not.toHaveClass(/open/);

	await openMenu(page);
	const deleteItem = page.locator('.dropdown-menu').getByRole('button', { name: 'Delete note' });
	await expect(deleteItem).toBeVisible();
	await deleteItem.click();

	await expect.poll(() => editorText(page)).toBe('keep me');
	await toggle.click();
	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('keep me');
});

test('desktop: more menu does not offer delete note', async ({ page }) => {
	await page.goto('/');
	await openMenu(page);
	await expect(
		page.locator('.dropdown-menu').getByRole('button', { name: 'Delete note' })
	).toHaveCount(0);
});

test('sidebar shows the updated note title', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('My renamed note');
	await page.waitForTimeout(700);

	await revealSidebar(page);
	await expect(page.locator('aside a')).toHaveText('My renamed note');
});

test('reload preserves note content', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('persistent content here');
	await page.waitForTimeout(700);

	await page.reload();
	await expect.poll(() => editorText(page)).toBe('persistent content here');
});

test('reload at home restores the latest session and note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('latest note body');
	await page.waitForTimeout(700);

	await page.goto('/');
	await expect.poll(() => editorText(page)).toBe('latest note body');
});

test.skip('creates a second note and lists both', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('first note');
	await page.waitForTimeout(700);
	const firstUrl = page.url();

	await openMenu(page);
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).not.toHaveURL(firstUrl);
	await page.getByRole('textbox', { name: 'Note' }).fill('second note');
	await page.waitForTimeout(700);

	await revealSidebar(page);
	const links = page.locator('aside a');
	await expect(links).toHaveCount(2);
});

test.skip('navigating between notes via sidebar shows each note content', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('note AAAA content');
	await page.waitForTimeout(700);

	await openMenu(page);
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).toHaveURL(/\?n=/);
	await page.getByRole('textbox', { name: 'Note' }).fill('note BBBB content');
	await page.waitForTimeout(700);

	await revealSidebar(page);
	await page.locator('aside a', { hasText: 'note AAAA' }).click();
	await expect.poll(() => editorText(page)).toBe('note AAAA content');

	await revealSidebar(page);
	await page.locator('aside a', { hasText: 'note BBBB' }).click();
	await expect.poll(() => editorText(page)).toBe('note BBBB content');
});

test.skip('deletes a note', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('doomed note');
	await page.waitForTimeout(700);

	await revealSidebar(page);
	await page.locator('aside li').first().hover();
	await page.getByRole('button', { name: 'Delete note' }).click();
	await revealSidebar(page);
	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('Untitled');
	await expect(page).toHaveURL(/\/s\/[\w-]+\?n=[\w-]+/);
});

test('start empty session creates a fresh session', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('old session note');
	await page.waitForTimeout(700);
	const firstUrl = page.url();
	const firstSession = /\/s\/([\w-]+)/.exec(firstUrl)?.[1];

	await openMenu(page);
	await page.getByRole('button', { name: 'Start empty session' }).click();
	await expect(page).not.toHaveURL(firstUrl);
	const secondSession = /\/s\/([\w-]+)/.exec(page.url())?.[1];
	expect(secondSession).not.toBe(firstSession);

	await revealSidebar(page);
	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('Untitled');
	await expect(page.locator('header .title')).toHaveText('Untitled');
});
