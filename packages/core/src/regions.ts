// Region markers (format.md section 2): "docref: begin <name>" /
// "docref: end <name>" anywhere in a line, behind any comment leader.
// Names are kebab-case and unique per file; end always carries the name;
// marker lines are excluded from extraction. The negative lookahead keeps
// the attribute form (pin blocks, "src=...") from reading as a name.
import { KEBAB_BODY } from './ref';

// Composed from the shared kebab body so the marker grammar and the ref grammar
// cannot drift. The negative lookahead keeps the attribute form (src=...) from
// reading as a name.
const MARKER = new RegExp(`docref:\\s*(begin|end)\\s+(${KEBAB_BODY})(?![A-Za-z0-9=_-])`);

export type Region = { beginLine: number; endLine: number };
export type RegionError = { line: number; code: string; message: string };

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
		const verb = m[1]!;
		const name = m[2]!;
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
