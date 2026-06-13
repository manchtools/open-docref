// Decision logic for the extension, kept free of the vscode API so it is
// unit-testable: comment-leader detection, marker emission, the
// symbol-vs-region choice, and the mappings from core reports to
// diagnostics, tree nodes, and the status line.
import { isKebabName } from '@open-docref/core';
import type { AnchorsResult, Decl, GateLevel, Report, RefIndex, State } from '@open-docref/core';

/**
 * A workspace file's path as a POSIX, repo-relative path, or null when it is not
 * under `root`. Normalizes separators BEFORE stripping the root, so it is correct
 * on Windows — a Uri's fsPath there uses backslashes, and the naive
 * `fsPath.startsWith(root + '/')` never matches, silently returning an absolute
 * path that every path-keyed lookup then misses. Pure, so the keying is tested.
 */
export function relPath(root: string, fsPath: string): string | null {
	const toPosix = (p: string) => p.split('\\').join('/');
	const f = toPosix(fsPath);
	const r = toPosix(root);
	if (f === r) return '';
	return f.startsWith(r + '/') ? f.slice(r.length + 1) : null;
}

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
	proto: '//',
	proto3: '//',
	protobuf: '//',
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

/**
 * A docref claim block as a VS Code snippet for insertion into markdown: the
 * begin/end comment markers with the first tab stop (`$1`) parked at an empty
 * `src=` — so the reference autocomplete completes it — and the final cursor
 * (`$0`) in the prose between them. Lets an author scaffold a hand-written
 * claim without typing the markers by hand. The marker shape must stay exactly
 * what the core scanner recognizes as a claim (pinned by a round-trip test).
 */
export function claimScaffoldSnippet(): string {
	return '<!-- docref: begin src=$1 -->\n$0\n<!-- docref: end -->';
}

/**
 * Markdown doesn't auto-suggest on plain typing, so the scaffold is summoned by
 * typing the shorthand `docref` (and, since `#` is a completion trigger, often
 * `docref#`). That trigger text must be REPLACED by the inserted block, not left
 * behind. Given the text before the cursor, return how many trailing characters
 * are the trigger token (to cover with the completion's replace range), or 0 if
 * there is none — e.g. a bare `#` heading, where the scaffold should not appear.
 */
export function claimScaffoldTriggerLength(before: string): number {
	const m = /docref[#:]?$/i.exec(before);
	return m ? m[0].length : 0;
}

export function isValidRegionName(name: string): boolean {
	return isKebabName(name);
}

export function suggestRegionName(selection: string, taken: Set<string>): string {
	const words = (selection.split('\n')[0] ?? '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w !== '' && !/^[0-9]+$/.test(w))
		.slice(0, 3);
	let base = words.join('-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
	if (!isKebabName(base)) base = 'region';
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
	severity: 'error' | 'warning' | 'information';
	message: string;
	code: string;
	/** The ref the squiggle sits on, so the editor can jump to the code or
	 * diff it. Absent for scan errors, which are about the document itself. */
	ref?: string;
};

// In-editor severity tracks the gate level, so the squiggle matches what
// actually fails CI. A "hard" finding is a broken ref or scan error; a "soft"
// one is drift (stale snippet/claim or an unused anchor). strict: hard=Error,
// soft=Warning (today). lenient: a broken ref still gates, so hard=Error, but
// drift does not, so soft=Information. advisory: nothing gates, so hard=Warning
// and soft=Information.
function severityOf(hard: boolean, level: GateLevel): DiagnosticData['severity'] {
	if (hard) return level === 'advisory' ? 'warning' : 'error';
	return level === 'strict' ? 'warning' : 'information';
}

export function diagnosticsFromReport(
	report: Report,
	level: GateLevel = 'strict'
): Map<string, DiagnosticData[]> {
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
			severity: severityOf(e.state === 'broken', level),
			message: `${e.state}: ${e.ref}${hashes}${e.reason ? ` ${e.reason}` : ''}`,
			code: e.state,
			ref: e.ref
		});
	}
	for (const e of report.errors) {
		push(e.doc, { line: e.line, severity: severityOf(true, level), message: e.message, code: e.code });
	}
	for (const u of report.unusedAnchors) {
		push(u.file, {
			line: u.line,
			severity: severityOf(false, level),
			message: `unused-anchor: nothing references ${u.file}#@${u.name}`,
			code: 'unused-anchor',
			ref: `${u.file}#@${u.name}`
		});
	}
	return byDoc;
}

