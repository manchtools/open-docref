---
title: Reference states & exit codes
description: The four states every reference is in, and how a run collapses to a process exit code for CI.
---

# Reference states & exit codes

Every snippet and claim is in exactly one state; the whole tool is organized
around moving references between them (see [Format specification](/format) section 7).

```ts docref=packages/core/src/ops.ts#State:18fd84bc
export type State = 'up-to-date' | 'stale-snippet' | 'stale-claim' | 'broken';
```

A run of references collapses to a process exit code (clean, stale, or broken),
which is what makes `check` a usable CI gate.

```ts docref=packages/core/src/ops.ts#exitCode:57a1b5ed
export function exitCode(report: Report): 0 | 1 | 2 {
	const s = report.summary;
	if (report.errors.length > 0 || s.broken > 0) return EXIT.broken;
	if (s.staleSnippet > 0 || s.staleClaim > 0 || report.unusedAnchors.length > 0) return EXIT.stale;
	return EXIT.ok;
}
```
