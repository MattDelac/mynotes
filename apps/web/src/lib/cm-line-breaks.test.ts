// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { concealMarks } from './cm-conceal';
import { lineBreaks } from './cm-line-breaks';

const views: EditorView[] = [];

function mount(doc: string, extensions: Extension[] = []): EditorView {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [
				markdown({ base: markdownLanguage }),
				...extensions,
				lineBreaks,
				EditorView.decorations.of((v) => v.state.field(lineBreaks))
			]
		}),
		parent: host
	});
	views.push(view);
	return view;
}

afterEach(() => {
	while (views.length) views.pop()!.destroy();
	document.body.innerHTML = '';
});

describe('cm-line-breaks', () => {
	it('exposes a real newline between lines in the editor DOM', () => {
		const view = mount('## title\ntext');
		expect(view.contentDOM.textContent).toBe('## title\ntext');
	});

	it('keeps blank lines as their own newlines in the editor DOM', () => {
		const view = mount('line one\n\nline three');
		expect(view.contentDOM.textContent).toBe('line one\n\nline three');
	});

	it('adds no newline after the last line', () => {
		const view = mount('only a line');
		expect(view.contentDOM.textContent).toBe('only a line');
	});

	it('renders an empty note without any separator', () => {
		const view = mount('');
		expect(view.contentDOM.textContent).toBe('');
	});

	it('keeps the separator on a line whose marks are concealed', () => {
		const view = mount('## title\nbody', [concealMarks]);
		view.dispatch({ selection: { anchor: 13 } });
		expect(view.contentDOM.textContent).toBe('title\nbody');
	});

	it('shows marks and separators on the cursor line', () => {
		const view = mount('## title\nbody', [concealMarks]);
		expect(view.contentDOM.textContent).toBe('## title\nbody');
	});

	it('keeps separators inside fenced code blocks', () => {
		const view = mount('a\n\n```\ncode\n```\nz');
		expect(view.contentDOM.textContent).toBe('a\n\n```\ncode\n```\nz');
	});

	it('does not add characters to the document', () => {
		const view = mount('## title\ntext');
		expect(view.state.doc.toString()).toBe('## title\ntext');
	});

	it('types at the end of a line without moving the caret to another line', () => {
		const view = mount('## title\ntext');
		view.dispatch({ selection: { anchor: 8 }, changes: { from: 8, insert: 'x' } });
		expect(view.state.doc.toString()).toBe('## titlex\ntext');
		expect(view.contentDOM.textContent).toBe('## titlex\ntext');
	});

	it('splits a line when a newline is typed', () => {
		const view = mount('## title\ntext');
		view.dispatch({ selection: { anchor: 8 }, changes: { from: 8, insert: '\n' } });
		expect(view.state.doc.toString()).toBe('## title\n\ntext');
		expect(view.contentDOM.textContent).toBe('## title\n\ntext');
	});

	it('merges lines when the line break is deleted', () => {
		const view = mount('## title\ntext');
		view.dispatch({ selection: { anchor: 9 }, changes: { from: 8, to: 9 } });
		expect(view.state.doc.toString()).toBe('## titletext');
		expect(view.contentDOM.textContent).toBe('## titletext');
	});

	it('clears the note down to an empty DOM', () => {
		const view = mount('## title\ntext');
		view.dispatch({ selection: { anchor: 0 }, changes: { from: 0, to: 13 } });
		expect(view.state.doc.toString()).toBe('');
		expect(view.contentDOM.textContent).toBe('');
	});

	it('still resolves the end of a line to the line-end position', () => {
		const view = mount('## title\ntext');
		const firstLine = view.contentDOM.querySelector('.cm-line') as HTMLElement;
		const text = firstLine.firstChild as Text;
		expect(view.posAtDOM(text, text.length)).toBe(8);
	});
});
