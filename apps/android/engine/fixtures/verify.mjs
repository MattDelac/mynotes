import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';

const require = createRequire(import.meta.url);
const yjsVersion = require('yjs/package.json').version;
const EXPECTED = '13.6.32';
if (yjsVersion !== EXPECTED) {
	throw new Error(`yjs version mismatch: resolved ${yjsVersion}, expected ${EXPECTED}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const testdata = join(here, '..', 'testdata');
const read = (name) => readFileSync(join(testdata, name));
const bin = (name) => new Uint8Array(read(name));

const expect = JSON.parse(readFileSync(join(testdata, 'expect.json'), 'utf8'));

function checkState(doc, stageName) {
	const notes = doc.getMap('notes');
	const ids = [...notes.keys()].sort();
	const expectedIds = [...expect.ids].sort();
	if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
		throw new Error(
			`[${stageName}] ids mismatch:\n  got      ${JSON.stringify(ids)}\n  expected ${JSON.stringify(expectedIds)}`
		);
	}
	for (const id of expectedIds) {
		const text = notes.get(id);
		if (!(text instanceof Y.Text)) {
			throw new Error(`[${stageName}] note ${id} is not a Y.Text (got ${text})`);
		}
		const got = text.toString();
		const want = expect.notes[id].text;
		if (got !== want) {
			throw new Error(
				`[${stageName}] note ${id} text mismatch:\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(want)}`
			);
		}
		if (got.length !== expect.notes[id].utf16Length) {
			throw new Error(
				`[${stageName}] note ${id} utf16Length mismatch: got ${got.length}, expected ${expect.notes[id].utf16Length}`
			);
		}
	}
}

const checks = [];
function run(name, fn) {
	try {
		fn();
		checks.push({ name, ok: true });
		console.log(`ok   ${name}`);
	} catch (err) {
		checks.push({ name, ok: false });
		console.error(`FAIL ${name}: ${err.message}`);
	}
}

run('full', () => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, bin('go_ops_full.bin'));
	checkState(doc, 'full');
});

run('diff', () => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, bin('js_full.bin'));
	Y.applyUpdate(doc, bin('js_delta_1.bin'));
	Y.applyUpdate(doc, bin('js_delta_2.bin'));
	Y.applyUpdate(doc, bin('js_delta_3.bin'));
	Y.applyUpdate(doc, bin('go_ops_diff.bin'));
	checkState(doc, 'diff');
});

run('full-idempotent', () => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, bin('go_ops_full.bin'));
	Y.applyUpdate(doc, bin('go_ops_full.bin'));
	checkState(doc, 'full-idempotent');
});

if (!checks.every((c) => c.ok)) {
	console.error('verify: FAILED');
	process.exit(1);
}

const sha256 = {
	'go_ops_full.bin': createHash('sha256').update(read('go_ops_full.bin')).digest('hex'),
	'go_ops_sv.bin': createHash('sha256').update(read('go_ops_sv.bin')).digest('hex'),
	'go_ops_diff.bin': createHash('sha256').update(read('go_ops_diff.bin')).digest('hex'),
	'expect.json': createHash('sha256').update(read('expect.json')).digest('hex')
};

const verdict = { ok: true, yjsVersion: EXPECTED, checks, sha256 };
writeFileSync(join(testdata, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
console.log(`verify: ok (yjs ${yjsVersion})`);
