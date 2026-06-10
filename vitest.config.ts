import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/*/src/**/*.test.ts'],
		// git fixture setup and wasm grammar loading need headroom
		testTimeout: 20000
	}
});
