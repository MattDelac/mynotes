import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CHECKPOINTS_DIR, ensureStateDir, type SessionEntry } from '../src/config.js';
import { decryptBytes, encryptBytes, exportKey, generateKey, importKey } from '../src/crypto.js';
import { RelayClient, RelayError } from '../src/relay.js';
import { Session } from '../src/session.js';
import { noteTitle, sessionNotes } from '../src/session.js';
import { seedSession, startRelay, waitFor, type RelayHandle } from './helpers/relay-fixture.js';

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

	it('converges after the owner compacts the room while the reader is offline', async () => {
		const seeded = await seedSession(relay.url, { note: 'v1' });
		const client = new RelayClient({ apiUrl: relay.url });
		const before = await client.fetchUpdates(seeded.roomId, -1);
		const cursor = before[before.length - 1]?.seq ?? -1;

		seeded.doc.transact(() => {
			const text = seeded.doc.getMap<Y.Text>('notes').get('note');
			text?.insert(text.length, ' updated');
		});
		const key = await importKey(seeded.key);
		const snapshot = await encryptBytes(key, Y.encodeStateAsUpdate(seeded.doc));
		const compacted = await fetch(`${relay.url}/rooms/${seeded.roomId}/snapshot`, {
			method: 'PUT',
			headers: { 'x-edit-token': seeded.editToken },
			body: snapshot as BodyInit
		});
		expect(compacted.status).toBe(204);

		const after = await client.fetchUpdates(seeded.roomId, cursor);
		expect(after).toHaveLength(1);
		expect(after[0]?.seq).toBeGreaterThan(cursor);
		const doc = new Y.Doc();
		for (const row of before) Y.applyUpdate(doc, await decryptBytes(key, row.blob));
		Y.applyUpdate(doc, await decryptBytes(key, after[0]!.blob));
		expect(sessionNotes(doc)).toEqual([{ id: 'note', content: 'v1 updated' }]);
	});

	it('receives live websocket broadcasts and advances on catch-up', async () => {
		const seeded = await seedSession(relay.url, { note: 'base' });
		const dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-ws-'));
		ensureStateDir(dir);
		const entry: SessionEntry = {
			name: 'live',
			room_id: seeded.roomId,
			key: seeded.key,
			edit_token: null,
			writable: false
		};
		const session = new Session({
			entry,
			relay: new RelayClient({ apiUrl: relay.url }),
			checkpointPath: join(dir, CHECKPOINTS_DIR, `${seeded.roomId}.json`)
		});
		await session.catchUp();
		const baseline = session.lastSeq;
		session.setLive(true);
		await waitFor(() => session.wsConnected, 5000, 'session websocket');

		const writer = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/ws/${seeded.roomId}`);
		await new Promise<void>((resolve, reject) => {
			writer.onopen = () => resolve();
			writer.onerror = () => reject(new Error('writer websocket failed'));
		});
		const writable = new Promise<boolean>((resolve) => {
			writer.onmessage = (event) => {
				try {
					const parsed = JSON.parse(String(event.data)) as { writable?: boolean };
					if (parsed.writable === true) resolve(true);
				} catch {
					// ignore
				}
			};
		});
		writer.send(JSON.stringify({ edit_token: seeded.editToken }));
		expect(await writable).toBe(true);

		const stateBefore = Y.encodeStateVector(seeded.doc);
		seeded.doc.transact(() => {
			const text = seeded.doc.getMap<Y.Text>('notes').get('note');
			text?.insert(text.length, ' via socket');
		});
		const key = await importKey(seeded.key);
		writer.send((await encryptBytes(key, Y.encodeStateAsUpdate(seeded.doc, stateBefore))) as never);
		await waitFor(() => session.noteContent('note') === 'base via socket', 5000, 'socket update');
		expect(session.lastSeq).toBe(baseline);

		await session.catchUp();
		expect(session.lastSeq).toBeGreaterThan(baseline);
		session.destroy();
		writer.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
