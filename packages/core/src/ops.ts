// The operations (tooling.md section 1). The defining rule from format.md
// section 7 runs through everything here: the tool moves carriers in and
// out of stale-snippet on its own (refresh), and never moves anything out
// of stale-claim (bless is explicit) or broken (author intervention).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'tinyglobby';
import type { Project } from './config';
import { writeLock } from './config';
import { DocrefError } from './errors';
import { contentHash, hashesMatch } from './hash';
import { parseRef } from './ref';
import {
	scanMarkdown,
	rewriteFences,
	blessPins,
	type FenceCarrier,
	type PinCarrier,
	type FenceEdit
} from './markdown';
import { workingTreeSource, resolveAnchor, type Anchor, type FileSource } from './resolve';
import { branchTip, gitRevSource } from './gitcache';

export type State = 'fresh' | 'stale-snippet' | 'stale-claim' | 'broken';

export type ReportEntry = {
	doc: string;
	line: number;
	carrier: 'fence' | 'pin';
	ref: string;
	state: State;
	pinned?: string;
	current?: string;
	reason?: string;
};

export type ReportError = { doc: string; line: number; code: string; message: string };

export type Report = {
	entries: ReportEntry[];
	errors: ReportError[];
	summary: { fresh: number; staleSnippet: number; staleClaim: number; broken: number };
};

export function exitCode(report: Report): 0 | 1 | 2 {
	const s = report.summary;
	if (report.errors.length > 0 || s.broken > 0) return 2;
	if (s.staleSnippet > 0 || s.staleClaim > 0) return 1;
	return 0;
}

