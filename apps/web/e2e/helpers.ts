import type { Page } from '@playwright/test';

export async function editorText(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate((el) =>
		Array.from(el.querySelectorAll('.cm-line'))
			.map((line) => line.textContent)
			.join('\n')
	);
}
