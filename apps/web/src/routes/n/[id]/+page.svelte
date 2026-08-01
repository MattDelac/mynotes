<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { listNotes, saveNote, deleteNote, createNote, noteTitle, type Note } from '$lib/db';
	import { debounce } from '$lib/debounce';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let note = $state<Note>({ id: '', content: '', createdAt: 0, updatedAt: 0 });
	let notes = $state<Note[]>([]);
	let preview = $state(false);
	let sidebarOpen = $state(false);

	const persist = debounce(async () => {
		note.updatedAt = Date.now();
		await saveNote(note);
		notes = await listNotes();
	}, 400);

	const rendered = $derived(
		preview ? DOMPurify.sanitize(marked.parse(note.content, { async: false }) as string) : ''
	);

	$effect(() => {
		listNotes().then((all) => (notes = all));
	});

	$effect(() => {
		note = { ...data.note };
		preview = false;
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

	function onInput() {
		persist();
	}
</script>

<div class="shell">
	<header>
		<button class="icon" aria-label="Toggle note list" onclick={() => (sidebarOpen = !sidebarOpen)}>
			☰
		</button>
		<span class="title">{noteTitle(note.content)}</span>
		<button class="icon" aria-label="Toggle preview" onclick={() => (preview = !preview)}>
			{preview ? '✎' : '◉'}
		</button>
	</header>

	<div class="body">
		{#if sidebarOpen}
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
			{#if preview}
				<article class="preview">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify above -->
					{@html rendered}
				</article>
			{:else}
				<textarea
					bind:value={note.content}
					oninput={onInput}
					placeholder="Start typing…"
					aria-label="Note"
				></textarea>
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
