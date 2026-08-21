import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { taskMarkerAt, toggleMarkerChange, type MarkerRange } from './cm-task-click';

function makeState(doc: string): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })]
	});
}

function markerAt(doc: string, pos: number): MarkerRange | null {
	return taskMarkerAt(makeState(doc), pos);
}

function toggle(doc: string, marker: MarkerRange): string | null {
	const change = toggleMarkerChange(marker, doc);
	if (!change) return null;
	return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
}

describe('taskMarkerAt', () => {
	it('finds the marker of a plain task item', () => {
		const m = markerAt('- [ ] buy milk', 3);
		expect(m).toEqual({ from: 2, to: 5 });
	});

	it('accepts clicks on the token boundaries', () => {
		for (const pos of [2, 3, 4, 5]) {
			expect(markerAt('- [ ] buy milk', pos), `pos ${pos}`).not.toBeNull();
		}
	});

	it('rejects clicks before the token', () => {
		for (const pos of [0, 1]) {
			expect(markerAt('- [ ] buy milk', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('rejects clicks after the token', () => {
		for (const pos of [6, 8, 13]) {
			expect(markerAt('- [ ] buy milk', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('finds the marker of a checked task item', () => {
		expect(markerAt('- [x] done', 3)).toEqual({ from: 2, to: 5 });
	});

	it('finds the marker of an indented task item', () => {
		expect(markerAt('  - [ ] nested', 5)).toEqual({ from: 4, to: 7 });
	});

	it('finds the marker of the right line in a multi-item list', () => {
		expect(markerAt('- [ ] a\n- [x] b', 3)).toEqual({ from: 2, to: 5 });
		expect(markerAt('- [ ] a\n- [x] b', 11)).toEqual({ from: 10, to: 13 });
	});

	it('returns null on a bare "- [ ]" line (no trailing space, not a task)', () => {
		for (const pos of [0, 2, 3, 4, 5]) {
			expect(markerAt('- [ ]', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('returns null on a bare "- [x]" line (parses as a link)', () => {
		for (const pos of [2, 3, 4]) {
			expect(markerAt('- [x]', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('returns null for an invalid marker middle character', () => {
		for (const pos of [2, 3, 4]) {
			expect(markerAt('- [a] weird', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('returns null on a bracket pair that is not a task marker', () => {
		for (const pos of [5, 6, 7]) {
			expect(markerAt('word [ ] more', pos), `pos ${pos}`).toBeNull();
		}
	});

	it('returns null inside a fenced code block', () => {
		for (const pos of [4, 5, 6, 7]) {
			expect(markerAt('```\n- [ ] x\n```', pos), `pos ${pos}`).toBeNull();
		}
	});
});

describe('toggleMarkerChange', () => {
	it('checks an unchecked marker', () => {
		const m = markerAt('- [ ] buy milk', 3)!;
		expect(toggle('- [ ] buy milk', m)).toBe('- [x] buy milk');
	});

	it('unchecks a checked marker', () => {
		const m = markerAt('- [x] done', 3)!;
		expect(toggle('- [x] done', m)).toBe('- [ ] done');
	});

	it('unchecks an uppercase-X marker', () => {
		const m = markerAt('- [X] upper', 5)!;
		expect(toggle('- [X] upper', m)).toBe('- [ ] upper');
	});

	it('leaves the rest of the line untouched', () => {
		const m = markerAt('- [ ] a **bold** [ ] b', 5)!;
		expect(toggle('- [ ] a **bold** [ ] b', m)).toBe('- [x] a **bold** [ ] b');
	});

	it('returns null for a marker whose middle is not a toggleable char', () => {
		expect(toggleMarkerChange({ from: 2, to: 5 }, '- [a] weird')).toBeNull();
	});
});
