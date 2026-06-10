import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadProject } from './config';
import { check, refresh, bless, update, affected, ls, exitCode } from './ops';
import { tmp, write, read, initRepo, commitAll, git } from './testutil';

// Integration contract for the operations (tooling.md section 1 against the
// format in format.md): check reports the four states without writing;
// refresh rewrites only fences; bless advances only pin shas and only for
// explicit paths; update pins cross-repo revs in the lockfile; affected maps
// working-tree changes to endangered carriers. The defining rule throughout:
// the tool moves carriers in and out of stale-snippet on its own and never
// out of stale-claim or broken.

let cacheDir: string;
beforeAll(() => {
	cacheDir = tmp('docref-cache-');
	process.env.DOCREF_CACHE = cacheDir;
});
afterAll(() => {
	delete process.env.DOCREF_CACHE;
});

const LIB_TS = [
	'export function greet(name: string): string {',
	"\treturn 'hi ' + name;",
	'}',
	'',
	'export function area(r: number): number {',
	'\t// docref: begin pi-part',
	'\tconst pi = 3.14159;',
	'\t// docref: end pi-part',
	'\treturn pi * r * r;',
	'}',
	''
].join('\n');

function sameRepoProject(): string {
	const root = tmp();
	write(root, 'src/lib.ts', LIB_TS);
	write(
		root,
		'docs/page.md',
		['# Page', '', '```ts docref=src/lib.ts#greet', '```', '', '```ts docref=src/lib.ts#@pi-part', '```', ''].join(
			'\n'
		)
	);
	return root;
}

describe('refresh: materializing fences', () => {
	it('fills bodies and shas, after which check is fresh and refresh idempotent', async () => {
		const root = sameRepoProject();
		const r1 = await refresh(loadProject(root));
		expect(r1.changedDocs).toEqual(['docs/page.md']);

		const doc = read(root, 'docs/page.md');
		expect(doc).toContain("return 'hi ' + name;");
		expect(doc).toContain('const pi = 3.14159;');
		expect(doc).toMatch(/docref=src\/lib\.ts#greet sha=[0-9a-f]{8}/);

		const report = await check(loadProject(root));
		expect(report.summary).toEqual({ fresh: 2, staleSnippet: 0, staleClaim: 0, broken: 0 });
		expect(exitCode(report)).toBe(0);

		const r2 = await refresh(loadProject(root));
		expect(r2.changedDocs).toEqual([]);
		expect(read(root, 'docs/page.md')).toBe(doc);
	});

	it('detects a hand-edited fence body and restores it', async () => {
		const root = sameRepoProject();
		await refresh(loadProject(root));
		write(root, 'docs/page.md', read(root, 'docs/page.md').replace("'hi ' + name", "'yo ' + name"));

		const report = await check(loadProject(root));
		expect(report.summary.staleSnippet).toBe(1);
		expect(exitCode(report)).toBe(1);

		await refresh(loadProject(root));
		expect(read(root, 'docs/page.md')).toContain("'hi ' + name");
		expect(exitCode(await check(loadProject(root)))).toBe(0);
	});

	it('goes stale when the source changes and only the touched anchor is stale', async () => {
		const root = sameRepoProject();
		await refresh(loadProject(root));
		write(root, 'src/lib.ts', LIB_TS.replace("'hi ' + name", "'hello ' + name"));

		const report = await check(loadProject(root));
		expect(report.summary.staleSnippet).toBe(1);
		expect(report.summary.fresh).toBe(1);
		const stale = report.entries.find((e) => e.state === 'stale-snippet');
		expect(stale?.ref).toBe('src/lib.ts#greet');
		expect(stale?.pinned).not.toBe(stale?.current);

		await refresh(loadProject(root));
		expect(read(root, 'docs/page.md')).toContain("'hello ' + name");
	});

	it('survives bodies that contain fences (lengthened fence round-trips)', async () => {
		const root = tmp();
		write(root, 'src/example.md', '<!-- docref: begin demo -->\n```js\nrun()\n```\n<!-- docref: end demo -->\n');
		write(root, 'docs/page.md', '```md docref=src/example.md#@demo\n```\n');
		await refresh(loadProject(root));
		const report = await check(loadProject(root));
		expect(report.errors).toEqual([]);
		expect(report.summary.fresh).toBe(1);
		expect(read(root, 'docs/page.md')).toContain('run()');
	});
});

describe('pins: stale-claim and bless', () => {
	function pinProject(): string {
		const root = tmp();
		write(root, 'src/lib.ts', LIB_TS);
		write(
			root,
			'docs/claim.md',
			['<!-- docref: begin src=src/lib.ts#greet -->', 'Greets by name.', '<!-- docref: end -->', ''].join('\n')
		);
		return root;
	}

	it('an unblessed pin is stale-claim; bless makes it fresh; prose is never touched', async () => {
		const root = pinProject();
		let report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);
		expect(exitCode(report)).toBe(1);

		const b = await bless(loadProject(root), ['docs/claim.md']);
		expect(b.blessed).toBe(1);
		expect(read(root, 'docs/claim.md')).toContain('Greets by name.');
		expect(read(root, 'docs/claim.md')).toMatch(/begin src=src\/lib\.ts#greet sha=[0-9a-f]{8}/);

		report = await check(loadProject(root));
		expect(report.summary).toEqual({ fresh: 1, staleSnippet: 0, staleClaim: 0, broken: 0 });
	});

	it('a source change makes the pin stale-claim and refresh must NOT clear it', async () => {
		const root = pinProject();
		await bless(loadProject(root), ['docs/claim.md']);
		write(root, 'src/lib.ts', LIB_TS.replace("'hi ' + name", "'hello ' + name"));

		let report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);

		// the defining rule: refresh is mechanical and may not bless
		await refresh(loadProject(root));
		report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);

		await bless(loadProject(root), ['docs/claim.md']);
		expect(exitCode(await check(loadProject(root)))).toBe(0);
	});

	it('bless refuses a broken pin and writes nothing', async () => {
		const root = tmp();
		write(root, 'docs/claim.md', '<!-- docref: begin src=src/gone.ts#x -->\np\n<!-- docref: end -->\n');
		const before = read(root, 'docs/claim.md');
		const b = await bless(loadProject(root), ['docs/claim.md']);
		expect(b.blessed).toBe(0);
		expect(b.refused).toHaveLength(1);
		expect(read(root, 'docs/claim.md')).toBe(before);
	});
});

