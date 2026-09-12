import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
	autocompletion,
	completionStatus,
	moveCompletionSelection
} from '@codemirror/autocomplete';
import type { UndoManager } from 'yjs';
import { EMOJIS, type Emoji } from './emoji';
import { ownUndoStep } from './cm-undo';

const QUERY_AT_END = /(^|[^\w:]):([a-z0-9_+-]{2,})$/i;

export interface EmojiQuery {
	from: number;
	query: string;
}

export function emojiQueryAt(state: EditorState, pos: number): EmojiQuery | null {
	const line = state.doc.lineAt(pos);
	const text = line.text.slice(0, pos - line.from);
	const match = QUERY_AT_END.exec(text);
	if (!match) return null;
	const from = line.from + match.index + match[1].length;
	const node = syntaxTree(state).resolveInner(from, 1);
	let current: typeof node | null = node;
	while (current) {
		if (
			current.name === 'InlineCode' ||
			current.name === 'FencedCode' ||
			current.name === 'CodeBlock'
		) {
			return null;
		}
		current = current.parent;
	}
	return { from, query: match[2] };
}

export function matchEmojis(query: string, undoManager?: UndoManager): Completion[] {
	const q = query.toLowerCase();
	const byShortcode: Completion[] = [];
	const byAlias: Completion[] = [];
	for (const emoji of EMOJIS) {
		if (emoji.shortcode.startsWith(q)) {
			byShortcode.push(completionFor(emoji, undoManager));
		} else if (emoji.aliases?.some((alias) => alias.startsWith(q))) {
			byAlias.push(completionFor(emoji, undoManager));
		}
	}
	return [...byShortcode, ...byAlias];
}

function completionFor(emoji: Emoji, undoManager?: UndoManager): Completion {
	return {
		label: emoji.char,
		detail: `:${emoji.shortcode}:`,
		apply: (view, _completion, from, to) => {
			ownUndoStep(view, { changes: { from, to, insert: emoji.char } }, undoManager);
		}
	};
}

export function emojiCompletionSource(undoManager?: UndoManager): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const match = emojiQueryAt(context.state, context.pos);
		if (!match) return null;
		const options = matchEmojis(match.query, undoManager);
		if (options.length === 0) return null;
		return {
			from: match.from,
			options,
			filter: false,
			validFor: /^:[a-z0-9_+-]*$/i
		};
	};
}

function arrowCommand(forward: boolean): (view: EditorView) => boolean {
	return (view) => {
		if (completionStatus(view.state) !== 'active') return false;
		moveCompletionSelection(forward)(view);
		return true;
	};
}

export const emojiArrowKeymap: KeyBinding[] = [
	{ key: 'ArrowLeft', run: arrowCommand(false) },
	{ key: 'ArrowRight', run: arrowCommand(true) }
];

const emojiTooltipTheme = EditorView.theme({
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip': {
		border: '1px solid var(--border)',
		backgroundColor: 'var(--bg)',
		color: 'var(--fg)',
		paddingBottom: '1.75rem'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip > ul': {
		display: 'grid',
		gridTemplateColumns: 'repeat(8, 2rem)',
		gap: '0.25rem',
		padding: '0.5rem',
		margin: '0',
		listStyle: 'none',
		maxHeight: 'none',
		background: 'none'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip > ul > li': {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '2rem',
		height: '2rem',
		margin: '0',
		padding: '0',
		borderRadius: 'var(--radius)',
		fontSize: '1.35rem',
		lineHeight: '1'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip > ul > li[aria-selected]': {
		backgroundColor: 'var(--bg-active)'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip .cm-completionLabel': {
		display: 'none'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip .cm-completionDetail': {
		display: 'none'
	},
	'.cm-tooltip.cm-tooltip-autocomplete.cm-emoji-tooltip > ul > li[aria-selected] .cm-completionDetail':
		{
			display: 'block',
			position: 'absolute',
			left: 0,
			right: 0,
			bottom: '0.35rem',
			textAlign: 'center',
			fontSize: '0.7rem',
			color: 'var(--fg-muted)',
			whiteSpace: 'nowrap'
		}
});

export function emojiAutocomplete(undoManager?: UndoManager): Extension {
	return [
		autocompletion({
			override: [emojiCompletionSource(undoManager)],
			defaultKeymap: true,
			icons: false,
			maxRenderedOptions: 16,
			tooltipClass: () => 'cm-emoji-tooltip',
			addToOptions: [
				{
					position: 40,
					render(completion) {
						const tile = document.createElement('span');
						tile.className = 'cm-emoji-tile';
						tile.textContent = completion.label;
						tile.setAttribute('title', completion.detail ?? '');
						tile.setAttribute('aria-label', completion.detail ?? '');
						return tile;
					}
				}
			]
		}),
		Prec.highest(keymap.of(emojiArrowKeymap)),
		emojiTooltipTheme
	];
}
