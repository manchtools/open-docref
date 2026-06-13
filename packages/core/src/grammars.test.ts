import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BY_EXT } from './languages';
import { listDeclarations } from './symbols';

// Self-discovering coverage guard, driven by the language registry. Adding a
// language to BY_EXT without wiring up its grammar (a missing/unbuilt wasm, a
// grammar not embedded in the compiled binary, or a registry edit that breaks
// the extension's grammar discovery) fails HERE, loudly, instead of silently at
// a user's runtime. A hardcoded list of languages would itself go stale; these
// checks read the registry so they cannot.

// distinct grammar `wasm` id -> a sample file extension that selects it
const grammars = new Map<string, string>();
for (const [ext, info] of Object.entries(BY_EXT)) {
	if (!grammars.has(info.wasm)) grammars.set(info.wasm, ext);
}

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('grammar coverage', () => {
	it('discovers a non-trivial set of grammars (guards against matching zero)', () => {
		expect(grammars.size).toBeGreaterThanOrEqual(16);
	});

	for (const [wasm, ext] of grammars) {
		it(`resolves and loads the ${wasm} grammar`, async () => {
			// empty source yields zero declarations; the point is that the wasm for
			// this registered language actually resolves and loads at all
			await expect(listDeclarations('', `probe.${ext}`)).resolves.toBeInstanceOf(Array);
		});
	}

	it('the standalone binary embeds every registered grammar', () => {
		// bun --compile embeds only statically-imported files; a grammar absent
		// from the GRAMMARS map cannot resolve in the binary even though it is
		// registered. Keyed by the wasm id (what the resolver is handed).
		const src = read('../../cli/src/standalone.ts');
		for (const wasm of grammars.keys()) {
			expect(src, `standalone GRAMMARS is missing "${wasm}"`).toMatch(
				new RegExp(`(^|[^\\w])${wasm}:`, 'm')
			);
		}
	});

	it("the extension copy step's discovery captures the whole registry", () => {
		// copy-ext-wasm.mjs discovers grammars from this exact regex over
		// languages.ts; pin that the regex still finds every registered wasm id so
		// a future reformat of the registry cannot silently drop grammars from the
		// shipped extension.
		const registry = read('./languages.ts');
		const discovered = new Set(
			[...registry.matchAll(/wasm:\s*'([^']+)'/g)].map((m) => m[1])
		);
		expect([...discovered].sort()).toEqual([...grammars.keys()].sort());
	});
});