describe('broken refs and scan errors', () => {
	it('a ref to a missing file is broken: exit 2', async () => {
		const root = tmp();
		write(root, 'docs/page.md', '```ts docref=src/gone.ts#x\n```\n');
		const report = await check(loadProject(root));
		expect(report.summary.broken).toBe(1);
		expect(exitCode(report)).toBe(2);
	});

	it('a nested pin is a scan error: exit 2', async () => {
		const root = tmp();
		write(
			root,
			'docs/page.md',
			['<!-- docref: begin src=a.ts -->', '<!-- docref: begin src=b.ts -->', '<!-- docref: end -->', '<!-- docref: end -->', ''].join('\n')
		);
		const report = await check(loadProject(root));
		expect(report.errors.length).toBeGreaterThan(0);
		expect(exitCode(report)).toBe(2);
	});

	it('an undeclared alias is broken: exit 2', async () => {
		const root = tmp();
		write(root, 'docs/page.md', '```ts docref=ghost:src/a.ts#x\n```\n');
		const report = await check(loadProject(root));
		expect(report.summary.broken).toBe(1);
		expect(report.entries[0]?.reason).toContain('alias');
	});
});

describe('scan config', () => {
	it('respects [scan] include', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[scan]\ninclude = ["docs/**/*.md"]\n');
		write(root, 'docs/ok.md', 'no carriers\n');
		write(root, 'drafts/broken.md', '```ts docref=src/gone.ts#x\n```\n');
		const report = await check(loadProject(root));
		expect(report.summary.broken).toBe(0);
		expect(exitCode(report)).toBe(0);
	});
});

describe('ls: the reverse index', () => {
	it('groups carriers by ref', async () => {
		const root = sameRepoProject();
		const index = await ls(loadProject(root));
		const refs = index.refs.map((r) => r.ref).sort();
		expect(refs).toEqual(['src/lib.ts#@pi-part', 'src/lib.ts#greet']);
		expect(index.refs[0]?.locations[0]?.doc).toBe('docs/page.md');
	});
});

