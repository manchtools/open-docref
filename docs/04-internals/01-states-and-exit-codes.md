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
which is what makes `check` a usable CI gate. The gate **level** (set with
`[check] level` or a `--strict`/`--lenient`/`--advisory` flag) decides how
strict that collapse is: `strict` (default) fails on drift and broken alike;
`lenient` fails only on a broken ref or error, so drift is reported but does not
gate; `advisory` reports everything and never fails.

```ts docref=packages/core/src/ops.ts#exitCodeFor:470b3765
export function exitCodeFor(report: Report, level: GateLevel = 'strict'): 0 | 1 | 2 {
	if (level === 'advisory') return EXIT.ok;
	const s = report.summary;
	if (report.errors.length > 0 || s.broken > 0) return EXIT.broken;
	if (level === 'lenient') return EXIT.ok;
	if (s.staleSnippet > 0 || s.staleClaim > 0 || report.unusedAnchors.length > 0) return EXIT.stale;
	return EXIT.ok;
}
```
