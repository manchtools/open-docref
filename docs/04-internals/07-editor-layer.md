---
title: The editor layer
description: The unit-testable logic behind the VSCode extension's status bar and anchor creation.
---

# The editor layer

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
