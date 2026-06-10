// Decision logic for the extension, kept free of the vscode API so it is
// unit-testable: comment-leader detection, marker emission, the
// symbol-vs-region choice, and the mappings from core reports to
// diagnostics, tree nodes, and the status line.
import type { AnchorsResult, Decl, Report, RefIndex, State } from '@open-docref/core';

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
		if (e.state === 'up-to-date') continue;
		const hashes = e.pinned || e.current ? ` (${e.pinned ?? 'unapproved'} -> ${e.current ?? '?'})` : '';
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
	for (const u of report.unusedAnchors) {
		push(u.file, {
			line: u.line,
			severity: 'warning',
			message: `unused-anchor: nothing references ${u.file}#@${u.name}`,
			code: 'unused-anchor'
		});
	}
	return byDoc;
}

/**
 * One node type for both sidebar views. `id` is stable across rescans
 * so the tree keeps its collapse state; `doc`/`line`/`ref`/`path` tell
 * the thin vscode layer where a click should jump.
 */
export type SidebarNode = {
	type: 'group' | 'issue' | 'file' | 'ref' | 'location';
	id: string;
	label: string;
	description?: string;
	severity?: 'error' | 'warning';
	state?: State | 'unknown';
	mood?: 'attention' | 'ok';
	doc?: string;
	line?: number;
	path?: string;
	ref?: string;
	kind?: string;
	children?: SidebarNode[];
};

const SEVERITY: Record<State | 'unknown', number> = {
	'up-to-date': 0,
	unknown: 1,
	'stale-snippet': 2,
	'stale-claim': 3,
	broken: 4
};

function locationNodes(
	ref: string,
	locations: { doc: string; line: number; kind: string }[]
): SidebarNode[] {
	return locations.map((l) => ({
		type: 'location',
		id: `loc:${ref}:${l.doc}:${l.line}`,
		label: `${l.doc}:${l.line}`,
		description: l.kind,
		doc: l.doc,
		line: l.line,
		kind: l.kind
	}));
}

/**
 * The References view, triage-first: one expanded group with every
 * problem (clickable, worst first), then the full inventory grouped
 * by source file, collapsed.
 */
export function buildReferencesTree(index: RefIndex, report: Report | null): SidebarNode[] {
	const out: SidebarNode[] = [];

	if (report) {
		const issues: SidebarNode[] = [];
		for (const e of report.errors) {
			issues.push({
				type: 'issue',
				id: `err:${e.doc}:${e.line}`,
				label: `${e.doc}:${e.line}`,
				description: e.message,
				severity: 'error',
				doc: e.doc,
				line: e.line
			});
		}
		for (const e of report.entries) {
			if (e.state === 'up-to-date') continue;
			issues.push({
				type: 'issue',
				id: `entry:${e.doc}:${e.line}:${e.ref}`,
				label: e.ref,
				description: `${e.state}  ${e.doc}:${e.line}`,
				severity: e.state === 'broken' ? 'error' : 'warning',
				doc: e.doc,
				line: e.line
			});
		}
		for (const u of report.unusedAnchors) {
			issues.push({
				type: 'issue',
				id: `unused:${u.file}:${u.name}`,
				label: `${u.file}#@${u.name}`,
				description: 'unused-anchor',
				severity: 'warning',
				doc: u.file,
				line: u.line
			});
		}
		issues.sort(
			(a, b) =>
				Number(a.severity !== 'error') - Number(b.severity !== 'error') ||
				a.label.localeCompare(b.label)
		);
		if (issues.length > 0) {
			out.push({
				type: 'group',
				id: 'attention',
				label: 'Needs attention',
				description: String(issues.length),
				mood: 'attention',
				children: issues
			});
		}
	}

	const stateAt = new Map<string, State>();
	for (const e of report?.entries ?? []) stateAt.set(`${e.doc}:${e.line}`, e.state);

	const byFile = new Map<string, SidebarNode[]>();
	for (const r of index.refs) {
		const hash = r.ref.indexOf('#');
		const path = hash === -1 ? r.ref : r.ref.slice(0, hash);
		const fragment = hash === -1 ? '' : r.ref.slice(hash + 1);
		const worst = report
			? r.locations.reduce<State | 'unknown'>(
					(w, l) => {
						const st = stateAt.get(`${l.doc}:${l.line}`) ?? 'unknown';
						return SEVERITY[st] > SEVERITY[w] ? st : w;
					},
					'up-to-date'
				)
			: 'unknown';
		const stateNote = worst !== 'up-to-date' && worst !== 'unknown' ? `  ${worst}` : '';
		const node: SidebarNode = {
			type: 'ref',
			id: `ref:${r.ref}`,
			label: fragment ? `#${fragment}` : '(whole file)',
			description: `${r.locations.length} reference${r.locations.length === 1 ? '' : 's'}${stateNote}`,
			ref: r.ref,
			state: worst,
			children: locationNodes(r.ref, r.locations)
		};
		const list = byFile.get(path) ?? [];
		list.push(node);
		byFile.set(path, list);
	}

	const fileNodes: SidebarNode[] = [...byFile.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, refs]) => ({
			type: 'file',
			id: `file:${path}`,
			label: path.split('/').pop() ?? path,
			description: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
			path,
			children: refs.sort((a, b) => a.label.localeCompare(b.label))
		}));

	out.push({
		type: 'group',
		id: 'all',
		label: 'All references',
		description: `${index.refs.length} across ${byFile.size} file${byFile.size === 1 ? '' : 's'}`,
		mood: 'ok',
		children: fileNodes
	});
	return out;
}

