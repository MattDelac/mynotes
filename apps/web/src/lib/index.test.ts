import { describe, expect, it } from 'vitest';
import { placeholder } from './index';

describe('placeholder', () => {
	it('returns the app name', () => {
		expect(placeholder()).toBe('mynotes');
	});
});
