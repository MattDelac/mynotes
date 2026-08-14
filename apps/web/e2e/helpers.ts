import type { Page } from '@playwright/test';

export async function editorText(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate((el) =>
		Array.from(el.querySelectorAll('.cm-line'))
			.map((line) => line.textContent)
			.join('\n')
	);
}

export async function openMenu(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'More options' }).click();
	await page.waitForTimeout(300);
}

export async function revealSidebar(page: Page): Promise<void> {
	await page.keyboard.press('Meta+o');
	await page.waitForTimeout(500);
}
