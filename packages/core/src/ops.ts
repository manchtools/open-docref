// The operations (tooling.md section 1). The defining rule from format.md
// section 7 runs through everything here: the tool moves references in and
// out of stale-snippet on its own (refresh), and never moves anything out
// of stale-claim (approve is explicit) or broken (author intervention).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'tinyglobby';
import type { Project } from './config';
import { writeLock } from './config';
import { DocrefError } from './errors';
import { contentHash, hashesMatch } from './hash';
import { parseRef } from './ref';
import {
	scanMarkdown,
	rewriteSnippets,
	approveClaims,
	splitShaSuffix,
	type Snippet,
	type Claim,
	type SnippetEdit
} from './markdown';
import { workingTreeSource, resolveAnchor, type Anchor, type FileSource } from './resolve';
import { branchTip, gitRevSource } from './gitcache';
import { scanRegions } from './regions';
import { listDeclarations } from './symbols';
import { languageForFile } from './languages';

export type State = 'up-to-date' | 'stale-snippet' | 'stale-claim' | 'broken';

export type ReportEntry = {
	doc: string;
	line: number;
	kind: 'snippet' | 'claim';
	ref: string;
	state: State;
	pinned?: string;
	current?: string;
	reason?: string;
};

export type ReportError = { doc: string; line: number; code: string; message: string };

export type UnusedAnchor = { file: string; name: string; line: number };

export type Report = {
	entries: ReportEntry[];
	errors: ReportError[];
	/** declared region markers nothing references (unless allow-unused) */
	unusedAnchors: UnusedAnchor[];
	summary: { upToDate: number; staleSnippet: number; staleClaim: number; broken: number };
};

export function exitCode(report: Report): 0 | 1 | 2 {
	const s = report.summary;
	if (report.errors.length > 0 || s.broken > 0) return 2;
	if (s.staleSnippet > 0 || s.staleClaim > 0 || report.unusedAnchors.length > 0) return 1;
	return 0;
}

function summarize(entries: ReportEntry[]): Report['summary'] {
	return {
		upToDate: entries.filter((e) => e.state === 'up-to-date').length,
		staleSnippet: entries.filter((e) => e.state === 'stale-snippet').length,
		staleClaim: entries.filter((e) => e.state === 'stale-claim').length,
		broken: entries.filter((e) => e.state === 'broken').length
	};
}

async function docFiles(project: Project, paths?: string[]): Promise<string[]> {
	if (paths?.length) return [...paths].sort();
	const found = await glob(project.scan.include, {
		cwd: project.root,
		ignore: project.scan.exclude
	});
	return found.sort();
}

type RevOverrides = Record<string, string>;

/** Lazily build one FileSource per (alias, rev); same-repo = working tree. */
function sourcePool(project: Project, overrides?: RevOverrides) {
	const sources = new Map<string, FileSource>();
	return (alias: string | undefined): FileSource => {
		const key = alias ?? '';
		let src = sources.get(key);
		if (src) return src;
		if (!alias) {
			src = workingTreeSource(project.root);
		} else {
			const repo = project.repos[alias];
			if (!repo) {
				throw new DocrefError('undeclared-alias', `alias "${alias}" is not declared in docref.toml`);
			}
			const rev = overrides?.[alias] ?? project.lock[alias]?.rev;
			if (!rev) {
				throw new DocrefError(
					'unlocked-alias',
					`alias "${alias}" has no locked rev; run: docref update ${alias}`
				);
			}
			src = gitRevSource(repo.url, rev);
		}
		sources.set(key, src);
		return src;
	};
}

type DocEvaluation = {
	entries: ReportEntry[];
	errors: ReportError[];
	snippetEdits: SnippetEdit[];
	claims: { carrier: Claim; anchors: (Anchor | null)[]; reason?: string }[];
	text: string;
};

