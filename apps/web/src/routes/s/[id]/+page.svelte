<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { renderMarkdown } from '$lib/markdown';
	import { forgetShareKey } from '$lib/shared';
	import { RoomSession, type SessionState } from '$lib/collab';
	import { encryptBytes, exportKey, generateKey, importKey } from '$lib/crypto';
	import { pushBlob, pushSnapshot } from '$lib/api';
	import {
		createSession,
		getSession,
		listNotes,
		saveNote,
		saveSession,
		deleteNote,
		noteTitle,
		type Note,
		type ShareInfo
	} from '$lib/db';
	import {
		addNote,
		currentNoteId,
		destroySessionDoc,
		getSessionDoc,
		rememberCurrentNote,
		removeNote,
		type SessionDoc
	} from '$lib/sessions';
	import * as Y from 'yjs';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, sessionOwnerLink, sessionViewLink } from '$lib/share';
	import { downloadNote } from '$lib/export';
	import { showToast } from '$lib/toast';
	import Editor from '$lib/Editor.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import NoteList from '$lib/components/NoteList.svelte';
	import SharePanel from '$lib/components/SharePanel.svelte';
	import ToastStack from '$lib/components/ToastStack.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let sessionDoc = $state<SessionDoc | null>(null);
	let noteId = $state('');
	let ytext = $state<Y.Text | null>(null);
	let content = $state('');
	let notes = $state<Note[]>([]);
	let share = $state<ShareInfo | null>(null);
	let preview = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(window.matchMedia('(max-width: 640px)').matches);
	let shareOpen = $state(false);
	let shareError = $state('');
	let copied = $state(false);
	let shareKind = $state<'view' | 'edit'>('view');
	let editor = $state<Editor | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let sessionState = $state<SessionState | 'idle'>('idle');
	let collab: RoomSession | null = null;
	let textObserver: (() => void) | null = null;

	const title = $derived(noteTitle(content));
	const rendered = $derived(renderMarkdown(content));
	const canWrite = $derived(!data.shared || data.shared.owner);
	const headerTitle = $derived(
		data.shared && !data.shared.owner ? 'Shared session (read-only)' : title
	);
	const activeShareLink = $derived(
		share ? (shareKind === 'edit' ? sessionOwnerLink(share) : sessionViewLink(share)) : ''
	);
	const showSync = $derived(Boolean(share || data.shared));

	$effect(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		const onChange = () => (isMobile = mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	$effect(() => {
		if (shareError) {
			showToast('danger', shareError);
		}
	});

	function exportNote() {
		const ok = confirm('This will export an unencrypted copy of the note. Continue?');
		if (ok) {
			downloadNote({ id: noteId, content, createdAt: 0, updatedAt: Date.now() });
		}
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !sessionDoc) return;
		const text = await file.text();
		const doc = sessionDoc;
		const id = await addNote(docId());
		const target = doc.notes.get(id);
		if (target && text.length > 0) target.insert(0, text);
		selectNote(id);
	}

	function docId(): string {
		return data.sessionId ?? data.shared?.remoteId ?? '';
	}

	async function leaveSharedSession() {
		if (!data.shared) return;
		if (!confirm('Leave this session? The decryption key stored on this device will be removed.')) {
			return;
		}
		const remoteId = data.shared.remoteId;
		forgetShareKey(remoteId);
		await destroySessionDoc(remoteId);
		await goto(resolve('/'));
	}

	async function syncMetadata() {
		const doc = sessionDoc;
		if (!doc) return;
		const ids = [...doc.notes.keys()];
		const all = await listNotes();
		const byId = new Map(all.map((n) => [n.id, n]));
		const result: Note[] = [];
		for (const id of ids) {
			const text = doc.notes.get(id)?.toString() ?? '';
			const existing = byId.get(id);
			const changed = !existing || existing.content !== text;
			const meta: Note = existing
				? { ...existing, content: text }
				: { id, content: text, createdAt: Date.now(), updatedAt: Date.now() };
			if (data.sessionId) meta.sessionId = data.sessionId;
			if (changed) {
				meta.updatedAt = Date.now();
				await saveNote(meta);
			}
			result.push(meta);
		}
		result.sort((a, b) => b.updatedAt - a.updatedAt);
		notes = result;
	}

	const syncMeta = debounce(syncMetadata, 300);

	function openNote(id: string) {
		const doc = sessionDoc;
		if (!doc) return;
		const text = doc.notes.get(id);
		if (!text) return;
		if (textObserver && ytext) ytext.unobserve(textObserver);
		noteId = id;
		ytext = text;
		content = text.toString();
		textObserver = () => {
			content = text.toString();
			void syncMeta();
		};
		text.observe(textObserver);
	}

	function selectNote(id: string) {
		sidebarOpen = false;
		const sessionKey = docId();
		if (data.sessionId) rememberCurrentNote(sessionKey, id);
		openNote(id);
		history.replaceState(null, '', `${resolve(`/s/${sessionKey}`)}?n=${id}${location.hash}`);
	}

	async function startCollab(ydoc: Y.Doc, info: ShareInfo) {
		collab?.stop();
		collab = new RoomSession({
			ydoc,
			roomId: info.remoteId,
			key: await importKey(info.key),
			editToken: info.editToken,
			onState: (state) => (sessionState = state)
		});
		try {
			await collab.start();
		} catch {
			sessionState = 'offline';
		}
	}

	$effect(() => {
		if (!data.sessionId) return;
		const sessionId = data.sessionId;
		let cancelled = false;
		let boundDoc: SessionDoc | null = null;
		let mapObserver: (() => void) | null = null;
		void (async () => {
			const doc = await getSessionDoc(sessionId);
			if (cancelled) return;
			sessionDoc = doc;
			boundDoc = doc;
			const meta = await getSession(sessionId);
			share = meta?.share ?? null;
			await syncMetadata();
			mapObserver = () => void syncMeta();
			doc.notes.observeDeep(mapObserver);
			let id = data.noteId && doc.notes.has(data.noteId) ? data.noteId : currentNoteId(sessionId);
			if (!id || !doc.notes.has(id)) id = notes[0]?.id ?? '';
			if (!id) id = await addNote(sessionId);
			rememberCurrentNote(sessionId, id);
			openNote(id);
			if (share) await startCollab(doc.ydoc, share);
		})();
		return () => {
			cancelled = true;
			collab?.stop();
			collab = null;
			if (mapObserver) boundDoc?.notes.unobserveDeep(mapObserver);
			if (textObserver) ytext?.unobserve(textObserver);
			textObserver = null;
			sessionDoc = null;
			ytext = null;
			noteId = '';
		};
	});

	$effect(() => {
		if (!data.shared) return;
		const remoteId = data.shared.remoteId;
		let cancelled = false;
		let boundDoc: SessionDoc | null = null;
		let mapObserver: (() => void) | null = null;
		void (async () => {
			const shared = data.shared;
			const doc = await getSessionDoc(remoteId);
			if (cancelled) return;
			const room = new RoomSession({
				ydoc: doc.ydoc,
				roomId: remoteId,
				key: await importKey(shared.key),
				editToken: shared.editToken,
				onState: (state) => (sessionState = state)
			});
			collab = room;
			try {
				await room.start();
			} catch {
				sessionState = 'offline';
				return;
			}
			if (cancelled) return;
			sessionDoc = doc;
			boundDoc = doc;
			await syncMetadata();
			mapObserver = () => {
				void syncMeta();
				if (!noteId) {
					const first = [...doc.notes.keys()][0];
					if (first) openNote(first);
				}
			};
			doc.notes.observeDeep(mapObserver);
			const id = data.noteId && doc.notes.has(data.noteId) ? data.noteId : (notes[0]?.id ?? '');
			if (id) openNote(id);
		})();
		return () => {
			cancelled = true;
			collab?.stop();
			collab = null;
			if (mapObserver) boundDoc?.notes.unobserveDeep(mapObserver);
			if (textObserver) ytext?.unobserve(textObserver);
			textObserver = null;
			sessionDoc = null;
			ytext = null;
			noteId = '';
			sessionState = 'idle';
		};
	});

	async function newNote() {
		const id = await addNote(docId());
		selectNote(id);
	}

	async function removeNoteById(id: string) {
		await removeNote(docId(), id);
		await deleteNote(id);
		await syncMetadata();
		if (id === noteId) {
			if (notes.length > 0) {
				selectNote(notes[0].id);
			} else if (canWrite) {
				const fresh = await addNote(docId());
				selectNote(fresh);
			}
		}
	}

	async function deleteCurrentNote() {
		if (!noteId) return;
		await removeNoteById(noteId);
	}

	async function startEmptySession() {
		const fresh = createSession();
		await saveSession(fresh);
		await goto(resolve(`/s/${fresh.id}`));
	}

	async function shareSession() {
		if (share) {
			shareOpen = true;
			return;
		}
		const ok = confirm(
			'Sharing this session will store all its notes encrypted on the server. Anyone with the link can read them. Confirm?'
		);
		if (!ok || !data.sessionId || !sessionDoc) return;
		shareError = '';
		try {
			const cryptoKey = await generateKey();
			const encoded = await exportKey(cryptoKey);
			const snapshot = await encryptBytes(cryptoKey, Y.encodeStateAsUpdate(sessionDoc.ydoc));
			const { id, edit_token } = await pushBlob(snapshot);
			await pushSnapshot(id, edit_token, snapshot);
			share = { remoteId: id, key: encoded, editToken: edit_token };
			const meta = await getSession(data.sessionId);
			if (meta) await saveSession({ ...meta, share, updatedAt: Date.now() });
			shareOpen = true;
			await startCollab(sessionDoc.ydoc, share);
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'share failed';
		}
	}

	async function copyLink(link: string) {
		await navigator.clipboard.writeText(link);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function email(link: string, edit: boolean) {
		if (edit) {
			location.href = mailtoLink('My notes', link);
			return;
		}
		const ok = confirm(
			'Anyone with this link can read the notes. The key is in the link — treat the email as sensitive.'
		);
		if (ok) {
			location.href = mailtoLink('My notes', link);
		}
	}

	function handleMenuAction(action: string) {
		if (action === 'export') exportNote();
		else if (action === 'import') fileInput?.click();
		else if (action === 'newSession') startEmptySession();
		else if (action === 'deleteNote') void deleteCurrentNote();
	}
</script>

<div class="shell">
	<AppHeader
		title={headerTitle}
		sharedMode={Boolean(data.shared)}
		readOnly={data.shared ? !data.shared.owner : false}
		{showSync}
		{sessionState}
		{sidebarOpen}
		onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
		onShare={shareSession}
		onLeave={data.shared ? leaveSharedSession : undefined}
		onTogglePreview={() => (preview = !preview)}
		{preview}
		onMenuAction={handleMenuAction}
		showNewSession={!data.shared}
		showDeleteNote={isMobile}
	/>

	<NoteList
		{notes}
		activeNoteId={noteId}
		{canWrite}
		onSelectNote={selectNote}
		onNewNote={newNote}
		onDeleteNote={removeNoteById}
		{noteTitle}
		mobileOpen={sidebarOpen || (Boolean(data.shared) && !isMobile)}
		onCloseRequest={() => (sidebarOpen = false)}
	/>

	{#if shareOpen && share}
		<SharePanel
			shareLink={activeShareLink}
			{shareKind}
			onKindChange={(k) => (shareKind = k)}
			onCopy={() => copyLink(activeShareLink)}
			onEmail={(edit) => email(activeShareLink, edit)}
			onClose={() => (shareOpen = false)}
			{copied}
		/>
	{/if}

	<input
		bind:this={fileInput}
		type="file"
		accept=".md,.markdown,.txt,text/markdown,text/plain"
		hidden
		onchange={importFile}
	/>

	<main>
		{#if preview}
			<article
				class="preview"
				style="max-width: var(--content-width); margin: 0 auto; padding: var(--space-4) var(--space-3);"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
				{@html rendered}
			</article>
		{:else if noteId && ytext}
			{#key noteId}
				<Editor bind:this={editor} {ytext} editable={canWrite} />
			{/key}
		{/if}
	</main>

	<ToastStack />
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	main {
		flex: 1;
		min-width: 0;
		display: flex;
		min-height: 0;
	}
</style>
