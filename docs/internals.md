# Internals

A short tour of the core, with the relevant code embedded directly. Every
fenced block below is a docref snippet: its body is materialized from the
source and kept current by `docref refresh`, so this page cannot quietly drift
from the implementation it describes. This is also the tool dogfooding itself —
the snippets here are real references that `docref check` resolves in CI.

## Reference states

Every snippet and claim is in exactly one state; the whole tool is organized
around moving references between them (see [format.md](format.md) section 7).

```ts docref=packages/core/src/ops.ts#State:18fd84bc
export type State = 'up-to-date' | 'stale-snippet' | 'stale-claim' | 'broken';
```

A run of references collapses to a process exit code — clean, stale, or broken
— which is what makes `check` a usable CI gate.

```ts docref=packages/core/src/ops.ts#exitCode:926bfd35
export function exitCode(report: Report): 0 | 1 | 2 {
	const s = report.summary;
	if (report.errors.length > 0 || s.broken > 0) return 2;
	if (s.staleSnippet > 0 || s.staleClaim > 0 || report.unusedAnchors.length > 0) return 1;
	return 0;
}
```

## Hashing

A reference stores a hash of the anchored code with every whitespace code point
removed, so formatter churn never invalidates it and only token changes do.

```ts docref=packages/core/src/hash.ts#contentHash:b8c62d04
export function contentHash(content: string): string {
	return createHash('sha256').update(stripWhitespace(content), 'utf8').digest('hex');
}
```

## Symbol languages

Structural (tree-sitter) symbol resolution is available for these file
extensions. Anything else still works with a region marker.

```ts docref=packages/core/src/languages.ts#LanguageId:67736556
export type LanguageId = 'typescript' | 'tsx' | 'javascript' | 'go' | 'python';
```

## Parsing a reference

The grammar from [format.md](format.md) section 1 is enforced here; anything
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

## Region markers

Markers are recognized anywhere in a line, behind any comment leader. Names
are unique per file; an unmatched or duplicate marker is an error.

```ts docref=packages/core/src/regions.ts#scanRegions:5fcc3f83
export function scanRegions(source: string): {
	regions: Map<string, Region>;
	errors: RegionError[];
} {
	const regions = new Map<string, Region>();
	const open = new Map<string, number>();
	const errors: RegionError[] = [];
	const lines = source.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const m = MARKER.exec(lines[i]!);
		if (!m) continue;
		const [, verb, name] = m as unknown as [string, 'begin' | 'end', string];
		const line = i + 1;
		if (verb === 'begin') {
			if (regions.has(name) || open.has(name)) {
				errors.push({ line, code: 'duplicate-region', message: `region "${name}" begins twice` });
				continue;
			}
			open.set(name, line);
		} else {
			const beginLine = open.get(name);
			if (beginLine === undefined) {
				errors.push({ line, code: 'unmatched-end', message: `end of "${name}" without a begin` });
				continue;
			}
			open.delete(name);
			regions.set(name, { beginLine, endLine: line });
		}
	}

	for (const [name, line] of open) {
		errors.push({ line, code: 'unmatched-begin', message: `region "${name}" is never closed` });
	}

	return { regions, errors };
}
```

## Disambiguating the sha suffix

A ref is `[alias:]path[#fragment][:sha]`. The alias separator is the first
colon, the sha suffix the last, and fragments cannot contain colons, so the
two never collide — the parser proves which is which.

```ts docref=packages/core/src/markdown.ts#splitShaSuffix:30ec78f1
export function splitShaSuffix(part: string): { ref: string; sha?: string } {
	const at = part.lastIndexOf(':');
	if (at > 0) {
		const suffix = part.slice(at + 1);
		if (SHA.test(suffix)) {
			const bare = part.slice(0, at);
			try {
				parseRef(bare);
				return { ref: bare, sha: suffix.toLowerCase() };
			} catch {
				// the colon belonged to the ref itself; validate it whole
			}
		}
	}
	parseRef(part); // throws on an invalid ref
	return { ref: part };
}
```

## Comparing hashes

References store an 8-hex prefix; a comparison accepts a longer prefix on
either side and refuses to match on fewer than 8 characters.

```ts docref=packages/core/src/hash.ts#hashesMatch:95849d90
export function hashesMatch(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	if (la.length < 8 || lb.length < 8) return false;
	if (!/^[0-9a-f]+$/.test(la) || !/^[0-9a-f]+$/.test(lb)) return false;
	return la.startsWith(lb) || lb.startsWith(la);
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

## The editor layer

The VSCode extension is thin wiring over this same core; the decisions and
formatting it needs live in a `logic.ts` kept free of the editor API so they
are unit-testable. The status-bar summary, for instance:

```ts docref=packages/vscode/src/logic.ts#statusText:11321715
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
```

"Create anchor" picks a comment leader by language; an unknown language falls
back to a quick-pick in the extension layer.

```ts docref=packages/vscode/src/logic.ts#commentLeaderFor:ade6eb1c
export function commentLeaderFor(languageId: string): Leader | null {
	const line = LINE_LEADERS[languageId];
	if (line) return { kind: 'line', open: line };
	const block = BLOCK_LEADERS[languageId];
	if (block) return { kind: 'block', open: block[0], close: block[1] };
	return null;
}
```
