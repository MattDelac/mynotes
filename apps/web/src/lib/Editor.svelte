<script lang="ts">
	import { onMount } from 'svelte';
	import * as Y from 'yjs';
	import { EditorState, Prec } from '@codemirror/state';
	import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
	import { defaultKeymap } from '@codemirror/commands';
	import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { classHighlighter, tags } from '@lezer/highlight';
	import { concealMarks } from './cm-conceal';
	import { titleLines } from './cm-title';
	import { fencedCodeLines } from './cm-fenced-code';
	import { clickableLinks } from './cm-links';
	import { formatKeymap } from './cm-format';
	import { indentKeymap } from './cm-indent';
	import { inputRulesKeymap } from './cm-input-rules';
	import { tableKeymap } from './cm-table';
	import { taskMarkerClick } from './cm-task-click';
	import { taskToggleKeymap } from './cm-task-toggle';
	import { orderedTaskNewlineKeymap } from './cm-task-newline';
	import { orderedTaskBackspaceKeymap } from './cm-task-backspace';
	import { getNoteSelection } from './db';
	import {
		clampSelection,
		hasSelection,
		recordSelection,
		savedSelection
	} from './selection-memory';
	import { scheduleSelectionPersist } from './selection-persist';
	import { getUndoManager } from './undo-memory';

	let {
		ytext,
		editable = true,
		noteId = ''
	}: { ytext: Y.Text; editable?: boolean; noteId?: string } = $props();

	let container = $state<HTMLDivElement | null>(null);
	let view: EditorView | null = null;

	const markdownStyle = HighlightStyle.define([
		{
			tag: tags.heading1,
			fontSize: '1.7em',
			fontWeight: '700',
			lineHeight: '1.3',
			fontFamily: 'var(--font-serif)'
		},
		{
			tag: tags.heading2,
			fontSize: '1.45em',
			fontWeight: '700',
			lineHeight: '1.3',
			fontFamily: 'var(--font-serif)'
		},
		{
			tag: tags.heading3,
			fontSize: '1.25em',
			fontWeight: '600',
			lineHeight: '1.3',
			fontFamily: 'var(--font-serif)'
		},
		{ tag: tags.heading4, fontSize: '1.1em', fontWeight: '600' },
		{ tag: tags.strong, fontWeight: '700' },
		{ tag: tags.emphasis, fontStyle: 'italic' },
		{ tag: tags.strikethrough, textDecoration: 'line-through' },
		{ tag: tags.monospace, fontFamily: 'var(--mono)' },
		{ tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
		{ tag: tags.url, color: 'var(--accent)', textDecoration: 'underline' },
		{ tag: tags.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
		{ tag: tags.processingInstruction, color: 'var(--fg-muted)' }
	]);

	onMount(() => {
		if (!container) return;
		const undoManager = getUndoManager(ytext);
		const docText = ytext.toString();
		let touched = false;
		let restoring = Boolean(noteId) && !hasSelection(noteId);
		const state = EditorState.create({
			doc: docText,
			selection: savedSelection(noteId, docText.length),
			extensions: [
				Prec.highest(keymap.of(orderedTaskNewlineKeymap(undoManager))),
				Prec.highest(keymap.of(orderedTaskBackspaceKeymap(undoManager))),
				keymap.of([
					...yUndoManagerKeymap,
					{ key: 'Mod-Shift-Z', run: () => undoManager.redo() != null, preventDefault: true },
					...tableKeymap(undoManager),
					...indentKeymap(undoManager),
					...inputRulesKeymap(undoManager),
					...formatKeymap(undoManager),
					...taskToggleKeymap(undoManager),
					...defaultKeymap
				]),
				markdown({ base: markdownLanguage, codeLanguages: languages }),
				syntaxHighlighting(markdownStyle),
				syntaxHighlighting(classHighlighter),
				concealMarks,
				titleLines,
				fencedCodeLines,
				EditorView.decorations.of((view) => view.state.field(titleLines)),
				EditorView.decorations.of((view) => view.state.field(fencedCodeLines)),
				clickableLinks,
				taskMarkerClick(undoManager),
				cmPlaceholder('Start typing…'),
				EditorView.updateListener.of((update) => {
					const main = update.state.selection.main;
					recordSelection(noteId, main.anchor, main.head);
					if (update.docChanged) touched = true;
					if (!restoring) scheduleSelectionPersist(noteId, main.anchor, main.head);
				}),
				EditorView.lineWrapping,
				EditorView.editable.of(editable),
				EditorView.contentAttributes.of({ 'aria-label': 'Note' }),
				yCollab(ytext, null, { undoManager }),
				EditorView.theme({
					'&': { height: '100%', fontSize: '1.05rem', backgroundColor: 'transparent' },
					'.cm-note-title': {
						fontSize: '1.7em',
						fontWeight: '700',
						lineHeight: 'normal',
						fontFamily: 'var(--font-serif)'
					},
					'.cm-title-separator': {
						borderBottom: '1px solid var(--border)',
						paddingBottom: 'var(--space-3)'
					},
					'.cm-title-separator + .cm-line': {
						paddingTop: 'var(--space-3)'
					},
					'.cm-content': {
						padding: '1.5rem 0 50vh',
						fontFamily: 'inherit',
						lineHeight: '1.7',
						color: 'var(--fg)',
						caretColor: 'var(--fg)'
					},
					'&.cm-focused': { outline: 'none' },
					'.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
					'.cm-cursor': { borderLeftColor: 'var(--fg)' },
					'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
						backgroundColor: 'var(--accent-soft) !important'
					},
					'.cm-fenced-code': {
						backgroundColor: 'var(--bg-subtle)',
						paddingInline: '0.75rem'
					},
					'.cm-fenced-code-start': {
						borderTopLeftRadius: 'var(--radius)',
						borderTopRightRadius: 'var(--radius)'
					},
					'.cm-fenced-code-end': {
						borderBottomLeftRadius: 'var(--radius)',
						borderBottomRightRadius: 'var(--radius)'
					}
				})
			]
		});
		view = new EditorView({ state, parent: container });
		const main = view.state.selection.main;
		if (main.anchor !== 0 || main.head !== 0) {
			view.dispatch({ selection: main, scrollIntoView: true });
		}
		if (editable) view.focus();
		if (restoring) {
			void (async () => {
				try {
					const saved = await getNoteSelection(noteId);
					const v = view;
					if (!saved || touched || !v) return;
					const current = v.state.selection.main;
					if (current.anchor !== 0 || current.head !== 0) return;
					const restored = clampSelection(saved, v.state.doc.length);
					if (restored.anchor === 0 && restored.head === 0) return;
					v.dispatch({ selection: restored, scrollIntoView: true });
				} finally {
					restoring = false;
				}
			})();
		}
		return () => {
			view?.destroy();
			view = null;
		};
	});
</script>

<div class="editor" bind:this={container}></div>

<style>
	.editor {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: var(--content-width);
		margin: 0 auto;
		padding: 0 var(--space-3);
	}
	.editor :global(.cm-editor) {
		flex: 1;
		background: transparent;
	}
</style>
