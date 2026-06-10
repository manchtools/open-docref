import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, isMainEntry } from './main';
import { tmp, write, read } from '../../core/src/testutil';

// CLI contract (tooling.md section 1): exit 0 all up to date, 1 stale
// present, 2 broken or config/usage error. --json emits the machine
// report. approve demands explicit paths; affected demands --since.

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
		expect(parsed.summary.upToDate).toBe(1);
	});

	it('check exits 1 on stale references', async () => {
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

	it('approve without paths is a usage error', async () => {
		const res = await run(['approve'], project());
		expect(res.code).toBe(2);
	});

	it('affected without --since is a usage error', async () => {
		const res = await run(['affected'], project());
		expect(res.code).toBe(2);
	});

	it('diff shows what changed since a claim was approved', async () => {
		const root = tmp();
		const { execFileSync } = await import('node:child_process');
		const g = (...a: string[]) => execFileSync('git', a, { cwd: root });
		g('init', '-b', 'main');
		g('config', 'user.name', 't');
		g('config', 'user.email', 't@t');
		write(root, 'src/lib.ts', 'export function greet(): string {\n\treturn "hi";\n}\n');
		write(root, 'docs/c.md', '<!-- docref: begin src=src/lib.ts#greet -->\np\n<!-- docref: end -->\n');
		await run(['approve', 'docs/c.md'], root);
		g('add', '-A');
		g('commit', '-q', '-m', 'approved');
		write(root, 'src/lib.ts', read(root, 'src/lib.ts').replace('"hi"', '"hello"'));

		const res = await run(['diff'], root);
		expect(res.code).toBe(0);
		expect(res.out).toContain('src/lib.ts#greet');
		expect(res.out).toContain('-\treturn "hi";');
		expect(res.out).toContain('+\treturn "hello";');

		const json = await run(['diff', '--json'], root);
		const parsed = JSON.parse(json.out);
		expect(parsed.entries[0].approvedRev).toMatch(/^[0-9a-f]{40}$/);
	});

	it('anchors lists region markers with a not-used flag', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', '// docref: begin spare\nconst s = 1;\n// docref: end spare\n');
		const res = await run(['anchors'], root);
		expect(res.code).toBe(0);
		expect(res.out).toContain('not used');
		expect(res.out).toContain('src/lib.ts#@spare');

		const json = await run(['anchors', '--json'], root);
		expect(JSON.parse(json.out).anchors[0]).toMatchObject({ name: 'spare', references: [] });
	});

	it('anchors exits 2 on marker errors', async () => {
		const root = tmp();
		write(root, 'src/broken.ts', '// docref: begin lonely\n');
		expect((await run(['anchors'], root)).code).toBe(2);
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
