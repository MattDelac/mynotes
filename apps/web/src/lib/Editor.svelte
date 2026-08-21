<script lang="ts">
	import { onMount } from 'svelte';
	import * as Y from 'yjs';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
	import { defaultKeymap } from '@codemirror/commands';
	import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { classHighlighter, tags } from '@lezer/highlight';
	import { concealMarks } from './cm-conceal';
	import { titleLines } from './cm-title';
	import { clickableLinks } from './cm-links';
	import { formatKeymap } from './cm-format';
	import { indentKeymap } from './cm-indent';
	import { inputRulesKeymap } from './cm-input-rules';
	import { tableKeymap } from './cm-table';

	let { ytext, editable = true }: { ytext: Y.Text; editable?: boolean } = $props();

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
		{ tag: tags.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
		{ tag: tags.processingInstruction, color: 'var(--fg-muted)' }
	]);

	export function insertAtCursor(text: string): void {
		if (!view) return;
		const { from, to } = view.state.selection.main;
		ytext.delete(from, to - from);
		ytext.insert(from, text);
		view.dispatch({ selection: { anchor: from + text.length } });
		view.focus();
	}

	export function focus(): void {
		view?.focus();
	}

	onMount(() => {
		if (!container) return;
		const undoManager = new Y.UndoManager(ytext);
		const state = EditorState.create({
			doc: ytext.toString(),
			extensions: [
				keymap.of([
					...yUndoManagerKeymap,
					...tableKeymap,
					...indentKeymap,
					...inputRulesKeymap,
					...formatKeymap(undoManager),
					...defaultKeymap
				]),
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(markdownStyle),
				syntaxHighlighting(classHighlighter),
				concealMarks,
				titleLines,
				EditorView.decorations.of((view) => view.state.field(titleLines)),
				clickableLinks,
				cmPlaceholder('Start typing…'),
				EditorView.lineWrapping,
				EditorView.editable.of(editable),
				EditorView.contentAttributes.of({ 'aria-label': 'Note' }),
				yCollab(ytext, null, { undoManager }),
				EditorView.theme({
					'&': { height: '100%', fontSize: '1.05rem', backgroundColor: 'transparent' },
					'.cm-note-title': {
						fontSize: '1.7em',
						fontWeight: '700',
						lineHeight: '1.3',
						fontFamily: 'var(--font-serif)'
					},
					'.cm-content': {
						padding: '1.5rem 0',
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
					}
				})
			]
		});
		view = new EditorView({ state, parent: container });
		return () => {
			undoManager.destroy();
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
