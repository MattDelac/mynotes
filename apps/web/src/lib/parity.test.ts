import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noteTitle } from './db';
import { exportFilename } from './export';

interface FixtureCase {
	input: string;
	expected: string;
}

interface Fixtures {
	titles: FixtureCase[];
	filenames: FixtureCase[];
}

const fixtures = JSON.parse(
	readFileSync(new URL('../../../android/testdata/parity-fixtures.json', import.meta.url), 'utf8')
) as Fixtures;

describe('shared title/export parity fixture', () => {
	it('produces every expected title', () => {
		expect(fixtures.titles.length).toBeGreaterThan(0);
		for (const { input, expected } of fixtures.titles) {
			expect(noteTitle(input), JSON.stringify(input)).toBe(expected);
		}
	});

	it('produces every expected export filename', () => {
		expect(fixtures.filenames.length).toBeGreaterThan(0);
		for (const { input, expected } of fixtures.filenames) {
			expect(exportFilename(input), JSON.stringify(input)).toBe(expected);
		}
	});
});
