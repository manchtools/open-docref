// Markdown references (format.md sections 3 and 4): snippets carry
// docref attributes in the fence info string; claims are comment pairs. The
// scanner is fence-aware so example fences inside longer fences and claim
// syntax inside code blocks are content, never references. Malformed
// references are hard errors.
import { parseRef, type Ref } from './ref';

// The claim marker's literal close line. The emitters below and the CLAIM_END
// scanner below it both key off the same syntax; keeping the emitted form in one
// const keeps the round-trip honest.
const CLAIM_END_LINE = '<!-- docref: end -->';

export type Snippet = {
	kind: 'snippet';
	openLine: number; // 1-based, inclusive
	closeLine: number;
	indent: string;
	fenceChar: string;
	fenceLen: number;
	language: string;
	tokens: string[]; // info-string tokens after the language word
	ref: string;
	sha?: string;
	body: string;
};

export type Claim = {
	kind: 'claim';
	openLine: number;
	closeLine: number;
	indent: string;
	tokens: string[];
	/** bare refs joined with commas, for display */
	ref: string;
	refs: string[];
	/** one entry per ref, in order; undefined = that source unapproved */
	shas: (string | undefined)[];
};

export type Reference = Snippet | Claim;
export type ScanError = { line: number; code: string; message: string };

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const CLAIM_BEGIN = /^(\s*)<!--\s*docref:\s*begin\s+(.+?)\s*-->\s*$/;
const CLAIM_END = /^\s*<!--\s*docref:\s*end\s*-->\s*$/;
const SHA = /^[0-9a-f]{8,64}$/i;

type Attrs = { ref?: string; refs?: string[]; shas?: (string | undefined)[] };

/**
 * The sha rides on the ref it pins: `path#fragment:sha`. The alias
 * separator is the FIRST colon of a ref, the sha suffix the LAST, and
 * fragments cannot contain colons, so the two never collide.
 */
export function splitShaSuffix(part: string): { ref: string; sha?: string } {
	const { bare, sha } = parseRefWithSha(part);
	return sha !== undefined ? { ref: bare, sha } : { ref: bare };
}

/**
 * Like {@link splitShaSuffix}, but also returns the parsed {@link Ref}, so a
 * caller that needs the Ref (resolveReference, remove) does not re-parse the
 * bare string a second time. `bare` is the ref without its `:sha` suffix.
 */
export function parseRefWithSha(part: string): { ref: Ref; bare: string; sha?: string } {
	const at = part.lastIndexOf(':');
	if (at > 0) {
		const suffix = part.slice(at + 1);
		if (SHA.test(suffix)) {
			const bare = part.slice(0, at);
			try {
				const ref = parseRef(bare);
				return { ref, bare, sha: suffix.toLowerCase() };
			} catch {
				// the colon belonged to the ref itself; validate it whole
			}
		}
	}
	const ref = parseRef(part); // throws on an invalid ref
	return { ref, bare: part };
}

/**
 * Validate reference tokens; returns null with an error pushed. Claims
 * (src=) may pin several anchors as a comma list, each carrying its
 * own `:sha`; snippets (docref=) are single-source, since a fence can
 * materialize exactly one anchor.
 */
function readAttrs(
	tokens: string[],
	refKey: 'docref' | 'src',
	line: number,
	errors: ScanError[]
): Attrs | null {
	const attrs: Attrs = {};
	const fail = (message: string): null => {
		errors.push({ line, code: 'malformed-reference', message });
		return null;
	};
	for (const t of tokens) {
		const eq = t.indexOf('=');
		if (eq < 1) continue; // opaque token, preserved but not ours
		const key = t.slice(0, eq);
		const value = t.slice(eq + 1);
		if (key === refKey) {
			const parts = value.split(',');
			if (refKey === 'docref' && parts.length > 1) {
				return fail('a snippet materializes exactly one anchor; use a claim for several');
			}
			const refs: string[] = [];
			const shas: (string | undefined)[] = [];
			for (const part of parts) {
				try {
					const split = splitShaSuffix(part);
					refs.push(split.ref);
					shas.push(split.sha);
				} catch (e) {
					return fail((e as Error).message);
				}
			}
			attrs.ref = refs.join(',');
			attrs.refs = refs;
			attrs.shas = shas;
		} else if (key === 'sha') {
			return fail(
				'the sha rides on the ref (path#fragment:sha); a separate sha= attribute is not part of the format'
			);
		}
	}
	return attrs;
}

type Fence = { char: string; len: number };

/** The fence a line opens (>=3 backticks or tildes), or null. */
function fenceOpen(line: string): Fence | null {
	const m = FENCE_OPEN.exec(line);
	if (!m) return null;
	const run = m[2]!;
	return { char: run[0]!, len: run.length };
}