export type QuickFixes = {
	openCode: boolean; // jump to the referenced source declaration/region
	showDiff: boolean; // open the approved-vs-current drift diff for the claim
	approve: boolean; // re-approve the claim against the current code
	refresh: boolean; // rewrite the materialized snippet from the current source
};

const NO_FIXES: QuickFixes = { openCode: false, showDiff: false, approve: false, refresh: false };

/**
 * Which editor quick fixes a docref diagnostic offers, by its state code.
 * Only actions that can actually succeed for that state are offered: a stale
 * claim can be inspected (jump to code), compared (drift diff) and approved; a
 * stale snippet jumps to code and is rewritten by refresh (it is materialized,
 * never approved); a broken ref has no code to open, and unused anchors and
 * scan errors are not about a resolvable ref.
 */
export function quickFixesForState(code: string): QuickFixes {
	switch (code) {
		case 'stale-claim':
			return { openCode: true, showDiff: true, approve: true, refresh: false };
		case 'stale-snippet':
			return { openCode: true, showDiff: false, approve: false, refresh: true };
		default:
			return { ...NO_FIXES };
	}
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
				state: e.state,
				doc: e.doc,
				line: e.line,
				ref: e.ref
			});
		}
		for (const u of report.unusedAnchors) {
			issues.push({
				type: 'issue',
				id: `unused:${u.file}:${u.name}`,
				label: `${u.file}#@${u.name}`,
				description: 'unused-anchor',
				severity: 'warning',
				ref: `${u.file}#@${u.name}`,
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
				ref,
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

export function statusText(report: Report | null, level: GateLevel = 'strict'): string {
	if (!report) return 'docref';
	const s = report.summary;
	const stale = s.staleSnippet + s.staleClaim;
	const broken = s.broken + report.errors.length;
	const suffix = level === 'strict' ? '' : ` · ${level}`;
	if (broken > 0) {
		const parts = [];
		if (s.broken) parts.push(`${s.broken} broken`);
		if (report.errors.length) parts.push(`${report.errors.length} error${report.errors.length === 1 ? '' : 's'}`);
		if (stale) parts.push(`${stale} stale`);
		// advisory never fails, so the count is shown without the alarming error glyph
		const glyph = level === 'advisory' ? '$(info)' : '$(error)';
		return `docref ${glyph} ${parts.join(', ')}${suffix}`;
	}
	if (stale > 0) return `docref $(warning) ${stale} stale${suffix}`;
	if (report.unusedAnchors.length > 0) {
		return `docref $(warning) ${report.unusedAnchors.length} unused${suffix}`;
	}
	return `docref $(check) ${s.upToDate}${suffix}`;
}

/** The Staged view: refs collected for insertion into documents. */
export function buildStageTree(staged: { ref: string; sha?: string }[]): SidebarNode[] {
	return staged.map((s) => ({
		type: 'ref',
		id: `stage:${s.ref}`,
		label: s.ref,
		description: s.sha ?? 'does not resolve',
		ref: s.ref,
		state: 'unknown'
	}));
}

/**
 * The message shown in the suggest list when a file the user is referencing has
 * nothing to anchor — so an empty fragment phase reads as a clear "nothing here"
 * instead of a silent "No suggestions". `kind` is the fragment phase (`region`
 * after `#@`, else `any`); `symbolsSupported` says whether structural symbol
 * resolution exists for the file type, so the hint can point at region markers
 * when it does not.
 */
export function noReferenceablesMessage(
	path: string,
	kind: 'any' | 'region',
	symbolsSupported: boolean
): string {
	const base = path.split('/').pop() || path;
	if (kind === 'region') return `No region markers in ${base}`;
	return symbolsSupported
		? `No referenceable symbols or region markers in ${base}`
		: `No region markers in ${base} — no symbol support for this file type, add a marker`;
}

export type RefCompletion =
	| { phase: 'path'; alias?: string; partial: string }
	| { phase: 'fragment'; alias?: string; path: string; kind: 'any' | 'region'; partial: string };

/**
 * What a completion at `character` on `line` should offer when the cursor sits
 * inside a docref reference value — the `docref=` of a snippet fence or the
 * `src=` of a claim comment (for a multi-source claim, the segment after the
 * last comma). Returns null when the cursor is not in such a value, so an
 * ordinary `src=` (an HTML `<img>`) is left alone. Pure and unit-tested; the
 * vscode layer turns the result into file / symbol / region items and computes
 * the `:sha`.
 */
export function refCompletionContext(line: string, character: number): RefCompletion | null {
	const before = line.slice(0, Math.max(0, character));
	let value: string | null = null;
	const snippet = /docref=([^\s]*)$/.exec(before);
	if (snippet) {
		value = snippet[1]!;
	} else {
		const claim = /src=([^\s]*)$/.exec(before);
		if (claim && /docref:\s*begin\b/.test(before.slice(0, claim.index))) value = claim[1]!;
	}
	if (value === null) return null;

	// a reference cannot contain a space; commas separate a claim's sources, so
	// the active reference is the segment after the last comma
	const seg = value.split(',').pop() ?? '';
	// shares core's kebab grammar, but stays non-throwing: a leading-`:` or a
	// non-kebab prefix means "no alias yet" (parseRef would treat leading-`:` as
	// an empty alias and throw — completion must not)
	const splitAlias = (s: string): { alias?: string; rest: string } => {
		const c = s.indexOf(':');
		return c > 0 && isKebabName(s.slice(0, c))
			? { alias: s.slice(0, c), rest: s.slice(c + 1) }
			: { rest: s };
	};

	const hash = seg.indexOf('#');
	if (hash === -1) {
		const { alias, rest } = splitAlias(seg);
		return { phase: 'path', ...(alias ? { alias } : {}), partial: rest };
	}
	const { alias, rest } = splitAlias(seg.slice(0, hash));
	const frag = seg.slice(hash + 1);
	const region = frag.startsWith('@');
	return {
		phase: 'fragment',
		...(alias ? { alias } : {}),
		path: rest,
		kind: region ? 'region' : 'any',
		partial: region ? frag.slice(1) : frag
	};
}

/**
 * Path-phase completion derived from the project's anchorable file list (the
 * `[anchors]` include/exclude scope), not the raw filesystem — so completion
 * offers exactly what can be referenced and honors the toml. Given those files
 * and the partial path typed, returns the distinct next path segment under it:
 * a directory to descend into, or a file to reference. Directories first, then
 * files, each alphabetical.
 */
export function pathCompletionsFromFiles(
	files: string[],
	partial: string
): { name: string; isDir: boolean }[] {
	const slash = partial.lastIndexOf('/');
	const dir = slash === -1 ? '' : partial.slice(0, slash + 1);
	const base = (slash === -1 ? partial : partial.slice(slash + 1)).toLowerCase();
	const seen = new Map<string, boolean>(); // next segment -> isDir
	for (const f of files) {
		if (!f.startsWith(dir)) continue;
		const rest = f.slice(dir.length);
		const cut = rest.indexOf('/');
		const isDir = cut !== -1;
		const name = isDir ? rest.slice(0, cut) : rest;
		if (!name || !name.toLowerCase().startsWith(base)) continue;
		if (!seen.has(name)) seen.set(name, isDir);
	}
	return [...seen.entries()]
		.map(([name, isDir]) => ({ name, isDir }))
		.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}
