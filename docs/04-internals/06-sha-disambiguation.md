---
title: Disambiguating the sha suffix
description: Telling the alias colon from the sha colon so the two never collide.
---

# Disambiguating the sha suffix

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
