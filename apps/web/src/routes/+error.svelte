<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const message = $derived(
		page.error?.message ?? (page.status === 404 ? 'Page not found.' : 'Something went wrong.')
	);
</script>

<main class="error">
	<h1>{page.status}</h1>
	<p class="message">{message}</p>
	<a class="back" href={resolve('/')}>Back to my notes</a>
</main>

<style>
	.error {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		text-align: center;
		padding: var(--space-4);
	}
	.error h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 600;
		color: var(--fg);
	}
	.message {
		margin: 0;
		max-width: 28rem;
		color: var(--fg-muted);
		font-size: 0.95rem;
		line-height: 1.5;
	}
	.back {
		margin-top: var(--space-2);
		color: var(--fg);
		text-decoration: none;
		font-size: 0.9rem;
		padding: 0.5rem var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.back:hover {
		background: var(--bg-hover);
	}
</style>