/**
 * Whether `line` closes `fence`: a run of the SAME char, at least as long,
 * alone on the line. Neither backtick nor tilde is a regex metacharacter, so
 * the char interpolates literally.
 */
function fenceCloses(line: string, fence: Fence): boolean {
	return new RegExp(`^\\s*${fence.char}{${fence.len},}\\s*$`).test(line);
}

/**
 * The one fence model, shared by every fence-aware pass. Yields each line with
 * whether it lies inside a fenced code block; the delimiter lines themselves
 * report inFence:true (they are markup, not prose). Char- and length-aware, so
 * a ``` run never closes a ~~~ fence and a shorter run never closes a longer
 * one — exactly scanMarkdown's rule.
 */
export function* eachLine(text: string): Generator<{ line: string; index: number; inFence: boolean }> {
	const lines = text.split('\n');
	let fence: Fence | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (fence) {
			const closes = fenceCloses(line, fence);
			yield { line, index: i, inFence: true };
			if (closes) fence = null;
			continue;
		}
		const open = fenceOpen(line);
		if (open) {
			fence = open;
			yield { line, index: i, inFence: true };
			continue;
		}
		yield { line, index: i, inFence: false };
	}
}

/**
 * Blank every fenced-code line (delimiters included) while preserving line
 * numbers, so marker EXAMPLES inside prose are never mistaken for real anchors.
 */
export function maskFences(text: string): string {
	const out: string[] = [];
	for (const { line, inFence } of eachLine(text)) out.push(inFence ? '' : line);
	return out.join('\n');
}

export function scanMarkdown(text: string): { references: Reference[]; errors: ScanError[] } {
	const references: Reference[] = [];
	const errors: ScanError[] = [];
	const lines = text.split('\n');

	let fence: { char: string; len: number } | null = null;
	let pending: (Omit<Snippet, 'body' | 'closeLine'> & { bodyStart: number }) | null = null;
	let claim: Omit<Claim, 'closeLine'> | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		if (fence) {
			if (fenceCloses(line, fence)) {
				if (pending) {
					const { bodyStart, ...rest } = pending;
					references.push({ ...rest, body: lines.slice(bodyStart, i).join('\n'), closeLine: i + 1 });
					pending = null;
				}
				fence = null;
			}
			continue;
		}

		const open = FENCE_OPEN.exec(line);
		if (open) {
			const indent = open[1]!;
			const run = open[2]!;
			const restRaw = open[3]!;
			fence = { char: run[0]!, len: run.length };
			const info = restRaw.trim();
			if (!info.includes('docref=')) continue;

			const all = info.split(/\s+/).filter(Boolean);
			const language = all[0] && !all[0].includes('=') ? all[0] : '';
			const tokens = language ? all.slice(1) : all;
			const attrs = readAttrs(tokens, 'docref', i + 1, errors);
			if (!attrs || !attrs.ref) continue; // error already recorded or not ours
			pending = {
				kind: 'snippet',
				openLine: i + 1,
				indent,
				fenceChar: fence.char,
				fenceLen: fence.len,
				language,
				tokens,
				ref: attrs.ref,
				...(attrs.shas![0] !== undefined ? { sha: attrs.shas![0] } : {}),
				bodyStart: i + 1
			};
			continue;
		}

		if (CLAIM_END.test(line)) {
			if (claim) {
				references.push({ ...claim, closeLine: i + 1 });
				claim = null;
			} else {
				errors.push({ line: i + 1, code: 'unmatched-claim-end', message: 'claim end without a begin' });
			}
			continue;
		}

		const begin = CLAIM_BEGIN.exec(line);
		if (begin) {
			const indent = begin[1]!;
			const argsRaw = begin[2]!;
			const tokens = argsRaw.split(/\s+/).filter(Boolean);
			const withEq = tokens.filter((t) => t.includes('='));
			if (withEq.length === 0) {
				// name form: a region marker in a markdown source file, not a claim
				continue;
			}
			if (withEq.length !== tokens.length) {
				errors.push({
					line: i + 1,
					code: 'malformed-reference',
					message: 'claim arguments mix names and key=value attributes'
				});
				continue;
			}
			if (claim) {
				errors.push({ line: i + 1, code: 'nested-claim', message: 'claim blocks do not nest' });
				continue;
			}
			const attrs = readAttrs(tokens, 'src', i + 1, errors);
			if (!attrs) continue;
			if (!attrs.ref) {
				errors.push({ line: i + 1, code: 'malformed-reference', message: 'claim is missing src=' });
				continue;
			}
			claim = {
				kind: 'claim',
				openLine: i + 1,
				indent,
				tokens,
				ref: attrs.ref,
				refs: attrs.refs!,
				shas: attrs.shas!
			};
		}
	}

	if (pending) {
		errors.push({
			line: pending.openLine,
			code: 'unclosed-snippet',
			message: `snippet for ${pending.ref} is never closed`
		});
	}
	if (claim) {
		errors.push({
			line: claim.openLine,
			code: 'unclosed-claim',
			message: `claim for ${claim.ref} is never closed`
		});
	}

	return { references, errors };
}

