import { describe, it, expect } from 'vitest';
import { parseRef } from './ref';
import { DocrefError } from './errors';

// Contract (format.md section 1): ref = [alias ":"] path ["#" fragment].
// Paths are repo-relative POSIX, no spaces, no leading "./". Fragments are
// either a symbol (identifier segments joined by ".") or "@" + kebab-case
// region name. Line numbers are deliberately not representable. Anything
// outside the grammar is a hard parse error, never a guess.

const bad = (raw: string) => () => parseRef(raw);

describe('parseRef: accepted forms', () => {
	it('same-repo symbol', () => {
		expect(parseRef('src/lib/server/markdown.ts#applyFootnotes')).toEqual({
			raw: 'src/lib/server/markdown.ts#applyFootnotes',
			path: 'src/lib/server/markdown.ts',
			fragment: { kind: 'symbol', name: 'applyFootnotes' }
		});
	});

	it('nested symbol', () => {
		expect(parseRef('src/api/handler.go#Server.VerifySignature').fragment).toEqual({
			kind: 'symbol',
			name: 'Server.VerifySignature'
		});
	});

	it('region with the @ sigil', () => {
		expect(parseRef('src/markdown.ts#@footnote-ordering').fragment).toEqual({
			kind: 'region',
			name: 'footnote-ordering'
		});
	});

	it('cross-repo alias', () => {
		const ref = parseRef('open-secret:src/api/handler.go#VerifySignature');
		expect(ref.alias).toBe('open-secret');
		expect(ref.path).toBe('src/api/handler.go');
	});

	it('whole file: no fragment', () => {
		const ref = parseRef('config/default.toml');
		expect(ref.fragment).toBeUndefined();
		expect(ref.alias).toBeUndefined();
	});

	it('symbol segments may use _, $ and digits after the first character', () => {
		expect(parseRef('a.js#_private.$el2').fragment).toEqual({
			kind: 'symbol',
			name: '_private.$el2'
		});
	});
});

describe('parseRef: rejected forms', () => {
	it('rejects empties', () => {
		expect(bad('')).toThrow(DocrefError);
		expect(bad('#foo')).toThrow(DocrefError);
		expect(bad(':src/a.ts#x')).toThrow(DocrefError);
	});

	it('rejects non-repo-relative paths', () => {
		expect(bad('./src/a.ts#x')).toThrow(DocrefError);
		expect(bad('/etc/passwd')).toThrow(DocrefError);
		expect(bad('src\\a.ts#x')).toThrow(DocrefError);
	});

	it('rejects traversal segments: a ref must not escape the repo', () => {
		expect(bad('../secrets.md')).toThrow(DocrefError);
		expect(bad('src/../../x.md')).toThrow(DocrefError);
	});

	it('rejects spaces in paths', () => {
		expect(bad('my docs/a.md')).toThrow(DocrefError);
	});

	it('rejects invalid aliases', () => {
		expect(bad('Open-Secret:src/a.go#X')).toThrow(DocrefError);
		expect(bad('-bad:src/a.go#X')).toThrow(DocrefError);
	});

	it('rejects empty or malformed fragments', () => {
		expect(bad('a.ts#')).toThrow(DocrefError);
		expect(bad('a.ts#@')).toThrow(DocrefError);
		expect(bad('a.ts#a..b')).toThrow(DocrefError);
		expect(bad('a.ts#9lives')).toThrow(DocrefError);
	});

	it('rejects region names that are not kebab-case', () => {
		expect(bad('a.ts#@Foo')).toThrow(DocrefError);
		expect(bad('a.ts#@foo_bar')).toThrow(DocrefError);
		expect(bad('a.ts#@-x')).toThrow(DocrefError);
	});

	it('rejects line-range style fragments: lines are not part of the grammar', () => {
		expect(bad('a.ts#L10-L20')).toThrow(DocrefError);
		expect(bad('a.ts#10')).toThrow(DocrefError);
	});
});
