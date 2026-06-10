// Region markers (format.md section 2): "docref: begin <name>" /
// "docref: end <name>" anywhere in a line, behind any comment leader.
// Names are kebab-case and unique per file; end always carries the name;
// marker lines are excluded from extraction. The negative lookahead keeps
// the attribute form (pin blocks, "src=...") from reading as a name.
import { DocrefError } from './errors';

const MARKER = /docref:\s*(begin|end)\s+([a-z0-9][a-z0-9-]*)(?![A-Za-z0-9=_-])/;

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

export function extractRegion(source: string, name: string): string {
	const { regions, errors } = scanRegions(source);
	if (errors.length > 0) {
		const e = errors[0]!;
		throw new DocrefError('region-error', `line ${e.line}: ${e.message}`);
	}
	const region = regions.get(name);
	if (!region) {
		throw new DocrefError('region-not-found', `region "${name}" not found`);
	}
	return source.split('\n').slice(region.beginLine, region.endLine - 1).join('\n');
}