/**
 * The Anchors view: marker errors and unused anchors as clickable
 * issues, the healthy rest in one collapsed group.
 */
export function buildAnchorsTree(result: AnchorsResult): SidebarNode[] {
	const out: SidebarNode[] = result.errors.map((e) => ({
		type: 'issue' as const,
		id: `aerr:${e.file}:${e.line}`,
		label: `${e.file}:${e.line}`,
		description: e.message,
		severity: 'error' as const,
		doc: e.file,
		line: e.line
	}));
	const used: SidebarNode[] = [];
	for (const a of result.anchors) {
		const ref = `${a.file}#@${a.name}`;
		if (a.references.length === 0) {
			out.push({
				type: 'issue',
				id: `aunused:${ref}`,
				label: ref,
				description: 'not used',
				severity: 'warning',
				doc: a.file,
				line: a.line
			});
		} else {
			used.push({
				type: 'ref',
				id: `aused:${ref}`,
				label: ref,
				description: `${a.references.length} reference${a.references.length === 1 ? '' : 's'}`,
				ref,
				state: 'up-to-date',
				children: locationNodes(ref, a.references)
			});
		}
	}
	if (used.length > 0) {
		out.push({
			type: 'group',
			id: 'used',
			label: 'Used',
			description: String(used.length),
			mood: 'ok',
			children: used
		});
	}
	return out;
}

const NOISE = /(^|\/)(node_modules|\.git|\.svelte-kit|dist|build|out|coverage|target)(\/|$)/;

/**
 * Whether a filesystem change can move a docref state: markdown (a
 * reference may have been edited), the config or lockfile, a file some
 * reference points at, or a file with declared anchors. Everything
 * else, build churn especially, is ignored.
 */
export function isRelevantChange(
	rel: string,
	refPaths: ReadonlySet<string>,
	anchorFiles: ReadonlySet<string>
): boolean {
	if (NOISE.test(rel)) return false;
	if (/\.(md|mdx|markdown)$/i.test(rel)) return true;
	if (rel === 'docref.toml' || rel === 'docref.lock') return true;
	return refPaths.has(rel) || anchorFiles.has(rel);
}

export function statusText(report: Report | null): string {
	if (!report) return 'docref';
	const s = report.summary;
	const stale = s.staleSnippet + s.staleClaim;
	const broken = s.broken + report.errors.length;
	if (broken > 0) {
		const parts = [];
		if (s.broken) parts.push(`${s.broken} broken`);
		if (report.errors.length) parts.push(`${report.errors.length} error${report.errors.length === 1 ? '' : 's'}`);
		if (stale) parts.push(`${stale} stale`);
		return `docref $(error) ${parts.join(', ')}`;
	}
	if (stale > 0) return `docref $(warning) ${stale} stale`;
	if (report.unusedAnchors.length > 0) {
		return `docref $(warning) ${report.unusedAnchors.length} unused`;
	}
	return `docref $(check) ${s.upToDate}`;
}
