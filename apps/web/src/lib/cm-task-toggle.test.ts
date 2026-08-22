import { describe, expect, it } from 'vitest';
import { EditorState, type Line } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
	applyTaskToggle,
	taskBlocked,
	taskInsertLine,
	taskMarkerOnLine,
	type TaskToggleResult
} from './cm-task-toggle';

function makeState(doc: string, anchor: number): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor }
	});
}

function apply(doc: string, result: TaskToggleResult): string {
	let out = doc;
	for (const ch of [...result.changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
		out = out.slice(0, ch.from) + ch.insert + out.slice(ch.to);
	}
	return out;
}

function toggle(
	doc: string,
	from: number,
	to: number,
	marker: { from: number; to: number } | null = null
): TaskToggleResult {
	return applyTaskToggle({ doc, from, to, marker });
}

describe('applyTaskToggle — plain line to task', () => {
	it('prefixes a plain line with "- [ ] " and shifts the caret', () => {
		const r = toggle('hello world', 5, 5);
		expect(apply('hello world', r)).toBe('- [ ] hello world');
		expect(r.anchor).toBe(11);
	});

	it('works on the first line of a multi-line document', () => {
		expect(apply('hello\nworld', toggle('hello\nworld', 0, 0))).toBe('- [ ] hello\nworld');
	});

	it('works on a middle line and leaves the others alone', () => {
		expect(apply('a\nhello\nb', toggle('a\nhello\nb', 6, 6))).toBe('a\n- [ ] hello\nb');
	});

	it('gives an empty line "- [ ] " so typed text lands in a valid task', () => {
		const r = toggle('a\n\nb', 2, 2);
		expect(apply('a\n\nb', r)).toBe('a\n- [ ] \nb');
		expect(r.anchor).toBe(8);
	});

	it('turns an empty document into "- [ ] "', () => {
		expect(apply('', toggle('', 0, 0))).toBe('- [ ] ');
	});

	it('shifts a selection with the prefix', () => {
		const r = toggle('hello', 2, 5);
		expect(apply('hello', r)).toBe('- [ ] hello');
		expect(r.anchor).toBe(8);
		expect(r.head).toBe(11);
	});
});

describe('applyTaskToggle — plain bullet to task', () => {
	it('inserts "[ ] " after a dash bullet, keeping the caret on the same letter', () => {
		const r = toggle('- buy milk', 6, 6);
		expect(apply('- buy milk', r)).toBe('- [ ] buy milk');
		expect(r.anchor).toBe(10);
	});

	it('inserts "[ ] " after an asterisk bullet', () => {
		expect(apply('* item', toggle('* item', 5, 5))).toBe('* [ ] item');
	});

	it('inserts "[ ] " after a plus bullet', () => {
		expect(apply('+ item', toggle('+ item', 5, 5))).toBe('+ [ ] item');
	});

	it('keeps the indent of a nested bullet', () => {
		expect(apply('  - second', toggle('  - second', 8, 8))).toBe('  - [ ] second');
	});

	it('turns a bullet with only a trailing space into "- [ ] "', () => {
		expect(apply('- ', toggle('- ', 2, 2))).toBe('- [ ] ');
	});

	it('treats a lone bullet character as a plain line', () => {
		expect(apply('-', toggle('-', 0, 0))).toBe('- [ ] -');
	});
});

describe('applyTaskToggle — task to plain bullet (line regex)', () => {
	it('strips the "[ ] " marker and keeps the bullet', () => {
		const r = toggle('- [ ] buy milk', 6, 6);
		expect(apply('- [ ] buy milk', r)).toBe('- buy milk');
		expect(r.anchor).toBe(2);
	});

	it('strips a checked "[x]" marker', () => {
		expect(apply('- [x] done', toggle('- [x] done', 6, 6))).toBe('- done');
	});

	it('strips an uppercase "[X]" marker', () => {
		expect(apply('- [X] done', toggle('- [X] done', 6, 6))).toBe('- done');
	});

	it('strips a bare "- [ ]" line down to "- "', () => {
		expect(apply('- [ ]', toggle('- [ ]', 3, 3))).toBe('- ');
	});

	it('strips a bare "- [x]" line (no TaskMarker in the tree) down to "- "', () => {
		expect(apply('- [x]', toggle('- [x]', 3, 3))).toBe('- ');
	});

	it('handles a tab between the bullet and the marker', () => {
		expect(apply('-\t[x] y', toggle('-\t[x] y', 4, 4))).toBe('- y');
	});

	it('treats "[nope]" as content, not a marker', () => {
		expect(apply('- [nope] x', toggle('- [nope] x', 8, 8))).toBe('- [ ] [nope] x');
	});

	it('shifts a selection back with the stripped marker', () => {
		const r = toggle('- [ ] buy milk', 6, 14);
		expect(apply('- [ ] buy milk', r)).toBe('- buy milk');
		expect(r.anchor).toBe(2);
		expect(r.head).toBe(10);
	});
});

describe('applyTaskToggle — tree marker branch', () => {
	it('strips the marker range plus its trailing space', () => {
		const r = toggle('- [ ] buy milk', 6, 6, { from: 2, to: 5 });
		expect(apply('- [ ] buy milk', r)).toBe('- buy milk');
	});

	it('strips a marker at the end of the line without a trailing space', () => {
		expect(apply('- [ ] ', toggle('- [ ] ', 4, 4, { from: 2, to: 5 }))).toBe('- ');
	});

	it('keeps the indent of a nested marker', () => {
		expect(apply('  - [ ] second', toggle('  - [ ] second', 8, 8, { from: 4, to: 7 }))).toBe(
			'  - second'
		);
	});

	it('keeps extra spaces after the marker as item content', () => {
		expect(apply('- [ ]   spaced', toggle('- [ ]   spaced', 6, 6, { from: 2, to: 5 }))).toBe(
			'-   spaced'
		);
	});
});

describe('applyTaskToggle — ordered task marker strip', () => {
	function toggleOrdered(doc: string, pos: number): TaskToggleResult {
		const st = makeState(doc, pos);
		const line = st.doc.lineAt(pos);
		return applyTaskToggle({
			doc,
			from: pos,
			to: pos,
			marker: taskMarkerOnLine(st, line)
		});
	}

	it('strips the marker from a dot ordered task, keeping the ordered prefix', () => {
		const r = toggleOrdered('1. [ ] buy milk', 10);
		expect(apply('1. [ ] buy milk', r)).toBe('1. buy milk');
		expect(r.anchor).toBe(6);
	});

	it('strips a checked ordered task marker', () => {
		expect(apply('1. [x] done', toggleOrdered('1. [x] done', 4))).toBe('1. done');
	});

	it('strips the marker from a paren ordered task', () => {
		expect(apply('1) [ ] buy milk', toggleOrdered('1) [ ] buy milk', 4))).toBe('1) buy milk');
	});

	it('keeps the indent of a nested ordered task', () => {
		const doc = '- a\n    1. [ ] b';
		expect(apply(doc, toggleOrdered(doc, 12))).toBe('- a\n    1. b');
	});

	it('keeps a second ordered item on another line untouched', () => {
		const doc = '1. [ ] first\n2. second';
		expect(apply(doc, toggleOrdered(doc, 4))).toBe('1. first\n2. second');
	});
});

describe('applyTaskToggle — ordered bare marker strip (no TaskMarker in the tree)', () => {
	function toggleOrdered(doc: string, pos: number): TaskToggleResult {
		const st = makeState(doc, pos);
		const line = st.doc.lineAt(pos);
		return applyTaskToggle({
			doc,
			from: pos,
			to: pos,
			marker: taskMarkerOnLine(st, line)
		});
	}

	it('strips a bare "1. [ ]" line down to "1. " (keeps the ordered marker + item space)', () => {
		const r = toggleOrdered('1. [ ]', 6);
		expect(apply('1. [ ]', r)).toBe('1. ');
		expect(r.anchor).toBe(3);
	});

	it('strips a bare "1. [x]" line (parses as a link, no TaskMarker) down to "1. "', () => {
		expect(apply('1. [x]', toggleOrdered('1. [x]', 3))).toBe('1. ');
	});

	it('strips a bare "1. [X]" line down to "1. "', () => {
		expect(apply('1. [X]', toggleOrdered('1. [X]', 3))).toBe('1. ');
	});

	it('strips a bare paren-marker ordered line "1) [ ]" down to "1) "', () => {
		expect(apply('1) [ ]', toggleOrdered('1) [ ]', 3))).toBe('1) ');
	});

	it('strips a blockquoted bare ordered marker, keeping the quote', () => {
		expect(apply('> 1. [ ]', toggleOrdered('> 1. [ ]', 5))).toBe('> 1. ');
	});

	it('keeps the indent of a nested bare ordered marker', () => {
		expect(apply('  1. [ ]', toggleOrdered('  1. [ ]', 4))).toBe('  1. ');
	});

	it('strips only the bare marker line and leaves a following content line', () => {
		const doc = '1. [ ]\n2. keep';
		expect(apply(doc, toggleOrdered(doc, 3))).toBe('1. \n2. keep');
	});

	it('strips a marked "1. [ ] x" (real content) exactly once, not double-inserted', () => {
		expect(apply('1. [ ] x', toggleOrdered('1. [ ] x', 4))).toBe('1. x');
	});

	it('still inserts exactly once on a plain ordered line (strip branch does not steal it)', () => {
		const r = toggleOrdered('1. x', 3);
		expect(apply('1. x', r)).toBe('1. [ ] x');
	});

	it('still inserts exactly once on a plain quoted ordered line', () => {
		expect(apply('> 1. x', toggleOrdered('> 1. x', 5))).toBe('> 1. [ ] x');
	});
});

describe('applyTaskToggle — blockquoted task marker strip', () => {
	function toggleQuoted(doc: string, pos: number): TaskToggleResult {
		const st = makeState(doc, pos);
		const line = st.doc.lineAt(pos);
		return applyTaskToggle({
			doc,
			from: pos,
			to: pos,
			marker: taskMarkerOnLine(st, line)
		});
	}

	it('strips the marker from a blockquoted bullet task, keeping the quote and bullet', () => {
		const r = toggleQuoted('> - [ ] buy milk', 12);
		expect(apply('> - [ ] buy milk', r)).toBe('> - buy milk');
		expect(r.anchor).toBe(8);
	});

	it('strips a checked blockquoted task marker', () => {
		expect(apply('> - [x] done', toggleQuoted('> - [x] done', 6))).toBe('> - done');
	});

	it('strips the marker from a deeply nested blockquoted task', () => {
		expect(apply('> > - [ ] x', toggleQuoted('> > - [ ] x', 8))).toBe('> > - x');
	});

	it('strips the marker from a blockquoted ordered task', () => {
		expect(apply('> 1. [ ] x', toggleQuoted('> 1. [ ] x', 8))).toBe('> 1. x');
	});

	it('keeps a following plain quoted line untouched', () => {
		const doc = '> - [ ] task\n> note';
		expect(apply(doc, toggleQuoted(doc, 6))).toBe('> - task\n> note');
	});
});

describe('applyTaskToggle — plain ordered item to task (insert)', () => {
	it('inserts "[ ] " after a dot ordered marker, keeping the caret on the same letter', () => {
		const r = toggle('1. buy milk', 6, 6);
		expect(apply('1. buy milk', r)).toBe('1. [ ] buy milk');
		expect(r.anchor).toBe(10);
	});

	it('inserts "[ ] " after a paren ordered marker', () => {
		expect(apply('1) buy milk', toggle('1) buy milk', 6, 6))).toBe('1) [ ] buy milk');
	});

	it('keeps the indent of a nested ordered item', () => {
		expect(apply('    1. second', toggle('    1. second', 10, 10))).toBe('    1. [ ] second');
	});

	it('keeps the caret in place when it is before the insertion point', () => {
		const r = toggle('1. x', 0, 0);
		expect(apply('1. x', r)).toBe('1. [ ] x');
		expect(r.anchor).toBe(0);
	});

	it('shifts a selection with the inserted marker', () => {
		const r = toggle('1. hello', 3, 8);
		expect(apply('1. hello', r)).toBe('1. [ ] hello');
		expect(r.anchor).toBe(7);
		expect(r.head).toBe(12);
	});

	it('turns an empty ordered item ("1. ") into "1. [ ] "', () => {
		expect(apply('1. ', toggle('1. ', 3, 3))).toBe('1. [ ] ');
	});

	it('leaves a second ordered item on another line untouched', () => {
		const doc = '1. first\n2. second';
		expect(apply(doc, toggle(doc, 15, 15))).toBe('1. first\n2. [ ] second');
	});

	it('inserts inside a single-level blockquote', () => {
		const r = toggle('> 1. x', 4, 4);
		expect(apply('> 1. x', r)).toBe('> 1. [ ] x');
		expect(r.anchor).toBe(8);
	});

	it('inserts inside a deeply nested blockquote', () => {
		expect(apply('> > 1. x', toggle('> > 1. x', 6, 6))).toBe('> > 1. [ ] x');
	});

	it('treats a ten-digit marker as a plain line (not an ordered item)', () => {
		expect(apply('1234567890. x', toggle('1234567890. x', 5, 5))).toBe('- [ ] 1234567890. x');
	});
});

describe('applyTaskToggle — blockquoted bullet to task (insert)', () => {
	it('inserts "[ ] " after a blockquoted dash bullet, keeping the caret on the same letter', () => {
		const r = toggle('> - buy milk', 8, 8);
		expect(apply('> - buy milk', r)).toBe('> - [ ] buy milk');
		expect(r.anchor).toBe(12);
	});

	it('inserts "[ ] " after an asterisk bullet in a quote', () => {
		expect(apply('> * item', toggle('> * item', 6, 6))).toBe('> * [ ] item');
	});

	it('handles the no-space quote form', () => {
		const r = toggle('>- x', 2, 2);
		expect(apply('>- x', r)).toBe('>- [ ] x');
		expect(r.anchor).toBe(6);
	});

	it('keeps a nested quote', () => {
		expect(apply('> > - x', toggle('> > - x', 6, 6))).toBe('> > - [ ] x');
	});

	it('keeps the indent after the quote', () => {
		expect(apply('>   - x', toggle('>   - x', 6, 6))).toBe('>   - [ ] x');
	});

	it('leaves a following plain quoted line untouched', () => {
		const doc = '> - first\n> note';
		expect(apply(doc, toggle(doc, 8, 8))).toBe('> - [ ] first\n> note');
	});
});

describe('taskInsertLine', () => {
	it('returns the ordered insert for a dot item', () => {
		expect(taskInsertLine('1. x')).toEqual({ newLine: '1. [ ] x', insertAt: 2 });
	});

	it('returns the ordered insert for a paren item', () => {
		expect(taskInsertLine('1) x')).toEqual({ newLine: '1) [ ] x', insertAt: 2 });
	});

	it('returns the ordered insert for a blockquoted item, quote included', () => {
		expect(taskInsertLine('> 1. x')).toEqual({ newLine: '> 1. [ ] x', insertAt: 4 });
	});

	it('returns the quoted bullet insert', () => {
		expect(taskInsertLine('> - x')).toEqual({ newLine: '> - [ ] x', insertAt: 3 });
	});

	it('returns null for a plain quoted line', () => {
		expect(taskInsertLine('> note')).toBeNull();
	});

	it('returns null for a top-level bullet (handled by the bullet branch)', () => {
		expect(taskInsertLine('- x')).toBeNull();
	});

	it('returns null for a plain line', () => {
		expect(taskInsertLine('hello')).toBeNull();
	});

	it('returns null for a bare "1." without a space', () => {
		expect(taskInsertLine('1.')).toBeNull();
	});

	it('returns null for a ten-digit marker (not a list item)', () => {
		expect(taskInsertLine('1234567890. x')).toBeNull();
	});
});

describe('taskMarkerOnLine', () => {
	function onLine(doc: string, pos: number) {
		const state = makeState(doc, pos);
		return taskMarkerOnLine(state, state.doc.lineAt(pos));
	}

	it('finds the marker with the caret at the end of the line', () => {
		expect(onLine('- [ ] buy milk', 13)).toEqual({ from: 2, to: 5 });
	});

	it('finds the marker with the caret at the start of the line', () => {
		expect(onLine('- [ ] buy milk', 0)).toEqual({ from: 2, to: 5 });
	});

	it('finds the marker of a nested task', () => {
		expect(onLine('  - [ ] second', 10)).toEqual({ from: 4, to: 7 });
	});

	it('returns null for a bare "- [ ]" line (parses as a paragraph)', () => {
		expect(onLine('- [ ]', 3)).toBeNull();
	});

	it('returns null for a bare "- [x]" line (parses as a link)', () => {
		expect(onLine('- [x]', 3)).toBeNull();
	});

	it('returns null for a plain line', () => {
		expect(onLine('just text', 4)).toBeNull();
	});

	it('returns null for a task-like line inside a fence', () => {
		expect(onLine('```\n- [ ] x\n```', 6)).toBeNull();
	});
});

describe('taskBlocked', () => {
	function lineAt(doc: string, pos: number): Line {
		return makeState(doc, pos).doc.lineAt(pos);
	}

	function markerAt(doc: string, pos: number) {
		const st = makeState(doc, pos);
		return taskMarkerOnLine(st, st.doc.lineAt(pos));
	}

	it('blocks a line inside a fenced code block', () => {
		expect(
			taskBlocked(makeState('```\n- [ ] x\n```', 6), lineAt('```\n- [ ] x\n```', 6), null)
		).toBe(true);
	});

	it('blocks the opening and closing fence lines', () => {
		expect(
			taskBlocked(makeState('```\n- [ ] x\n```', 0), lineAt('```\n- [ ] x\n```', 0), null)
		).toBe(true);
		expect(
			taskBlocked(makeState('```\n- [ ] x\n```', 12), lineAt('```\n- [ ] x\n```', 12), null)
		).toBe(true);
	});

	it('allows the line after a closed fence', () => {
		const doc = '```\ncode\n```\nafter';
		expect(taskBlocked(makeState(doc, 16), lineAt(doc, 16), null)).toBe(false);
	});

	it('blocks an indented code line', () => {
		expect(taskBlocked(makeState('    code', 6), lineAt('    code', 6), null)).toBe(true);
	});

	it('blocks a table row', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |';
		expect(taskBlocked(makeState(doc, 30), lineAt(doc, 30), null)).toBe(true);
	});

	it('blocks a pipe-less line directly after a table (a table row per GFM)', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |\nafter';
		expect(taskBlocked(makeState(doc, 38), lineAt(doc, 38), null)).toBe(true);
	});

	it('allows the line after a table when a blank line separates them', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |\n\nafter';
		expect(taskBlocked(makeState(doc, 39), lineAt(doc, 39), null)).toBe(false);
	});

	it('blocks a plain ordered list item (no task marker)', () => {
		expect(taskBlocked(makeState('1. item', 4), lineAt('1. item', 4), null)).toBe(true);
	});

	it('blocks a plain ordered list item with a paren marker (no task marker)', () => {
		expect(taskBlocked(makeState('1) item', 4), lineAt('1) item', 4), null)).toBe(true);
	});

	it('blocks a nested plain ordered item indented under a bullet (no task marker)', () => {
		expect(taskBlocked(makeState('- a\n    1. b', 12), lineAt('- a\n    1. b', 12), null)).toBe(
			true
		);
	});

	it('allows an ordered task line when the line has a task marker', () => {
		expect(
			taskBlocked(
				makeState('1. [ ] buy milk', 4),
				lineAt('1. [ ] buy milk', 4),
				markerAt('1. [ ] buy milk', 4)
			)
		).toBe(false);
	});

	it('allows a paren-marker ordered task line with a task marker', () => {
		expect(
			taskBlocked(
				makeState('1) [ ] buy milk', 4),
				lineAt('1) [ ] buy milk', 4),
				markerAt('1) [ ] buy milk', 4)
			)
		).toBe(false);
	});

	it('allows a nested ordered task line with a task marker', () => {
		const doc = '- a\n    1. [ ] b';
		expect(taskBlocked(makeState(doc, 12), lineAt(doc, 12), markerAt(doc, 12))).toBe(false);
	});

	it('still blocks a fenced task line even with a marker-shaped probe', () => {
		const doc = '```\n1. [ ] x\n```';
		expect(taskBlocked(makeState(doc, 6), lineAt(doc, 6), markerAt(doc, 6))).toBe(true);
	});

	it('blocks the setext underline line', () => {
		expect(taskBlocked(makeState('Title\n====', 7), lineAt('Title\n====', 7), null)).toBe(true);
		expect(taskBlocked(makeState('Title\n---', 7), lineAt('Title\n---', 7), null)).toBe(true);
	});

	it('blocks the paragraph line above a setext underline', () => {
		expect(taskBlocked(makeState('Title\n====', 2), lineAt('Title\n====', 2), null)).toBe(true);
	});

	it('blocks a thematic break', () => {
		expect(taskBlocked(makeState('para\n\n---', 8), lineAt('para\n\n---', 8), null)).toBe(true);
	});

	it('blocks a plain blockquote line (no task marker)', () => {
		expect(taskBlocked(makeState('> quote', 4), lineAt('> quote', 4), null)).toBe(true);
	});

	it('allows a blockquoted bullet task line when the line has a task marker', () => {
		expect(
			taskBlocked(
				makeState('> - [ ] buy milk', 6),
				lineAt('> - [ ] buy milk', 6),
				markerAt('> - [ ] buy milk', 6)
			)
		).toBe(false);
	});

	it('allows a nested blockquoted task line with a task marker', () => {
		expect(
			taskBlocked(makeState('> > - [ ] x', 8), lineAt('> > - [ ] x', 8), markerAt('> > - [ ] x', 8))
		).toBe(false);
	});

	it('allows a blockquoted ordered task line with a task marker', () => {
		expect(
			taskBlocked(makeState('> 1. [ ] x', 8), lineAt('> 1. [ ] x', 8), markerAt('> 1. [ ] x', 8))
		).toBe(false);
	});

	it('allows a plain ordered line when it is an insert candidate', () => {
		expect(taskBlocked(makeState('1. item', 4), lineAt('1. item', 4), null, true)).toBe(false);
	});

	it('allows a paren ordered line when it is an insert candidate', () => {
		expect(taskBlocked(makeState('1) item', 4), lineAt('1) item', 4), null, true)).toBe(false);
	});

	it('allows a nested ordered line when it is an insert candidate', () => {
		const doc = '- a\n    1. b';
		expect(taskBlocked(makeState(doc, 12), lineAt(doc, 12), null, true)).toBe(false);
	});

	it('allows a blockquoted bullet line when it is an insert candidate', () => {
		expect(taskBlocked(makeState('> - item', 4), lineAt('> - item', 4), null, true)).toBe(false);
	});

	it('allows a blockquoted ordered line when it is an insert candidate', () => {
		expect(taskBlocked(makeState('> 1. item', 5), lineAt('> 1. item', 5), null, true)).toBe(false);
	});

	it('still hard-blocks a fenced ordered line for an insert candidate', () => {
		const doc = '```\n1. x\n```';
		expect(taskBlocked(makeState(doc, 6), lineAt(doc, 6), null, true)).toBe(true);
	});

	it('blocks a plain quoted line that is not an insert candidate', () => {
		expect(taskBlocked(makeState('> note', 4), lineAt('> note', 4), null, false)).toBe(true);
	});

	it('allows a plain line', () => {
		expect(taskBlocked(makeState('just text', 4), lineAt('just text', 4), null)).toBe(false);
	});

	it('allows a plain bullet line', () => {
		expect(taskBlocked(makeState('- item', 4), lineAt('- item', 4), null)).toBe(false);
	});

	it('allows a nested bullet task line', () => {
		expect(taskBlocked(makeState('  - [ ] x', 6), lineAt('  - [ ] x', 6), null)).toBe(false);
	});

	it('allows the bullet line before a blockquote', () => {
		const doc = '- a\n> quote';
		expect(taskBlocked(makeState(doc, 1), lineAt(doc, 1), null)).toBe(false);
	});
});
