import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testMatch: /screenshots\.spec\.ts/,
	timeout: 60_000,
	fullyParallel: false,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'off',
		video: 'off',
		screenshot: 'off'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'corepack pnpm build && corepack pnpm preview',
			url: 'http://localhost:4173',
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: 'cargo run --manifest-path ../../api/Cargo.toml',
			url: 'http://localhost:3000/healthz',
			reuseExistingServer: !process.env.CI,
			timeout: 300_000,
			env: { DATABASE_URL: 'sqlite:/tmp/mynotes-e2e.db' }
		}
	]
});
