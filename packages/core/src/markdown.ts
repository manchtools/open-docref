// Markdown carriers (format.md sections 3 and 4): snippet fences carry
// docref attributes in the info string; pin blocks are comment pairs. The
// scanner is fence-aware so example fences inside longer fences and pin
// syntax inside code blocks are content, never carriers. Malformed
// carriers are hard errors.
import { parseRef } from './ref';
import { DocrefError } from './errors';

export type FenceCarrier = {
	kind: 'fence';
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

export type PinCarrier = {
	kind: 'pin';
	openLine: number;
	closeLine: number;
	indent: string;
	tokens: string[];
	ref: string;
	sha?: string;
};

export type Carrier = FenceCarrier | PinCarrier;
export type ScanError = { line: number; code: string; message: string };

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const PIN_BEGIN = /^(\s*)<!--\s*docref:\s*begin\s+(.+?)\s*-->\s*$/;
const PIN_END = /^\s*<!--\s*docref:\s*end\s*-->\s*$/;
const SHA = /^[0-9a-f]{8,64}$/i;

type Attrs = { ref?: string; sha?: string };

/** Validate docref/sha attribute tokens; returns null with an error pushed. */
function readAttrs(
	tokens: string[],
	refKey: 'docref' | 'src',
	line: number,
	errors: ScanError[]
): Attrs | null {
	const attrs: Attrs = {};
	for (const t of tokens) {
		const eq = t.indexOf('=');
		if (eq < 1) continue; // opaque token, preserved but not ours
		const key = t.slice(0, eq);
		const value = t.slice(eq + 1);
		if (key === refKey) {
			try {
				parseRef(value);
			} catch (e) {
				errors.push({ line, code: 'malformed-carrier', message: (e as Error).message });
				return null;
			}
			attrs.ref = value;
		} else if (key === 'sha') {
			if (!SHA.test(value)) {
				errors.push({
					line,
					code: 'malformed-carrier',
					message: `sha "${value}" is not 8-64 hex characters`
				});
				return null;
			}
			attrs.sha = value.toLowerCase();
		}
	}
	return attrs;
}

export function scanMarkdown(text: string): { carriers: Carrier[]; errors: ScanError[] } {
	const carriers: Carrier[] = [];
	const errors: ScanError[] = [];
	const lines = text.split('\n');

	let fence: { char: string; len: number } | null = null;
	let pending: (Omit<FenceCarrier, 'body' | 'closeLine'> & { bodyStart: number }) | null = null;
	let pin: (Omit<PinCarrier, 'closeLine'> & { hasSha: boolean }) | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		if (fence) {
			const close = new RegExp(`^\\s*${fence.char === '`' ? '`' : '~'}{${fence.len},}\\s*$`);
			if (close.test(line)) {
				if (pending) {
					const { bodyStart, ...rest } = pending;
					carriers.push({ ...rest, body: lines.slice(bodyStart, i).join('\n'), closeLine: i + 1 });
					pending = null;
				}
				fence = null;
			}
			continue;
		}

		const open = FENCE_OPEN.exec(line);
		if (open) {
			const [, indent, run, restRaw] = open as unknown as [string, string, string, string];
			fence = { char: run[0]!, len: run.length };
			const info = restRaw.trim();
			if (!info.includes('docref=')) continue;

			const all = info.split(/\s+/).filter(Boolean);
			const language = all[0] && !all[0].includes('=') ? all[0] : '';
			const tokens = language ? all.slice(1) : all;
			const attrs = readAttrs(tokens, 'docref', i + 1, errors);
			if (!attrs || !attrs.ref) continue; // error already recorded or not ours
			pending = {
				kind: 'fence',
				openLine: i + 1,
				indent,
				fenceChar: fence.char,
				fenceLen: fence.len,
				language,
				tokens,
				ref: attrs.ref,
				...(attrs.sha !== undefined ? { sha: attrs.sha } : {}),
				bodyStart: i + 1
			};
			continue;
		}

		if (PIN_END.test(line)) {
			if (pin) {
				const { hasSha, ...rest } = pin;
				void hasSha;
				carriers.push({ ...rest, closeLine: i + 1 });
				pin = null;
			} else {
				errors.push({ line: i + 1, code: 'unmatched-pin-end', message: 'pin end without a begin' });
			}
			continue;
		}

		const begin = PIN_BEGIN.exec(line);
		if (begin) {
			const [, indent, argsRaw] = begin as unknown as [string, string, string];
			const tokens = argsRaw.split(/\s+/).filter(Boolean);
			const withEq = tokens.filter((t) => t.includes('='));
			if (withEq.length === 0) {
				// name form: a region marker in a markdown source file, not a pin
				continue;
			}
			if (withEq.length !== tokens.length) {
				errors.push({
					line: i + 1,
					code: 'malformed-carrier',
					message: 'pin arguments mix names and key=value attributes'
				});
				continue;
			}
			if (pin) {
				errors.push({ line: i + 1, code: 'nested-pin', message: 'pin blocks do not nest' });
				continue;
			}
			const attrs = readAttrs(tokens, 'src', i + 1, errors);
			if (!attrs) continue;
			if (!attrs.ref) {
				errors.push({ line: i + 1, code: 'malformed-carrier', message: 'pin is missing src=' });
				continue;
			}
			pin = {
				kind: 'pin',
				openLine: i + 1,
				indent,
				tokens,
				ref: attrs.ref,
				...(attrs.sha !== undefined ? { sha: attrs.sha } : {}),
				hasSha: attrs.sha !== undefined
			};
		}
	}

	if (pending) {
		errors.push({
			line: pending.openLine,
			code: 'unclosed-fence',
			message: `fence carrier for ${pending.ref} is never closed`
		});
	}
	if (pin) {
		errors.push({
			line: pin.openLine,
			code: 'unclosed-pin',
			message: `pin for ${pin.ref} is never closed`
		});
	}

	return { carriers, errors };
}

