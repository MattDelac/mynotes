import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { noteTitle as webNoteTitle } from '../../../apps/web/src/lib/db.js';
import { noteTitle, sessionNotes } from '../src/session.js';

const corpus: [string, string][] = [
	['', 'Untitled'],
	['\n  \n', 'Untitled'],
	['\nhello world\nsecond line', 'hello world'],
	['## My heading', 'My heading'],
	['  # Indented heading', 'Indented heading'],
	['#', 'Untitled'],
	['# ', 'Untitled'],
	['# \nBody', 'Body'],
	['#\n\nBody', 'Body'],
	['#NoSpace', '#NoSpace'],
	['- item\n- two', 'Untitled'],
	['1. first\n2. second', 'Untitled'],
	['> quoted', 'Untitled'],
	['```\ncode\n```', 'Untitled'],
	['    indented code', 'Untitled'],
	['| a | b |\n| - | - |', 'Untitled'],
	['---\n\nBody', 'Untitled'],
	['Some text\n- item1\n- item2', 'Untitled'],
	['Line one\nLine two\n- item', 'Untitled'],
	['Some text\n\n- item1', 'Some text'],
	['Some text\n1. item', 'Some text'],
	['x'.repeat(100), 'x'.repeat(60)],
	['\u00a0\u3000', 'Untitled'],
	['\u00a0\n\u3000', 'Untitled'],
	['\u3000# Heading', 'Heading'],
	['#\u00a0Heading', 'Heading'],
	['Heading\u3000', 'Heading'],
	['\u00a0\nBody', 'Body'],
	['~~~\nfence\n~~~', 'Untitled'],
	['###  Deep heading  ', 'Deep heading'],
	['- \nBody', 'Untitled'],
	['Title line\n---\nBody', 'Title line'],
	['Title line\n=== ', 'Title line'],
	['1) item', 'Untitled'],
	['10. item', 'Untitled'],
	['> quote\ncontinued', 'Untitled'],
	['\tindented', 'Untitled'],
	['a\nb\nc\n- list', 'Untitled'],
	['a\nb\nc\n\n- list', 'a'],
	['* * *', 'Untitled'],
	['___', 'Untitled'],
	['# one\n# two', 'one'],
	['##\nBody', 'Body']
];

describe('noteTitle parity with the web client', () => {
	for (const [content, expected] of corpus) {
		it(`matches the web client for ${JSON.stringify(content.slice(0, 24))}`, () => {
			expect(noteTitle(content)).toBe(webNoteTitle(content));
			expect(noteTitle(content)).toBe(expected);
		});
	}
});

describe('session document model', () => {
	it('reads notes from the notes Y.Map', () => {
		const doc = new Y.Doc();
		const notes = doc.getMap<Y.Text>('notes');
		const first = new Y.Text();
		first.insert(0, '# First');
		const second = new Y.Text();
		second.insert(0, 'Second');
		notes.set('note-a', first);
		notes.set('note-b', second);
		expect(sessionNotes(doc)).toEqual([
			{ id: 'note-a', content: '# First' },
			{ id: 'note-b', content: 'Second' }
		]);
	});

	it('reflects deletes and concurrent updates', () => {
		const doc = new Y.Doc();
		const notes = doc.getMap<Y.Text>('notes');
		const text = new Y.Text();
		text.insert(0, 'hello');
		notes.set('note-a', text);
		notes.delete('note-a');
		expect(sessionNotes(doc)).toEqual([]);
	});

	it('applies remote updates in any order', () => {
		const left = new Y.Doc();
		const right = new Y.Doc();
		const leftText = new Y.Text();
		leftText.insert(0, 'base');
		left.getMap<Y.Text>('notes').set('note-a', leftText);
		Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
		const rightText = right.getMap<Y.Text>('notes').get('note-a');
		rightText?.insert(4, ' updated');
		Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
		expect(sessionNotes(left)).toEqual([{ id: 'note-a', content: 'base updated' }]);
	});

	it('ignores the frozen legacy top-level content shape', () => {
		const doc = new Y.Doc();
		doc.getText('content').insert(0, 'legacy note');
		expect(sessionNotes(doc)).toEqual([]);
	});
});
