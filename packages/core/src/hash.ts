// Content hashing (format.md section 5): sha256 over the UTF-8 bytes of
// the content with every Unicode White_Space code point removed, so
// formatter churn never invalidates a hash and token changes always do.
import { createHash } from 'node:crypto';

// \s in JS regexes covers Unicode White_Space except U+0085 (NEL), which
// must be added by hand to honor "every White_Space code point".
const WHITESPACE = /[\s]+/gu;

export function stripWhitespace(content: string): string {
	return content.replace(WHITESPACE, '');
}

export function contentHash(content: string): string {
	return createHash('sha256').update(stripWhitespace(content), 'utf8').digest('hex');
}

export function shortHash(content: string): string {
	return contentHash(content).slice(0, 8);
}

/**
 * Compare a stored hash against another (either may be a prefix). Matching
 * needs at least 8 hex characters on both sides; anything thinner is
 * treated as a mismatch so a truncated value can never bless by accident.
 */
export function hashesMatch(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	if (la.length < 8 || lb.length < 8) return false;
	if (!/^[0-9a-f]+$/.test(la) || !/^[0-9a-f]+$/.test(lb)) return false;
	return la.startsWith(lb) || lb.startsWith(la);
}