/** Rewrite the ref token's value, keeping every other token in order. */
export function withRefValue(tokens: string[], anchorKey: string, value: string): string[] {
	return tokens.map((t) => (t.startsWith(`${anchorKey}=`) ? `${anchorKey}=${value}` : t));
}

/** The one place a claim begin line is emitted (approveClaims, claimBlockText,
 * and ops.remove all call it), so the marker's open syntax cannot drift. */
export function renderClaimBegin(indent: string, tokens: string[]): string {
	return `${indent}<!-- docref: begin ${tokens.join(' ')} -->`;
}

/** The `src=` value for a claim: each ref with its sha when approved, else bare,
 * comma-joined. Used where the sha is CONDITIONAL (claimBlockText, ops.remove);
 * approveClaims emits shas unconditionally and does not use this. */
export function buildSrcValue(sources: { ref: string; sha?: string }[]): string {
	return sources.map((s) => (s.sha ? `${s.ref}:${s.sha}` : s.ref)).join(',');
}

export type SnippetEdit = { carrier: Snippet; body: string; sha: string };

/**
 * Rewrite snippets in place: new body, sha placed after docref=. The
 * fence is lengthened when the body itself contains fence-like runs, so the
 * result always round-trips through scanMarkdown.
 */
function fenceLengthFor(body: string, fenceChar: string, atLeast = 3): number {
	let maxRun = 0;
	for (const l of body.split('\n')) {
		// fenceChar is a single backtick or tilde — neither is regex-special
		const run = new RegExp(`^\\s*(${fenceChar}{3,})`).exec(l);
		if (run) maxRun = Math.max(maxRun, run[1]!.length);
	}
	return Math.max(atLeast, maxRun + 1, 3);
}

export function rewriteSnippets(text: string, edits: SnippetEdit[]): string {
	const lines = text.split('\n');
	const sorted = [...edits].sort((a, b) => b.carrier.openLine - a.carrier.openLine);
	for (const { carrier: c, body, sha } of sorted) {
		const bodyLines = body === '' ? [] : body.split('\n');
		const len = fenceLengthFor(body, c.fenceChar, c.fenceLen);
		const tokens = withRefValue(c.tokens, 'docref', `${c.ref}:${sha}`);
		const openLine =
			c.indent + c.fenceChar.repeat(len) + (c.language ? c.language + ' ' : '') + tokens.join(' ');
		const closeLine = c.indent + c.fenceChar.repeat(len);
		lines.splice(c.openLine - 1, c.closeLine - c.openLine + 1, openLine, ...bodyLines, closeLine);
	}
	return lines.join('\n');
}

export type ClaimEdit = { carrier: Claim; shas: string[] };

/** Advance claim shas (the approval). Only the begin line is touched. */
export function approveClaims(text: string, edits: ClaimEdit[]): string {
	const lines = text.split('\n');
	for (const { carrier: c, shas } of edits) {
		// approval pins every source: shas are unconditional here, not buildSrcValue
		const value = c.refs.map((r, k) => `${r}:${shas[k]}`).join(',');
		const tokens = withRefValue(c.tokens, 'src', value);
		lines[c.openLine - 1] = renderClaimBegin(c.indent, tokens);
	}
	return lines.join('\n');
}

/**
 * Paste-ready snippet: materialized body, sha riding the ref, fence
 * lengthened past any fence runs in the body. What the staging flow
 * inserts at the cursor; nobody computes a hash by hand.
 */
export function snippetFenceText(ref: string, sha: string, language: string, body: string): string {
	const run = '`'.repeat(fenceLengthFor(body, '`'));
	return `${run}${language ? language + ' ' : ''}docref=${ref}:${sha}\n${body}\n${run}\n`;
}

/** Paste-ready claim block, one source per ref, shas riding along. */
export function claimBlockText(sources: { ref: string; sha?: string }[]): string {
	const begin = renderClaimBegin('', [`src=${buildSrcValue(sources)}`]);
	return `${begin}\n\n${CLAIM_END_LINE}\n`;
}