async function evaluateDoc(
	doc: string,
	text: string,
	sourceFor: (alias: string | undefined) => FileSource
): Promise<DocEvaluation> {
	const { references, errors } = scanMarkdown(text);
	const out: DocEvaluation = {
		entries: [],
		errors: errors.map((e) => ({ doc, ...e })),
		snippetEdits: [],
		claims: [],
		text
	};

	for (const c of references) {
		const base = { doc, line: c.openLine, kind: c.kind, ref: c.ref } as const;

		if (c.kind === 'snippet') {
			let anchor: Anchor;
			try {
				const ref = parseRef(c.ref);
				anchor = await resolveAnchor(sourceFor(ref.alias), ref);
			} catch (e) {
				out.entries.push({
					...base,
					state: 'broken',
					...(c.sha ? { pinned: c.sha } : {}),
					reason: (e as Error).message
				});
				continue;
			}
			const current = contentHash(anchor.content);
			const cur8 = current.slice(0, 8);
			const upToDate = hashesMatch(c.sha, current) && contentHash(c.body) === current;
			if (!upToDate) out.snippetEdits.push({ carrier: c, body: anchor.content, sha: cur8 });
			out.entries.push({
				...base,
				state: upToDate ? 'up-to-date' : 'stale-snippet',
				...(c.sha ? { pinned: c.sha } : {}),
				current: cur8
			});
			continue;
		}

		// a claim may pin several anchors; broken if ANY fails, stale if
		// ANY drifted, approved only as a whole
		const anchors: (Anchor | null)[] = [];
		let reason: string | undefined;
		for (const r of c.refs) {
			try {
				const ref = parseRef(r);
				anchors.push(await resolveAnchor(sourceFor(ref.alias), ref));
			} catch (e) {
				anchors.push(null);
				reason ??= (e as Error).message;
			}
		}
		out.claims.push({ carrier: c, anchors, ...(reason ? { reason } : {}) });
		const pinned = c.shas.some(Boolean)
			? c.shas.map((s) => s ?? 'unapproved').join(',')
			: undefined;
		if (reason) {
			out.entries.push({ ...base, state: 'broken', ...(pinned ? { pinned } : {}), reason });
			continue;
		}
		const currents = anchors.map((a) => contentHash(a!.content));
		const upToDate = currents.every((h, k) => hashesMatch(c.shas[k], h));
		out.entries.push({
			...base,
			state: upToDate ? 'up-to-date' : 'stale-claim',
			...(pinned ? { pinned } : {}),
			current: currents.map((h) => h.slice(0, 8)).join(',')
		});
	}

	return out;
}

async function evaluate(
	project: Project,
	paths?: string[],
	overrides?: RevOverrides
): Promise<Map<string, DocEvaluation>> {
	const sourceFor = sourcePool(project, overrides);
	const result = new Map<string, DocEvaluation>();
	for (const doc of await docFiles(project, paths)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		result.set(doc, await evaluateDoc(doc, text, sourceFor));
	}
	return result;
}

function toReport(evaluations: Map<string, DocEvaluation>, unusedAnchors: UnusedAnchor[]): Report {
	const entries = [...evaluations.values()].flatMap((e) => e.entries);
	const errors = [...evaluations.values()].flatMap((e) => e.errors);
	return { entries, errors, unusedAnchors, summary: summarize(entries) };
}

/**
 * Declared markers nothing references; always computed against the
 * whole project, so a path-scoped check cannot fake emptiness.
 */
async function findUnusedAnchors(project: Project): Promise<UnusedAnchor[]> {
	if (project.anchors.allowUnused) return [];
	const inventory = await anchors(project);
	return inventory.anchors
		.filter((a) => a.references.length === 0)
		.map((a) => ({ file: a.file, name: a.name, line: a.line }));
}

/**
 * Resolve one ref to its current content and sha: the primitive behind
 * staging, the claim/snippet emit commands, and any place that needs a
 * paste-ready pin without anything being referenced yet.
 */
export async function resolveReference(
	project: Project,
	refRaw: string
): Promise<{ ref: string; sha: string; content: string }> {
	const bare = splitShaSuffix(refRaw).ref;
	const ref = parseRef(bare);
	const anchor = await resolveAnchor(sourcePool(project)(ref.alias), ref);
	return { ref: bare, sha: contentHash(anchor.content).slice(0, 8), content: anchor.content };
}

