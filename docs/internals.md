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
