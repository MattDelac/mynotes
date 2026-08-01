<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { renderMarkdown } from '$lib/markdown';
	import { fetchSharedContent, SHARED_POLL_INTERVAL_MS } from '$lib/shared';
	import { listNotes, saveNote, deleteNote, createNote, noteTitle, type Note } from '$lib/db';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, shareNote, syncShared, viewLink } from '$lib/share';
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
		Mail,
		Menu,
		Mic,
		Pencil,
		Plus,
		RefreshCw,
		Share2,
		Square,
		Trash2,
		Upload,
		X
	} from 'lucide-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let note = $state<Note>({ id: '', content: '', createdAt: 0, updatedAt: 0 });
	let notes = $state<Note[]>([]);
	let preview = $state(false);
	let sidebarOpen = $state(false);
	let shareOpen = $state(false);
	let sharing = $state(false);
	let shareError = $state('');
	let copied = $state(false);
	let editor = $state<Editor | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let dictation = $state<VoiceEngine | null>(null);
	let dictating = $state(false);
	let voiceError = $state('');
	let voiceStatus = $state('');
	const engines = availableEngines();
	let engineKind = $state<VoiceEngineKind | null>(loadEngineChoice() ?? engines[0]?.kind ?? null);

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
			downloadNote(note);
		}
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const fresh = createNote();
		fresh.content = await file.text();
		await saveNote(fresh);
		input.value = '';
		await goto(resolve(`/n/${fresh.id}`));
	}

	const persist = debounce(async () => {
		note.updatedAt = Date.now();
		await saveNote(note);
		notes = await listNotes();
	}, 400);

	let syncState = $state<'idle' | 'pending' | 'syncing' | 'synced' | 'error'>('idle');

	const syncRemote = debounce(async () => {
		if (!note.share) return;
		syncState = 'syncing';
		try {
			await syncShared(note);
			syncState = 'synced';
		} catch {
			syncState = 'error';
		}
	}, 5000);

	let sharedContent = $state('');

	const rendered = $derived(renderMarkdown(data.shared ? sharedContent : note.content));

	$effect(() => {
		if (!data.shared) return;
		sharedContent = data.shared.content;
		const remoteId = data.shared.remoteId;
		const timer = setInterval(async () => {
			try {
				const fresh = await fetchSharedContent(remoteId, location.hash);
				if (fresh.content !== sharedContent) {
					sharedContent = fresh.content;
				}
			} catch {
				// keep showing the last known content on transient failures
			}
		}, SHARED_POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	});

	$effect(() => {
		listNotes().then((all) => (notes = all));
	});

	$effect(() => {
		if (data.note) {
			note = { ...data.note };
			preview = false;
			shareOpen = false;
			syncState = data.note.share ? 'synced' : 'idle';
		}
	});

	async function newNote() {
		const fresh = createNote();
		await saveNote(fresh);
		sidebarOpen = false;
		await goto(resolve(`/n/${fresh.id}`));
	}

	async function removeNote(id: string) {
		await deleteNote(id);
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
		sharing = true;
		shareError = '';
		try {
			note.share = await shareNote(note);
			await saveNote(note);
			shareOpen = true;
			syncState = 'synced';
		} catch (e) {
			shareError = e instanceof Error ? e.message : 'share failed';
		} finally {
			sharing = false;
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
</script>

<div class="shell">
	<header>
		{#if data.shared}
			<span class="title">Shared note (read-only)</span>
		{:else}
			<button
				class="icon"
				aria-label="Toggle note list"
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				<Menu size={18} />
			</button>
			<span class="title">{noteTitle(note.content)}</span>
			{#if note.share}
				<span
					class="sync"
					class:sync-error={syncState === 'error'}
					title={syncState === 'error' ? 'sync failed' : 'shared'}
				>
					{syncState === 'syncing'
						? 'syncing…'
						: syncState === 'pending'
							? 'pending…'
							: syncState === 'error'
								? 'sync failed'
								: 'shared ✓'}
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
						value={engineKind}
						onchange={(e) => chooseEngine(e.currentTarget.value as VoiceEngineKind)}
					>
						{#each engines as engine (engine.kind)}
							<option value={engine.kind}>{engine.label}</option>
						{/each}
					</select>
				{/if}
			{/if}
			<button class="icon" aria-label="Export note" onclick={exportNote}>
				<Download size={18} />
			</button>
			<button class="icon" aria-label="Import note" onclick={() => fileInput?.click()}>
				<Upload size={18} />
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".md,.markdown,.txt,text/markdown,text/plain"
				hidden
				onchange={importFile}
			/>
			<button class="icon" aria-label="Share note" disabled={sharing} onclick={share}>
				{#if note.share}<RefreshCw size={18} />{:else}<Share2 size={18} />{/if}
			</button>
			<button class="icon" aria-label="Toggle preview" onclick={() => (preview = !preview)}>
				{#if preview}<Pencil size={18} />{:else}<Eye size={18} />{/if}
			</button>
		{/if}
	</header>

	{#if shareOpen && note.share}
		<div class="sharebar">
			<input readonly value={viewLink(note.share)} aria-label="Share link" />
			<button class="text-btn" onclick={copyLink}>
				<Copy size={15} />
				{copied ? 'Copied' : 'Copy'}
			</button>
			<button class="text-btn" onclick={email}>
				<Mail size={15} />
				Email
			</button>
			<button class="icon" aria-label="Close share panel" onclick={() => (shareOpen = false)}>
				<X size={16} />
			</button>
		</div>
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
		{#if sidebarOpen && !data.shared}
			<aside>
				<button class="new" onclick={newNote}>
					<Plus size={15} />
					New note
				</button>
				<ul>
					{#each notes as n (n.id)}
						<li class:active={n.id === note.id}>
							<a href={resolve(`/n/${n.id}`)} onclick={() => (sidebarOpen = false)}
								>{noteTitle(n.content)}</a
							>
							<button class="delete" aria-label="Delete note" onclick={() => removeNote(n.id)}>
								<Trash2 size={14} />
							</button>
						</li>
					{/each}
				</ul>
			</aside>
		{/if}

		<main>
			{#if data.shared || preview}
				<article class="preview">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
					{@html rendered}
				</article>
			{:else if note.id}
				{#key note.id}
					<Editor
						bind:this={editor}
						value={note.content}
						onchange={(text) => {
							note.content = text;
							if (note.share) syncState = 'pending';
							persist();
							syncRemote();
						}}
					/>
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
	@media (max-width: 640px) {
		aside {
			position: absolute;
			z-index: 10;
			height: 100%;
			box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
		}
	}
</style>
