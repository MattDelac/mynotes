import { describe, expect, it } from 'vitest';
import { exportFilename } from './export';
import { addMessage, chatState, transcript } from './chat-store.svelte';

describe('exportFilename', () => {
	it('slugifies the note title', () => {
		expect(exportFilename('# My Great Ideas!\n\nbody')).toBe('my-great-ideas.md');
	});

	it('falls back to untitled.md for empty content', () => {
		expect(exportFilename('')).toBe('untitled.md');
	});
});

describe('chat transcript', () => {
	it('is empty when there are no messages', () => {
		chatState.messages = [];
		expect(transcript()).toBe('');
	});

	it('formats messages as a markdown section', () => {
		chatState.messages = [];
		addMessage({ role: 'user', content: 'hello' });
		addMessage({ role: 'assistant', content: 'hi there' });
		const text = transcript();
		expect(text).toContain('## AI chat transcript');
		expect(text).toContain('**You:** hello');
		expect(text).toContain('**AI:** hi there');
		chatState.messages = [];
	});
});
