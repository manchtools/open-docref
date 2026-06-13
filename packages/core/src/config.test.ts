import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject, findRoot } from './config';
import { DocrefError } from './errors';
import { tmp, write } from './testutil';

const code = (e: () => unknown): string => {
	try {
		e();
		return 'no-error';
	} catch (err) {
		return (err as DocrefError).code;
	}
};

describe('loadProject: config parsing and validation', () => {
	it('wraps a malformed docref.toml as DocrefError(invalid-config) with the path', () => {
		const root = tmp();
		write(root, 'docref.toml', 'this is = not valid toml ][');
		expect(() => loadProject(root)).toThrow(DocrefError);
		expect(code(() => loadProject(root))).toBe('invalid-config');
		try {
			loadProject(root);
		} catch (e) {
			// the raw smol-toml message is unclassifiable and in a different voice;
			// the wrap gives a stable code and names the offending file
			expect((e as DocrefError).message).toContain('docref.toml');
		}
	});

	it('wraps a malformed docref.lock the same way', () => {
		const root = tmp();
		// a valid (empty) toml so the toml path is reached, then a broken lock
		write(root, 'docref.toml', '');
		write(root, 'docref.lock', 'broken ][ toml');
		expect(code(() => loadProject(root))).toBe('invalid-config');
	});

	it('rejects a repo alias with no url, naming the alias', () => {
		const root = tmp();
		write(root, 'docref.toml', '[repos.lib]\nref = "main"\n'); // url absent
		expect(code(() => loadProject(root))).toBe('invalid-config');
		try {
			loadProject(root);
		} catch (e) {
			expect((e as DocrefError).message).toContain('repos.lib');
			expect((e as DocrefError).message).toContain('url');
		}
	});

	it('rejects a lock alias with no rev, naming the alias', () => {
		const root = tmp();
		// the toml has no repos, so the lock path is reached (toml parses first)
		write(root, 'docref.toml', '');
		write(root, 'docref.lock', '[repos.lib]\n'); // rev absent
		expect(code(() => loadProject(root))).toBe('invalid-config');
		try {
			loadProject(root);
		} catch (e) {
			expect((e as DocrefError).message).toContain('repos.lib');
			expect((e as DocrefError).message).toContain('rev');
		}
	});

	it('keeps the default scan.include for an empty list, but honors a non-empty one', () => {
		const a = tmp();
		write(a, 'docref.toml', '[scan]\ninclude = []\n');
		expect(loadProject(a).scan.include).toEqual(['**/*.md']);
		const b = tmp();
		write(b, 'docref.toml', '[scan]\ninclude = ["docs/**"]\n');
		expect(loadProject(b).scan.include).toEqual(['docs/**']);
	});
});

describe('findRoot: locating the project root', () => {
	it('walks up from a nested dir to the nearest docref.toml', () => {
		const root = tmp();
		write(root, 'docref.toml', '');
		const nested = join(root, 'a', 'b');
		mkdirSync(nested, { recursive: true });
		expect(findRoot(nested)).toBe(root);
	});

	it('falls back to cwd unchanged when no docref.toml exists up to the fs root', () => {
		const root = tmp();
		const nested = join(root, 'x');
		mkdirSync(nested, { recursive: true });
		// no docref.toml anywhere above -> the loop terminates at the fs root
		// (parent === dir) and returns the original cwd, never looping forever
		expect(findRoot(nested)).toBe(nested);
	});
});
