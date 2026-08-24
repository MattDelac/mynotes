import { marked, Renderer, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLang from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
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

const HLJS_LANGUAGES: [string, typeof bash][] = [
	['javascript', javascript],
	['js', javascript],
	['jsx', javascript],
	['typescript', typescript],
	['ts', typescript],
	['tsx', typescript],
	['python', python],
	['py', python],
	['rust', rust],
	['rs', rust],
	['go', go],
	['bash', bash],
	['sh', bash],
	['shell', bash],
	['json', json],
	['html', xml],
	['xml', xml],
	['css', css],
	['sql', sql],
	['yaml', yaml],
	['yml', yaml],
	['markdown', markdownLang],
	['md', markdownLang],
	['diff', diff],
	['patch', diff]
];
for (const [name, language] of HLJS_LANGUAGES) {
	hljs.registerLanguage(name, language);
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function escapeAttr(text: string): string {
	return text.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch]);
}

function codeBlock(token: Tokens.Code): string {
	const lang = (token.lang ?? '').match(/^\s*(\S+)/)?.[1] ?? '';
	const code = token.text.replace(/\n$/, '') + '\n';
	const escaped = token.escaped ? code : escapeHtml(code);
	if (!lang) return `<pre><code>${escaped}</code></pre>\n`;
	if (hljs.getLanguage(lang)) {
		try {
			const highlighted = hljs.highlight(token.text, { language: lang }).value;
			return `<pre><code class="hljs language-${escapeAttr(lang)}">${highlighted}</code></pre>\n`;
		} catch {
			return `<pre><code class="language-${escapeAttr(lang)}">${escaped}</code></pre>\n`;
		}
	}
	return `<pre><code class="language-${escapeAttr(lang)}">${escaped}</code></pre>\n`;
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
	renderer.code = (token) => codeBlock(token);
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
