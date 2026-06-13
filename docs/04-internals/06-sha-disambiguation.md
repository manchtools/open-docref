---
title: Disambiguating the sha suffix
description: Telling the alias colon from the sha colon so the two never collide.
---

# Disambiguating the sha suffix

A ref is `[alias:]path[#fragment][:sha]`. The alias separator is the first
colon, the sha suffix the last, and fragments cannot contain colons, so the
two never collide: the parser proves which is which.

```ts docref=packages/core/src/markdown.ts#splitShaSuffix:6a2cefbf
export function splitShaSuffix(part: string): { ref: string; sha?: string } {
	const { bare, sha } = parseRefWithSha(part);
	return sha !== undefined ? { ref: bare, sha } : { ref: bare };
}
```
