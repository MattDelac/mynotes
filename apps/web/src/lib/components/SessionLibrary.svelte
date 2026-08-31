<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { HousePlus, Plus, Trash2 } from '@lucide/svelte';
	import {
		clearOutbox,
		createSession,
		deleteNote,
		deleteSession,
		listNotes,
		noteTitle,
		saveSession,
		type Note,
		type Session
	} from '$lib/db';
	import { destroySessionDoc } from '$lib/sessions';
	import { forgetShareKey } from '$lib/shared';

	interface Props {
		sessions: Session[];
	}

	let { sessions }: Props = $props();

	let titles = new SvelteMap<string, string>();
	let recency = new SvelteMap<string, number>();
	let removed = new SvelteSet<string>();

	const visible = $derived(sessions.filter((s) => !removed.has(s.id)));

	async function refreshTitles() {
		const notes = await listNotes();
		const best = new SvelteMap<string, Note>();
		for (const note of notes) {
			if (note.sessionId && !best.has(note.sessionId)) best.set(note.sessionId, note);
		}
		titles.clear();
		recency.clear();
		for (const [id, note] of best) {
			titles.set(id, noteTitle(note.content));
			recency.set(id, note.updatedAt);
		}
	}

	onMount(() => {
		void refreshTitles();
	});

	function timeAgo(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	async function newSession() {
		const fresh = createSession();
		await saveSession(fresh);
		await goto(resolve(`/s/${fresh.id}`));
	}

	async function openSession(session: Session) {
		await goto(resolve(`/s/${session.id}`));
	}

	async function removeSession(session: Session) {
		const title = titles.get(session.id) ?? 'Untitled';
		if (!confirm(`Delete "${title}" and all its notes from this device?`)) return;
		const notes = await listNotes();
		await Promise.all(notes.filter((n) => n.sessionId === session.id).map((n) => deleteNote(n.id)));
		await clearOutbox(session.share?.remoteId ?? session.id);
		await destroySessionDoc(session.id);
		await deleteSession(session.id);
		if (session.share) forgetShareKey(session.share.remoteId);
		removed.add(session.id);
	}
</script>

<div class="library">
	<header>
		<h1>MyNotes</h1>
		<button class="new" onclick={() => void newSession()} aria-label="New session">
			<HousePlus size={16} />
			<span>New session</span>
		</button>
	</header>

	{#if visible.length === 0}
		<div class="empty">
			<p>No sessions yet.</p>
			<button class="new" onclick={() => void newSession()} aria-label="New session">
				<Plus size={16} />
				<span>New session</span>
			</button>
		</div>
	{:else}
		<ul>
			{#each visible as session (session.id)}
				<li>
					<button
						class="row"
						onclick={() => void openSession(session)}
						aria-label="Open session {titles.get(session.id) ?? 'Untitled'}"
					>
						<span class="row-title">{titles.get(session.id) ?? 'Untitled'}</span>
						{#if session.share && !session.share.editToken}
							<span class="badge">Read-only</span>
						{/if}
						<span class="row-time">{timeAgo(recency.get(session.id) ?? session.updatedAt)}</span>
					</button>
					<button
						class="delete"
						onclick={() => void removeSession(session)}
						aria-label="Delete session"
						title="Delete session"
					>
						<Trash2 size={14} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.library {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: calc(var(--header-h)) var(--space-3) var(--space-3);
	}
	header {
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}
	h1 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0;
	}
	.new {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: none;
		color: var(--fg);
		font-size: 0.85rem;
		padding: 0.4rem 0.7rem;
		cursor: pointer;
	}
	.new:hover {
		background: var(--bg-hover);
	}
	.empty {
		margin-top: 20vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		color: var(--fg-muted);
	}
	.empty p {
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 0.65rem var(--space-3);
		cursor: pointer;
		font-size: 0.9rem;
		color: var(--fg);
	}
	.row:hover {
		background: var(--bg-hover);
	}
	.row-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.badge {
		font-size: 0.7rem;
		color: var(--fg-muted);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		flex-shrink: 0;
	}
	.row-time {
		font-size: 0.75rem;
		color: var(--fg-muted);
		flex-shrink: 0;
	}
	.delete {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		color: var(--fg-muted);
		opacity: 0;
		flex-shrink: 0;
	}
	li:hover .delete,
	.delete:focus-visible {
		opacity: 1;
	}
	.delete:hover {
		color: var(--danger);
		background: var(--bg-active);
	}
</style>
