import { describe, it, expect } from 'vitest';
import { languageForFile, fenceLanguageForRef } from './languages';

describe('languageForFile', () => {
	it('maps known extensions case-insensitively and rejects the unknown', () => {
		expect(languageForFile('src/a.ts')?.id).toBe('typescript');
		expect(languageForFile('SRC/A.TS')?.id).toBe('typescript');
		expect(languageForFile('a.proto')?.id).toBe('proto');
		expect(languageForFile('notes.txt')).toBeNull();
		expect(languageForFile('Makefile')).toBeNull(); // no extension
	});
});

describe('fenceLanguageForRef', () => {
	it('returns the path extension, stripping any alias and #fragment', () => {
		expect(fenceLanguageForRef('src/a.ts')).toBe('ts');
		expect(fenceLanguageForRef('src/a.ts#applyFootnotes')).toBe('ts');
		expect(fenceLanguageForRef('lib:src/a.go#Server.Close')).toBe('go');
		expect(fenceLanguageForRef('src/q.sql#@tenant-scope')).toBe('sql');
	});

	it('returns "" for a path with no extension, never the whole path', () => {
		// the bug this replaces: `path.split('.').pop()` returns the whole
		// dotless path, yielding a bogus fence word
		expect(fenceLanguageForRef('Makefile')).toBe('');
		expect(fenceLanguageForRef('dir/Dockerfile')).toBe('');
		expect(fenceLanguageForRef('src/.gitignore')).toBe(''); // leading dot is not an extension
	});

	it('throws on a malformed ref (callers with untrusted input must guard)', () => {
		expect(() => fenceLanguageForRef('bad ref with spaces')).toThrow();
	});
});
