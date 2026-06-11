import { describe, it, expect } from 'vitest';
import { scanRegions, type Decl, type Report, type RefIndex } from '@open-docref/core';
import {
	commentLeaderFor,
	markerLines,
	suggestRegionName,
	isValidRegionName,
	normalizeSelectionLines,
	symbolFragmentForSelection,
	diagnosticsFromReport,
	buildReferencesTree,
	buildAnchorsTree,
	buildStageTree,
	type SidebarNode,
	isRelevantChange,
	statusText,
	refCompletionContext,
	pathCompletionsFromFiles
} from './logic';

// Contract for the extension's decision logic (tooling.md section 3). The
// vscode API layer stays thin; everything that decides or formats is here
// and testable: leader detection, marker emission that round-trips through
// the core scanner, symbol-vs-region choice (exact span only), report to
// diagnostics mapping, the tree model, and the status line.

describe('commentLeaderFor', () => {
	it('knows line-comment families', () => {
		expect(commentLeaderFor('typescript')).toEqual({ kind: 'line', open: '//' });
		expect(commentLeaderFor('go')).toEqual({ kind: 'line', open: '//' });
		expect(commentLeaderFor('python')).toEqual({ kind: 'line', open: '#' });
		expect(commentLeaderFor('sql')).toEqual({ kind: 'line', open: '--' });
	});

	it('knows block-comment families', () => {
		expect(commentLeaderFor('html')).toEqual({ kind: 'block', open: '<!--', close: '-->' });
		expect(commentLeaderFor('markdown')).toEqual({ kind: 'block', open: '<!--', close: '-->' });
		expect(commentLeaderFor('css')).toEqual({ kind: 'block', open: '/*', close: '*/' });
	});

	it('returns null for unknown languages instead of guessing', () => {
		expect(commentLeaderFor('brainfuck')).toBeNull();
	});
});

describe('markerLines', () => {
	it('emits line-leader markers with the indentation preserved', () => {
		const m = markerLines('core-loop', { kind: 'line', open: '//' }, '\t');
		expect(m.begin).toBe('\t// docref: begin core-loop');
		expect(m.end).toBe('\t// docref: end core-loop');
	});

	it('emits block-leader markers with the closer', () => {
		const m = markerLines('nav', { kind: 'block', open: '<!--', close: '-->' }, '');
		expect(m.begin).toBe('<!-- docref: begin nav -->');
		expect(m.end).toBe('<!-- docref: end nav -->');
	});

	it('round-trips through the core region scanner', () => {
		for (const leader of [
			{ kind: 'line', open: '#' } as const,
			{ kind: 'block', open: '/*', close: '*/' } as const
		]) {
			const m = markerLines('pinned', leader, '  ');
			const { regions, errors } = scanRegions(`${m.begin}\ncode\n${m.end}`);
			expect(errors).toEqual([]);
			expect(regions.has('pinned')).toBe(true);
		}
	});
});

describe('suggestRegionName', () => {
	it('builds a kebab name from the selection words, skipping numbers', () => {
		expect(suggestRegionName('const pi = 3.14159;\nreturn pi * r * r;', new Set())).toBe(
			'const-pi'
		);
	});

	it('dedupes against taken names', () => {
		expect(suggestRegionName('const pi = 1;', new Set(['const-pi']))).toBe('const-pi-2');
	});

	it('falls back to "region" when nothing usable is selected', () => {
		expect(suggestRegionName('!!! ???', new Set())).toBe('region');
		expect(suggestRegionName('', new Set(['region']))).toBe('region-2');
	});

	it('always suggests something the validator accepts', () => {
		for (const sel of ['Weird__NAME here', '   ', '$$$', 'x'.repeat(300)]) {
			expect(isValidRegionName(suggestRegionName(sel, new Set()))).toBe(true);
		}
	});
});

describe('isValidRegionName', () => {
	it('accepts kebab-case and rejects everything else', () => {
		expect(isValidRegionName('foo-1')).toBe(true);
		expect(isValidRegionName('Foo')).toBe(false);
		expect(isValidRegionName('foo_bar')).toBe(false);
		expect(isValidRegionName('')).toBe(false);
		expect(isValidRegionName('-x')).toBe(false);
	});
});

describe('normalizeSelectionLines', () => {
	it('drops a trailing line the cursor only touches at column 0', () => {
		expect(normalizeSelectionLines(5, 8, 0)).toEqual([5, 7]);
	});

	it('keeps a trailing line with real content selected', () => {
		expect(normalizeSelectionLines(5, 8, 3)).toEqual([5, 8]);
	});

	it('never collapses below the start line', () => {
		expect(normalizeSelectionLines(5, 5, 0)).toEqual([5, 5]);
	});
});