/** Resolve and report every reference. Writes nothing. */
export async function check(project: Project, paths?: string[]): Promise<Report> {
	return toReport(await evaluate(project, paths), await findUnusedAnchors(project));
}

/**
 * The mechanical half: rewrite every stale snippet to the anchor's current
 * content. Claims are never touched. Returns the post-refresh report.
 */
export async function refresh(
	project: Project,
	paths?: string[]
): Promise<{ report: Report; changedDocs: string[] }> {
	const evaluations = await evaluate(project, paths);
	const changedDocs: string[] = [];
	for (const [doc, ev] of evaluations) {
		if (ev.snippetEdits.length === 0) continue;
		writeFileSync(join(project.root, doc), rewriteSnippets(ev.text, ev.snippetEdits));
		changedDocs.push(doc);
	}
	return {
		report: toReport(await evaluate(project, paths), await findUnusedAnchors(project)),
		changedDocs: changedDocs.sort()
	};
}

/**
 * The judgment half: advance claim shas in exactly the given files.
 * Claims whose anchor is broken are refused, never written.
 */
export async function approve(
	project: Project,
	paths: string[]
): Promise<{ approved: number; refused: ReportEntry[]; changedDocs: string[] }> {
	if (!paths?.length) {
		throw new DocrefError('usage', 'approve requires explicit paths; there is no --all by design');
	}
	const evaluations = await evaluate(project, paths);
	let approved = 0;
	const refused: ReportEntry[] = [];
	const changedDocs: string[] = [];
	for (const [doc, ev] of evaluations) {
		const edits = [];
		for (const claim of ev.claims) {
			if (claim.anchors.some((a) => a === null)) {
				refused.push({
					doc,
					line: claim.carrier.openLine,
					kind: 'claim',
					ref: claim.carrier.ref,
					state: 'broken',
					...(claim.reason ? { reason: claim.reason } : {})
				});
				continue;
			}
			edits.push({
				carrier: claim.carrier,
				shas: claim.anchors.map((a) => contentHash(a!.content).slice(0, 8))
			});
			approved++;
		}
		if (edits.length > 0) {
			const next = approveClaims(ev.text, edits);
			if (next !== ev.text) {
				writeFileSync(join(project.root, doc), next);
				changedDocs.push(doc);
			}
		}
	}
	return { approved, refused, changedDocs: changedDocs.sort() };
}

export type UpdateResult = {
	changed: { alias: string; from?: string; to: string }[];
	report: Report;
};

/**
 * Advance cross-repo pins to the tracked branch tip. checkOnly evaluates
 * against the new tips without writing the lockfile or any document.
 */
export async function update(
	project: Project,
	opts: { aliases?: string[]; checkOnly?: boolean } = {}
): Promise<UpdateResult> {
	const targets = opts.aliases?.length ? opts.aliases : Object.keys(project.repos);
	const overrides: RevOverrides = {};
	const changed: UpdateResult['changed'] = [];
	for (const alias of targets) {
		const repo = project.repos[alias];
		if (!repo) {
			throw new DocrefError('undeclared-alias', `alias "${alias}" is not declared in docref.toml`);
		}
		const tip = branchTip(repo.url, repo.ref);
		overrides[alias] = tip;
		const from = project.lock[alias]?.rev;
		if (from !== tip) changed.push({ alias, ...(from ? { from } : {}), to: tip });
	}

	if (opts.checkOnly) {
		return {
			changed,
			report: toReport(
				await evaluate(project, undefined, overrides),
				await findUnusedAnchors(project)
			)
		};
	}

	for (const [alias, rev] of Object.entries(overrides)) project.lock[alias] = { rev };
	writeLock(project);
	const { report } = await refresh(project);
	return { changed, report };
}

export type ClaimDriftEntry = {
	doc: string;
	line: number;
	ref: string;
	pinned?: string;
	current?: string;
	/** the commit whose anchor matches the recorded sha */
	approvedRev?: string;
	approvedContent?: string;
	/** absent when the anchor no longer resolves */
	currentContent?: string;
	note?: string;
};

