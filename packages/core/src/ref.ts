// Reference parsing (format.md section 1):
//   ref = [alias ":"] path ["#" fragment]
// Anything outside the grammar is a hard error; the parser never guesses.
import { DocrefError } from './errors';

export type Fragment = { kind: 'symbol'; name: string } | { kind: 'region'; name: string };

export type Ref = {
	raw: string;
	alias?: string;
	path: string;
	fragment?: Fragment;
};

// The body of a kebab-case identifier (no anchors): lowercase alnum start,
// internal hyphens. The single source of truth for the shape of a repo alias,
// a region name (this file), and the region MARKER (regions.ts) — they must not
// drift apart. regions.ts composes its line-scanning regex from KEBAB_BODY.
export const KEBAB_BODY = '[a-z0-9][a-z0-9-]*';
export const KEBAB_NAME = new RegExp(`^${KEBAB_BODY}$`);
/** Whether a string is a kebab-case name (alias / region name). */
export const isKebabName = (s: string): boolean => KEBAB_NAME.test(s);

const SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

function fail(raw: string, why: string): never {
	throw new DocrefError('invalid-ref', `invalid ref "${raw}": ${why}`);
}

export function parseRef(raw: string): Ref {
	if (!raw) fail(raw, 'empty');

	let rest = raw;
	let alias: string | undefined;
	const colon = rest.indexOf(':');
	if (colon !== -1) {
		alias = rest.slice(0, colon);
		rest = rest.slice(colon + 1);
		if (!isKebabName(alias)) fail(raw, `alias "${alias}" must be kebab-case`);
	}

	let path = rest;
	let fragment: Fragment | undefined;
	const hash = rest.indexOf('#');
	if (hash !== -1) {
		path = rest.slice(0, hash);
		const frag = rest.slice(hash + 1);
		if (!frag) fail(raw, 'empty fragment');
		if (frag.startsWith('@')) {
			const name = frag.slice(1);
			if (!isKebabName(name)) fail(raw, `region name "${name}" must be kebab-case`);
			fragment = { kind: 'region', name };
		} else {
			if (!SYMBOL.test(frag)) {
				fail(raw, `"${frag}" is not a symbol path (line numbers are not supported; use a region marker)`);
			}
			fragment = { kind: 'symbol', name: frag };
		}
	}

	if (!path) fail(raw, 'empty path');
	if (path.includes(' ')) fail(raw, 'paths must not contain spaces');
	if (path.includes('\\')) fail(raw, 'paths are POSIX (no backslashes)');
	if (path.startsWith('/')) fail(raw, 'paths are repo-relative (no leading /)');
	if (path.startsWith('./')) fail(raw, 'paths are repo-relative (no leading ./)');
	if (path.split('/').some((seg) => seg === '..' || seg === '')) {
		fail(raw, 'paths must not contain ".." or empty segments');
	}

	const ref: Ref = { raw, path };
	if (alias !== undefined) ref.alias = alias;
	if (fragment !== undefined) ref.fragment = fragment;
	return ref;
}