describe('symbolFragmentForSelection', () => {
	const decls: Decl[] = [
		{ path: ['Renderer'], startLine: 1, endLine: 10, content: '' },
		{ path: ['Renderer', 'run'], startLine: 2, endLine: 4, content: '' },
		{ path: ['helper'], startLine: 12, endLine: 12, content: '' }
	];

	it('returns the dotted path when the selection spans exactly one declaration', () => {
		expect(symbolFragmentForSelection(decls, 2, 4)).toBe('Renderer.run');
		expect(symbolFragmentForSelection(decls, 12, 12)).toBe('helper');
	});

	it('returns null for partial selections: those want region markers', () => {
		expect(symbolFragmentForSelection(decls, 3, 4)).toBeNull();
		expect(symbolFragmentForSelection(decls, 2, 5)).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(symbolFragmentForSelection(decls, 20, 22)).toBeNull();
	});
});

const REPORT: Report = {
	entries: [
		{ doc: 'docs/a.md', line: 3, kind: 'snippet', ref: 'src/x.ts#f', state: 'up-to-date' },
		{
			doc: 'docs/a.md',
			line: 9,
			kind: 'claim',
			ref: 'src/x.ts#@r',
			state: 'stale-claim',
			pinned: '11111111',
			current: '22222222'
		},
		{
			doc: 'docs/b.md',
			line: 1,
			kind: 'snippet',
			ref: 'src/gone.ts#x',
			state: 'broken',
			reason: 'missing-file'
		}
	],
	errors: [{ doc: 'docs/c.md', line: 4, code: 'nested-claim', message: 'claim blocks do not nest' }],
	unusedAnchors: [],
	summary: { upToDate: 1, staleSnippet: 0, staleClaim: 1, broken: 1 }
};

describe('diagnosticsFromReport', () => {
	it('squiggles unused anchors on their source files', () => {
		const byDoc = diagnosticsFromReport({
			...REPORT,
			unusedAnchors: [{ file: 'src/x.ts', name: 'spare', line: 7 }]
		});
		expect(byDoc.get('src/x.ts')).toEqual([
			expect.objectContaining({ line: 7, severity: 'warning', code: 'unused-anchor' })
		]);
	});

	it('maps stale to warning, broken and scan errors to error, skips fresh', () => {
		const byDoc = diagnosticsFromReport(REPORT);
		expect(byDoc.get('docs/a.md')).toHaveLength(1);
		expect(byDoc.get('docs/a.md')![0]).toMatchObject({ line: 9, severity: 'warning' });
		expect(byDoc.get('docs/a.md')![0]!.message).toContain('stale-claim');
		expect(byDoc.get('docs/b.md')![0]).toMatchObject({ line: 1, severity: 'error' });
		expect(byDoc.get('docs/c.md')![0]).toMatchObject({ line: 4, severity: 'error' });
		expect([...byDoc.values()].flat().some((d) => d.message.includes('up-to-date'))).toBe(false);
	});
});

describe('buildReferencesTree', () => {
	const index: RefIndex = {
		refs: [
			{ ref: 'src/gone.ts#x', locations: [{ doc: 'docs/b.md', line: 1, kind: 'snippet' }] },
			{ ref: 'src/x.ts#f', locations: [{ doc: 'docs/a.md', line: 3, kind: 'snippet' }] },
			{
				ref: 'src/x.ts#@r',
				locations: [{ doc: 'docs/a.md', line: 9, kind: 'claim' }]
			},
			{ ref: 'config/app.toml', locations: [{ doc: 'docs/a.md', line: 20, kind: 'claim' }] }
		]
	};

	it('puts every problem in one expanded attention group, worst first', () => {
		const tree = buildReferencesTree(index, {
			...REPORT,
			unusedAnchors: [{ file: 'src/y.ts', name: 'spare', line: 7 }]
		});
		const attention = tree[0]!;
		expect(attention.type).toBe('group');
		expect(attention.label).toBe('Needs attention');
		const kinds = attention.children!.map((n) => n.description);
		// broken and scan errors (severity error) come before warnings
		expect(attention.children![0]!.severity).toBe('error');
		expect(kinds.join(' ')).toContain('stale-claim');
		expect(attention.children!.some((n) => n.label === 'src/y.ts#@spare')).toBe(true);
		// every item is clickable: it knows where to jump
		for (const n of attention.children!) {
			expect(n.doc).toBeTruthy();
			expect(n.line).toBeGreaterThan(0);
		}
	});

	it('omits the attention group entirely when everything is clean', () => {
		const clean: Report = {
			entries: [
				{ doc: 'docs/a.md', line: 3, kind: 'snippet', ref: 'src/x.ts#f', state: 'up-to-date' }
			],
			errors: [],
			unusedAnchors: [],
			summary: { upToDate: 1, staleSnippet: 0, staleClaim: 0, broken: 0 }
		};
		const tree = buildReferencesTree(index, clean);
		expect(tree[0]!.label).toBe('All references');
	});

	it('groups the inventory by source file with fragments and counts', () => {
		const tree = buildReferencesTree(index, null);
		const all = tree[tree.length - 1]!;
		expect(all.type).toBe('group');
		expect(all.description).toContain('4');
		const files = all.children!;
		expect(files.every((f) => f.type === 'file')).toBe(true);
		const x = files.find((f) => f.path === 'src/x.ts')!;
		expect(x.children!.map((r) => r.label).sort()).toEqual(['#@r', '#f']);
		const whole = files.find((f) => f.path === 'config/app.toml')!;
		expect(whole.children![0]!.label).toBe('(whole file)');
		// locations hang off the fragment nodes
		expect(x.children![0]!.children![0]!.type).toBe('location');
	});

	it('marks a drifted ref on its fragment node in the inventory', () => {
		const tree = buildReferencesTree(index, REPORT);
		const all = tree[tree.length - 1]!;
		const gone = all.children!.find((f) => f.path === 'src/gone.ts')!;
		expect(gone.children![0]!.description).toContain('broken');
	});
});