function singleFileSource(path: string, text: string): FileSource {
	return { read: (p) => (p === path ? text : null), describe: () => 'history' };
}

/**
 * Walk the anchored file's history (newest first) until a revision's
 * anchor hashes to the recorded sha. Bounded; the approved state must
 * have been committed to be findable.
 */
async function findApproved(
	gitDir: string,
	refRaw: string,
	sha: string,
	limit = 200
): Promise<{ rev: string; content: string } | null> {
	const ref = parseRef(refRaw);
	const revs = execFileSync(
		'git',
		['log', `-${limit}`, '--format=%H', '--', ref.path],
		{ cwd: gitDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	)
		.split('\n')
		.filter(Boolean);
	for (const rev of revs) {
		let text: string;
		try {
			text = execFileSync('git', ['show', `${rev}:${ref.path}`], {
				cwd: gitDir,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch {
			continue; // file absent at this revision
		}
		let content: string;
		try {
			content = (await resolveAnchor(singleFileSource(ref.path, text), ref)).content;
		} catch {
			continue; // anchor absent or ambiguous at this revision
		}
		if (hashesMatch(sha, contentHash(content))) return { rev, content };
	}
	return null;
}

/**
 * For every claim that is not up to date: recover the content the
 * approver saw (via git history) next to the anchor's current content,
 * so the drift is reviewable as a diff instead of two hashes.
 */
export async function diff(
	project: Project,
	paths?: string[]
): Promise<{ entries: ClaimDriftEntry[] }> {
	const entries: ClaimDriftEntry[] = [];
	for (const [doc, ev] of await evaluate(project, paths)) {
		for (const claim of ev.claims) {
			const c = claim.carrier;
			// one drift entry per drifted source of the claim
			for (let k = 0; k < c.refs.length; k++) {
				const refRaw = c.refs[k]!;
				const anchor = claim.anchors[k] ?? null;
				const sha = c.shas[k];
				if (anchor !== null && hashesMatch(sha, contentHash(anchor.content))) continue;

				const entry: ClaimDriftEntry = { doc, line: c.openLine, ref: refRaw };
				if (sha) entry.pinned = sha;
				if (anchor) {
					entry.current = contentHash(anchor.content).slice(0, 8);
					entry.currentContent = anchor.content;
				} else if (claim.reason) {
					entry.note = claim.reason;
				}

				if (!sha) {
					entry.note = 'never approved; there is no prior state to recover';
				} else {
					const ref = parseRef(refRaw);
					const gitDir = ref.alias
						? undefined // shallow cross-repo caches carry no history in v1
						: project.root;
					try {
						if (!gitDir) {
							entry.note = 'cross-repo history is not searchable (shallow cache)';
						} else {
							const found = await findApproved(gitDir, refRaw, sha);
							if (found) {
								entry.approvedRev = found.rev;
								entry.approvedContent = found.content;
							} else {
								entry.note =
									entry.note ??
									'approved state not found in history (approved but never committed?)';
							}
						}
					} catch {
						entry.note = 'no git history to search (not a git repository)';
					}
				}
				entries.push(entry);
			}
		}
	}
	return { entries };
}

/**
 * Delete a reference everywhere: snippet fences vanish whole (their
 * bodies are tool-owned), claim comments vanish while the prose stays
 * (it belongs to the author), a multi-source claim merely drops the
 * named source, and a same-repo region ref also removes its marker
 * pair from the code.
 */
export async function remove(
	project: Project,
	refRaw: string
): Promise<{ docsChanged: string[]; referencesRemoved: number; markersRemoved: number }> {
	const target = splitShaSuffix(refRaw).ref;
	let referencesRemoved = 0;
	const docsChanged: string[] = [];

	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		const { references } = scanMarkdown(text);
		type Op =
			| { kind: 'delete'; from: number; to: number }
			| { kind: 'replace'; line: number; text: string };
		const ops: Op[] = [];
		for (const c of references) {
			if (c.kind === 'snippet') {
				if (c.ref === target) {
					ops.push({ kind: 'delete', from: c.openLine, to: c.closeLine });
					referencesRemoved++;
				}
				continue;
			}
			const at = c.refs.indexOf(target);
			if (at === -1) continue;
			referencesRemoved++;
			if (c.refs.length === 1) {
				// drop the comment pair, keep the prose between them
				ops.push({ kind: 'delete', from: c.closeLine, to: c.closeLine });
				ops.push({ kind: 'delete', from: c.openLine, to: c.openLine });
			} else {
				const value = c.refs
					.map((r, k) => ({ r, sha: c.shas[k] }))
					.filter((_, k) => k !== at)
					.map((s) => (s.sha ? `${s.r}:${s.sha}` : s.r))
					.join(',');
				const tokens = c.tokens.map((t) => (t.startsWith('src=') ? `src=${value}` : t));
				ops.push({
					kind: 'replace',
					line: c.openLine,
					text: `${c.indent}<!-- docref: begin ${tokens.join(' ')} -->`
				});
			}
		}
		if (ops.length === 0) continue;
		const lines = text.split('\n');
		ops.sort(
			(a, b) =>
				(b.kind === 'delete' ? b.from : b.line) - (a.kind === 'delete' ? a.from : a.line)
		);
		for (const op of ops) {
			if (op.kind === 'replace') lines[op.line - 1] = op.text;
			else lines.splice(op.from - 1, op.to - op.from + 1);
		}
		writeFileSync(join(project.root, doc), lines.join('\n'));
		docsChanged.push(doc);
	}

	let markersRemoved = 0;
	const ref = parseRef(target);
	if (!ref.alias && ref.fragment?.kind === 'region') {
		try {
			const abs = join(project.root, ref.path);
			const text = readFileSync(abs, 'utf8');
			const { regions, errors } = scanRegions(text);
			const region = errors.length === 0 ? regions.get(ref.fragment.name) : undefined;
			if (region) {
				const lines = text.split('\n');
				lines.splice(region.endLine - 1, 1);
				lines.splice(region.beginLine - 1, 1);
				writeFileSync(abs, lines.join('\n'));
				markersRemoved = 1;
			}
		} catch {
			// source file unreadable: nothing to remove there
		}
	}

	return { docsChanged: docsChanged.sort(), referencesRemoved, markersRemoved };
}

export type AffectedEntry = {
	doc: string;
	line: number;
	kind: 'snippet' | 'claim';
	ref: string;
	reason: 'overlap' | 'broken';
};

/**
 * Map a change to the references it endangers: intersect the diff's changed
 * line ranges with anchor spans in the working tree. Same-repo only; a
 * code repository cannot know who references it from outside.
 */
export async function affected(
	project: Project,
	since: string
): Promise<{ entries: AffectedEntry[] }> {
	const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', since, '--'], {
		cwd: project.root,
		encoding: 'utf8'
	});

	const changes = new Map<string, { ranges: [number, number][]; deleted: boolean }>();
	let oldPath: string | null = null;
	let current: { ranges: [number, number][]; deleted: boolean } | null = null;
	for (const line of diff.split('\n')) {
		const minus = /^--- a\/(.+)$/.exec(line);
		if (minus) {
			oldPath = minus[1]!;
			continue;
		}
		const plus = /^\+\+\+ (.+)$/.exec(line);
		if (plus) {
			const target = plus[1]!;
			if (target === '/dev/null') {
				current = { ranges: [], deleted: true };
				changes.set(oldPath!, current);
			} else {
				current = changes.get(target.replace(/^b\//, '')) ?? { ranges: [], deleted: false };
				changes.set(target.replace(/^b\//, ''), current);
			}
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && current) {
			const start = Math.max(1, Number(hunk[1]));
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			current.ranges.push([start, count === 0 ? start : start + count - 1]);
		}
	}

	const entries: AffectedEntry[] = [];
	const sourceFor = sourcePool(project);
	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		const { references } = scanMarkdown(text);
		for (const c of references) {
			for (const refRaw of c.kind === 'claim' ? c.refs : [c.ref]) {
				let ref;
				try {
					ref = parseRef(refRaw);
				} catch {
					continue; // malformed references are check's findings, not affected's
				}
				if (ref.alias) continue;
				const change = changes.get(ref.path);
				if (!change) continue;

				const base = { doc, line: c.openLine, kind: c.kind, ref: refRaw } as const;
				if (change.deleted) {
					entries.push({ ...base, reason: 'broken' });
					continue;
				}
				let anchor: Anchor;
				try {
					anchor = await resolveAnchor(sourceFor(undefined), ref);
				} catch {
					entries.push({ ...base, reason: 'broken' });
					continue;
				}
				if (!anchor.span) {
					entries.push({ ...base, reason: 'overlap' });
					continue;
				}
				const { startLine, endLine } = anchor.span;
				if (change.ranges.some(([a, b]) => a <= endLine && b >= startLine)) {
					entries.push({ ...base, reason: 'overlap' });
				}
			}
		}
	}
	return { entries };
}

export type RefIndex = {
	refs: { ref: string; locations: { doc: string; line: number; kind: 'snippet' | 'claim' }[] }[];
};

export type AnchorEntry = {
	file: string;
	name: string;
	line: number; // begin marker, 1-based
	endLine: number;
	references: { doc: string; line: number; kind: 'snippet' | 'claim' }[];
};

export type AnchorsResult = {
	anchors: AnchorEntry[];
	errors: { file: string; line: number; code: string; message: string }[];
};

/** Blank out fenced-code lines so marker EXAMPLES in markdown are not anchors. */
function withoutFences(text: string): string {
	const lines = text.split('\n');
	let fence: { char: string; len: number } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (fence) {
			const close = new RegExp(`^\\s*${fence.char === '`' ? '`' : '~'}{${fence.len},}\\s*$`);
			if (close.test(line)) fence = null;
			lines[i] = '';
			continue;
		}
		const open = /^\s*(`{3,}|~{3,})/.exec(line);
		if (open) {
			fence = { char: open[1]![0]!, len: open[1]!.length };
			lines[i] = '';
		}
	}
	return lines.join('\n');
}

export async function anchorFiles(project: Project): Promise<string[]> {
	let files = await glob(project.anchors.include, {
		cwd: project.root,
		ignore: project.anchors.exclude
	});
	// in a git repo, respect gitignore: build outputs and generated trees
	// carry marker COPIES that would otherwise show up as anchors
	try {
		const out = execFileSync(
			'git',
			['ls-files', '--cached', '--others', '--exclude-standard'],
			{ cwd: project.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);
		const visible = new Set(out.split('\n').filter(Boolean));
		files = files.filter((f) => visible.has(f));
	} catch {
		// not a git repo: the glob result stands
	}
	return files.sort();
}

/**
 * The code-side inventory (the reverse of ls): every declared region
 * marker, with the references referencing it; an empty list means the
 * anchor is not used. Marker errors surface even in
 * files nothing references, which check alone would never visit.
 */
export async function anchors(project: Project): Promise<AnchorsResult> {
	const used = new Map<string, AnchorEntry['references']>();
	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		for (const c of scanMarkdown(text).references) {
			for (const r of c.kind === 'claim' ? c.refs : [c.ref]) {
				try {
					const ref = parseRef(r);
					if (ref.alias || ref.fragment?.kind !== 'region') continue;
					const key = `${ref.path}#@${ref.fragment.name}`;
					const list = used.get(key) ?? [];
					list.push({ doc, line: c.openLine, kind: c.kind });
					used.set(key, list);
				} catch {
					// malformed references are check's findings
				}
			}
		}
	}

	const result: AnchorsResult = { anchors: [], errors: [] };
	for (const file of await anchorFiles(project)) {
		const abs = join(project.root, file);
		let text: string;
		try {
			if (!statSync(abs).isFile() || statSync(abs).size > 2_000_000) continue;
			text = readFileSync(abs, 'utf8');
		} catch {
			continue;
		}
		if (text.includes('\u0000') || !text.includes('docref:')) continue;
		const scannable = /\.(md|mdx|markdown)$/i.test(file) ? withoutFences(text) : text;
		const { regions, errors } = scanRegions(scannable);
		result.errors.push(...errors.map((e) => ({ file, ...e })));
		for (const [name, region] of regions) {
			result.anchors.push({
				file,
				name,
				line: region.beginLine,
				endLine: region.endLine,
				references: used.get(`${file}#@${name}`) ?? []
			});
		}
	}
	result.anchors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	return result;
}

/** The reverse index: every referenced anchor and where it is referenced. */
export async function ls(project: Project): Promise<RefIndex> {
	const byRef = new Map<string, RefIndex['refs'][number]['locations']>();
	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		for (const c of scanMarkdown(text).references) {
			for (const r of c.kind === 'claim' ? c.refs : [c.ref]) {
				const locations = byRef.get(r) ?? [];
				locations.push({ doc, line: c.openLine, kind: c.kind });
				byRef.set(r, locations);
			}
		}
	}
	return {
		refs: [...byRef.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([ref, locations]) => ({ ref, locations }))
	};
}

