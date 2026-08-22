<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { renderMarkdown } from '$lib/markdown';
	import { forgetShareKey } from '$lib/shared';
	import { RoomSession, type SessionState } from '$lib/collab';
	import { encryptBytes, exportKey, generateKey, importKey } from '$lib/crypto';
	import { pushBlob, pushSnapshot } from '$lib/api';
	import {
		listNotes,
		saveNote,
		deleteNote,
		deleteNoteSelection,
		createNote,
		noteTitle,
		type Note
	} from '$lib/db';
	import { destroyNoteDoc, getNoteDoc, migrateLegacyContent, setDocContent } from '$lib/docs';
	import * as Y from 'yjs';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, viewLink } from '$lib/share';
	import { downloadNote } from '$lib/export';
	import { forgetSelection } from '$lib/selection-memory';
	import { forgetUndoManager } from '$lib/undo-memory';
	import { showToast } from '$lib/toast';
	import Editor from '$lib/Editor.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import NoteList from '$lib/components/NoteList.svelte';
	import SharePanel from '$lib/components/SharePanel.svelte';
	import ToastStack from '$lib/components/ToastStack.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let note = $state<Note>({ id: '', content: '', createdAt: 0, updatedAt: 0 });
	let ytext = $state<Y.Text | null>(null);
	let notes = $state<Note[]>([]);
	let preview = $state(false);
	let sidebarOpen = $state(false);
	let shareOpen = $state(false);
	let shareError = $state('');
	let copied = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let sessionState = $state<SessionState | 'idle'>('idle');
	let session: RoomSession | null = null;
	let sharedYtext = $state<Y.Text | null>(null);

	const rendered = $derived(renderMarkdown(note.content));
	const headerTitle = $derived(
		data.shared ? `Shared note${data.shared.owner ? '' : ' (read-only)'}` : noteTitle(note.content)
	);
	const showSync = $derived(Boolean(note.share));

	$effect(() => {
		if (shareError) {
			showToast('danger', shareError);
		}
	});

	function exportNote() {
		const ok = confirm('This will export an unencrypted copy of the note. Continue?');
		if (ok) {
			downloadNote(note);
		}
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const fresh = createNote();
		fresh.content = '';
		await setDocContent(fresh.id, await file.text());
		await saveNote(fresh);
		input.value = '';
		await goto(resolve(`/n/${fresh.id}`));
	}

	const persist = debounce(async () => {
		note.updatedAt = Date.now();
		await saveNote(note);
		notes = await listNotes();
	}, 400);

	$effect(() => {
		if (!data.shared) return;
		const remoteId = data.shared.remoteId;
		let session: RoomSession | null = null;
		let cancelled = false;
		void (async () => {
			const shared = data.shared;
			const ydoc = new Y.Doc();
			session = new RoomSession({
				ydoc,
				roomId: remoteId,
				key: await importKey(shared.key),
				editToken: shared.editToken,
				onState: (state) => (sessionState = state)
			});
			try {
				await session.start();
			} catch {
				sessionState = 'offline';
				return;
			}
			if (cancelled) {
				session.stop();
				ydoc.destroy();
				return;
			}
			sharedYtext = ydoc.getText('content');
		})();
		return () => {
			cancelled = true;
			session?.stop();
			sharedYtext = null;
		};
	});

	$effect(() => {
		listNotes().then((all) => (notes = all));
	});

	$effect(() => {
		if (!data.note) return;
		note = { ...data.note };
		ytext = null;
		preview = false;
		shareOpen = false;
		sessionState = 'idle';
		const id = data.note.id;
		const legacy = data.note.content;
		let observer: (() => void) | null = null;
		let cancelled = false;
		void (async () => {
			const doc = await getNoteDoc(id);
			if (cancelled) return;
			await migrateLegacyContent(id, legacy);
			if (cancelled) return;
			ytext = doc.ytext;
			note.content = doc.ytext.toString();
			observer = () => {
				note.content = doc.ytext.toString();
				persist();
			};
			doc.ytext.observe(observer);
			if (data.note?.share) {
				startSession(doc.ydoc, data.note.share);
			}
		})();
		return () => {
			cancelled = true;
			session?.stop();
			session = null;
			if (observer) {
				getNoteDoc(id).then((doc) => doc.ytext.unobserve(observer!));
			}
		};
	});

	async function startSession(ydoc: Y.Doc, share: NonNullable<Note['share']>) {
		session?.stop();
		session = new RoomSession({
			ydoc,
			roomId: share.remoteId,
			key: await importKey(share.key),
			editToken: share.editToken,
			onState: (state) => (sessionState = state)
		});
		try {
			await session.start();
		} catch {
			sessionState = 'offline';
		}
	}

	async function newNote() {
		const fresh = createNote();
		await saveNote(fresh);
		await goto(resolve(`/n/${fresh.id}`));
	}

	async function removeNoteById(id: string) {
		const doc = await getNoteDoc(id);
		forgetUndoManager(doc.ytext);
		await deleteNote(id);
		await destroyNoteDoc(id);
		forgetSelection(id);
		await deleteNoteSelection(id);
		notes = await listNotes();
		if (id === note.id) {
			if (notes.length > 0) {
				await goto(resolve(`/n/${notes[0].id}`));
			} else {
				const fresh = createNote();
				await saveNote(fresh);
				await goto(resolve(`/n/${fresh.id}`));
			}
		}
	}

	async function share() {
		if (note.share) {
			shareOpen = true;
			return;
		}
		const ok = confirm(
			'Sharing your note will store it encrypted on the server. Anyone with the link can read it. Confirm?'
		);
		if (!ok) return;
		shareError = '';
		try {
			const cryptoKey = await generateKey();
			const encoded = await exportKey(cryptoKey);
			const doc = await getNoteDoc(note.id);
			const snapshot = await encryptBytes(cryptoKey, Y.encodeStateAsUpdate(doc.ydoc));
			const { id, edit_token } = await pushBlob(snapshot);
			await pushSnapshot(id, edit_token, snapshot);
			note.share = { remoteId: id, key: encoded, editToken: edit_token };
			await saveNote(note);
			shareOpen = true;
			startSession(doc.ydoc, note.share);
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'share failed';
		}
	}

	async function copyLink() {
		if (!note.share) return;
		await navigator.clipboard.writeText(viewLink(note.share));
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function email() {
		if (!note.share) return;
		const ok = confirm(
			'Anyone with this link can read the note. The key is in the link — treat the email as sensitive.'
		);
		if (ok) {
			location.href = mailtoLink(noteTitle(note.content), viewLink(note.share));
		}
	}

	function handleMenuAction(action: string) {
		if (action === 'export') exportNote();
		else if (action === 'import') fileInput?.click();
	}

	async function leaveSharedNote() {
		if (!data.shared) return;
		if (!confirm('Leave this note? The decryption key stored on this device will be removed.')) {
			return;
		}
		forgetShareKey(data.shared.remoteId);
		await goto(resolve('/'));
	}
</script>

<div class="shell">
	<AppHeader
		title={headerTitle}
		sharedMode={Boolean(data.shared)}
		readOnly={data.shared ? !data.shared.owner : false}
		{showSync}
		{sessionState}
		onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
		onShare={data.shared ? undefined : share}
		onLeave={data.shared ? leaveSharedNote : undefined}
		onTogglePreview={() => (preview = !preview)}
		{preview}
		onMenuAction={handleMenuAction}
		showNewSession={false}
	/>

	{#if !data.shared}
		<NoteList
			{notes}
			activeNoteId={note.id}
			canWrite={true}
			onSelectNote={(id) => goto(resolve(`/n/${id}`))}
			onNewNote={newNote}
			onDeleteNote={removeNoteById}
			{noteTitle}
			mobileOpen={sidebarOpen}
			onCloseRequest={() => (sidebarOpen = false)}
		/>
	{/if}

	{#if shareOpen && note.share}
		<SharePanel
			shareLink={viewLink(note.share)}
			shareKind="view"
			onKindChange={() => {}}
			onCopy={copyLink}
			onEmail={() => email()}
			onClose={() => (shareOpen = false)}
			{copied}
			showKindSelect={false}
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
		{#if data.shared}
			{#if sharedYtext}
				<Editor ytext={sharedYtext} noteId={data.shared.remoteId} editable={data.shared.owner} />
			{/if}
		{:else if preview}
			<article
				class="preview"
				style="max-width: var(--content-width); margin: 0 auto; padding: var(--space-4) var(--space-3);"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
				{@html rendered}
			</article>
		{:else if note.id && ytext}
			{#key note.id}
				<Editor {ytext} noteId={note.id} />
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