/** Place or update the sha token, keeping every other token in order. */
function withSha(tokens: string[], anchorKey: string, sha: string): string[] {
	const out = [...tokens];
	const at = out.findIndex((t) => t.startsWith('sha='));
	if (at >= 0) {
		out[at] = `sha=${sha}`;
		return out;
	}
	const anchorAt = out.findIndex((t) => t.startsWith(`${anchorKey}=`));
	out.splice(anchorAt + 1, 0, `sha=${sha}`);
	return out;
}

export type FenceEdit = { carrier: FenceCarrier; body: string; sha: string };

/**
 * Rewrite fence carriers in place: new body, sha placed after docref=. The
 * fence is lengthened when the body itself contains fence-like runs, so the
 * result always round-trips through scanMarkdown.
 */
export function rewriteFences(text: string, edits: FenceEdit[]): string {
	const lines = text.split('\n');
	const sorted = [...edits].sort((a, b) => b.carrier.openLine - a.carrier.openLine);
	for (const { carrier: c, body, sha } of sorted) {
		const bodyLines = body === '' ? [] : body.split('\n');
		let maxRun = 0;
		for (const l of bodyLines) {
			const run = new RegExp(`^\\s*(${c.fenceChar === '`' ? '`' : '~'}{3,})`).exec(l);
			if (run) maxRun = Math.max(maxRun, run[1]!.length);
		}
		const len = Math.max(c.fenceLen, maxRun + 1, 3);
		const tokens = withSha(c.tokens, 'docref', sha);
		const openLine =
			c.indent + c.fenceChar.repeat(len) + (c.language ? c.language + ' ' : '') + tokens.join(' ');
		const closeLine = c.indent + c.fenceChar.repeat(len);
		lines.splice(c.openLine - 1, c.closeLine - c.openLine + 1, openLine, ...bodyLines, closeLine);
	}
	return lines.join('\n');
}

export type PinEdit = { carrier: PinCarrier; sha: string };

/** Advance pin shas (the blessing). Only the begin line is touched. */
export function blessPins(text: string, edits: PinEdit[]): string {
	const lines = text.split('\n');
	for (const { carrier: c, sha } of edits) {
		const tokens = withSha(c.tokens, 'src', sha);
		lines[c.openLine - 1] = `${c.indent}<!-- docref: begin ${tokens.join(' ')} -->`;
	}
	return lines.join('\n');
}

export function assertNoErrors(errors: ScanError[], doc: string): void {
	if (errors.length > 0) {
		const e = errors[0]!;
		throw new DocrefError(e.code, `${doc}:${e.line} ${e.message}`);
	}
}
