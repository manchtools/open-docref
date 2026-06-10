// Anchor resolution (format.md sections 1, 2): whole file, region, or
// symbol, read through a FileSource (working tree or a pinned git rev).
// Every failure is a typed, fail-closed error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dedent } from './dedent';
import { DocrefError } from './errors';
import type { Ref } from './ref';
import { scanRegions } from './regions';
import { findSymbol } from './symbols';

export type FileSource = {
	read(path: string): string | null;
	describe(): string;
};

export function workingTreeSource(root: string): FileSource {
	return {
		read(path: string): string | null {
			try {
				return readFileSync(join(root, path), 'utf8');
			} catch {
				return null;
			}
		},
		describe: () => root
	};
}

export type Anchor = {
	content: string;
	/** 1-based line span in the source file; regions include their marker lines. */
	span?: { startLine: number; endLine: number };
};

export async function resolveAnchor(source: FileSource, ref: Ref): Promise<Anchor> {
	const text = source.read(ref.path);
	if (text === null) {
		throw new DocrefError('missing-file', `"${ref.path}" not found in ${source.describe()}`);
	}
	if (!ref.fragment) return { content: text };

	if (ref.fragment.kind === 'region') {
		const { regions, errors } = scanRegions(text);
		if (errors.length > 0) {
			const e = errors[0]!;
			throw new DocrefError('region-error', `${ref.path}:${e.line} ${e.message}`);
		}
		const region = regions.get(ref.fragment.name);
		if (!region) {
			throw new DocrefError(
				'region-not-found',
				`region "@${ref.fragment.name}" not found in ${ref.path}`
			);
		}
		const content = dedent(
			text
				.split('\n')
				.slice(region.beginLine, region.endLine - 1)
				.join('\n')
		);
		return { content, span: { startLine: region.beginLine, endLine: region.endLine } };
	}

	const decl = await findSymbol(text, ref.path, ref.fragment.name);
	return { content: decl.content, span: { startLine: decl.startLine, endLine: decl.endLine } };
}
