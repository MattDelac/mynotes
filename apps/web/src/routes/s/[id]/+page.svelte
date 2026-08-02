<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { renderMarkdown } from '$lib/markdown';
	import { parseShareFragment } from '$lib/shared';
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
		getSessionDoc,
		rememberCurrentNote,
		removeNote,
		type SessionDoc
	} from '$lib/sessions';
	import * as Y from 'yjs';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, sessionOwnerLink, sessionViewLink } from '$lib/share';
	import {
		availableEngines,
		createEngine,
		loadEngineChoice,
		saveEngineChoice
	} from '$lib/voice/engine';
	import type { VoiceEngine, VoiceEngineKind } from '$lib/voice/types';
	import { downloadNote } from '$lib/export';
	import Editor from '$lib/Editor.svelte';
	import {
		Copy,
		Download,
		Eye,
		FilePlus2,
		Link2,
		Mail,
		Menu,
		Mic,
		Pencil,
		Plus,
		RefreshCw,
		Square,
		Trash2,
		Upload,
		X
	} from 'lucide-svelte';
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
	let shareOpen = $state(false);
	let sharing = $state(false);
	let shareError = $state('');
	let copied = $state(false);
	let shareKind = $state<'view' | 'edit'>('view');
	let editor = $state<Editor | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let dictation = $state<VoiceEngine | null>(null);
	let dictating = $state(false);
	let voiceError = $state('');
	let voiceStatus = $state('');
	const engines = availableEngines();
	let engineKind = $state<VoiceEngineKind | null>(loadEngineChoice() ?? engines[0]?.kind ?? null);
	let sessionState = $state<SessionState | 'idle'>('idle');
	let collab: RoomSession | null = null;
	let textObserver: (() => void) | null = null;

	const title = $derived(noteTitle(content));
	const rendered = $derived(renderMarkdown(content));
	const canWrite = $derived(!data.shared || data.shared.owner);
	const activeShareLink = $derived(
		share ? (shareKind === 'edit' ? sessionOwnerLink(share) : sessionViewLink(share)) : ''
	);

	$effect(() => {
		if (!engineKind) return;
		dictation = createEngine(engineKind, {
			onText: insertAtCursor,
			onError: (message) => (voiceError = message),
			onActiveChange: (active) => {
				dictating = active;
				if (active) voiceError = '';
			},
			onProgress: (message) => (voiceStatus = message)
		});
	});

	function insertAtCursor(text: string) {
		editor?.insertAtCursor(text);
	}

	function toggleDictation() {
		if (!dictation) return;
		if (dictating) {
			dictation.stop();
		} else {
			voiceStatus = '';
			dictation.start();
		}
	}

	function chooseEngine(kind: VoiceEngineKind) {
		dictation?.stop();
		saveEngineChoice(kind);
		engineKind = kind;
	}

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
		history.replaceState(null, '', `${resolve(`/s/${sessionKey}`)}?n=${id}`);
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
			const fragment = parseShareFragment(location.hash);
			if (!fragment) return;
			const doc = await getSessionDoc(remoteId);
			if (cancelled) return;
			const room = new RoomSession({
				ydoc: doc.ydoc,
				roomId: remoteId,
				key: await importKey(fragment.key),
				editToken: fragment.editToken,
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
		sharing = true;
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
		} finally {
			sharing = false;
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
</script>

<div class="shell">
	<header>
		{#if data.shared && !data.shared.owner}
			<span class="title">Shared session (read-only)</span>
			<span class="sync" class:sync-error={sessionState === 'offline'}>
				{sessionState === 'live'
					? 'live'
					: sessionState === 'connecting'
						? 'connecting…'
						: 'offline'}
			</span>
		{:else}
			<button
				class="icon menu-btn"
				aria-label="Toggle note list"
				title="Notes"
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				<Menu size={18} />
			</button>
			<span class="title">{title}</span>
			{#if share || data.shared}
				<span class="sync" class:sync-error={sessionState === 'offline'}>
					{sessionState === 'live'
						? 'live'
						: sessionState === 'connecting'
							? 'connecting…'
							: 'offline'}
				</span>
			{/if}
			{#if engines.length > 0}
				<button
					class="icon"
					class:recording={dictating}
					aria-label="Toggle dictation"
					title={voiceError || voiceStatus || 'Dictate'}
					disabled={!dictation}
					onclick={toggleDictation}
				>
					{#if dictating}<Square size={18} />{:else}<Mic size={18} />{/if}
				</button>
				{#if engines.length > 1}
					<select
						class="engine"
						aria-label="Speech engine"
						title="Speech recognition engine"
						value={engineKind}
						onchange={(e) => chooseEngine(e.currentTarget.value as VoiceEngineKind)}
					>
						{#each engines as engine (engine.kind)}
							<option value={engine.kind}>{engine.label}</option>
						{/each}
					</select>
				{/if}
			{:else}
				<button
					class="icon"
					aria-label="Dictation unavailable"
					title="Dictation needs Chrome/Edge/Safari (Web Speech) or a WebGPU browser (on-device)"
					disabled
				>
					<Mic size={18} />
				</button>
			{/if}
			<button
				class="icon"
				aria-label="Export note"
				title="Export current note as markdown file"
				onclick={exportNote}
			>
				<Download size={18} />
			</button>
			<button
				class="icon"
				aria-label="Import note"
				title="Import a markdown file as a new note"
				onclick={() => fileInput?.click()}
			>
				<Upload size={18} />
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".md,.markdown,.txt,text/markdown,text/plain"
				hidden
				onchange={importFile}
			/>
			{#if !data.shared}
				<button
					class="icon"
					aria-label="Share session"
					title="Share this session"
					disabled={sharing}
					onclick={shareSession}
				>
					{#if share}<RefreshCw size={18} />{:else}<Link2 size={18} />{/if}
				</button>
				<button
					class="icon"
					aria-label="Start empty session"
					title="Start an empty session"
					onclick={startEmptySession}
				>
					<FilePlus2 size={18} />
				</button>
			{/if}
			<button
				class="icon"
				aria-label="Toggle preview"
				title="Toggle markdown preview"
				onclick={() => (preview = !preview)}
			>
				{#if preview}<Pencil size={18} />{:else}<Eye size={18} />{/if}
			</button>
		{/if}
	</header>

	{#if shareOpen && share}
		<div class="sharebar">
			<select class="share-kind" aria-label="Link type" bind:value={shareKind}>
				<option value="view">Read only</option>
				<option value="edit">Edit</option>
			</select>
			<input readonly value={activeShareLink} aria-label="Share link" />
			<button class="text-btn" title="Copy link" onclick={() => copyLink(activeShareLink)}>
				<Copy size={15} />
				{copied ? 'Copied' : 'Copy'}
			</button>
			<button
				class="text-btn"
				title="Email link"
				onclick={() => email(activeShareLink, shareKind === 'edit')}
			>
				<Mail size={15} />
				Email
			</button>
			<button
				class="icon"
				aria-label="Close share panel"
				title="Close share panel"
				onclick={() => (shareOpen = false)}
			>
				<X size={16} />
			</button>
		</div>
		{#if shareKind === 'edit'}
			<div class="share-warning">Anyone with this link can edit all notes in this session.</div>
		{/if}
	{/if}
	{#if shareError}
		<div class="error">{shareError}</div>
	{/if}
	{#if voiceError}
		<div class="error">Dictation: {voiceError}</div>
	{:else if voiceStatus}
		<div class="status">{voiceStatus}</div>
	{/if}

	<div class="body">
		<aside class:open={sidebarOpen || Boolean(data.shared)}>
			{#if canWrite}
				<button class="new" onclick={newNote} title="Create a new note">
					<Plus size={15} />
					New note
				</button>
			{/if}
			<ul>
				{#each notes as n (n.id)}
					<li class:active={n.id === noteId}>
						<a
							href={resolve(`/s/${docId()}?n=${n.id}`)}
							onclick={(e) => {
								e.preventDefault();
								selectNote(n.id);
							}}>{noteTitle(n.content)}</a
						>
						{#if canWrite}
							<button
								class="delete"
								aria-label="Delete note"
								title="Delete note"
								onclick={() => removeNoteById(n.id)}
							>
								<Trash2 size={14} />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</aside>

		<main>
			{#if preview}
				<article class="preview">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
					{@html rendered}
				</article>
			{:else if noteId && ytext}
				{#key noteId}
					<Editor bind:this={editor} {ytext} editable={canWrite} />
				{/key}
			{/if}
		</main>
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		font-size: 0.95rem;
		padding-left: 0.25rem;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease;
	}
	.icon:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	.icon:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon.recording {
		color: var(--danger);
	}
	.sharebar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-subtle);
	}
	.sharebar input {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.share-kind {
		font-size: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 0.4rem 0.4rem;
		flex-shrink: 0;
	}
	.share-warning {
		padding: 0.4rem 1rem;
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 0.8rem;
	}
	.text-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		font-size: 0.85rem;
		padding: 0.4rem 0.7rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.text-btn:hover {
		background: var(--bg-hover);
	}
	.error {
		padding: 0.5rem 1rem;
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 0.85rem;
	}
	.status {
		padding: 0.5rem 1rem;
		background: var(--info-soft);
		color: var(--fg-muted);
		font-size: 0.85rem;
	}
	.engine {
		font-size: 0.8rem;
		max-width: 9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 0.25rem 0.4rem;
	}
	.sync {
		font-size: 0.75rem;
		color: var(--success);
		white-space: nowrap;
		padding: 0 0.25rem;
	}
	.sync.sync-error {
		color: var(--danger);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	aside {
		width: 15rem;
		border-right: 1px solid var(--border);
		background: var(--bg-subtle);
		overflow-y: auto;
		padding: 0.75rem 0.5rem;
	}
	.new {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		width: 100%;
		padding: 0.45rem;
		margin-bottom: 0.5rem;
		cursor: pointer;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		font-size: 0.85rem;
	}
	.new:hover {
		background: var(--bg-hover);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: var(--radius);
	}
	li:hover {
		background: var(--bg-hover);
	}
	li.active {
		background: var(--bg-active);
	}
	li a {
		flex: 1;
		display: block;
		padding: 0.45rem 0.6rem;
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}
	.delete {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		margin-right: 0.25rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		color: var(--fg-muted);
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	li:hover .delete,
	.delete:focus-visible {
		opacity: 1;
	}
	.delete:hover {
		color: var(--danger);
		background: var(--bg-active);
	}
	main {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.preview {
		flex: 1;
		overflow-y: auto;
		width: 100%;
		max-width: calc(var(--content-width) + 2rem);
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
	@media (min-width: 641px) {
		.menu-btn {
			display: none;
		}
	}
	@media (max-width: 640px) {
		aside {
			display: none;
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			z-index: 10;
			width: 14rem;
			background: var(--bg);
			box-shadow: var(--shadow);
		}
		aside.open {
			display: block;
		}
		.body {
			position: relative;
		}
	}
</style>
