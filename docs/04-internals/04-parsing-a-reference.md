---
title: Parsing a reference
description: Enforcing the ref grammar without guessing, and walking up to the project root.
---

# Parsing a reference

The grammar from [References](/format/references) section 1 is enforced here; anything
outside it is a hard error and the parser never guesses.

```ts docref=packages/core/src/ref.ts#parseRef:5e6d511d
export function parseRef(raw: string): Ref {
	if (!raw) fail(raw, 'empty');

	let rest = raw;
	let alias: string | undefined;
	const colon = rest.indexOf(':');
	if (colon !== -1) {
		alias = rest.slice(0, colon);
		rest = rest.slice(colon + 1);
		if (!ALIAS.test(alias)) fail(raw, `alias "${alias}" must match ${ALIAS}`);
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
			if (!REGION.test(name)) fail(raw, `region name "${name}" must be kebab-case`);
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
```

## Finding the project root

Run from anywhere inside the repository: `docref` walks up to the nearest
`docref.toml`, falling back to the working directory.

```ts docref=packages/core/src/config.ts#findRoot:371ad98d
export function findRoot(cwd: string): string {
	let dir = cwd;
	for (;;) {
		if (existsSync(join(dir, 'docref.toml'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
}
```