describe('buildAnchorsTree', () => {
	const result = {
		anchors: [
			{
				file: 'src/a.ts',
				name: 'used-one',
				line: 3,
				endLine: 7,
				references: [{ doc: 'docs/a.md', line: 4, kind: 'snippet' as const }]
			},
			{ file: 'src/b.ts', name: 'orphan', line: 1, endLine: 2, references: [] }
		],
		errors: [{ file: 'src/c.ts', line: 5, code: 'unmatched-begin', message: 'never closed' }]
	};

	it('orders errors, then unused issues, then a collapsed used group', () => {
		const tree = buildAnchorsTree(result);
		expect(tree[0]).toMatchObject({ type: 'issue', severity: 'error', label: 'src/c.ts:5' });
		expect(tree[1]).toMatchObject({ type: 'issue', label: 'src/b.ts#@orphan', description: 'not used' });
		const used = tree[2]!;
		expect(used).toMatchObject({ type: 'group', label: 'Used' });
		expect(used.children![0]!.label).toBe('src/a.ts#@used-one');
		expect(used.children![0]!.children![0]!.type).toBe('location');
	});

	it('hides the used group when no anchor is used', () => {
		const tree = buildAnchorsTree({ anchors: [result.anchors[1]!], errors: [] });
		expect(tree.every((n) => n.type === 'issue')).toBe(true);
	});
});

describe('buildStageTree', () => {
	it('lists staged refs with their shas, ready to insert', () => {
		const tree = buildStageTree([
			{ ref: 'src/a.ts#x', sha: 'aabbccdd' },
			{ ref: 'src/gone.ts#y' }
		]);
		expect(tree[0]).toMatchObject({ type: 'ref', label: 'src/a.ts#x', description: 'aabbccdd' });
		expect(tree[1]!.description).toBe('does not resolve');
		expect(buildStageTree([])).toEqual([]);
	});
});

describe('isRelevantChange', () => {
	// The background watcher sees every filesystem event; only changes
	// that can move a docref state are worth a rescan.
	const refPaths = new Set(['src/lib/server/site.ts']);
	const anchorFiles = new Set(['src/lib/server/markdown.ts']);

	it('rescans for markdown, config, referenced and anchored files', () => {
		expect(isRelevantChange('docs/page.md', refPaths, anchorFiles)).toBe(true);
		expect(isRelevantChange('docref.toml', refPaths, anchorFiles)).toBe(true);
		expect(isRelevantChange('docref.lock', refPaths, anchorFiles)).toBe(true);
		expect(isRelevantChange('src/lib/server/site.ts', refPaths, anchorFiles)).toBe(true);
		expect(isRelevantChange('src/lib/server/markdown.ts', refPaths, anchorFiles)).toBe(true);
	});

	it('ignores unrelated files and build output churn', () => {
		expect(isRelevantChange('src/lib/other.ts', refPaths, anchorFiles)).toBe(false);
		expect(isRelevantChange('node_modules/x/index.md', refPaths, anchorFiles)).toBe(false);
		expect(isRelevantChange('.git/HEAD', refPaths, anchorFiles)).toBe(false);
		expect(isRelevantChange('.svelte-kit/output/page.md', refPaths, anchorFiles)).toBe(false);
		expect(isRelevantChange('dist/docs/page.md', refPaths, anchorFiles)).toBe(false);
	});
});

