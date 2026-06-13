---
title: Region marker scanning
description: Recognizing begin/end markers anywhere in a line and reporting unmatched or duplicate names.
---

# Region marker scanning

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
