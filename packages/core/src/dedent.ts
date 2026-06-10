/**
 * Remove the longest common leading whitespace from every line (blank
 * lines ignored). Materialized snippets of nested anchors come out flush
 * left with their internal nesting preserved. Purely presentational:
 * hashing strips all whitespace anyway.
 */
export function dedent(content: string): string {
	const lines = content.split('\n');
	let common: string | null = null;
	for (const line of lines) {
		if (line.trim() === '') continue;
		const indent = /^[\t ]*/.exec(line)![0];
		if (common === null) {
			common = indent;
		} else {
			let k = 0;
			while (k < common.length && k < indent.length && common[k] === indent[k]) k++;
			common = common.slice(0, k);
		}
		if (common === '') return content;
	}
	if (!common) return content;
	const cut = common.length;
	return lines.map((l) => (l.trim() === '' ? l : l.slice(cut))).join('\n');
}
