import { describe, it, expect } from 'vitest';
import { workingTreeSource, resolveAnchor } from './resolve';
import { parseRef } from './ref';
import { DocrefError } from './errors';
import { tmp, write } from './testutil';

// Contract (format.md sections 1, 2, 8): an anchor is a whole file, a
// region, or a symbol, resolved through a file source. Every resolution
// failure is a typed, fail-closed error.

const code = async (e: () => Promise<unknown>): Promise<string> => {
	try {
		await e();
		return 'no-error';
	} catch (err) {
		return (err as DocrefError).code;
	}
};

function fixture(): string {
	const root = tmp();
	write(
		root,
		'src/lib.ts',
		[
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
		].join('\n')
	);
	write(root, 'config/default.toml', 'level = "info"\n');
	return root;
}

describe('workingTreeSource', () => {
	it('reads existing files and returns null for missing ones', () => {
		const root = fixture();
		const src = workingTreeSource(root);
		expect(src.read('config/default.toml')).toBe('level = "info"\n');
		expect(src.read('config/missing.toml')).toBeNull();
	});
});

describe('resolveAnchor', () => {
	it('resolves a whole file', async () => {
		const src = workingTreeSource(fixture());
		const a = await resolveAnchor(src, parseRef('config/default.toml'));
		expect(a.content).toBe('level = "info"\n');
	});

	it('resolves a region dedented, with a 1-based span covering the marker lines', async () => {
		const src = workingTreeSource(fixture());
		const a = await resolveAnchor(src, parseRef('src/lib.ts#@pi-part'));
		expect(a.content).toBe('const pi = 3.14159;');
		expect(a.span).toEqual({ startLine: 6, endLine: 8 });
	});

	it('resolves a symbol with its span', async () => {
		const src = workingTreeSource(fixture());
		const a = await resolveAnchor(src, parseRef('src/lib.ts#greet'));
		expect(a.content).toContain('export function greet');
		expect(a.span).toEqual({ startLine: 1, endLine: 3 });
	});

	it('fails closed: missing file', async () => {
		const src = workingTreeSource(fixture());
		expect(await code(() => resolveAnchor(src, parseRef('src/nope.ts#x')))).toBe('missing-file');
	});

	it('fails closed: unknown region', async () => {
		const src = workingTreeSource(fixture());
		expect(await code(() => resolveAnchor(src, parseRef('src/lib.ts#@ghost')))).toBe(
			'region-not-found'
		);
	});

	it('fails closed: unknown symbol', async () => {
		const src = workingTreeSource(fixture());
		expect(await code(() => resolveAnchor(src, parseRef('src/lib.ts#ghost')))).toBe(
			'symbol-not-found'
		);
	});

	it('fails closed: symbol ref into an unsupported language', async () => {
		const root = fixture();
		write(root, 'src/main.rs', 'fn main() {}\n');
		const src = workingTreeSource(root);
		expect(await code(() => resolveAnchor(src, parseRef('src/main.rs#main')))).toBe(
			'unsupported-language'
		);
		// regions still work in any language
		write(root, 'src/lib.rs', '// docref: begin r\nlet x = 1;\n// docref: end r\n');
		const a = await resolveAnchor(src, parseRef('src/lib.rs#@r'));
		expect(a.content).toBe('let x = 1;');
	});
});
