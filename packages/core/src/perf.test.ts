import { describe, it, expect } from 'vitest';
import { findSymbol, listDeclarations, symbolCacheStats } from './symbols';

// "Fast" is a contract of this tool, so it is guarded here deterministically
// (no wall-clock, no flake). The dominant cost is parsing a file; the invariant
// is that a document with many references into the same source parses it ONCE,
// not once per reference. If the per-file parse cache regresses, the parse
// count jumps and these fail. End-to-end wall-clock is the CI bench step
// (scripts/bench.mjs); this pins the algorithm.

describe('performance: the per-file parse cache', () => {
	it('parses a file once no matter how many references resolve into it', async () => {
		// unique content so the first touch is a guaranteed cache miss this run
		const src =
			'// perf-guard fixture 9f3a\n' +
			Array.from({ length: 40 }, (_, i) => `export function fn${i}() { return ${i}; }`).join('\n');

		const before = symbolCacheStats();
		const RESOLUTIONS = 400;
		for (let i = 0; i < RESOLUTIONS; i++) {
			await findSymbol(src, 'src/perf-guard.ts', `fn${i % 40}`);
		}
		const after = symbolCacheStats();

		// 400 resolutions into one unique file => exactly one parse, the rest hits
		expect(after.parses - before.parses).toBe(1);
		expect(after.hits - before.hits).toBe(RESOLUTIONS - 1);
	});

	it('re-parses only when content changes, and hits unchanged content', async () => {
		const v1 = '// perf-guard edit a\nexport function only() { return 1; }';
		const v2 = '// perf-guard edit b\nexport function only() { return 2; }';
		const a = symbolCacheStats();
		await listDeclarations(v1, 'src/edit.ts'); // miss
		await listDeclarations(v1, 'src/edit.ts'); // hit
		await listDeclarations(v2, 'src/edit.ts'); // miss: content changed
		const b = symbolCacheStats();
		expect(b.parses - a.parses).toBe(2);
		expect(b.hits - a.hits).toBe(1);
	});
});
