import { describe, it, expect } from 'vitest';
import { scanMarkdown, rewriteSnippets, approveClaims, type Snippet, type Claim } from './markdown';

// Contract (format.md sections 3 and 4): snippets are code blocks
// whose info string carries docref= (required) and sha= (tool-written);
// claims are <!-- docref: begin key=value... --> ... <!-- docref: end -->.
// Fences nested in longer example fences are content, not references.
// Claims do not nest. The name form (region marker in a markdown source
// file) is not a reference. Malformed references are hard errors.

const SHA = 'aabbccdd';

function snippets(text: string): Snippet[] {
	return scanMarkdown(text).references.filter((c): c is Snippet => c.kind === 'snippet');
}
function claims(text: string): Claim[] {
	return scanMarkdown(text).references.filter((c): c is Claim => c.kind === 'claim');
}

describe('scanMarkdown: snippets', () => {
	it('finds a snippet and captures language, ref, sha, and body', () => {
		const doc = [
			'# Title',
			'',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'const x = 1;',
			'const y = 2;',
			'```',
			''
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(references).toHaveLength(1);
		const f = references[0] as Snippet;
		expect(f.kind).toBe('snippet');
		expect(f.language).toBe('ts');
		expect(f.ref).toBe('src/a.ts#foo');
		expect(f.sha).toBe(SHA);
		expect(f.body).toBe('const x = 1;\nconst y = 2;');
		expect(f.openLine).toBe(3);
		expect(f.closeLine).toBe(6);
	});

	it('ignores ordinary fences without docref=', () => {
		expect(snippets('```ts\ncode\n```\n')).toHaveLength(0);
	});

	it('accepts attributes in any order and preserves unknown tokens', () => {
		const doc = `\`\`\`go sha=${SHA} highlight=2 docref=src/a.go#X\ncode\n\`\`\`\n`;
		const f = snippets(doc)[0]!;
		expect(f.ref).toBe('src/a.go#X');
		expect(f.sha).toBe(SHA);
		expect(f.tokens).toContain('highlight=2');
	});

	it('treats a missing sha as never-refreshed (sha undefined), not an error', () => {
		const doc = '```ts docref=src/a.ts#foo\n```\n';
		const { errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(snippets(doc)[0]!.sha).toBeUndefined();
	});

	it('does not treat example fences inside longer fences as snippets', () => {
		// the README documents docref with a ts fence inside a markdown fence
		const doc = [
			'````markdown',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'code',
			'```',
			'````'
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(references).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('supports tilde fences', () => {
		const doc = `~~~py docref=src/a.py#run sha=${SHA}\npass\n~~~\n`;
		expect(snippets(doc)[0]!.fenceChar).toBe('~');
	});

	it('rejects a malformed sha attribute', () => {
		const doc = '```ts docref=src/a.ts#foo sha=XYZ\ncode\n```\n';
		const { references, errors } = scanMarkdown(doc);
		expect(references).toHaveLength(0);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('rejects an unparseable ref', () => {
		const doc = `\`\`\`ts docref=/abs/path.ts#x sha=${SHA}\ncode\n\`\`\`\n`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('rejects an unclosed snippet', () => {
		const doc = `\`\`\`ts docref=src/a.ts#foo sha=${SHA}\ncode\n`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'unclosed-snippet')).toBe(true);
	});
});

describe('scanMarkdown: claims', () => {
	it('finds a claim with src and sha', () => {
		const doc = [
			`<!-- docref: begin src=src/a.go#Verify sha=${SHA} -->`,
			'The handler rejects forged signatures.',
			'<!-- docref: end -->'
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		const p = references[0] as Claim;
		expect(p.kind).toBe('claim');
		expect(p.ref).toBe('src/a.go#Verify');
		expect(p.sha).toBe(SHA);
		expect(p.openLine).toBe(1);
		expect(p.closeLine).toBe(3);
	});

	it('treats a claim without sha as unapproved, not malformed', () => {
		const doc = '<!-- docref: begin src=src/a.go#Verify -->\nprose\n<!-- docref: end -->';
		const { errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(claims(doc)[0]!.sha).toBeUndefined();
	});

	it('rejects a claim without src=', () => {
		const doc = `<!-- docref: begin sha=${SHA} -->\nprose\n<!-- docref: end -->`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('rejects mixed name/attribute argument tokens', () => {
		const doc = '<!-- docref: begin src=src/a.ts#x oops -->\nprose\n<!-- docref: end -->';
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('ignores the name form: a region marker in a markdown source file', () => {
		const doc = [
			'<!-- docref: begin nav-skeleton -->',
			'<nav>...</nav>',
			'<!-- docref: end nav-skeleton -->'
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(references).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('rejects nested claims', () => {
		const doc = [
			'<!-- docref: begin src=a.ts#x -->',
			'<!-- docref: begin src=b.ts#y -->',
			'<!-- docref: end -->',
			'<!-- docref: end -->'
		].join('\n');
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'nested-claim')).toBe(true);
	});

	it('rejects an unclosed claim', () => {
		const { errors } = scanMarkdown('<!-- docref: begin src=a.ts#x -->\nprose\n');
		expect(errors.some((e) => e.code === 'unclosed-claim')).toBe(true);
	});

	it('rejects a bare end without a begin', () => {
		const { errors } = scanMarkdown('prose\n<!-- docref: end -->\n');
		expect(errors.some((e) => e.code === 'unmatched-claim-end')).toBe(true);
	});

	it('ignores claim syntax inside code fences', () => {
		const doc = ['```markdown', '<!-- docref: begin src=a.ts#x -->', '```'].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(references).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('parses a multi-source claim: comma-separated refs, paired shas', () => {
		const doc = [
			'<!-- docref: begin src=src/Tabs.svelte#@props,src/Tab.svelte#@props sha=aabbccdd,11223344 -->',
			'Documents both components of the pair.',
			'<!-- docref: end -->'
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		const c = references[0] as Claim;
		expect(c.refs).toEqual(['src/Tabs.svelte#@props', 'src/Tab.svelte#@props']);
		expect(c.sha).toBe('aabbccdd,11223344');
	});

	it('a single-source claim still exposes refs', () => {
		const doc = '<!-- docref: begin src=src/a.go#Verify -->\np\n<!-- docref: end -->';
		expect(claims(doc)[0]!.refs).toEqual(['src/a.go#Verify']);
	});

	it('rejects a sha count that does not match the ref count', () => {
		const doc = [
			'<!-- docref: begin src=a.ts#x,b.ts#y sha=aabbccdd -->',
			'p',
			'<!-- docref: end -->'
		].join('\n');
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('rejects an invalid ref anywhere in the list', () => {
		const doc = '<!-- docref: begin src=a.ts#x,/abs.ts#y -->\np\n<!-- docref: end -->';
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('snippets stay single-source: a comma list is malformed there', () => {
		const doc = '```ts docref=a.ts#x,b.ts#y\n```\n';
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-reference')).toBe(true);
	});

	it('finds a snippet inside a claim as an independent reference', () => {
		const doc = [
			`<!-- docref: begin src=src/a.ts#foo sha=${SHA} -->`,
			'Claim about foo.',
			'',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'code',
			'```',
			'<!-- docref: end -->'
		].join('\n');
		const { references, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(references.map((c) => c.kind).sort()).toEqual(['claim', 'snippet']);
		const claim = references.find((c) => c.kind === 'claim') as Claim;
		expect(claim.closeLine).toBe(7);
	});
});

describe('rewriteSnippets', () => {
	it('replaces the body and writes sha after docref, preserving other tokens', () => {
		const doc = `before\n\`\`\`ts docref=src/a.ts#foo highlight=2\nold\n\`\`\`\nafter\n`;
		const f = snippets(doc)[0]!;
		const out = rewriteSnippets(doc, [{ carrier: f, body: 'new line 1\nnew line 2', sha: SHA }]);
		expect(out).toContain(`\`\`\`ts docref=src/a.ts#foo sha=${SHA} highlight=2`);
		expect(out).toContain('new line 1\nnew line 2');
		expect(out).not.toContain('old');
		expect(out.startsWith('before\n')).toBe(true);
		expect(out.endsWith('after\n')).toBe(true);
	});

	it('updates an existing sha in place', () => {
		const doc = `\`\`\`ts docref=src/a.ts#foo sha=11111111\nold\n\`\`\`\n`;
		const out = rewriteSnippets(doc, [{ carrier: snippets(doc)[0]!, body: 'new', sha: SHA }]);
		expect(out).toContain(`sha=${SHA}`);
		expect(out).not.toContain('sha=11111111');
	});

	it('lengthens the fence when the body itself contains a fence', () => {
		const doc = `\`\`\`md docref=src/ex.md#@demo sha=${SHA}\nx\n\`\`\`\n`;
		const body = '```js\nrun()\n```';
		const out = rewriteSnippets(doc, [{ carrier: snippets(doc)[0]!, body, sha: SHA }]);
		// the rewritten doc must round-trip: one carrier, same body
		const { references, errors } = scanMarkdown(out);
		expect(errors).toEqual([]);
		expect(references).toHaveLength(1);
		expect((references[0] as Snippet).body).toBe(body);
		expect((references[0] as Snippet).fenceLen).toBeGreaterThanOrEqual(4);
	});

	it('rewrites multiple fences in one document correctly', () => {
		const doc = [
			'```ts docref=src/a.ts#one',
			'o',
			'```',
			'mid',
			'```ts docref=src/a.ts#two',
			't',
			'```',
			''
		].join('\n');
		const [f1, f2] = snippets(doc);
		const out = rewriteSnippets(doc, [
			{ carrier: f1!, body: 'ONE', sha: SHA },
			{ carrier: f2!, body: 'TWO', sha: SHA }
		]);
		const rescanned = snippets(out);
		expect(rescanned[0]!.body).toBe('ONE');
		expect(rescanned[1]!.body).toBe('TWO');
		expect(out).toContain('mid');
	});
});

describe('approveClaims', () => {
	it('writes sha on an unapproved claim without touching the prose', () => {
		const doc = '<!-- docref: begin src=src/a.go#Verify -->\nThe exact claim.\n<!-- docref: end -->\n';
		const out = approveClaims(doc, [{ carrier: claims(doc)[0]!, sha: SHA }]);
		expect(out).toContain(`<!-- docref: begin src=src/a.go#Verify sha=${SHA} -->`);
		expect(out).toContain('The exact claim.');
	});

	it('advances an existing sha', () => {
		const doc = `<!-- docref: begin src=src/a.go#Verify sha=11111111 -->\np\n<!-- docref: end -->\n`;
		const out = approveClaims(doc, [{ carrier: claims(doc)[0]!, sha: SHA }]);
		expect(out).toContain(`sha=${SHA}`);
		expect(out).not.toContain('sha=11111111');
	});
});
