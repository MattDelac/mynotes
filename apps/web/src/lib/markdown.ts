import { marked, Renderer, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { scanTaskLines, type TaskLine } from './task-lines';

marked.use({ gfm: true, breaks: true });

if (DOMPurify.isSupported) {
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});
}

function taskCheckboxRenderer(candidates: TaskLine[], readOnly: boolean): Renderer {
	const counter = { i: 0 };
	const renderer = new Renderer({});
	renderer.checkbox = (token) => {
		const candidate = readOnly ? undefined : candidates[counter.i];
		counter.i += 1;
		const checked = token.checked;
		if (candidate && candidate.checked === checked) {
			return `<input type="checkbox" tabindex="-1" data-task-line="${candidate.line}"${checked ? ' checked=""' : ''}> `;
		}
		return `<input ${checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `;
	};
	return renderer;
}

function renderTokens(tokens: Token[], renderer: Renderer): string {
	return marked.parser(tokens, { async: false, renderer }) as string;
}

export function titleWrappedHtml(content: string, readOnly = true): string {
	const tokens = marked.lexer(content);
	const renderer = taskCheckboxRenderer(scanTaskLines(content), readOnly);
	const firstIndex = tokens.findIndex((t) => {
		if (t.type === 'space') return false;
		if (t.type === 'paragraph') return t.text.trim() !== '';
		return true;
	});
	if (firstIndex >= 0) {
		const first = tokens[firstIndex];
		const next = tokens[firstIndex + 1];
		const tightList = next !== undefined && next.type === 'list' && !next.ordered;
		if (first.type === 'paragraph' && !tightList) {
			const head = renderTokens([first], renderer).replace('<p>', '<p class="note-title">');
			const rest = renderTokens(tokens.slice(firstIndex + 1), renderer);
			return head + rest;
		}
	}
	return renderTokens(tokens, renderer);
}

export function renderMarkdown(content: string, readOnly = true): string {
	return DOMPurify.sanitize(titleWrappedHtml(content, readOnly));
}
