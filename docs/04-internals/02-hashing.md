---
title: Hashing
description: Whitespace-stripped content hashing and how stored hash prefixes are compared.
---

# Hashing

A reference stores a hash of the anchored code with every whitespace code point
removed, so formatter churn never invalidates it and only token changes do.

```ts docref=packages/core/src/hash.ts#contentHash:b8c62d04
export function contentHash(content: string): string {
	return createHash('sha256').update(stripWhitespace(content), 'utf8').digest('hex');
}
```

## Comparing hashes

References store an 8-hex prefix; a comparison accepts a longer prefix on
either side and refuses to match on fewer than 8 characters.

```ts docref=packages/core/src/hash.ts#hashesMatch:77116135
export function hashesMatch(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	if (la.length < SHORT_HASH_LEN || lb.length < SHORT_HASH_LEN) return false;
	if (!/^[0-9a-f]+$/.test(la) || !/^[0-9a-f]+$/.test(lb)) return false;
	return la.startsWith(lb) || lb.startsWith(la);
}
```
