import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, isMainEntry, VERSION } from './main';
import { tmp, write, read, initRepo, commitAll, git } from '../../core/src/testutil';

// CLI contract (tooling.md section 1): exit 0 all up to date, 1 stale
// present, 2 broken or config/usage error. --json emits the machine
// report. approve demands explicit paths; affected demands --since.

describe('version', () => {
	const pkgVersion = JSON.parse(
		readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
	).version as string;

	it('VERSION is the single source of truth, matching package.json', () => {
		// pins the constant to the manifest so a release bump cannot desync them
		expect(VERSION).toBe(pkgVersion);
	});

	it('prints the version with --version and -v, exit 0', async () => {
		expect(await run(['--version'], process.cwd())).toEqual({ code: 0, out: pkgVersion });
		expect(await run(['-v'], process.cwd())).toEqual({ code: 0, out: pkgVersion });
	});

	it('every workspace package version moves in lockstep', () => {
		// core's version is otherwise dead (private, unpublished, nothing reads it);
		// this pins it — and the cli + vsix versions — so a release bump cannot
		// desync them. Self-discovering over the packages dir, not a hardcoded list.
		const root = fileURLToPath(new URL('../../..', import.meta.url));
		const versions = ['cli', 'core', 'vscode'].map(
			(p) => JSON.parse(readFileSync(join(root, 'packages', p, 'package.json'), 'utf8')).version as string
		);
		expect(versions.length).toBeGreaterThan(0);
		expect(new Set(versions).size).toBe(1); // all equal
		expect(versions[0]).toBe(VERSION);
	});
});

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

	describe('check gate levels (incremental adoption)', () => {
		const staleRoot = async () => {
			const root = project();
			await run(['refresh'], root);
			write(root, 'src/lib.ts', read(root, 'src/lib.ts').replace('"hi"', '"ho"'));
			return root;
		};
		const brokenRoot = () => {
			const root = tmp();
			write(root, 'docs/page.md', '```ts docref=src/gone.ts#x\n```\n');
			return root;
		};

		it('--lenient: drift does not gate (exit 0) but the report still names it', async () => {
			const res = await run(['check', '--lenient'], await staleRoot());
			expect(res.code).toBe(0);
			expect(res.out).toContain('stale-snippet');
			expect(res.out).toContain('lenient');
		});

		it('--lenient: a broken ref still fails closed (exit 2)', async () => {
			expect((await run(['check', '--lenient'], brokenRoot())).code).toBe(2);
		});

		it('--advisory: nothing gates, even a broken ref — but it is still reported', async () => {
			const res = await run(['check', '--advisory'], brokenRoot());
			expect(res.code).toBe(0);
			expect(res.out).toContain('broken');
			expect(res.out).toContain('advisory');
		});

		it('reads the level from [check] in docref.toml when no flag is given', async () => {
			const root = await staleRoot();
			write(root, 'docref.toml', '[check]\nlevel = "lenient"\n');
			expect((await run(['check'], root)).code).toBe(0);
		});

		it('a flag overrides the configured level', async () => {
			const root = await staleRoot();
			write(root, 'docref.toml', '[check]\nlevel = "advisory"\n');
			// config alone would exit 0; --strict forces the gate back on
			expect((await run(['check', '--strict'], root)).code).toBe(1);
		});

		it('two conflicting level flags is a usage error', async () => {
			expect((await run(['check', '--lenient', '--advisory'], project())).code).toBe(2);
		});
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

	it('claim emits a paste-ready block, sha computed, multi-source capable', async () => {
		const root = tmp();
		write(root, 'src/a.ts', 'export function alpha(): number {\n\treturn 1;\n}\n');
		write(root, 'src/b.ts', 'export function beta(): number {\n\treturn 2;\n}\n');
		const res = await run(['claim', 'src/a.ts#alpha', 'src/b.ts#beta'], root);
		expect(res.code).toBe(0);
		expect(res.out).toMatch(/src=src\/a\.ts#alpha:[0-9a-f]{8},src\/b\.ts#beta:[0-9a-f]{8}/);
		// appending the output to a doc yields a valid, scannable claim
		write(root, 'docs/d.md', res.out + '\n');
		expect((await run(['check', '--json'], root)).out).toContain('"staleClaim": 0');
	});

	it('snippet emits a materialized fence that is born up to date', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', 'export function greet(): string {\n\treturn "hi";\n}\n');
		const res = await run(['snippet', 'src/lib.ts#greet'], root);
		expect(res.code).toBe(0);
		expect(res.out).toMatch(/```ts docref=src\/lib\.ts#greet:[0-9a-f]{8}/);
		expect(res.out).toContain('return "hi";');
		write(root, 'docs/d.md', res.out + '\n');
		const check = await run(['check'], root);
		expect(check.code).toBe(0);
	});

	it('claim and snippet fail closed on refs that do not resolve', async () => {
		const root = tmp();
		expect((await run(['claim', 'src/gone.ts#x'], root)).code).toBe(2);
		expect((await run(['snippet', 'src/gone.ts#x'], root)).code).toBe(2);
		expect((await run(['snippet', 'a.ts#x', 'b.ts#y'], root)).code).toBe(2); // single source
		expect((await run(['claim'], root)).code).toBe(2);
	});

	it('remove deletes a reference everywhere', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', '// docref: begin bit\nconst x = 1;\n// docref: end bit\n');
		write(root, 'docs/d.md', '<!-- docref: begin src=src/lib.ts#@bit -->\nkept prose\n<!-- docref: end -->\n');
		const res = await run(['remove', 'src/lib.ts#@bit'], root);
		expect(res.code).toBe(0);
		expect(res.out).toContain('removed 1 reference(s)');
		expect(res.out).toContain('marker pair deleted');
		expect(read(root, 'docs/d.md')).toContain('kept prose');
		expect(read(root, 'docs/d.md')).not.toContain('docref');
		expect((await run(['check'], root)).code).toBe(0);
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

	it('check catches unused anchors', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', '// docref: begin spare\nconst s = 1;\n// docref: end spare\n');
		const res = await run(['check'], root);
		expect(res.code).toBe(1);
		expect(res.out).toContain('unused-anchor');
		expect(res.out).toContain('src/lib.ts#@spare');
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

describe('CLI dispatch: the commands the report family does not cover', () => {
	it('ls prints the reverse index and --json emits it', async () => {
		const root = project();
		await run(['refresh'], root);
		const res = await run(['ls'], root);
		expect(res.code).toBe(0);
		expect(res.out).toContain('src/lib.ts#greet');
		const json = await run(['ls', '--json'], root);
		expect(JSON.parse(json.out).refs[0].ref).toBe('src/lib.ts#greet');
	});

	it('suggest reports plainly when nothing is unanchored', async () => {
		const root = tmp();
		write(root, 'docs/x.md', '# just prose, no inline-code identifiers\n');
		const res = await run(['suggest'], root);
		expect(res.code).toBe(0);
		expect(res.out).toBe('no unanchored references found');
	});

	it('self-update on a node/source build explains it is binary-only, exit 2', async () => {
		const res = await run(['self-update'], project());
		expect(res.code).toBe(2);
		expect(res.out).toContain('package manager');
	});

	it('update of an undeclared alias surfaces the error as exit 2', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[scan]\ninclude = ["docs/**"]\n');
		const res = await run(['update', 'nope'], root);
		expect(res.code).toBe(2);
		expect(res.out).toContain('not declared');
	});

	it('update --check maps to checkOnly: reports drift, writes nothing; update then pins', async () => {
		const remote = tmp('docref-remote-');
		initRepo(remote);
		write(remote, 'src/h.go', 'package api\n\nfunc Verify() bool {\n\treturn false\n}\n');
		commitAll(remote, 'v1');
		const root = tmp();
		write(root, 'docref.toml', `[repos.lib]\nurl = "file://${remote}"\n`);
		write(
			root,
			'docs/x.md',
			['```go docref=lib:src/h.go#Verify', '```', ''].join('\n')
		);

		// establish the lock and materialize the snippet
		await run(['update'], root);
		expect(read(root, 'docs/x.md')).toContain('func Verify');

		// the remote moves on
		write(remote, 'src/h.go', 'package api\n\nfunc Verify() bool {\n\treturn true\n}\n');
		commitAll(remote, 'v2');

		const lockBefore = read(root, 'docref.lock');
		const docBefore = read(root, 'docs/x.md');
		const dry = await run(['update', '--check'], root);
		// proves --check reached the render branch with checkOnly true
		expect(dry.out).toContain('would pin');
		expect(dry.out).not.toContain('pinned');
		// and wrote nothing — byte-identical lock and doc
		expect(read(root, 'docref.lock')).toBe(lockBefore);
		expect(read(root, 'docs/x.md')).toBe(docBefore);

		const real = await run(['update'], root);
		expect(real.out).toContain('pinned');
		expect(real.out).not.toContain('would pin');
		expect(read(root, 'docref.lock')).not.toBe(lockBefore);
		expect(read(root, 'docs/x.md')).toContain('return true');
	});

	it('affected accepts the --since=<rev> form, and a value-less --since is a usage error', async () => {
		const root = tmp();
		initRepo(root);
		write(root, 'docs/x.md', '# x\n');
		commitAll(root, 'base');
		const rev = git(root, 'rev-parse', 'HEAD').trim();
		// =value form binds the rev (popValue hardening)
		expect((await run(['affected', `--since=${rev}`], root)).code).toBe(0);
		// a bare trailing --since has no value -> usage error, not undefined-bound
		expect((await run(['affected', '--since'], root)).code).toBe(2);
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