export type SuggestEntry = {
	doc: string;
	line: number;
	identifier: string;
	/** anchors the identifier could reference: file#symbol or file#@region */
	refs: string[];
};

/**
 * Coverage gap-finder. docref tells you when an existing anchor drifts; this
 * surfaces the opposite blind spot — prose that names a resolvable code
 * identifier but sits in no claim or snippet, a *candidate unanchored claim*.
 * It indexes every symbol and region marker in the `[anchors]` file set, then
 * scans each document's prose (outside fenced code and outside existing
 * references) for inline-code identifiers that match the index. A heuristic and
 * informational: it never gates, and a human decides whether each candidate is
 * really a claim worth anchoring.
 */
export async function suggest(project: Project): Promise<{ suggestions: SuggestEntry[] }> {
	const symbols = new Map<string, string[]>(); // leaf name -> [file#path]
	const regions = new Map<string, string[]>(); // region name -> [file#@name]
	const add = (m: Map<string, string[]>, key: string, ref: string) => {
		const list = m.get(key) ?? [];
		if (!list.includes(ref)) list.push(ref);
		m.set(key, list);
	};

	for (const file of await anchorFiles(project)) {
		let text: string;
		try {
			text = readFileSync(join(project.root, file), 'utf8');
		} catch {
			continue;
		}
		if (/\u0000/.test(text)) continue; // binary
		for (const name of scanRegions(text).regions.keys()) add(regions, name, `${file}#@${name}`);
		if (!languageForFile(file)) continue;
		try {
			for (const d of await listDeclarations(text, file)) {
				add(symbols, d.path[d.path.length - 1]!, `${file}#${d.path.join('.')}`);
			}
		} catch {
			// unsupported language or parse failure: regions still indexed
		}
	}

	const IDENT = /^[A-Za-z_$][\w$.-]*$/;
	const suggestions: SuggestEntry[] = [];
	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		const covered = referencedLines(text);
		const lines = text.split('\n');
		const seen = new Set<string>();
		let inFence = false;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (/^\s*(`{3,}|~{3,})/.test(line)) {
				inFence = !inFence;
				continue;
			}
			if (inFence || covered.has(i + 1)) continue;
			for (const m of line.matchAll(/`([^`\n]+)`/g)) {
				const token = m[1]!.replace(/^@/, '').trim();
				if (!IDENT.test(token)) continue;
				const refs = [...(symbols.get(token) ?? []), ...(regions.get(token) ?? [])];
				const key = `${i + 1}\0${token}`;
				// only an UNAMBIGUOUS match (one anchor in the tree) — which is also
				// exactly what `#token` would resolve to, so it is anchorable as
				// written. Ambiguous names (a leaf in several files) are noise.
				if (refs.length === 1 && !seen.has(key)) {
					seen.add(key);
					suggestions.push({ doc, line: i + 1, identifier: token, refs });
				}
			}
		}
	}
	return { suggestions };
}

/** Lines (1-based) inside an existing claim or snippet — already anchored. */
function referencedLines(text: string): Set<number> {
	const covered = new Set<number>();
	for (const c of scanMarkdown(text).references) {
		for (let l = c.openLine; l <= c.closeLine; l++) covered.add(l);
	}
	return covered;
}
