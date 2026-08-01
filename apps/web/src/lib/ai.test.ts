import { describe, expect, it } from 'vitest';
import { defaultModel, extractDelta } from './ai';

describe('extractDelta', () => {
	it('extracts anthropic text deltas', () => {
		const payload = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
		expect(extractDelta('anthropic', payload)).toBe('hi');
	});

	it('ignores non-text anthropic events', () => {
		expect(extractDelta('anthropic', { type: 'message_start' })).toBeNull();
		expect(
			extractDelta('anthropic', {
				type: 'content_block_delta',
				delta: { type: 'input_json_delta' }
			})
		).toBeNull();
	});

	it('extracts openai content deltas', () => {
		const payload = { choices: [{ delta: { content: 'yo' } }] };
		expect(extractDelta('openai', payload)).toBe('yo');
	});

	it('returns null for empty openai deltas', () => {
		expect(extractDelta('openai', { choices: [{ delta: {} }] })).toBeNull();
	});
});

describe('defaultModel', () => {
	it('has defaults for both providers', () => {
		expect(defaultModel('anthropic')).toBeTruthy();
		expect(defaultModel('openai')).toBeTruthy();
	});
});
