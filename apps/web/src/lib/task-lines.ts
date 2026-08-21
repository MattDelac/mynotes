export interface TaskLine {
	line: number;
	checked: boolean;
	markerStart: number;
}

const BLOCKQUOTE_PREFIX = /^(?: {0,3}>[ \t]?)*([ \t]*)(.*)$/;
const TASK_LINE = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\] +\S/;
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function indentWidth(indent: string): number {
	let col = 0;
	for (const ch of indent) {
		col = ch === '\t' ? col + (4 - (col % 4)) : col + 1;
	}
	return col;
}

function fenceClose(ch: string, len: number): RegExp {
	return new RegExp(`^ {0,3}${ch}{${len},}\\s*$`);
}

export function scanTaskLines(content: string): TaskLine[] {
	const lines = content.split('\n');
	const out: TaskLine[] = [];
	let closer: RegExp | null = null;
	let codeCol = -1;
	let itemCol = -1;
	let itemIndent = -1;
	let lineStart = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const prefix = BLOCKQUOTE_PREFIX.exec(line) ?? [line, '', line];
		const rest = prefix[2];
		const start = line.length - rest.length;
		if (closer) {
			if (closer.test(rest)) closer = null;
			lineStart += line.length + 1;
			continue;
		}
		const indent = indentWidth(prefix[1]);
		const open = FENCE_OPEN.exec(rest);
		if (open) {
			closer = fenceClose(open[1][0], open[1].length);
			lineStart += line.length + 1;
			continue;
		}
		if (rest.trim() === '') {
			codeCol = -1;
			lineStart += line.length + 1;
			continue;
		}
		if (codeCol >= 0) {
			if (indent >= codeCol) {
				lineStart += line.length + 1;
				continue;
			}
			codeCol = -1;
		}
		if (itemCol >= 0) {
			if (indent < itemIndent) {
				itemCol = -1;
				itemIndent = -1;
			} else if (indent >= itemCol + 4) {
				codeCol = itemCol + 4;
				lineStart += line.length + 1;
				continue;
			}
		}
		if (itemCol < 0 && indent >= 4) {
			codeCol = 4;
			lineStart += line.length + 1;
			continue;
		}
		const item = LIST_ITEM.exec(rest);
		if (item) {
			itemIndent = indent;
			itemCol = indent + item[0].length;
		}
		const task = TASK_LINE.exec(rest);
		if (task) {
			const bracket = rest.indexOf('[');
			out.push({
				line: i + 1,
				checked: task[1] !== ' ',
				markerStart: lineStart + start + bracket + 1
			});
		}
		lineStart += line.length + 1;
	}
	return out;
}
