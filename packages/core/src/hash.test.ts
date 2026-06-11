import { describe, it, expect } from 'vitest';
import { contentHash, shortHash, stripWhitespace, hashesMatch } from './hash';

// Contract (format.md section 5): hash = sha256 of the UTF-8 bytes of the
// content with every Unicode White_Space code point removed. Carriers store
// an 8-hex prefix; longer prefixes are accepted when comparing. Formatter
// churn must never invalidate a hash; token changes always must.

describe('stripWhitespace', () => {
	it('removes every White_Space code point, including exotic ones', () => {
		// space, tab, LF, CR, NBSP, NEL, ideographic space, thin space
		expect(stripWhitespace('a b\tc\nd\re\u00a0f\u0085g\u3000h\u2009i')).toBe('abcdefghi');
	});

	it('keeps non-whitespace intact, including unicode identifiers', () => {
		expect(stripWhitespace('größe=10')).toBe('größe=10');
	});
});

describe('contentHash', () => {
	it('is a full lowercase sha256 hex digest', () => {
		expect(contentHash('abc')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is deterministic', () => {
		expect(contentHash('const a = 1;')).toBe(contentHash('const a = 1;'));
	});

	it('is formatter-insensitive: same tokens, any whitespace', () => {
		const compact = 'function add(a,b){return a+b;}';
		const pretty = 'function add(a, b) {\n\treturn a + b;\n}\n';
		expect(contentHash(pretty)).toBe(contentHash(compact));
	});

	it('changes when tokens change', () => {
		expect(contentHash('return a + b;')).not.toBe(contentHash('return a - b;'));
	});

	it('pins the documented blind spot: indentation-only changes hash equal', () => {
		// A Python statement moved out of a block by indentation alone is
		// invisible to the hash. format.md documents this as accepted.
		const inside = 'if x:\n    a()\n    b()\n';
		const outside = 'if x:\n    a()\nb()\n';
		expect(contentHash(inside)).toBe(contentHash(outside));
	});
});

describe('shortHash', () => {
	it('is the first 8 hex characters of the full hash', () => {
		const full = contentHash('xyz');
		expect(shortHash('xyz')).toBe(full.slice(0, 8));
		expect(shortHash('xyz')).toHaveLength(8);
	});
});

describe('hashesMatch', () => {
	const full = contentHash('content');
	const short = full.slice(0, 8);

	it('accepts the stored 8-hex prefix against the full hash, both ways', () => {
		expect(hashesMatch(short, full)).toBe(true);
		expect(hashesMatch(full, short)).toBe(true);
		expect(hashesMatch(full, full)).toBe(true);
	});

	it('accepts longer-than-8 prefixes', () => {
		expect(hashesMatch(full.slice(0, 16), full)).toBe(true);
	});

	it('rejects a mismatch', () => {
		expect(hashesMatch(contentHash('other').slice(0, 8), full)).toBe(false);
	});

	it('rejects absent and too-short values: never match on thin evidence', () => {
		expect(hashesMatch(undefined, full)).toBe(false);
		expect(hashesMatch('', full)).toBe(false);
		// a 3-char prefix would match 1 in 4096 hashes by chance
		expect(hashesMatch(full.slice(0, 3), full)).toBe(false);
	});

	it('compares case-insensitively (hex is hex)', () => {
		expect(hashesMatch(short.toUpperCase(), full)).toBe(true);
	});
});
