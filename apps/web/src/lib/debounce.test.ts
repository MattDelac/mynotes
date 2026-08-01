import { describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
	it('coalesces rapid calls into one', async () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced('a');
		debounced('b');
		debounced('c');
		vi.advanceTimersByTime(150);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('c');
		vi.useRealTimers();
	});
});