describe('statusText', () => {
	it('renders the three moods', () => {
		expect(statusText(null)).toBe('docref');
		expect(
			statusText({
				entries: [],
				errors: [],
				unusedAnchors: [],
				summary: { upToDate: 3, staleSnippet: 0, staleClaim: 0, broken: 0 }
			})
		).toBe('docref $(check) 3');
		expect(
			statusText({
				entries: [],
				errors: [],
				unusedAnchors: [],
				summary: { upToDate: 1, staleSnippet: 1, staleClaim: 1, broken: 0 }
			})
		).toBe('docref $(warning) 2 stale');
		expect(statusText(REPORT)).toBe('docref $(error) 1 broken, 1 error, 1 stale');
		expect(
			statusText({
				entries: [],
				errors: [],
				unusedAnchors: [{ file: 'a.ts', name: 'x', line: 1 }],
				summary: { upToDate: 2, staleSnippet: 0, staleClaim: 0, broken: 0 }
			})
		).toBe('docref $(warning) 1 unused');
	});
});

describe('refCompletionContext: autocomplete inside a docref reference', () => {
	// `|` marks the cursor; the helper drops it and passes its index as the
	// character. Only the text before the cursor decides the context.
	const ctx = (s: string) => refCompletionContext(s.replace('|', ''), s.indexOf('|'));

	it('offers path completion inside a snippet docref= value', () => {
		expect(ctx('```ts docref=src/li|')).toEqual({ phase: 'path', partial: 'src/li' });
	});

	it('offers path completion right after the equals', () => {
		expect(ctx('```ts docref=|')).toEqual({ phase: 'path', partial: '' });
	});

	it('switches to fragment completion after #', () => {
		expect(ctx('```ts docref=src/lib.ts#gr|')).toEqual({
			phase: 'fragment',
			path: 'src/lib.ts',
			kind: 'any',
			partial: 'gr'
		});
	});

	it('offers region-only fragments after #@', () => {
		expect(ctx('```ts docref=src/lib.ts#@re|')).toEqual({
			phase: 'fragment',
			path: 'src/lib.ts',
			kind: 'region',
			partial: 're'
		});
	});

	it('works inside a claim src= value', () => {
		expect(ctx('<!-- docref: begin src=src/x|')).toEqual({ phase: 'path', partial: 'src/x' });
	});

	it('completes the segment after the last comma in a multi-source claim', () => {
		expect(ctx('<!-- docref: begin src=a.ts#x,src/b.ts#fo|')).toEqual({
			phase: 'fragment',
			path: 'src/b.ts',
			kind: 'any',
			partial: 'fo'
		});
	});

	it('carries a declared alias through to the fragment context', () => {
		expect(ctx('<!-- docref: begin src=lib:src/x.ts#f|')).toEqual({
			phase: 'fragment',
			alias: 'lib',
			path: 'src/x.ts',
			kind: 'any',
			partial: 'f'
		});
	});

	it('returns null for a non-docref src= (an HTML img, not a claim)', () => {
		expect(ctx('<img src=foo|')).toBeNull();
	});

	it('returns null once the cursor leaves the value (a space ends a ref)', () => {
		expect(ctx('```ts docref=src/x.ts#fn |')).toBeNull();
	});

	it('uses only the text before the cursor', () => {
		expect(ctx('```ts docref=src/li|b.ts#x more')).toEqual({ phase: 'path', partial: 'src/li' });
	});
});

describe('pathCompletionsFromFiles: completion scoped to the anchorable files', () => {
	const files = ['src/lib.ts', 'src/lib/util.ts', 'src/main.ts', 'docs/x.md', 'README.md'];

	it('lists top-level entries at the root, directories first', () => {
		expect(pathCompletionsFromFiles(files, '')).toEqual([
			{ name: 'docs', isDir: true },
			{ name: 'src', isDir: true },
			{ name: 'README.md', isDir: false }
		]);
	});

	it('descends into a directory and dedupes the next segment', () => {
		expect(pathCompletionsFromFiles(files, 'src/')).toEqual([
			{ name: 'lib', isDir: true }, // from src/lib/util.ts
			{ name: 'lib.ts', isDir: false },
			{ name: 'main.ts', isDir: false }
		]);
	});

	it('filters by the partial base, case-insensitively', () => {
		expect(pathCompletionsFromFiles(files, 'src/LI')).toEqual([
			{ name: 'lib', isDir: true },
			{ name: 'lib.ts', isDir: false }
		]);
	});

	it('offers nothing outside the anchorable set (e.g. node_modules)', () => {
		expect(pathCompletionsFromFiles(files, 'node_modules/')).toEqual([]);
	});
});
