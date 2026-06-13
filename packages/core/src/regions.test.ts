import { describe, it, expect } from 'vitest';
import { scanRegions } from './regions';
import { resolveAnchor, type FileSource } from './resolve';
import { parseRef } from './ref';
import { DocrefError } from './errors';

// Region materialization is exercised through the LIVE path (resolveAnchor over
// an in-memory FileSource), so the test pins the same dedented output the engine
// actually produces — not a parallel extractor that drifted from it.
function memSource(content: string): FileSource {
	return { read: () => content, describe: () => 'mem' };
}
const regionContent = (src: string, name: string): Promise<string> =>
	resolveAnchor(memSource(src), parseRef(`mem.ts#@${name}`)).then((a) => a.content);
const regionCode = async (src: string, name: string): Promise<string> => {
	try {
		await regionContent(src, name);
		return 'no-error';
	} catch (e) {
		return (e as DocrefError).code;
	}
};

// Contract (format.md section 2): regions are delimited by
// "docref: begin <name>" / "docref: end <name>" appearing anywhere in a
// line behind any comment leader. Names are kebab-case, unique per file,
// end always carries the name, marker lines are excluded from extraction.
// Duplicates and unmatched markers are hard errors. A token containing "="
// is an attribute (pin form), never a region name.

describe('scanRegions', () => {
	it('finds regions behind any comment leader', () => {
		const src = [
			'// docref: begin slash-style',
			'a',
			'// docref: end slash-style',
			'# docref: begin hash-style',
			'b',
			'# docref: end hash-style',
			'-- docref: begin sql-style',
			'c',
			'-- docref: end sql-style',
			'<!-- docref: begin html-style -->',
			'd',
			'<!-- docref: end html-style -->'
		].join('\n');
		const { regions, errors } = scanRegions(src);
		expect(errors).toEqual([]);
		expect([...regions.keys()].sort()).toEqual([
			'hash-style',
			'html-style',
			'slash-style',
			'sql-style'
		]);
		expect(regions.get('slash-style')).toEqual({ beginLine: 1, endLine: 3 });
	});

	it('allows nested and overlapping regions, both resolve correctly', async () => {
		const src = [
			'// docref: begin outer',
			'one',
			'// docref: begin inner',
			'two',
			'// docref: end inner',
			'three',
			'// docref: end outer'
		].join('\n');
		const { regions, errors } = scanRegions(src);
		expect(errors).toEqual([]);
		expect(await regionContent(src, 'inner')).toBe('two');
		// markers of the inner region are part of the outer region's text
		expect(await regionContent(src, 'outer')).toContain('two');
		expect(await regionContent(src, 'outer')).toContain('three');
		expect(regions.size).toBe(2);
	});

	it('rejects a duplicate begin with the same name', () => {
		const src = [
			'// docref: begin dup',
			'// docref: end dup',
			'// docref: begin dup',
			'// docref: end dup'
		].join('\n');
		const { errors } = scanRegions(src);
		expect(errors.some((e) => e.code === 'duplicate-region')).toBe(true);
	});

	it('rejects an unmatched begin', () => {
		const { errors } = scanRegions('// docref: begin lonely\ncode');
		expect(errors.some((e) => e.code === 'unmatched-begin')).toBe(true);
	});

	it('rejects an end without a begin', () => {
		const { errors } = scanRegions('code\n// docref: end ghost');
		expect(errors.some((e) => e.code === 'unmatched-end')).toBe(true);
	});

	it('does not mistake pin attributes for region names', () => {
		// "src=..." is the attribute form (pin block); "src" must not be
		// read as a region name even though the name pattern matches its
		// prefix. format.md: a token containing "=" is an attribute.
		const md = [
			'<!-- docref: begin src=a/b.ts#x sha=aabbccdd -->',
			'prose',
			'<!-- docref: end -->'
		].join('\n');
		const { regions, errors } = scanRegions(md);
		expect(regions.size).toBe(0);
		expect(errors).toEqual([]);
	});
});

describe('region materialization (via resolveAnchor)', () => {
	const src = [
		'before',
		'\t// docref: begin core',
		'\tconst a = 1;',
		'',
		'\tconst b = 2;',
		'\t// docref: end core',
		'after'
	].join('\n');

	it('returns the lines between the markers, markers excluded and dedented', () => {
		// the live path dedents (resolve.ts), so an indented region comes out flush
		// left with internal blanks preserved — the contract a doc actually sees
		return expect(regionContent(src, 'core')).resolves.toBe('const a = 1;\n\nconst b = 2;');
	});

	it('fails closed with region-not-found for an unknown name', async () => {
		expect(await regionCode(src, 'nope')).toBe('region-not-found');
	});

	it('fails closed when the file has any marker error', async () => {
		const broken = '// docref: begin a\nx\n// docref: end a\n// docref: begin loose';
		expect(await regionCode(broken, 'a')).toBe('region-error');
	});
});
