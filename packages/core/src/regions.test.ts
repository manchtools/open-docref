import { describe, it, expect } from 'vitest';
import { scanRegions, extractRegion } from './regions';
import { DocrefError } from './errors';

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

	it('allows nested and overlapping regions, both extract correctly', () => {
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
		expect(extractRegion(src, 'inner')).toBe('two');
		// markers of the inner region are part of the outer region's text
		expect(extractRegion(src, 'outer')).toContain('two');
		expect(extractRegion(src, 'outer')).toContain('three');
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

describe('extractRegion', () => {
	const src = [
		'before',
		'\t// docref: begin core',
		'\tconst a = 1;',
		'',
		'\tconst b = 2;',
		'\t// docref: end core',
		'after'
	].join('\n');

	it('returns the lines between the markers, markers excluded', () => {
		expect(extractRegion(src, 'core')).toBe('\tconst a = 1;\n\n\tconst b = 2;');
	});

	it('throws region-not-found for an unknown name', () => {
		expect(() => extractRegion(src, 'nope')).toThrow(DocrefError);
		try {
			extractRegion(src, 'nope');
		} catch (e) {
			expect((e as DocrefError).code).toBe('region-not-found');
		}
	});

	it('fails closed when the file has any marker error', () => {
		const broken = '// docref: begin a\nx\n// docref: end a\n// docref: begin loose';
		expect(() => extractRegion(broken, 'a')).toThrow(DocrefError);
	});
});
