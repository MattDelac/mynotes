import { expect, test, type Browser, type Page } from '@playwright/test';

interface Opened {
	url: string;
	target?: string;
}

declare global {
	interface Window {
		__opened?: Opened[];
	}
}

interface Point {
	x: number;
	y: number;
	id: number;
}

async function sendTouch(
	page: Page,
	type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
	changed: Point,
	active?: Point[]
): Promise<boolean> {
	return page.evaluate(
		({ type, changed, active }) => {
			const mk = (t: Point) => {
				const target = (document.elementFromPoint(t.x, t.y) as Element | null) ?? document.body;
				return {
					touch: new Touch({
						identifier: t.id,
						target,
						clientX: t.x,
						clientY: t.y,
						pageX: t.x,
						pageY: t.y
					}),
					target
				};
			};
			const { touch: changedTouch, target } = mk(changed);
			const activePoints =
				type === 'touchstart' || type === 'touchmove' ? (active ?? [changed]) : [];
			const activeTouches = activePoints.map(mk);
			const event = new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: activeTouches.map((a) => a.touch),
				targetTouches: activeTouches.map((a) => a.touch),
				changedTouches: [changedTouch]
			} as unknown as TouchEventInit);
			return !target.dispatchEvent(event);
		},
		{ type, changed, active }
	);
}

async function sendClick(page: Page, x: number, y: number, detail = 0): Promise<boolean> {
	return page.evaluate(
		({ x, y, detail }) => {
			const target = (document.elementFromPoint(x, y) as Element | null) ?? document.body;
			const event = new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				view: window,
				clientX: x,
				clientY: y,
				detail
			});
			return !target.dispatchEvent(event);
		},
		{ x, y, detail }
	);
}

async function stubWindowOpen(page: Page) {
	await page.evaluate(() => {
		window.__opened = [];
		window.open = (url?: string | URL, target?: string) => {
			window.__opened?.push({ url: String(url), target });
			return null;
		};
	});
}

async function openedLinks(page: Page): Promise<Opened[]> {
	return page.evaluate(() => window.__opened ?? []);
}

async function caretPosition(page: Page) {
	return page.evaluate(() => {
		const sel = window.getSelection();
		const node = sel?.anchorNode;
		return node ? { text: node.textContent ?? '', offset: sel!.anchorOffset } : null;
	});
}

const DOC = 'before\n[Example](https://example.com/page)\nafter';

async function mobilePage(browser: Browser, doc: string) {
	const context = await browser.newContext({
		isMobile: true,
		hasTouch: true,
		viewport: { width: 390, height: 844 }
	});
	const page = await context.newPage();
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill(doc);
	return { context, page };
}

async function linkCenter(page: Page) {
	const box = await page.locator('.cm-line .tok-link').first().boundingBox();
	expect(box).not.toBeNull();
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('long-press on a link in edit mode opens it in a new tab', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const { x, y } = await linkCenter(page);

	expect(await sendTouch(page, 'touchstart', { x, y, id: 1 })).toBe(false);
	await page.waitForTimeout(700);
	expect(await sendTouch(page, 'touchend', { x, y, id: 1 })).toBe(true);

	expect(await openedLinks(page)).toEqual([{ url: 'https://example.com/page', target: '_blank' }]);
	await context.close();
});

test('short tap on a link does not open it and leaves the tap unhandled', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const { x, y } = await linkCenter(page);

	expect(await sendTouch(page, 'touchstart', { x, y, id: 1 })).toBe(false);
	await page.waitForTimeout(50);
	expect(await sendTouch(page, 'touchend', { x, y, id: 1 })).toBe(false);
	expect(await sendClick(page, x, y, 0)).toBe(false);

	expect(await openedLinks(page)).toEqual([]);
	await context.close();
});

test('long-press does not move the caret', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const first = await page.locator('.cm-line').first().boundingBox();
	expect(first).not.toBeNull();
	await page.mouse.click(first.x + 2, first.y + first.height / 2);
	const before = await caretPosition(page);
	expect(before).not.toBeNull();

	const { x, y } = await linkCenter(page);
	await sendTouch(page, 'touchstart', { x, y, id: 1 });
	await page.waitForTimeout(700);
	expect(await sendTouch(page, 'touchend', { x, y, id: 1 })).toBe(true);
	expect(await sendClick(page, x, y, 0)).toBe(true);

	expect(await caretPosition(page)).toEqual(before);
	expect(await openedLinks(page)).toHaveLength(1);
	await context.close();
});

test('long-press on non-link text opens nothing', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const last = await page.locator('.cm-line').last().boundingBox();
	expect(last).not.toBeNull();
	const x = last.x + last.width / 2;
	const y = last.y + last.height / 2;

	expect(await sendTouch(page, 'touchstart', { x, y, id: 1 })).toBe(false);
	await page.waitForTimeout(700);
	expect(await sendTouch(page, 'touchend', { x, y, id: 1 })).toBe(false);

	expect(await openedLinks(page)).toEqual([]);
	await context.close();
});

test('moving the finger cancels the long-press', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const { x, y } = await linkCenter(page);

	expect(await sendTouch(page, 'touchstart', { x, y, id: 1 })).toBe(false);
	await page.waitForTimeout(100);
	await sendTouch(page, 'touchmove', { x: x + 30, y, id: 1 });
	await page.waitForTimeout(700);
	expect(await sendTouch(page, 'touchend', { x: x + 30, y, id: 1 })).toBe(false);

	expect(await openedLinks(page)).toEqual([]);
	await context.close();
});

test('a second finger cancels the long-press', async ({ browser }) => {
	const { context, page } = await mobilePage(browser, DOC);
	await stubWindowOpen(page);
	const { x, y } = await linkCenter(page);

	await sendTouch(page, 'touchstart', { x, y, id: 1 });
	await page.waitForTimeout(100);
	await sendTouch(page, 'touchstart', { x: x + 40, y, id: 2 }, [
		{ x, y, id: 1 },
		{ x: x + 40, y, id: 2 }
	]);
	await page.waitForTimeout(700);

	expect(await openedLinks(page)).toEqual([]);
	await context.close();
});
