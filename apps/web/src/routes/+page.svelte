<script lang="ts">
	let content = $state('');
</script>

<main>
	<textarea bind:value={content} placeholder="Start typing…" aria-label="Note" autofocus></textarea>
</main>

<style>
	main {
		height: 100dvh;
		margin: 0;
	}
	textarea {
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border: none;
		resize: none;
		padding: 1rem;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1.6;
		outline: none;
	}
</style>
