import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(content: string): string {
	return DOMPurify.sanitize(marked.parse(content, { async: false }) as string);
}
