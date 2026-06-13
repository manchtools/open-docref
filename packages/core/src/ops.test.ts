import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject } from './config';
import { check, refresh, approve, update, affected, ls, anchors, diff, remove, exitCode, suggest } from './ops';
import { tmp, write, read, initRepo, commitAll, git } from './testutil';

// Integration contract for the operations (tooling.md section 1 against the
// format in format.md): check reports the four states without writing;
// refresh rewrites only snippets; approve advances only claim shas and
// only for explicit paths; update pins cross-repo revs in the lockfile; affected maps
// working-tree changes to endangered references. The defining rule throughout:
// the tool moves references in and out of stale-snippet on its own and never
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

describe('refresh: materializing snippets', () => {
	it('fills bodies and shas, after which check is up to date and refresh idempotent', async () => {
		const root = sameRepoProject();
		const r1 = await refresh(loadProject(root));
		expect(r1.changedDocs).toEqual(['docs/page.md']);

		const doc = read(root, 'docs/page.md');
		expect(doc).toContain("return 'hi ' + name;");
		expect(doc).toContain('const pi = 3.14159;');
		expect(doc).toMatch(/docref=src\/lib\.ts#greet:[0-9a-f]{8}/);

		const report = await check(loadProject(root));
		expect(report.summary).toEqual({ upToDate: 2, staleSnippet: 0, staleClaim: 0, broken: 0 });
		expect(exitCode(report)).toBe(0);

		const r2 = await refresh(loadProject(root));
		expect(r2.changedDocs).toEqual([]);
		expect(read(root, 'docs/page.md')).toBe(doc);
	});

	it('detects a hand-edited snippet body and restores it', async () => {
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
		expect(report.summary.upToDate).toBe(1);
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
		expect(report.summary.upToDate).toBe(1);
		expect(read(root, 'docs/page.md')).toContain('run()');
	});
});

describe('claims: stale-claim and approve', () => {
	function claimProject(): string {
		const root = tmp();
		// LIB_TS declares pi-part, which these docs never reference
		write(root, 'docref.toml', '[anchors]\nallow-unused = true\n');
		write(root, 'src/lib.ts', LIB_TS);
		write(
			root,
			'docs/claim.md',
			['<!-- docref: begin src=src/lib.ts#greet -->', 'Greets by name.', '<!-- docref: end -->', ''].join('\n')
		);
		return root;
	}

	it('an unapproved claim is stale-claim; approve makes it up to date; prose is never touched', async () => {
		const root = claimProject();
		let report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);
		expect(exitCode(report)).toBe(1);

		const b = await approve(loadProject(root), ['docs/claim.md']);
		expect(b.approved).toBe(1);
		expect(read(root, 'docs/claim.md')).toContain('Greets by name.');
		expect(read(root, 'docs/claim.md')).toMatch(/begin src=src\/lib\.ts#greet:[0-9a-f]{8} -->/);

		report = await check(loadProject(root));
		expect(report.summary).toEqual({ upToDate: 1, staleSnippet: 0, staleClaim: 0, broken: 0 });
	});

	it('a source change makes the claim stale-claim and refresh must NOT clear it', async () => {
		const root = claimProject();
		await approve(loadProject(root), ['docs/claim.md']);
		write(root, 'src/lib.ts', LIB_TS.replace("'hi ' + name", "'hello ' + name"));

		let report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);

		// the defining rule: refresh is mechanical and may not approve
		await refresh(loadProject(root));
		report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);

		await approve(loadProject(root), ['docs/claim.md']);
		expect(exitCode(await check(loadProject(root)))).toBe(0);
	});

	it('approve refuses a broken claim and writes nothing', async () => {
		const root = tmp();
		write(root, 'docs/claim.md', '<!-- docref: begin src=src/gone.ts#x -->\np\n<!-- docref: end -->\n');
		const before = read(root, 'docs/claim.md');
		const b = await approve(loadProject(root), ['docs/claim.md']);
		expect(b.approved).toBe(0);
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

	it('a nested claim is a scan error: exit 2', async () => {
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
	it('lists references whose anchor overlaps the diff, and broken ones', async () => {
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

describe('anchors: the code-side inventory', () => {
	// The reverse view (tooling.md): every declared region marker in the
	// codebase, each flagged with its references or as not used. Symbols
	// are implicit anchors and deliberately not inventoried.

	it('lists every region marker with its references, flagging unused ones', async () => {
		const root = sameRepoProject(); // lib.ts declares pi-part; page.md references it
		write(root, 'src/lib.ts', read(root, 'src/lib.ts') + '// docref: begin spare\nconst s = 1;\n// docref: end spare\n');
		const result = await anchors(loadProject(root));
		expect(result.errors).toEqual([]);
		expect(result.anchors.map((a) => `${a.file}#@${a.name}`).sort()).toEqual([
			'src/lib.ts#@pi-part',
			'src/lib.ts#@spare'
		]);
		const pi = result.anchors.find((a) => a.name === 'pi-part')!;
		expect(pi.references).toEqual([{ doc: 'docs/page.md', line: 6, kind: 'snippet' }]);
		expect(result.anchors.find((a) => a.name === 'spare')!.references).toEqual([]);
	});

	it('surfaces marker errors even in files no carrier references', async () => {
		const root = tmp();
		write(root, 'src/broken.ts', '// docref: begin lonely\ncode\n');
		const result = await anchors(loadProject(root));
		expect(result.errors).toEqual([
			{ file: 'src/broken.ts', line: 1, code: 'unmatched-begin', message: expect.stringContaining('lonely') }
		]);
	});

	it('ignores marker examples inside markdown code fences', async () => {
		const root = tmp();
		write(
			root,
			'docs/spec.md',
			['```', '// docref: begin example-only', '```', '<!-- docref: begin real-md-region -->', 'x', '<!-- docref: end real-md-region -->', ''].join('\n')
		);
		const result = await anchors(loadProject(root));
		expect(result.errors).toEqual([]);
		expect(result.anchors.map((a) => a.name)).toEqual(['real-md-region']);
	});

	it('respects gitignore when the project is a git repo', async () => {
		const root = tmp();
		initRepo(root);
		write(root, '.gitignore', 'gen/\n');
		write(root, 'gen/copy.ts', '// docref: begin generated\nx\n// docref: end generated\n');
		write(root, 'src/s.ts', '// docref: begin real\nx\n// docref: end real\n');
		const result = await anchors(loadProject(root));
		expect(result.anchors.map((a) => a.name)).toEqual(['real']);
	});

	it('honors [anchors] exclude from docref.toml', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[anchors]\nexclude = ["vendor/**"]\n');
		write(root, 'vendor/v.ts', '// docref: begin vendored\nx\n// docref: end vendored\n');
		write(root, 'src/s.ts', '// docref: begin mine\nx\n// docref: end mine\n');
		const result = await anchors(loadProject(root));
		expect(result.anchors.map((a) => a.name)).toEqual(['mine']);
	});
});

describe('unused anchors fail the gate', () => {
	// A region marker is declared intent; if nothing references it, check
	// must say so (exit 1), not stay green. [anchors] allow-unused opts out.

	it('check reports an unused marker and exits 1', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', '// docref: begin spare\nconst s = 1;\n// docref: end spare\n');
		const report = await check(loadProject(root));
		expect(report.unusedAnchors).toEqual([
			{ file: 'src/lib.ts', name: 'spare', line: 1 }
		]);
		expect(exitCode(report)).toBe(1);
	});

	it('a referenced marker is not unused', async () => {
		const root = sameRepoProject(); // pi-part is referenced by docs/page.md
		const report = await check(loadProject(root));
		expect(report.unusedAnchors).toEqual([]);
	});

	it('allow-unused turns the gate green again', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[anchors]\nallow-unused = true\n');
		write(root, 'src/lib.ts', '// docref: begin spare\nconst s = 1;\n// docref: end spare\n');
		const report = await check(loadProject(root));
		expect(report.unusedAnchors).toEqual([]);
		expect(exitCode(report)).toBe(0);
	});
});

describe('multi-source claims', () => {
	function pairProject(): string {
		const root = tmp();
		write(root, 'src/a.ts', 'export function alpha(): number {\n\treturn 1;\n}\n');
		write(root, 'src/b.ts', 'export function beta(): number {\n\treturn 2;\n}\n');
		write(
			root,
			'docs/pair.md',
			['<!-- docref: begin src=src/a.ts#alpha,src/b.ts#beta -->', 'Both halves documented.', '<!-- docref: end -->', ''].join('\n')
		);
		return root;
	}

	it('approves all sources and stays up to date until ANY drifts', async () => {
		const root = pairProject();
		const a = await approve(loadProject(root), ['docs/pair.md']);
		expect(a.approved).toBe(1);
		expect(read(root, 'docs/pair.md')).toMatch(/#alpha:[0-9a-f]{8},src\/b\.ts#beta:[0-9a-f]{8}/);
		expect(exitCode(await check(loadProject(root)))).toBe(0);

		write(root, 'src/b.ts', 'export function beta(): number {\n\treturn 3;\n}\n');
		const report = await check(loadProject(root));
		expect(report.summary.staleClaim).toBe(1);

		await approve(loadProject(root), ['docs/pair.md']);
		expect(exitCode(await check(loadProject(root)))).toBe(0);
	});

	it('is broken when any source fails to resolve, and approve refuses', async () => {
		const root = pairProject();
		write(root, 'src/b.ts', 'export function gamma(): number {\n\treturn 3;\n}\n');
		const report = await check(loadProject(root));
		expect(report.summary.broken).toBe(1);
		const a = await approve(loadProject(root), ['docs/pair.md']);
		expect(a.approved).toBe(0);
		expect(a.refused).toHaveLength(1);
	});

	it('ls and anchors index every source of the claim', async () => {
		const root = pairProject();
		write(root, 'src/c.ts', '// docref: begin extra\nx\n// docref: end extra\n');
		const index = await ls(loadProject(root));
		expect(index.refs.map((r) => r.ref).sort()).toEqual(['src/a.ts#alpha', 'src/b.ts#beta']);

		write(
			root,
			'docs/more.md',
			['<!-- docref: begin src=src/c.ts#@extra,src/a.ts#alpha -->', 'p', '<!-- docref: end -->', ''].join('\n')
		);
		const result = await anchors(loadProject(root));
		expect(result.anchors.find((x) => x.name === 'extra')?.references).toHaveLength(1);
	});
});

describe('remove: delete a reference everywhere', () => {
	function tracedProject(): string {
		const root = tmp();
		write(
			root,
			'src/lib.ts',
			['export function greet(): string {', '\t// docref: begin core-bit', '\tconst x = 1;', '\t// docref: end core-bit', '\treturn "hi";', '}', ''].join('\n')
		);
		write(
			root,
			'docs/a.md',
			['# A', '', '```ts docref=src/lib.ts#@core-bit', 'const x = 1;', '```', '', '<!-- docref: begin src=src/lib.ts#@core-bit:aabbccdd -->', 'The prose stays.', '<!-- docref: end -->', ''].join('\n')
		);
		return root;
	}

	it('removes the snippet, the claim comments (prose kept), and the marker', async () => {
		const root = tracedProject();
		const result = await remove(loadProject(root), 'src/lib.ts#@core-bit');
		expect(result.referencesRemoved).toBe(2);
		expect(result.markersRemoved).toBe(1);
		expect(result.docsChanged).toEqual(['docs/a.md']);

		const doc = read(root, 'docs/a.md');
		expect(doc).not.toContain('docref');
		expect(doc).not.toContain('const x = 1;'); // the fence was tool-owned
		expect(doc).toContain('The prose stays.');
		expect(read(root, 'src/lib.ts')).not.toContain('docref');
		// nothing left: no carriers, no anchors, gate clean
		const report = await check(loadProject(root));
		expect(report.entries).toEqual([]);
		expect(report.unusedAnchors).toEqual([]);
	});

	it('drops only the named source from a multi-source claim', async () => {
		const root = tmp();
		write(root, 'src/a.ts', 'export function alpha(): number {\n\treturn 1;\n}\n');
		write(root, 'src/b.ts', 'export function beta(): number {\n\treturn 2;\n}\n');
		write(
			root,
			'docs/pair.md',
			['<!-- docref: begin src=src/a.ts#alpha:11111111,src/b.ts#beta:22222222 -->', 'p', '<!-- docref: end -->', ''].join('\n')
		);
		const result = await remove(loadProject(root), 'src/a.ts#alpha');
		expect(result.referencesRemoved).toBe(1);
		const doc = read(root, 'docs/pair.md');
		expect(doc).toContain('src=src/b.ts#beta:22222222');
		expect(doc).not.toContain('alpha');
		expect(doc).toContain('<!-- docref: end -->');
	});

	it('accepts a ref with a sha suffix and treats it as the bare ref', async () => {
		const root = tracedProject();
		const result = await remove(loadProject(root), 'src/lib.ts#@core-bit:aabbccdd');
		expect(result.referencesRemoved).toBe(2);
	});

	it('does nothing for a ref referenced nowhere', async () => {
		const root = tracedProject();
		const before = read(root, 'docs/a.md');
		const result = await remove(loadProject(root), 'src/lib.ts#greet');
		expect(result.referencesRemoved).toBe(0);
		expect(result.markersRemoved).toBe(0);
		expect(read(root, 'docs/a.md')).toBe(before);
	});
});

describe('diff: recovering what the approver saw', () => {
	// A claim stores only the hash, so the approved content comes from git:
	// walk the anchored file's history until a revision's anchor matches the
	// recorded sha. Snippets are excluded (their stale body IS the old code).

	const V1 = 'export function greet(): string {\n\treturn "hi";\n}\n';
	function gitProject(): string {
		const root = tmp();
		initRepo(root);
		write(root, 'src/lib.ts', V1);
		write(
			root,
			'docs/claim.md',
			['<!-- docref: begin src=src/lib.ts#greet -->', 'Greets tersely.', '<!-- docref: end -->', ''].join('\n')
		);
		return root;
	}

	it('finds the approved revision and returns both sides', async () => {
		const root = gitProject();
		await approve(loadProject(root), ['docs/claim.md']);
		const rev = commitAll(root, 'approved state');
		write(root, 'src/lib.ts', V1.replace('"hi"', '"hello"'));

		const { entries } = await diff(loadProject(root));
		expect(entries).toHaveLength(1);
		const e = entries[0]!;
		expect(e.ref).toBe('src/lib.ts#greet');
		expect(e.approvedRev).toBe(rev);
		expect(e.approvedContent).toContain('"hi"');
		expect(e.currentContent).toContain('"hello"');
	});

	it('walks past newer commits to the matching revision', async () => {
		const root = gitProject();
		await approve(loadProject(root), ['docs/claim.md']);
		const approvedAt = commitAll(root, 'v1 approved');
		write(root, 'src/lib.ts', V1.replace('"hi"', '"hey"'));
		commitAll(root, 'v2');
		write(root, 'src/lib.ts', V1.replace('"hi"', '"hello"'));
		commitAll(root, 'v3');

		const { entries } = await diff(loadProject(root));
		expect(entries[0]?.approvedRev).toBe(approvedAt);
		expect(entries[0]?.approvedContent).toContain('"hi"');
		expect(entries[0]?.currentContent).toContain('"hello"');
	});

	it('reports a never-approved claim instead of guessing', async () => {
		const root = gitProject();
		commitAll(root, 'base');
		const { entries } = await diff(loadProject(root));
		expect(entries[0]?.approvedRev).toBeUndefined();
		expect(entries[0]?.note).toContain('never approved');
	});

	it('reports missing history outside a git repository', async () => {
		const root = tmp();
		write(root, 'src/lib.ts', V1);
		write(
			root,
			'docs/claim.md',
			['<!-- docref: begin src=src/lib.ts#greet -->', 'p', '<!-- docref: end -->', ''].join('\n')
		);
		await approve(loadProject(root), ['docs/claim.md']);
		write(root, 'src/lib.ts', V1.replace('"hi"', '"hello"'));
		const { entries } = await diff(loadProject(root));
		expect(entries[0]?.approvedRev).toBeUndefined();
		expect(entries[0]?.note).toContain('history');
	});

	it('still recovers the approved side when the anchor is now broken', async () => {
		const root = gitProject();
		await approve(loadProject(root), ['docs/claim.md']);
		commitAll(root, 'approved');
		write(root, 'src/lib.ts', V1.replace(/greet/g, 'salute'));

		const { entries } = await diff(loadProject(root));
		expect(entries[0]?.approvedContent).toContain('"hi"');
		expect(entries[0]?.currentContent).toBeUndefined();
		expect(entries[0]?.note).toBeTruthy();
	});

	it('excludes snippets and up-to-date claims', async () => {
		const root = gitProject();
		write(root, 'docs/snip.md', '```ts docref=src/lib.ts#greet\n```\n');
		await approve(loadProject(root), ['docs/claim.md']);
		commitAll(root, 'approved');
		// snippet is stale (never refreshed), claim is up to date
		const { entries } = await diff(loadProject(root));
		expect(entries).toEqual([]);
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

		await approve(loadProject(root), ['docs/x.md']);
		expect(exitCode(await check(loadProject(root)))).toBe(0);

		// the remote moves on; pinned refs stay up to date until update
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

	it('fails closed at load on a poisoned lock rev instead of running git on it', () => {
		const { remote, root } = remoteFixture();
		// a malicious PR could ship a docref.lock whose rev is a git option;
		// without validation `git fetch origin --upload-pack=<cmd>` would run
		// <cmd>. loadProject rejects it before anything touches git.
		const sentinel = join(root, 'PWNED');
		write(root, 'docref.lock', `[repos.lib]\nrev = "--upload-pack=touch ${sentinel}"\n`);

		expect(() => loadProject(root)).toThrow(/unsafe git revision/);
		expect(existsSync(sentinel)).toBe(false); // nothing was executed
		// the remote still exists and was never reached
		expect(read(remote, 'src/handler.go')).toContain('func Verify');
	});

	it('refuses an ext:: url and an option-shaped tracked ref at load', () => {
		const evil = tmp();
		write(evil, 'docref.toml', '[repos.lib]\nurl = "ext::sh -c \'touch /tmp/docref-pwned\'"\n');
		expect(() => loadProject(evil)).toThrow(/unsafe repo url/);

		const evil2 = tmp();
		write(evil2, 'docref.toml', '[repos.lib]\nurl = "file:///tmp/x"\nref = "--upload-pack=touch /tmp/y"\n');
		expect(() => loadProject(evil2)).toThrow(/unsafe git ref/);
	});
});

describe('suggest: candidate unanchored claims', () => {
	it('flags prose naming a resolvable symbol, but not anchored or unrelated mentions', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[anchors]\nallow-unused = true\n');
		write(root, 'src/lib.ts', 'export function greet(n){return n}\nexport function farewell(n){return n}\n');
		write(
			root,
			'docs/x.md',
			[
				'# Doc',
				'',
				'The `greet` helper returns a greeting.', // unanchored mention -> suggest
				'',
				'<!-- docref: begin src=src/lib.ts#farewell -->',
				'The `farewell` helper is documented here.', // inside a claim -> not suggested
				'<!-- docref: end -->',
				'',
				'Some prose about `nothing` in particular.', // no such symbol -> not suggested
				'',
				'```ts',
				'`greet` in a code fence is not prose', // inside a fence -> not suggested
				'```',
				''
			].join('\n')
		);

		const { suggestions } = await suggest(loadProject(root));
		expect(suggestions).toEqual([
			{ doc: 'docs/x.md', line: 3, identifier: 'greet', refs: ['src/lib.ts#greet'] }
		]);
	});

	it('also matches region markers by name', async () => {
		const root = tmp();
		write(root, 'docref.toml', '[anchors]\nallow-unused = true\n');
		write(root, 'src/q.sql', '-- docref: begin tenant-scope\nWHERE tenant = $1\n-- docref: end tenant-scope\n');
		write(root, 'docs/y.md', '# Y\n\nThe `tenant-scope` clause isolates tenants.\n');
		const { suggestions } = await suggest(loadProject(root));
		expect(suggestions).toEqual([
			{ doc: 'docs/y.md', line: 3, identifier: 'tenant-scope', refs: ['src/q.sql#@tenant-scope'] }
		]);
	});

	it('flags a qualified Message.field / Class.method mention, the form wire-contract prose uses', async () => {
		// the suggester indexed only leaf names, so prose that qualified a member
		// — `CreateRequest.shares`, the exact form a proto wire contract is written
		// in — never matched, even though `#CreateRequest.shares` resolves. A bare
		// `shares` would also be ambiguous across messages; the qualified path is
		// the unambiguous, anchorable-as-written form.
		const root = tmp();
		write(root, 'docref.toml', '[anchors]\nallow-unused = true\n');
		write(
			root,
			'api.proto',
			'syntax = "proto3";\nmessage CreateRequest {\n  repeated string shares = 1;\n}\nmessage Share {\n  string shares = 1;\n}\n'
		);
		write(root, 'docs/wire.md', '# Wire\n\nEach `CreateRequest.shares` entry is a share id.\n');
		const { suggestions } = await suggest(loadProject(root));
		// `shares` is a leaf in two messages (ambiguous), so only the qualified
		// path is anchorable — and it now surfaces
		expect(suggestions).toContainEqual({
			doc: 'docs/wire.md',
			line: 3,
			identifier: 'CreateRequest.shares',
			refs: ['api.proto#CreateRequest.shares']
		});
	});
});
