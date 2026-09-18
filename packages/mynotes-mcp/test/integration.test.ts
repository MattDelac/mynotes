import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decryptBytes, exportKey, generateKey, importKey } from '../src/crypto.js';
import { RelayClient, RelayError } from '../src/relay.js';
import { noteTitle, sessionNotes } from '../src/session.js';
import { seedSession, startRelay, type RelayHandle } from './helpers/relay-fixture.js';

describe('real relay interop', () => {
	let relay: RelayHandle;

	beforeAll(async () => {
		relay = await startRelay();
	});

	afterAll(async () => {
		await relay?.stop();
	});

	it('seeds a web-compatible session and decodes it through the relay client', async () => {
		const seeded = await seedSession(relay.url, {
			'a1b2c3d4-0000-0000-0000-000000000001': '# Hello relay\n\nfirst paragraph',
			'a1b2c3d4-0000-0000-0000-000000000002': 'second note'
		});
		const client = new RelayClient({ apiUrl: relay.url });
		const rows = await client.fetchUpdates(seeded.roomId, -1);
		expect(rows.length).toBeGreaterThan(0);
		let previous = -1;
		for (const row of rows) {
			expect(row.seq).toBeGreaterThan(previous);
			previous = row.seq;
		}

		const key = await importKey(seeded.key);
		const doc = new Y.Doc();
		for (const row of rows) {
			Y.applyUpdate(doc, await decryptBytes(key, row.blob));
		}
		const notes = new Map(sessionNotes(doc).map((note) => [note.id, note.content]));
		expect(notes.get('a1b2c3d4-0000-0000-0000-000000000001')).toBe(
			'# Hello relay\n\nfirst paragraph'
		);
		expect(notes.get('a1b2c3d4-0000-0000-0000-000000000002')).toBe('second note');
		expect(noteTitle(notes.get('a1b2c3d4-0000-0000-0000-000000000001') ?? '')).toBe('Hello relay');
	});

	it('reports a missing room as not_found', async () => {
		const client = new RelayClient({ apiUrl: relay.url });
		await expect(client.fetchUpdates(crypto.randomUUID(), -1)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(client.fetchUpdates(crypto.randomUUID(), -1)).rejects.toBeInstanceOf(RelayError);
	});

	it('fails to decrypt with the wrong key without corrupting the doc', async () => {
		const seeded = await seedSession(relay.url, { note: 'protected' });
		const client = new RelayClient({ apiUrl: relay.url });
		const rows = await client.fetchUpdates(seeded.roomId, -1);
		const wrongKey = await importKey(await exportKey(await generateKey()));
		const first = rows[0];
		expect(first).toBeDefined();
		await expect(decryptBytes(wrongKey, first!.blob)).rejects.toThrow();
	});
});