describe('affected: mapping changes to carriers', () => {
	it('lists carriers whose anchor overlaps the diff, and broken ones', async () => {
		const root = tmp();
		initRepo(root);
		write(
			root,
			'src/calc.ts',
			[
				'export function add(a: number, b: number): number {',
				'\treturn a + b;',
				'}',
				'',
				'export function sub(a: number, b: number): number {',
				'\treturn a - b;',
				'}',
				''
			].join('\n')
		);
		write(
			root,
			'docs/calc.md',
			[
				'```ts docref=src/calc.ts#add',
				'```',
				'```ts docref=src/calc.ts#sub',
				'```',
				'<!-- docref: begin src=src/calc.ts -->',
				'Whole-file claim.',
				'<!-- docref: end -->',
				''
			].join('\n')
		);
		commitAll(root, 'base');

		// edit inside add only
		write(root, 'src/calc.ts', read(root, 'src/calc.ts').replace('a + b', 'b + a'));
		let result = await affected(loadProject(root), 'HEAD');
		let refs = result.entries.map((e) => e.ref).sort();
		expect(refs).toEqual(['src/calc.ts', 'src/calc.ts#add']);

		// rename sub away: its carrier must surface as broken-by-this-change
		write(root, 'src/calc.ts', read(root, 'src/calc.ts').replace(/sub/g, 'mul'));
		result = await affected(loadProject(root), 'HEAD');
		refs = result.entries.map((e) => e.ref).sort();
		expect(refs).toEqual(['src/calc.ts', 'src/calc.ts#add', 'src/calc.ts#sub']);
		expect(result.entries.find((e) => e.ref === 'src/calc.ts#sub')?.reason).toBe('broken');
	});
});

describe('cross-repo: lock, update, pinned resolution', () => {
	function remoteFixture(): { remote: string; root: string } {
		const remote = tmp('docref-remote-');
		initRepo(remote);
		write(remote, 'src/handler.go', 'package api\n\nfunc Verify(sig []byte) bool {\n\treturn false\n}\n');
		commitAll(remote, 'v1');

		const root = tmp();
		write(root, 'docref.toml', `[repos.lib]\nurl = "file://${remote}"\n`);
		write(
			root,
			'docs/x.md',
			[
				'```go docref=lib:src/handler.go#Verify',
				'```',
				'<!-- docref: begin src=lib:src/handler.go#Verify -->',
				'Claim about Verify.',
				'<!-- docref: end -->',
				''
			].join('\n')
		);
		return { remote, root };
	}

	it('declared but unlocked alias fails closed until update; update pins and materializes', async () => {
		const { remote, root } = remoteFixture();

		let report = await check(loadProject(root));
		expect(report.summary.broken).toBe(2);
		expect(exitCode(report)).toBe(2);

		const u = await update(loadProject(root));
		expect(u.changed).toHaveLength(1);
		expect(u.changed[0]?.alias).toBe('lib');
		const tip = git(remote, 'rev-parse', 'HEAD').trim();
		expect(u.changed[0]?.to).toBe(tip);
		expect(read(root, 'docref.lock')).toContain(tip);
		expect(read(root, 'docs/x.md')).toContain('func Verify');

		await bless(loadProject(root), ['docs/x.md']);
		expect(exitCode(await check(loadProject(root)))).toBe(0);

		// the remote moves on; pinned refs stay fresh until update
		write(remote, 'src/handler.go', 'package api\n\nfunc Verify(sig []byte) bool {\n\treturn true\n}\n');
		commitAll(remote, 'v2');
		expect(exitCode(await check(loadProject(root)))).toBe(0);

		// dry run: reports drift against the new tip, writes nothing
		const lockBefore = read(root, 'docref.lock');
		const docBefore = read(root, 'docs/x.md');
		const dry = await update(loadProject(root), { checkOnly: true });
		expect(dry.changed[0]?.to).toBe(git(remote, 'rev-parse', 'HEAD').trim());
		expect(dry.report.summary.staleSnippet).toBe(1);
		expect(dry.report.summary.staleClaim).toBe(1);
		expect(read(root, 'docref.lock')).toBe(lockBefore);
		expect(read(root, 'docs/x.md')).toBe(docBefore);

		// real update: advances the lock, refreshes the fence, claim stays stale
		const u2 = await update(loadProject(root));
		expect(read(root, 'docref.lock')).toContain(u2.changed[0]!.to);
		expect(read(root, 'docs/x.md')).toContain('return true');
		expect(u2.report.summary.staleClaim).toBe(1);
		expect(u2.report.summary.staleSnippet).toBe(0);
	});
});
