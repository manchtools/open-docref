import { describe, it, expect } from 'vitest';
import { scanMarkdown, rewriteFences, blessPins, type FenceCarrier, type PinCarrier } from './markdown';

// Contract (format.md sections 3 and 4): snippet fences are code blocks
// whose info string carries docref= (required) and sha= (tool-written);
// pin blocks are <!-- docref: begin key=value... --> ... <!-- docref: end -->.
// Fences nested in longer example fences are content, not carriers. Pins do
// not nest. The name form (region marker in a markdown source file) is not
// a carrier. Malformed carriers are hard errors.

const SHA = 'aabbccdd';

function fences(text: string): FenceCarrier[] {
	return scanMarkdown(text).carriers.filter((c): c is FenceCarrier => c.kind === 'fence');
}
function pins(text: string): PinCarrier[] {
	return scanMarkdown(text).carriers.filter((c): c is PinCarrier => c.kind === 'pin');
}

describe('scanMarkdown: snippet fences', () => {
	it('finds a fence carrier and captures language, ref, sha, and body', () => {
		const doc = [
			'# Title',
			'',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'const x = 1;',
			'const y = 2;',
			'```',
			''
		].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(carriers).toHaveLength(1);
		const f = carriers[0] as FenceCarrier;
		expect(f.kind).toBe('fence');
		expect(f.language).toBe('ts');
		expect(f.ref).toBe('src/a.ts#foo');
		expect(f.sha).toBe(SHA);
		expect(f.body).toBe('const x = 1;\nconst y = 2;');
		expect(f.openLine).toBe(3);
		expect(f.closeLine).toBe(6);
	});

	it('ignores ordinary fences without docref=', () => {
		expect(fences('```ts\ncode\n```\n')).toHaveLength(0);
	});

	it('accepts attributes in any order and preserves unknown tokens', () => {
		const doc = `\`\`\`go sha=${SHA} highlight=2 docref=src/a.go#X\ncode\n\`\`\`\n`;
		const f = fences(doc)[0]!;
		expect(f.ref).toBe('src/a.go#X');
		expect(f.sha).toBe(SHA);
		expect(f.tokens).toContain('highlight=2');
	});

	it('treats a missing sha as never-refreshed (sha undefined), not an error', () => {
		const doc = '```ts docref=src/a.ts#foo\n```\n';
		const { errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(fences(doc)[0]!.sha).toBeUndefined();
	});

	it('does not treat example fences inside longer fences as carriers', () => {
		// the README documents docref with a ts fence inside a markdown fence
		const doc = [
			'````markdown',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'code',
			'```',
			'````'
		].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(carriers).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('supports tilde fences', () => {
		const doc = `~~~py docref=src/a.py#run sha=${SHA}\npass\n~~~\n`;
		expect(fences(doc)[0]!.fenceChar).toBe('~');
	});

	it('rejects a malformed sha attribute', () => {
		const doc = '```ts docref=src/a.ts#foo sha=XYZ\ncode\n```\n';
		const { carriers, errors } = scanMarkdown(doc);
		expect(carriers).toHaveLength(0);
		expect(errors.some((e) => e.code === 'malformed-carrier')).toBe(true);
	});

	it('rejects an unparseable ref', () => {
		const doc = `\`\`\`ts docref=/abs/path.ts#x sha=${SHA}\ncode\n\`\`\`\n`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-carrier')).toBe(true);
	});

	it('rejects an unclosed fence carrier', () => {
		const doc = `\`\`\`ts docref=src/a.ts#foo sha=${SHA}\ncode\n`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'unclosed-fence')).toBe(true);
	});
});

describe('scanMarkdown: pin blocks', () => {
	it('finds a pin block with src and sha', () => {
		const doc = [
			`<!-- docref: begin src=src/a.go#Verify sha=${SHA} -->`,
			'The handler rejects forged signatures.',
			'<!-- docref: end -->'
		].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		const p = carriers[0] as PinCarrier;
		expect(p.kind).toBe('pin');
		expect(p.ref).toBe('src/a.go#Verify');
		expect(p.sha).toBe(SHA);
		expect(p.openLine).toBe(1);
		expect(p.closeLine).toBe(3);
	});

	it('treats a pin without sha as unblessed, not malformed', () => {
		const doc = '<!-- docref: begin src=src/a.go#Verify -->\nprose\n<!-- docref: end -->';
		const { errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(pins(doc)[0]!.sha).toBeUndefined();
	});

	it('rejects a pin without src=', () => {
		const doc = `<!-- docref: begin sha=${SHA} -->\nprose\n<!-- docref: end -->`;
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-carrier')).toBe(true);
	});

	it('rejects mixed name/attribute argument tokens', () => {
		const doc = '<!-- docref: begin src=src/a.ts#x oops -->\nprose\n<!-- docref: end -->';
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'malformed-carrier')).toBe(true);
	});

	it('ignores the name form: a region marker in a markdown source file', () => {
		const doc = [
			'<!-- docref: begin nav-skeleton -->',
			'<nav>...</nav>',
			'<!-- docref: end nav-skeleton -->'
		].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(carriers).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('rejects nested pins', () => {
		const doc = [
			'<!-- docref: begin src=a.ts#x -->',
			'<!-- docref: begin src=b.ts#y -->',
			'<!-- docref: end -->',
			'<!-- docref: end -->'
		].join('\n');
		const { errors } = scanMarkdown(doc);
		expect(errors.some((e) => e.code === 'nested-pin')).toBe(true);
	});

	it('rejects an unclosed pin', () => {
		const { errors } = scanMarkdown('<!-- docref: begin src=a.ts#x -->\nprose\n');
		expect(errors.some((e) => e.code === 'unclosed-pin')).toBe(true);
	});

	it('rejects a bare end without a begin', () => {
		const { errors } = scanMarkdown('prose\n<!-- docref: end -->\n');
		expect(errors.some((e) => e.code === 'unmatched-pin-end')).toBe(true);
	});

	it('ignores pin syntax inside code fences', () => {
		const doc = ['```markdown', '<!-- docref: begin src=a.ts#x -->', '```'].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(carriers).toHaveLength(0);
		expect(errors).toEqual([]);
	});

	it('finds a fence inside a pin block as an independent carrier', () => {
		const doc = [
			`<!-- docref: begin src=src/a.ts#foo sha=${SHA} -->`,
			'Claim about foo.',
			'',
			`\`\`\`ts docref=src/a.ts#foo sha=${SHA}`,
			'code',
			'```',
			'<!-- docref: end -->'
		].join('\n');
		const { carriers, errors } = scanMarkdown(doc);
		expect(errors).toEqual([]);
		expect(carriers.map((c) => c.kind).sort()).toEqual(['fence', 'pin']);
		const pin = carriers.find((c) => c.kind === 'pin') as PinCarrier;
		expect(pin.closeLine).toBe(7);
	});
});

describe('rewriteFences', () => {
	it('replaces the body and writes sha after docref, preserving other tokens', () => {
		const doc = `before\n\`\`\`ts docref=src/a.ts#foo highlight=2\nold\n\`\`\`\nafter\n`;
		const f = fences(doc)[0]!;
		const out = rewriteFences(doc, [{ carrier: f, body: 'new line 1\nnew line 2', sha: SHA }]);
		expect(out).toContain(`\`\`\`ts docref=src/a.ts#foo sha=${SHA} highlight=2`);
		expect(out).toContain('new line 1\nnew line 2');
		expect(out).not.toContain('old');
		expect(out.startsWith('before\n')).toBe(true);
		expect(out.endsWith('after\n')).toBe(true);
	});

	it('updates an existing sha in place', () => {
		const doc = `\`\`\`ts docref=src/a.ts#foo sha=11111111\nold\n\`\`\`\n`;
		const out = rewriteFences(doc, [{ carrier: fences(doc)[0]!, body: 'new', sha: SHA }]);
		expect(out).toContain(`sha=${SHA}`);
		expect(out).not.toContain('sha=11111111');
	});

	it('lengthens the fence when the body itself contains a fence', () => {
		const doc = `\`\`\`md docref=src/ex.md#@demo sha=${SHA}\nx\n\`\`\`\n`;
		const body = '```js\nrun()\n```';
		const out = rewriteFences(doc, [{ carrier: fences(doc)[0]!, body, sha: SHA }]);
		// the rewritten doc must round-trip: one carrier, same body
		const { carriers, errors } = scanMarkdown(out);
		expect(errors).toEqual([]);
		expect(carriers).toHaveLength(1);
		expect((carriers[0] as FenceCarrier).body).toBe(body);
		expect((carriers[0] as FenceCarrier).fenceLen).toBeGreaterThanOrEqual(4);
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
		const [f1, f2] = fences(doc);
		const out = rewriteFences(doc, [
			{ carrier: f1!, body: 'ONE', sha: SHA },
			{ carrier: f2!, body: 'TWO', sha: SHA }
		]);
		const rescanned = fences(out);
		expect(rescanned[0]!.body).toBe('ONE');
		expect(rescanned[1]!.body).toBe('TWO');
		expect(out).toContain('mid');
	});
});

describe('blessPins', () => {
	it('writes sha on an unblessed pin without touching the prose', () => {
		const doc = '<!-- docref: begin src=src/a.go#Verify -->\nThe exact claim.\n<!-- docref: end -->\n';
		const out = blessPins(doc, [{ carrier: pins(doc)[0]!, sha: SHA }]);
		expect(out).toContain(`<!-- docref: begin src=src/a.go#Verify sha=${SHA} -->`);
		expect(out).toContain('The exact claim.');
	});

	it('advances an existing sha', () => {
		const doc = `<!-- docref: begin src=src/a.go#Verify sha=11111111 -->\np\n<!-- docref: end -->\n`;
		const out = blessPins(doc, [{ carrier: pins(doc)[0]!, sha: SHA }]);
		expect(out).toContain(`sha=${SHA}`);
		expect(out).not.toContain('sha=11111111');
	});
});
