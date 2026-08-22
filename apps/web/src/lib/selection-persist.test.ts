import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

async function fresh() {
	vi.resetModules();
	indexedDB = new IDBFactory();
	const db = await import('./db');
	const persist = await import('./selection-persist');
	return { db, persist };
}

describe('selection-persist', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('persists the scheduled selection after the debounce delay', async () => {
		const { db, persist } = await fresh();
		persist.scheduleSelectionPersist('n1', 4, 9);
		expect(await db.getNoteSelection('n1')).toBeUndefined();
		await vi.advanceTimersByTimeAsync(499);
		expect(await db.getNoteSelection('n1')).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 4, head: 9 });
	});

	it('coalesces rapid schedules into the last value', async () => {
		const { db, persist } = await fresh();
		persist.scheduleSelectionPersist('n1', 1, 2);
		await vi.advanceTimersByTimeAsync(200);
		persist.scheduleSelectionPersist('n1', 3, 5);
		await vi.advanceTimersByTimeAsync(200);
		persist.scheduleSelectionPersist('n1', 7, 8);
		await vi.advanceTimersByTimeAsync(500);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 7, head: 8 });
	});

	it('a newer note within the window supersedes the pending one', async () => {
		const { db, persist } = await fresh();
		persist.scheduleSelectionPersist('a', 1, 1);
		await vi.advanceTimersByTimeAsync(300);
		persist.scheduleSelectionPersist('b', 2, 2);
		await vi.advanceTimersByTimeAsync(500);
		expect(await db.getNoteSelection('b')).toEqual({ id: 'b', anchor: 2, head: 2 });
		expect(await db.getNoteSelection('a')).toBeUndefined();
	});

	it('flush writes immediately and cancels the pending timer', async () => {
		const { db, persist } = await fresh();
		persist.scheduleSelectionPersist('n1', 4, 9);
		await persist.flushSelectionPersist();
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 4, head: 9 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 4, head: 9 });
	});

	it('flush with nothing pending is a no-op', async () => {
		const { db, persist } = await fresh();
		await persist.flushSelectionPersist();
		expect(await db.getNoteSelection('n1')).toBeUndefined();
	});

	it('a schedule after a flush re-arms the debounce', async () => {
		const { db, persist } = await fresh();
		persist.scheduleSelectionPersist('n1', 1, 1);
		await persist.flushSelectionPersist();
		persist.scheduleSelectionPersist('n1', 2, 2);
		await vi.advanceTimersByTimeAsync(500);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 2, head: 2 });
	});
});
