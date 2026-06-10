// Decision logic for the extension, kept free of the vscode API so it is
// unit-testable: comment-leader detection, marker emission, the
// symbol-vs-region choice, and the mappings from core reports to
// diagnostics, tree nodes, and the status line.
import type { Decl, Report, RefIndex, State } from '@open-docref/core';

export type Leader =
	| { kind: 'line'; open: string }
	| { kind: 'block'; open: string; close: string };

const LINE_LEADERS: Record<string, string> = {
	javascript: '//',
	javascriptreact: '//',
	typescript: '//',
	typescriptreact: '//',
	go: '//',
	rust: '//',
	c: '//',
	cpp: '//',
	csharp: '//',
	java: '//',
	kotlin: '//',
	swift: '//',
	dart: '//',
	scala: '//',
	php: '//',
	python: '#',
	ruby: '#',
	shellscript: '#',
	yaml: '#',
	toml: '#',
	perl: '#',
	r: '#',
	makefile: '#',
	dockerfile: '#',
	elixir: '#',
	sql: '--',
	lua: '--',
	haskell: '--'
};

const BLOCK_LEADERS: Record<string, [string, string]> = {
	html: ['<!--', '-->'],
	xml: ['<!--', '-->'],
	markdown: ['<!--', '-->'],
	svelte: ['<!--', '-->'],
	vue: ['<!--', '-->'],
	css: ['/*', '*/'],
	scss: ['/*', '*/'],
	less: ['/*', '*/']
};

export function commentLeaderFor(languageId: string): Leader | null {
	const line = LINE_LEADERS[languageId];
	if (line) return { kind: 'line', open: line };
	const block = BLOCK_LEADERS[languageId];
	if (block) return { kind: 'block', open: block[0], close: block[1] };
	return null;
}

export function markerLines(
	name: string,
	leader: Leader,
	indent: string
): { begin: string; end: string } {
	const wrap = (verb: string) =>
		leader.kind === 'line'
			? `${indent}${leader.open} docref: ${verb} ${name}`
			: `${indent}${leader.open} docref: ${verb} ${name} ${leader.close}`;
	return { begin: wrap('begin'), end: wrap('end') };
}

const REGION_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function isValidRegionName(name: string): boolean {
	return REGION_NAME.test(name);
}

export function suggestRegionName(selection: string, taken: Set<string>): string {
	const words = (selection.split('\n')[0] ?? '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w !== '' && !/^[0-9]+$/.test(w))
		.slice(0, 3);
	let base = words.join('-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
	if (!REGION_NAME.test(base)) base = 'region';
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * 1-based selection lines. A selection whose end sits at column 0 only
 * touches that line; the line before it is the real last selected line.
 */
export function normalizeSelectionLines(
	startLine: number,
	endLine: number,
	endCharacter: number
): [number, number] {
	const end = endCharacter === 0 ? endLine - 1 : endLine;
	return [startLine, Math.max(startLine, end)];
}

/**
 * The selection becomes a symbol ref only when it spans EXACTLY one
 * declaration (same first and last line). Partial selections want region
 * markers; guessing a containing symbol would pin more than was chosen.
 */
export function symbolFragmentForSelection(
	decls: Decl[],
	startLine: number,
	endLine: number
): string | null {
	const exact = decls.filter((d) => d.startLine === startLine && d.endLine === endLine);
	if (exact.length !== 1) return null;
	return exact[0]!.path.join('.');
}

export type DiagnosticData = {
	line: number;
	severity: 'error' | 'warning';
	message: string;
	code: string;
};

export function diagnosticsFromReport(report: Report): Map<string, DiagnosticData[]> {
	const byDoc = new Map<string, DiagnosticData[]>();
	const push = (doc: string, d: DiagnosticData) => {
		const list = byDoc.get(doc) ?? [];
		list.push(d);
		byDoc.set(doc, list);
	};
	for (const e of report.entries) {
		if (e.state === 'fresh') continue;
		const hashes = e.pinned || e.current ? ` (${e.pinned ?? 'unblessed'} -> ${e.current ?? '?'})` : '';
		push(e.doc, {
			line: e.line,
			severity: e.state === 'broken' ? 'error' : 'warning',
			message: `${e.state}: ${e.ref}${hashes}${e.reason ? ` ${e.reason}` : ''}`,
			code: e.state
		});
	}
	for (const e of report.errors) {
		push(e.doc, { line: e.line, severity: 'error', message: e.message, code: e.code });
	}
	return byDoc;
}

export type RefNode = {
	ref: string;
	state: State | 'unknown';
	locations: { doc: string; line: number; carrier: string; state: State | 'unknown' }[];
};

const SEVERITY: Record<State | 'unknown', number> = {
	fresh: 0,
	unknown: 1,
	'stale-snippet': 2,
	'stale-claim': 3,
	broken: 4
};

export function buildRefTree(index: RefIndex, report: Report | null): RefNode[] {
	const stateAt = new Map<string, State>();
	for (const e of report?.entries ?? []) stateAt.set(`${e.doc}:${e.line}`, e.state);
	return index.refs.map((r) => {
		const locations = r.locations.map((l) => ({
			...l,
			state: stateAt.get(`${l.doc}:${l.line}`) ?? ('unknown' as const)
		}));
		const state = locations.reduce<State | 'unknown'>(
			(worst, l) => (SEVERITY[l.state] > SEVERITY[worst] ? l.state : worst),
			report ? 'fresh' : 'unknown'
		);
		return { ref: r.ref, state: report ? state : 'unknown', locations };
	});
}

export function statusText(report: Report | null): string {
	if (!report) return 'docref';
	const s = report.summary;
	const stale = s.staleSnippet + s.staleClaim;
	const broken = s.broken + report.errors.length;
	if (broken > 0) return `docref $(error) ${s.broken} broken${stale ? `, ${stale} stale` : ''}`;
	if (stale > 0) return `docref $(warning) ${stale} stale`;
	return `docref $(check) ${s.fresh}`;
}
