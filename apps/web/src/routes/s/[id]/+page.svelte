<script lang="ts">
	import { onDestroy } from 'svelte';
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
		deleteNoteSelection,
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
		rememberSession,
		removeNote,
		type SessionDoc
	} from '$lib/sessions';
	import * as Y from 'yjs';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, sessionOwnerLink, sessionViewLink } from '$lib/share';
	import { downloadNote, downloadExportArchive } from '$lib/export';
	import { scanTaskLines } from '$lib/task-lines';
	import { forgetSelection } from '$lib/selection-memory';
	import { forgetUndoManager, getUndoManager } from '$lib/undo-memory';
	import { showToast } from '$lib/toast';
	import { GrammarChecker, type GrammarSuggestion } from '$lib/grammar';
	import { loadGrammarModel, type ModelLoadProgress } from '$lib/grammar-model';
	import { grammarCheckEnabled, setGrammarCheckEnabled } from '$lib/grammar-prefs';
	import Editor from '$lib/Editor.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import NoteList from '$lib/components/NoteList.svelte';
	import SharePanel from '$lib/components/SharePanel.svelte';
	import ToastStack from '$lib/components/ToastStack.svelte';
	import GrammarPanel from '$lib/components/GrammarPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let sessionDoc = $state<SessionDoc | null>(null);
	let noteId = $state('');
	let ytext = $state<Y.Text | null>(null);
	let content = $state('');
	let notes = $state<Note[]>([]);
	let share = $state<ShareInfo | null>(
		data.shared
			? {
					remoteId: data.shared.remoteId,
					key: data.shared.key,
					editToken: data.shared.editToken
				}
			: null
	);
	let preview = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(window.matchMedia('(max-width: 640px)').matches);
	let shareOpen = $state(false);
	let shareError = $state('');
	let copied = $state(false);
	let shareKind = $state<'view' | 'edit'>('view');
	let previewEl = $state<HTMLElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let sessionState = $state<SessionState | 'idle'>('idle');
	let pendingCount = $state(0);
	let collab: RoomSession | null = null;
	let textObserver: (() => void) | null = null;
	let grammarOn = $state(grammarCheckEnabled());
	let grammarPanelOpen = $state(false);
	let grammarChecking = $state(false);
	let grammarModelState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let grammarModelProgress = $state<ModelLoadProgress>({ percent: null, loadedBytes: 0 });
	let grammarSuggestions = $state<GrammarSuggestion[]>([]);
	let dismissedSuggestionKey = $state('');

	const canWrite = $derived(!share || Boolean(share.editToken));
	const title = $derived(noteTitle(content));
	const rendered = $derived(renderMarkdown(content, !canWrite));
	const headerTitle = $derived(!canWrite ? 'Shared session (read-only)' : title);
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

	$effect(() => {
		const el = previewEl;
		if (!el) return;
		el.addEventListener('click', onPreviewClick);
		return () => el.removeEventListener('click', onPreviewClick);
	});

	function exportNote() {
		const ok = confirm('This will export an unencrypted copy of the note. Continue?');
		if (ok) {
			downloadNote({ id: noteId, content, createdAt: 0, updatedAt: Date.now() });
		}
	}

	function exportAllNotes() {
		const doc = sessionDoc;
		if (!doc) return;
		const entries = [...doc.notes.entries()].map(([id, text]) => ({
			id,
			content: text.toString()
		}));
		if (entries.length === 0) return;
		const ok = confirm(
			'This will export unencrypted copies of all notes in the session. Continue?'
		);
		if (ok) {
			downloadExportArchive(entries);
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

	async function addToLibrary() {
		const shared = data.shared;
		if (!shared) return;
		const now = Date.now();
		await saveSession({
			id: shared.remoteId,
			createdAt: now,
			updatedAt: now,
			share: {
				remoteId: shared.remoteId,
				key: shared.key,
				editToken: shared.editToken
			}
		});
		rememberSession(shared.remoteId);
		window.location.href = resolve(`/s/${shared.remoteId}`);
	}

	async function syncMetadata() {
		const doc = sessionDoc;
		if (!doc) return;
		const sessionId = data.sessionId ?? data.shared?.remoteId;
		const ids = [...doc.notes.keys()];
		const all = await listNotes();
		const byId = new Map(all.map((n) => [n.id, n]));
		const result: Note[] = [];
		for (const id of ids) {
			const text = doc.notes.get(id)?.toString() ?? '';
			const existing = byId.get(id);
			const meta: Note = existing
				? { ...existing, content: text }
				: { id, content: text, createdAt: Date.now(), updatedAt: Date.now() };
			if (sessionId) meta.sessionId = sessionId;
			const changed =
				!existing ||
				existing.content !== text ||
				(sessionId !== undefined && existing.sessionId !== sessionId);
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

	const suggestionKey = (list: GrammarSuggestion[]) =>
		list.map((s) => `${s.from}:${s.to}:${s.correction}`).join('|');

	const grammar = new GrammarChecker({
		isReady: () => grammarOn && canWrite && grammarModelState === 'ready',
		model: async (sentence) => (await loadGrammarModel())(sentence),
		onSuggestions: (list) => {
			grammarSuggestions = list;
			if (list.length > 0 && suggestionKey(list) !== dismissedSuggestionKey) {
				grammarPanelOpen = true;
			}
		},
		onState: (state) => (grammarChecking = state === 'checking'),
		onError: () => showToast('danger', 'Grammar check failed')
	});

	onDestroy(() => grammar.cancel());

	$effect(() => {
		if (grammarOn && canWrite) startModelLoad();
	});

	function startModelLoad() {
		if (grammarModelState === 'loading' || grammarModelState === 'ready') return;
		grammarModelState = 'loading';
		grammarModelProgress = { percent: null, loadedBytes: 0 };
		void loadGrammarModel((p) => (grammarModelProgress = p))
			.then(() => {
				grammarModelState = 'ready';
				if (grammarOn && ytext) grammar.checkNow(ytext.toString());
			})
			.catch(() => {
				grammarModelState = 'error';
				showToast('danger', 'Grammar model failed to load');
			});
	}

	function toggleGrammar() {
		grammarOn = !grammarOn;
		setGrammarCheckEnabled(grammarOn);
		if (grammarOn) {
			grammarPanelOpen = true;
			if (grammarModelState === 'ready') {
				if (ytext) grammar.checkNow(ytext.toString());
			} else {
				startModelLoad();
			}
		} else {
			grammar.cancel();
			grammarPanelOpen = false;
			grammarChecking = false;
		}
	}

	function runGrammarCheck() {
		if (!canWrite) return;
		if (!grammarOn) {
			grammarOn = true;
			setGrammarCheckEnabled(true);
		}
		grammarPanelOpen = true;
		if (grammarModelState === 'ready') {
			if (ytext) grammar.checkNow(ytext.toString());
		} else {
			startModelLoad();
		}
	}

	function dismissGrammar() {
		grammarPanelOpen = false;
		dismissedSuggestionKey = suggestionKey(grammarSuggestions);
	}

	function applyGrammarSuggestion(suggestion: GrammarSuggestion) {
		const text = ytext;
		const doc = text?.doc;
		if (!text || !doc) return;
		const current = text.toString();
		if (current.slice(suggestion.from, suggestion.to) !== suggestion.original) {
			grammarSuggestions = grammarSuggestions.filter((s) => s !== suggestion);
			return;
		}
		const undoManager = getUndoManager(text);
		undoManager.stopCapturing();
		doc.transact(() => {
			text.delete(suggestion.from, suggestion.to - suggestion.from);
			text.insert(suggestion.from, suggestion.correction);
		});
		undoManager.stopCapturing();
		grammarSuggestions = [];
		dismissedSuggestionKey = '';
	}

	function openNote(id: string) {
		const doc = sessionDoc;
		if (!doc) return;
		const text = doc.notes.get(id);
		if (!text) return;
		if (textObserver && ytext) ytext.unobserve(textObserver);
		grammar.cancel();
		noteId = id;
		ytext = text;
		content = text.toString();
		textObserver = () => {
			content = text.toString();
			void syncMeta();
			grammar.schedule(text.toString());
		};
		text.observe(textObserver);
		grammar.schedule(text.toString());
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
			onState: (state) => (sessionState = state),
			onPending: (count) => (pendingCount = count)
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
			pendingCount = 0;
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
			if (cancelled) return;
			const room = new RoomSession({
				ydoc: doc.ydoc,
				roomId: remoteId,
				key: await importKey(shared.key),
				editToken: shared.editToken,
				onState: (state) => (sessionState = state),
				onPending: (count) => (pendingCount = count)
			});
			if (cancelled) {
				room.stop();
				return;
			}
			collab = room;
			try {
				await room.start();
			} catch {
				sessionState = 'offline';
			}
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
			pendingCount = 0;
		};
	});

	async function newNote() {
		const id = await addNote(docId());
		selectNote(id);
	}

	async function removeNoteById(id: string) {
		const doomed = sessionDoc?.notes.get(id);
		if (doomed) forgetUndoManager(doomed);
		await removeNote(docId(), id);
		await deleteNote(id);
		forgetSelection(id);
		await deleteNoteSelection(id);
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
		else if (action === 'exportAll') exportAllNotes();
		else if (action === 'import') fileInput?.click();
		else if (action === 'newNote' && canWrite) void newNote();
		else if (action === 'newSession') startEmptySession();
		else if (action === 'deleteNote') void deleteCurrentNote();
		else if (action === 'toggleGrammar' && canWrite) toggleGrammar();
	}

	function toggleTaskLine(line: number, expectChecked: boolean) {
		const text = ytext;
		const doc = text?.doc;
		if (!text || !doc) return;
		const entry = scanTaskLines(text.toString()).find(
			(t) => t.line === line && t.checked === expectChecked
		);
		if (!entry) return;
		doc.transact(() => {
			text.delete(entry.markerStart, 1);
			text.insert(entry.markerStart, expectChecked ? ' ' : 'x');
		});
	}

	function onPreviewClick(event: MouseEvent) {
		if (!canWrite || !ytext) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const input = target.closest('input[data-task-line]');
		if (!input || !(input instanceof HTMLInputElement)) return;
		toggleTaskLine(Number(input.getAttribute('data-task-line')), input.hasAttribute('checked'));
	}
</script>

<div class="shell">
	<AppHeader
		title={headerTitle}
		sharedMode={Boolean(data.shared)}
		readOnly={!canWrite}
		{showSync}
		{sessionState}
		{pendingCount}
		showHome
		onHome={() => goto(resolve('/'))}
		{sidebarOpen}
		onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
		onShare={shareSession}
		onLeave={data.shared ? leaveSharedSession : undefined}
		onTogglePreview={() => (preview = !preview)}
		{preview}
		onMenuAction={handleMenuAction}
		onGrammarCheck={runGrammarCheck}
		onAddToLibrary={data.shared ? addToLibrary : undefined}
		grammarEnabled={grammarOn}
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
				bind:this={previewEl}
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
				{@html rendered}
			</article>
		{:else if noteId && ytext}
			{#key noteId}
				<Editor {ytext} {noteId} editable={canWrite} />
			{/key}
			{#if grammarPanelOpen && grammarOn && canWrite}
				<GrammarPanel
					checking={grammarChecking}
					modelLoading={grammarModelState === 'loading'}
					modelProgress={grammarModelProgress}
					suggestions={grammarSuggestions}
					onApply={applyGrammarSuggestion}
					onDismiss={dismissGrammar}
				/>
			{/if}
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
