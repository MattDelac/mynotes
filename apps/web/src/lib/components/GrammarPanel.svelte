<script lang="ts">
	import { SpellCheck, X } from '@lucide/svelte';
	import type { GrammarSuggestion } from '$lib/grammar';
	import type { ModelLoadProgress } from '$lib/grammar-model';

	let {
		checking,
		modelLoading,
		modelProgress,
		suggestions,
		onApply,
		onDismiss
	}: {
		checking: boolean;
		modelLoading: boolean;
		modelProgress: ModelLoadProgress;
		suggestions: GrammarSuggestion[];
		onApply: (suggestion: GrammarSuggestion) => void;
		onDismiss: () => void;
	} = $props();
</script>

<aside class="grammar" aria-label="Grammar suggestions">
	<header>
		<span class="title">
			<SpellCheck size={14} />
			Grammar
		</span>
		<button class="close" aria-label="Close grammar suggestions" onclick={onDismiss}>
			<X size={14} />
		</button>
	</header>
	<div class="body">
		{#if modelLoading}
			<p class="hint">
				{#if modelProgress.percent !== null}
					Loading model… {Math.round(modelProgress.percent * 100)}%
				{:else if modelProgress.loadedBytes > 0}
					Loading model… {Math.round(modelProgress.loadedBytes / 1048576)} MB
				{:else}
					Loading model…
				{/if}
			</p>
		{:else if checking}
			<p class="hint">Checking…</p>
		{:else if suggestions.length === 0}
			<p class="hint">No issues found.</p>
		{:else}
			<ul>
				{#each suggestions as suggestion (suggestion.from + ':' + suggestion.to)}
					<li>
						<button
							class="suggestion"
							onclick={() => onApply(suggestion)}
							aria-label="Replace {suggestion.original} with {suggestion.correction}"
						>
							<span class="original">{suggestion.original}</span>
							<span class="arrow" aria-hidden="true">→</span>
							<span class="correction">{suggestion.correction}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</aside>

<style>
	.grammar {
		width: 15rem;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-left: 1px solid var(--border);
		background: var(--bg-subtle);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem var(--space-2) 0.5rem var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.title {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.close {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.close:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2);
	}
	.hint {
		margin: 0;
		padding: var(--space-2);
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.suggestion {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-1);
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		font-size: 0.82rem;
		line-height: 1.45;
		text-align: left;
		color: var(--fg);
		cursor: pointer;
	}
	.suggestion:hover {
		background: var(--bg-hover);
		border-color: var(--fg-muted);
	}
	.original {
		color: var(--fg-muted);
		text-decoration: line-through;
		text-decoration-color: var(--danger);
	}
	.arrow {
		color: var(--fg-muted);
	}
	.correction {
		color: var(--fg);
		font-weight: 500;
	}
	@media (max-width: 640px) {
		.grammar {
			position: fixed;
			top: var(--header-h);
			right: 0;
			bottom: 0;
			width: min(100%, 19rem);
			border-left: 1px solid var(--border);
			box-shadow: var(--shadow);
			z-index: 40;
		}
	}
</style>
