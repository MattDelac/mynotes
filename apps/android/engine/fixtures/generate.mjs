import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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
mkdirSync(testdata, { recursive: true });

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

// Fixed client ID so regenerating the fixtures produces byte-identical
// files; the committed Go-side goldens are built on top of these bytes.
const doc = new Y.Doc();
doc.clientID = 424242;
const notes = doc.getMap('notes');

const written = [];
function write(name, bytes) {
	writeFileSync(join(testdata, name), bytes);
	written.push(name);
}

function snapshot() {
	const ids = [...notes.keys()].sort();
	const out = {};
	for (const id of ids) {
		const text = notes.get(id).toString();
		out[id] = { text, utf16Length: text.length };
	}
	return { ids, notes: out };
}

const stages = [];

notes.set(A, new Y.Text('Hello from JS\n\nSecond line'));
notes.set(B, new Y.Text('Unicode: héllo 🎉 世界 🚀'));
notes.set(C, new Y.Text(''));
notes.set(D, new Y.Text('temporary note'));
write('js_full.bin', Y.encodeStateAsUpdate(doc));
write('js_sv.bin', Y.encodeStateVector(doc));
const svFull = Y.encodeStateVector(doc);
stages.push({ name: 'full', updates: ['js_full.bin'], ...snapshot() });

notes.get(A).insert(5, ' there');
notes.set(E, new Y.Text('created later'));
write('js_delta_1.bin', Y.encodeStateAsUpdate(doc, svFull));
const sv1 = Y.encodeStateVector(doc);
stages.push({ name: 'delta1', updates: ['js_delta_1.bin'], ...snapshot() });

notes.delete(D);
notes.get(B).insert(15, '⭐');
notes.get(B).delete(16, 2);
write('js_delta_2.bin', Y.encodeStateAsUpdate(doc, sv1));
const sv2 = Y.encodeStateVector(doc);
stages.push({ name: 'delta2', updates: ['js_delta_2.bin'], ...snapshot() });

notes.get(A).delete(0, 5);
write('js_delta_3.bin', Y.encodeStateAsUpdate(doc, sv2));
stages.push({ name: 'delta3', updates: ['js_delta_3.bin'], ...snapshot() });

const manifest = { yjsVersion: EXPECTED, stages };
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log(`yjs ${yjsVersion}`);
for (const name of written) {
	console.log(name);
}
