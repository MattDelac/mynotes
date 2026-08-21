import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({ gfm: true, breaks: true });

if (DOMPurify.isSupported) {
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});
}

export function titleWrappedHtml(content: string): string {
	const tokens = marked.lexer(content);
	const first = tokens.find((t) => {
		if (t.type === 'space') return false;
		if (t.type === 'paragraph') return t.text.trim() !== '';
		return true;
	});
	if (first && first.type === 'paragraph') {
		const head = (marked.parser([first], { async: false }) as string).replace(
			'<p>',
			'<p class="note-title">'
		);
		const rest = marked.parser(tokens.slice(tokens.indexOf(first) + 1), { async: false }) as string;
		return head + rest;
	}
	return marked.parse(content, { async: false }) as string;
}

export function renderMarkdown(content: string): string {
	return DOMPurify.sanitize(titleWrappedHtml(content));
}
