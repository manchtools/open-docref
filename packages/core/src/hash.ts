// Content hashing (format.md section 5): sha256 over the UTF-8 bytes of
// the content with every Unicode White_Space code point removed, so
// formatter churn never invalidates a hash and token changes always do.
import { createHash } from 'node:crypto';

// \s in JS regexes covers Unicode White_Space except U+0085 (NEL), so NEL
// is added explicitly. The escape is deliberate: a literal NEL here would be
// an invisible byte any editor or formatter could silently strip, which would
// change every stored hash. Written as \u0085, the intent survives reformatting.
const WHITESPACE = /[\s\u0085]+/gu;

export function stripWhitespace(content: string): string {
	return content.replace(WHITESPACE, '');
}

export function contentHash(content: string): string {
	return createHash('sha256').update(stripWhitespace(content), 'utf8').digest('hex');
}

/**
 * The displayed/compared hash width. The single source of truth for the short
 * form: the prefix `shortHash` emits and the minimum `hashesMatch` will compare
 * derive from it, so the display width and the comparison floor cannot desync.
 */
export const SHORT_HASH_LEN = 8;

export function shortHash(content: string): string {
	return contentHash(content).slice(0, SHORT_HASH_LEN);
}

/**
 * Compare a stored hash against another (either may be a prefix). Matching
 * needs at least SHORT_HASH_LEN hex characters on both sides; anything thinner
 * is treated as a mismatch so a truncated value can never approve by accident.
 */
export function hashesMatch(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	if (la.length < SHORT_HASH_LEN || lb.length < SHORT_HASH_LEN) return false;
	if (!/^[0-9a-f]+$/.test(la) || !/^[0-9a-f]+$/.test(lb)) return false;
	return la.startsWith(lb) || lb.startsWith(la);
}
