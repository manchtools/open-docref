import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { assertRev, assertRef, assertUrl, cacheDirFor, ensureCommit } from './gitcache';
import { DocrefError } from './errors';
import { tmp, git } from './testutil';

// Contract: rev, ref, and url are read from committed config (docref.lock,
// docref.toml) and handed to the system `git` as positional arguments. git
// parses any leading-dash positional as an OPTION regardless of position, so
// a value like "--upload-pack=<cmd>" turns a fetch into arbitrary command
// execution; a "transport::address" url (ext::, fd::) runs a remote helper.
// These validators are the fail-closed boundary: only shapes that cannot be
// re-interpreted by git as an option or a code-executing transport pass.
//
// Each validator returns its input unchanged on success and throws a
// DocrefError (so the caller marks the reference broken, never runs git) on
// rejection. Coverage below is correct / absent / present-but-wrong, and the
// "wrong" cases are sourced from the threat (option flags, helper transports),
// not from the regex under test.

describe('assertRev: a revision safe to pass to git as a positional', () => {
	it('accepts a 40-hex SHA-1 and a 64-hex SHA-256 object id', () => {
		const sha1 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
		const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
		expect(assertRev(sha1)).toBe(sha1);
		expect(assertRev(sha256)).toBe(sha256);
	});

	it('accepts an abbreviated (>=7) hex id, case-insensitively', () => {
		expect(assertRev('e3b0c44')).toBe('e3b0c44');
		expect(assertRev('ABCDEF1234')).toBe('ABCDEF1234');
	});

	it('rejects a leading-dash option-injection payload', () => {
		// the exact attack: a fetch positional that git reads as --upload-pack
		expect(() => assertRev('--upload-pack=touch /tmp/pwned')).toThrow(DocrefError);
		expect(() => assertRev('-x')).toThrow(DocrefError);
	});

	it('rejects non-hex revisions (branch names, tags, HEAD, ranges)', () => {
		for (const bad of ['main', 'HEAD', 'v1.0', 'HEAD~1', 'origin/main', 'e3b0c44..HEAD']) {
			expect(() => assertRev(bad)).toThrow(DocrefError);
		}
	});

	it('rejects the absent, empty, too-short, and over-long', () => {
		expect(() => assertRev('')).toThrow(DocrefError);
		expect(() => assertRev('abcd')).toThrow(DocrefError); // < 7 hex
		expect(() => assertRev('a'.repeat(65))).toThrow(DocrefError);
		expect(() => assertRev(undefined as unknown as string)).toThrow(DocrefError);
	});

	it('rejects hex with embedded whitespace or a transport marker', () => {
		expect(() => assertRev('e3b0c44 ')).toThrow(DocrefError);
		expect(() => assertRev('e3b0c44::x')).toThrow(DocrefError);
	});
});

describe('assertRef: a branch/ref name safe as a fetch positional', () => {
	it('accepts ordinary branch and tag names, including slashes and dots', () => {
		for (const ok of ['main', 'HEAD', 'release/1.x', 'feature/foo-bar', 'v2.0.1']) {
			expect(assertRef(ok)).toBe(ok);
		}
	});

	it('rejects a leading-dash option-injection payload', () => {
		expect(() => assertRef('--upload-pack=touch /tmp/pwned')).toThrow(DocrefError);
		expect(() => assertRef('-q')).toThrow(DocrefError);
	});

	it('rejects empty, whitespace, "..", and out-of-charset ref names', () => {
		expect(() => assertRef('')).toThrow(DocrefError);
		expect(() => assertRef('a b')).toThrow(DocrefError);
		expect(() => assertRef('a..b')).toThrow(DocrefError); // git also forbids
		for (const bad of ['a~1', 'a^', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
			expect(() => assertRef(bad)).toThrow(DocrefError);
		}
	});
});

describe('assertUrl: a remote url safe to hand git', () => {
	it('accepts the standard transport schemes', () => {
		for (const ok of [
			'https://github.com/owner/repo',
			'http://example.com/r.git',
			'ssh://git@github.com/owner/repo.git',
			'git://example.com/r.git',
			'file:///tmp/local-mirror'
		]) {
			expect(assertUrl(ok)).toBe(ok);
		}
	});

	it('accepts scp-like user@host:path', () => {
		const scp = 'git@github.com:owner/repo.git';
		expect(assertUrl(scp)).toBe(scp);
	});

	it('rejects the ext:: remote-helper RCE vector and any transport::address', () => {
		expect(() => assertUrl("ext::sh -c 'touch /tmp/pwned'")).toThrow(DocrefError);
		expect(() => assertUrl('fd::17')).toThrow(DocrefError);
	});

	it('rejects a leading-dash option-injection payload', () => {
		expect(() => assertUrl('--upload-pack=touch /tmp/pwned')).toThrow(DocrefError);
	});

	it('rejects empty and unknown/no scheme', () => {
		expect(() => assertUrl('')).toThrow(DocrefError);
		expect(() => assertUrl('javascript:alert(1)')).toThrow(DocrefError);
		expect(() => assertUrl('owner/repo')).toThrow(DocrefError); // no scheme, no user@host
	});
});

describe('cacheDirFor: the cache key is injective per repository', () => {
	it('gives distinct dirs to urls a punctuation-collapsing slug would merge', () => {
		// the slug bug: `owner/repo` and `owner-repo` both collapse to
		// `github.com-owner-repo`, so the second alias would read the first
		// repo's bare clone. The key must distinguish genuinely different urls.
		const a = cacheDirFor('https://github.com/owner/repo');
		const b = cacheDirFor('https://github.com/owner-repo');
		expect(a).not.toBe(b);
		// and the same url is stable (a cache hit, not a fresh clone every time)
		expect(cacheDirFor('https://github.com/owner/repo')).toBe(a);
	});
});

describe('ensureCommit: refuses a cached dir whose origin is a different repo', () => {
	it('fails closed on an origin mismatch (collision defense in depth)', () => {
		const cache = tmp();
		const prev = process.env.DOCREF_CACHE;
		process.env.DOCREF_CACHE = cache;
		try {
			const url = 'https://example.com/owner/repo';
			const dir = cacheDirFor(url);
			// pre-create the bare repo with a DIFFERENT origin, simulating a key
			// collision: ensureCommit must refuse, never read the wrong repo
			mkdirSync(dir, { recursive: true });
			git(dir, 'init', '--bare', '-q');
			git(dir, 'remote', 'add', 'origin', '--', 'https://example.com/other/repo');
			const rev = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
			// the origin check must short-circuit BEFORE any network fetch
			let code = 'no-error';
			try {
				ensureCommit(url, rev);
			} catch (e) {
				code = (e as DocrefError).code;
			}
			expect(code).toBe('cache-origin-mismatch');
		} finally {
			if (prev === undefined) delete process.env.DOCREF_CACHE;
			else process.env.DOCREF_CACHE = prev;
		}
	});
});
