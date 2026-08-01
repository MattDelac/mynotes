<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { listNotes, saveNote, deleteNote, createNote, noteTitle, type Note } from '$lib/db';
	import { debounce } from '$lib/debounce';
	import { mailtoLink, shareNote, viewLink } from '$lib/share';
	import { createDictation, dictationSupported, type Dictation } from '$lib/voice';
	import { downloadNote } from '$lib/export';
	import { transcript } from '$lib/chat-store.svelte';
	import Chat from '$lib/Chat.svelte';
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
	let chatOpen = $state(false);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let dictation = $state<Dictation | null>(null);
	let dictating = $state(false);

	$effect(() => {
		if (dictationSupported() && !dictation) {
			dictation = createDictation(insertAtCursor, (active) => (dictating = active));
		}
	});

	function insertAtCursor(text: string) {
		if (!textarea) {
			note.content += text;
			persist();
			return;
		}
		const start = textarea.selectionStart ?? note.content.length;
		const end = textarea.selectionEnd ?? start;
		note.content = note.content.slice(0, start) + text + note.content.slice(end);
		const cursor = start + text.length;
		textarea.setSelectionRange(cursor, cursor);
		persist();
	}

	function toggleDictation() {
		if (!dictation) return;
		if (dictating) {
			dictation.stop();
		} else {
			dictation.start();
		}
	}

	function exportNote() {
		const extra = transcript();
		const ok = confirm(
			'This will export an unencrypted copy of the note' +
				(extra ? ' including the AI chat transcript' : '') +
				'. Continue?'
		);
		if (ok) {
			downloadNote(note, extra);
		}
	}

	const persist = debounce(async () => {
		note.updatedAt = Date.now();
		await saveNote(note);
		notes = await listNotes();
	}, 400);

	const rendered = $derived(
		DOMPurify.sanitize(
			marked.parse(data.shared ? data.shared.content : note.content, { async: false }) as string
		)
	);

	$effect(() => {
		listNotes().then((all) => (notes = all));
	});

	$effect(() => {
		if (data.note) {
			note = { ...data.note };
			preview = false;
			shareOpen = false;
		}
	});

	async function newNote() {
		const fresh = createNote();
		await saveNote(fresh);
		sidebarOpen = false;
		goto(resolve(`/n/${fresh.id}`));
	}

	async function removeNote(id: string) {
		await deleteNote(id);
		notes = await listNotes();
		if (id === note.id) {
			if (notes.length > 0) {
				goto(resolve(`/n/${notes[0].id}`));
			} else {
				const fresh = createNote();
				await saveNote(fresh);
				goto(resolve(`/n/${fresh.id}`));
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

	function onInput() {
		persist();
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
				☰
			</button>
			<span class="title">{noteTitle(note.content)}</span>
			{#if dictation}
				<button
					class="icon"
					class:recording={dictating}
					aria-label="Toggle dictation"
					onclick={toggleDictation}
				>
					{dictating ? '⏹' : '🎙'}
				</button>
			{/if}
			<button class="icon" aria-label="Export note" onclick={exportNote}>⬇</button>
			<button class="icon" aria-label="Toggle AI chat" onclick={() => (chatOpen = !chatOpen)}>
				💬
			</button>
			<button class="icon" aria-label="Share note" disabled={sharing} onclick={share}>
				{note.share ? '⇪' : '🔗'}
			</button>
			<button class="icon" aria-label="Toggle preview" onclick={() => (preview = !preview)}>
				{preview ? '✎' : '◉'}
			</button>
		{/if}
	</header>

	{#if shareOpen && note.share}
		<div class="sharebar">
			<input readonly value={viewLink(note.share)} aria-label="Share link" />
			<button onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
			<button onclick={email}>Email</button>
			<button aria-label="Close share panel" onclick={() => (shareOpen = false)}>×</button>
		</div>
	{/if}
	{#if shareError}
		<div class="error">{shareError}</div>
	{/if}

	<div class="body">
		{#if sidebarOpen && !data.shared}
			<aside>
				<button class="new" onclick={newNote}>+ New note</button>
				<ul>
					{#each notes as n (n.id)}
						<li class:active={n.id === note.id}>
							<a href={resolve(`/n/${n.id}`)} onclick={() => (sidebarOpen = false)}
								>{noteTitle(n.content)}</a
							>
							<button class="delete" aria-label="Delete note" onclick={() => removeNote(n.id)}>
								×
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
			{:else}
				<textarea
					bind:this={textarea}
					bind:value={note.content}
					oninput={onInput}
					placeholder="Start typing…"
					aria-label="Note"
				></textarea>
			{/if}
		</main>

		{#if chatOpen}
			<Chat noteContent={note.content} onclose={() => (chatOpen = false)} />
		{/if}
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
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e2e2e2;
	}
	.title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.icon {
		border: none;
		background: none;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}
	.icon.recording {
		color: #c00;
	}
	.sharebar {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e2e2e2;
		background: #f8f8f8;
	}
	.sharebar input {
		flex: 1;
		min-width: 0;
		font: inherit;
		padding: 0.25rem 0.5rem;
	}
	.sharebar button {
		cursor: pointer;
		padding: 0.25rem 0.75rem;
	}
	.error {
		padding: 0.5rem 0.75rem;
		background: #fee;
		color: #900;
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	aside {
		width: 16rem;
		border-right: 1px solid #e2e2e2;
		overflow-y: auto;
		padding: 0.5rem;
	}
	.new {
		width: 100%;
		padding: 0.5rem;
		margin-bottom: 0.5rem;
		cursor: pointer;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: 4px;
	}
	li.active {
		background: #f0f0f0;
	}
	li a {
		flex: 1;
		display: block;
		padding: 0.5rem;
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.delete {
		border: none;
		background: none;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		color: #999;
	}
	main {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	textarea {
		flex: 1;
		border: none;
		resize: none;
		padding: 1rem;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1.6;
		outline: none;
	}
	.preview {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		font-size: 1.1rem;
		line-height: 1.6;
	}
	@media (max-width: 640px) {
		aside {
			position: absolute;
			z-index: 10;
			background: white;
			height: 100%;
			box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
		}
	}
</style>