function summarize(entries: ReportEntry[]): Report['summary'] {
	return {
		fresh: entries.filter((e) => e.state === 'fresh').length,
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
	fenceEdits: FenceEdit[];
	pins: { carrier: PinCarrier; anchor: Anchor | null; reason?: string }[];
	text: string;
};

async function evaluateDoc(
	doc: string,
	text: string,
	sourceFor: (alias: string | undefined) => FileSource
): Promise<DocEvaluation> {
	const { carriers, errors } = scanMarkdown(text);
	const out: DocEvaluation = {
		entries: [],
		errors: errors.map((e) => ({ doc, ...e })),
		fenceEdits: [],
		pins: [],
		text
	};

	for (const c of carriers) {
		const base = { doc, line: c.openLine, carrier: c.kind, ref: c.ref } as const;
		let anchor: Anchor;
		try {
			const ref = parseRef(c.ref);
			anchor = await resolveAnchor(sourceFor(ref.alias), ref);
		} catch (e) {
			const reason = (e as Error).message;
			out.entries.push({ ...base, state: 'broken', ...(c.sha ? { pinned: c.sha } : {}), reason });
			if (c.kind === 'pin') out.pins.push({ carrier: c, anchor: null, reason });
			continue;
		}

		const current = contentHash(anchor.content);
		const cur8 = current.slice(0, 8);
		if (c.kind === 'fence') {
			const fresh = hashesMatch(c.sha, current) && contentHash(c.body) === current;
			if (!fresh) out.fenceEdits.push({ carrier: c as FenceCarrier, body: anchor.content, sha: cur8 });
			out.entries.push({
				...base,
				state: fresh ? 'fresh' : 'stale-snippet',
				...(c.sha ? { pinned: c.sha } : {}),
				current: cur8
			});
		} else {
			const fresh = hashesMatch(c.sha, current);
			out.pins.push({ carrier: c, anchor });
			out.entries.push({
				...base,
				state: fresh ? 'fresh' : 'stale-claim',
				...(c.sha ? { pinned: c.sha } : {}),
				current: cur8
			});
		}
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

function toReport(evaluations: Map<string, DocEvaluation>): Report {
	const entries = [...evaluations.values()].flatMap((e) => e.entries);
	const errors = [...evaluations.values()].flatMap((e) => e.errors);
	return { entries, errors, summary: summarize(entries) };
}

/** Resolve and report every carrier. Writes nothing. */
export async function check(project: Project, paths?: string[]): Promise<Report> {
	return toReport(await evaluate(project, paths));
}

/**
 * The mechanical half: rewrite every stale fence to the anchor's current
 * content. Pins are never touched. Returns the post-refresh report.
 */
export async function refresh(
	project: Project,
	paths?: string[]
): Promise<{ report: Report; changedDocs: string[] }> {
	const evaluations = await evaluate(project, paths);
	const changedDocs: string[] = [];
	for (const [doc, ev] of evaluations) {
		if (ev.fenceEdits.length === 0) continue;
		writeFileSync(join(project.root, doc), rewriteFences(ev.text, ev.fenceEdits));
		changedDocs.push(doc);
	}
	return { report: toReport(await evaluate(project, paths)), changedDocs: changedDocs.sort() };
}

/**
 * The judgment half: advance pin shas in exactly the given files. Pins
 * whose anchor is broken are refused, never written.
 */
export async function bless(
	project: Project,
	paths: string[]
): Promise<{ blessed: number; refused: ReportEntry[]; changedDocs: string[] }> {
	if (!paths?.length) {
		throw new DocrefError('usage', 'bless requires explicit paths; there is no --all by design');
	}
	const evaluations = await evaluate(project, paths);
	let blessed = 0;
	const refused: ReportEntry[] = [];
	const changedDocs: string[] = [];
	for (const [doc, ev] of evaluations) {
		const edits = [];
		for (const pin of ev.pins) {
			if (!pin.anchor) {
				refused.push({
					doc,
					line: pin.carrier.openLine,
					carrier: 'pin',
					ref: pin.carrier.ref,
					state: 'broken',
					...(pin.reason ? { reason: pin.reason } : {})
				});
				continue;
			}
			edits.push({ carrier: pin.carrier, sha: contentHash(pin.anchor.content).slice(0, 8) });
			blessed++;
		}
		if (edits.length > 0) {
			const next = blessPins(ev.text, edits);
			if (next !== ev.text) {
				writeFileSync(join(project.root, doc), next);
				changedDocs.push(doc);
			}
		}
	}
	return { blessed, refused, changedDocs: changedDocs.sort() };
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
		return { changed, report: toReport(await evaluate(project, undefined, overrides)) };
	}

	for (const [alias, rev] of Object.entries(overrides)) project.lock[alias] = { rev };
	writeLock(project);
	const { report } = await refresh(project);
	return { changed, report };
}

export type AffectedEntry = {
	doc: string;
	line: number;
	carrier: 'fence' | 'pin';
	ref: string;
	reason: 'overlap' | 'broken';
};

/**
 * Map a change to the carriers it endangers: intersect the diff's changed
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
		const { carriers } = scanMarkdown(text);
		for (const c of carriers) {
			let ref;
			try {
				ref = parseRef(c.ref);
			} catch {
				continue; // malformed carriers are check's findings, not affected's
			}
			if (ref.alias) continue;
			const change = changes.get(ref.path);
			if (!change) continue;

			const base = { doc, line: c.openLine, carrier: c.kind, ref: c.ref } as const;
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
	return { entries };
}

export type RefIndex = {
	refs: { ref: string; locations: { doc: string; line: number; carrier: 'fence' | 'pin' }[] }[];
};

/** The reverse index: every referenced anchor and where it is referenced. */
export async function ls(project: Project): Promise<RefIndex> {
	const byRef = new Map<string, RefIndex['refs'][number]['locations']>();
	for (const doc of await docFiles(project)) {
		const text = readFileSync(join(project.root, doc), 'utf8');
		for (const c of scanMarkdown(text).carriers) {
			const locations = byRef.get(c.ref) ?? [];
			locations.push({ doc, line: c.openLine, carrier: c.kind });
			byRef.set(c.ref, locations);
		}
	}
	return {
		refs: [...byRef.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([ref, locations]) => ({ ref, locations }))
	};
}
