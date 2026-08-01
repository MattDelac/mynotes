<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { classHighlighter, tags } from '@lezer/highlight';

	let {
		value,
		onchange
	}: {
		value: string;
		onchange(value: string): void;
	} = $props();

	let container = $state<HTMLDivElement | null>(null);
	let view: EditorView | null = null;

	const markdownStyle = HighlightStyle.define([
		{ tag: tags.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
		{ tag: tags.heading2, fontSize: '1.45em', fontWeight: '700', lineHeight: '1.3' },
		{ tag: tags.heading3, fontSize: '1.25em', fontWeight: '600', lineHeight: '1.3' },
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
		view.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length }
		});
		view.focus();
	}

	export function focus(): void {
		view?.focus();
	}

	onMount(() => {
		if (!container) return;
		const state = EditorState.create({
			doc: value,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(markdownStyle),
				syntaxHighlighting(classHighlighter),
				cmPlaceholder('Start typing…'),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ 'aria-label': 'Note' }),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						onchange(update.state.doc.toString());
					}
				}),
				EditorView.theme({
					'&': { height: '100%', fontSize: '1.05rem', backgroundColor: 'transparent' },
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
		max-width: calc(var(--content-width) + 2rem);
		margin: 0 auto;
		padding: 0 1rem;
	}
	.editor :global(.cm-editor) {
		flex: 1;
		background: transparent;
	}
</style>
