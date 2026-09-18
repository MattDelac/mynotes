import { defineConfig } from 'vitest/config';

export default defineConfig({
	tsconfig: './tsconfig.json',
	test: {
		include: ['test/**/*.test.ts'],
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 180_000
	}
});
