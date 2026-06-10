import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, isMainEntry } from './main';
import { tmp, write, read } from '../../core/src/testutil';

// CLI contract (tooling.md section 1): exit 0 all fresh, 1 stale present,
// 2 broken or config/usage error. --json emits the machine report. bless
// demands explicit paths; affected demands --since.

let cacheDir: string;
beforeAll(() => {
	cacheDir = tmp('docref-cache-');
	process.env.DOCREF_CACHE = cacheDir;
});
afterAll(() => {
	delete process.env.DOCREF_CACHE;
});

function project(): string {
	const root = tmp();
	write(root, 'src/lib.ts', 'export function greet(): string {\n\treturn "hi";\n}\n');
	write(root, 'docs/page.md', '```ts docref=src/lib.ts#greet\n```\n');
	return root;
}

describe('docref CLI', () => {
	it('refresh then check: exit 0 with a JSON report', async () => {
		const root = project();
		expect((await run(['refresh'], root)).code).toBe(0);
		const res = await run(['check', '--json'], root);
		expect(res.code).toBe(0);
		const parsed = JSON.parse(res.out);
		expect(parsed.summary.fresh).toBe(1);
	});

	it('check exits 1 on stale carriers', async () => {
		const root = project();
		await run(['refresh'], root);
		write(root, 'src/lib.ts', read(root, 'src/lib.ts').replace('"hi"', '"ho"'));
		expect((await run(['check'], root)).code).toBe(1);
	});

	it('check exits 2 on broken refs', async () => {
		const root = tmp();
		write(root, 'docs/page.md', '```ts docref=src/gone.ts#x\n```\n');
		const res = await run(['check'], root);
		expect(res.code).toBe(2);
		expect(res.out).toContain('broken');
	});

	it('bless without paths is a usage error', async () => {
		const res = await run(['bless'], project());
		expect(res.code).toBe(2);
	});

	it('affected without --since is a usage error', async () => {
		const res = await run(['affected'], project());
		expect(res.code).toBe(2);
	});

	it('unknown commands print usage and exit 2', async () => {
		const res = await run(['frobnicate'], project());
		expect(res.code).toBe(2);
		expect(res.out.toLowerCase()).toContain('usage');
	});
});

describe('isMainEntry: the bin guard', () => {
	// Package managers install bins as SYMLINKS (~/.bun/bin/docref,
	// node_modules/.bin/docref). The guard must follow them; comparing
	// raw paths makes the CLI a silent no-op that always exits 0.
	it('recognizes the module run directly', () => {
		const dir = tmp();
		const entry = join(dir, 'cli.js');
		writeFileSync(entry, '');
		expect(isMainEntry(entry, pathToFileURL(entry).href)).toBe(true);
	});

	it('recognizes the module run through a bin symlink', () => {
		const dir = tmp();
		const entry = join(dir, 'cli.js');
		writeFileSync(entry, '');
		const link = join(dir, 'docref');
		symlinkSync(entry, link);
		expect(isMainEntry(link, pathToFileURL(entry).href)).toBe(true);
	});

	it('stays false when the module is merely imported', () => {
		const dir = tmp();
		const entry = join(dir, 'cli.js');
		const other = join(dir, 'vitest.js');
		writeFileSync(entry, '');
		writeFileSync(other, '');
		expect(isMainEntry(other, pathToFileURL(entry).href)).toBe(false);
		expect(isMainEntry(undefined, pathToFileURL(entry).href)).toBe(false);
	});
});
