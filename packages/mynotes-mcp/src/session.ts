import * as Y from 'yjs';

const headingWithText = /^\s{0,3}#+\s+(.+)$/;
const bareHeading = /^\s{0,3}#+\s*$/;
const listItem = /^\s{0,3}(?:[-+*]|\d{1,9}[.)])\s/;
const bulletItem = /^\s{0,3}[-+*]\s/;
const blockquote = /^\s{0,3}>/;
const codeFence = /^\s{0,3}(?:```|~~~)/;
const indentedCode = /^\t|\s{4}/;
const tableRow = /^\s{0,3}\|/;
const thematicBreak = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function noteTitle(content: string): string {
	const lines = content.split('\n');
	const start = lines.findIndex((line) => line.trim() !== '' && !bareHeading.test(line));
	if (start === -1) return 'Untitled';
	const first = lines[start];
	const heading = first.match(headingWithText);
	if (heading) return heading[1].trim().slice(0, 60);
	if (
		listItem.test(first) ||
		blockquote.test(first) ||
		codeFence.test(first) ||
		indentedCode.test(first) ||
		tableRow.test(first) ||
		thematicBreak.test(first)
	) {
		return 'Untitled';
	}
	let end = start;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (
			line.trim() === '' ||
			listItem.test(line) ||
			blockquote.test(line) ||
			codeFence.test(line) ||
			tableRow.test(line) ||
			headingWithText.test(line) ||
			bareHeading.test(line)
		) {
			break;
		}
		end = i;
	}
	if (bulletItem.test(lines[end + 1] ?? '')) return 'Untitled';
	return first.trim().slice(0, 60);
}

export interface NoteRecord {
	id: string;
	content: string;
}

export function sessionNotes(doc: Y.Doc): NoteRecord[] {
	const map = doc.getMap<Y.Text>('notes');
	const notes: NoteRecord[] = [];
	for (const [id, text] of map.entries()) {
		notes.push({ id, content: text.toString() });
	}
	return notes;
}
