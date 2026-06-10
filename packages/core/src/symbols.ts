// Structural symbol resolution (format.md section 1): declarations are
// found by parsing with tree-sitter (WASM grammars, so a bare cached
// checkout needs no project setup). A fragment matches a declaration whose
// trailing path segments equal it; zero or multiple matches fail closed.
import { createRequire } from 'node:module';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { DocrefError } from './errors';
import { dedent } from './dedent';
import { languageForFile, type LanguageId } from './languages';

export type Decl = { path: string[]; startLine: number; endLine: number; content: string };

// works in ESM (vitest, the CLI) and inside a CJS bundle (the VSCode
// extension), where import.meta does not exist but require does
const require_: NodeJS.Require =
	typeof require === 'function' ? require : createRequire(import.meta.url);
let inited: Promise<void> | null = null;
const languages = new Map<string, Promise<Language>>();
const parsers = new Map<string, Parser>();

async function parserFor(wasm: string): Promise<Parser> {
	// the runtime wasm must be located through the package, not relative
	// to the executing file: a bundled CLI lives far from node_modules
	inited ??= Parser.init({
		locateFile: (name: string) => require_.resolve(`web-tree-sitter/${name}`)
	});
	await inited;
	let langPromise = languages.get(wasm);
	if (!langPromise) {
		langPromise = Language.load(require_.resolve(`tree-sitter-wasms/out/tree-sitter-${wasm}.wasm`));
		languages.set(wasm, langPromise);
	}
	const lang = await langPromise;
	let parser = parsers.get(wasm);
	if (!parser) {
		parser = new Parser();
		parser.setLanguage(lang);
		parsers.set(wasm, parser);
	}
	return parser;
}

function decl(source: string, node: Node, path: string[], out: Decl[]): void {
	// extend to the start of the first line so an indented declaration
	// keeps its own indent, then dedent the whole block flush left
	const lineStart = source.lastIndexOf('\n', node.startIndex - 1) + 1;
	const head = source.slice(lineStart, node.startIndex);
	const start = /^[\t ]*$/.test(head) ? lineStart : node.startIndex;
	out.push({
		path,
		startLine: node.startPosition.row + 1,
		endLine: node.endPosition.row + 1,
		content: dedent(source.slice(start, node.endIndex))
	});
}

/** The declaration span includes an export/decorator wrapper when present. */
function wrapped(node: Node, wrapperTypes: string[]): Node {
	return node.parent && wrapperTypes.includes(node.parent.type) ? node.parent : node;
}

function fieldChildren(node: Node, field: string): Node[] {
	const viaApi = (
		node as unknown as { childrenForFieldName?: (f: string) => (Node | null)[] }
	).childrenForFieldName?.(field);
	if (viaApi) return viaApi.filter((c): c is Node => c !== null);
	const one = node.childForFieldName(field);
	return one ? [one] : [];
}

const TS_NAMED = new Set([
	'function_declaration',
	'generator_function_declaration',
	'class_declaration',
	'abstract_class_declaration',
	'interface_declaration',
	'type_alias_declaration',
	'enum_declaration',
	'method_definition'
]);

function collectTsLike(source: string, node: Node, stack: string[], out: Decl[]): void {
	if (TS_NAMED.has(node.type)) {
		const name = node.childForFieldName('name')?.text;
		if (name) {
			decl(source, wrapped(node, ['export_statement']), [...stack, name], out);
			for (const child of node.namedChildren) {
				if (child) collectTsLike(source, child, [...stack, name], out);
			}
			return;
		}
	}
	if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
		for (const d of node.namedChildren) {
			if (d?.type !== 'variable_declarator') continue;
			const name = d.childForFieldName('name')?.text;
			if (name) decl(source, wrapped(node, ['export_statement']), [...stack, name], out);
		}
		return;
	}
	for (const child of node.namedChildren) {
		if (child) collectTsLike(source, child, stack, out);
	}
}

function goReceiverType(method: Node): string | undefined {
	const receiver = method.childForFieldName('receiver');
	if (!receiver) return undefined;
	// the receiver type may be plain, a pointer, or generic; the first
	// type_identifier inside is the type's name
	const queue: Node[] = [receiver];
	while (queue.length) {
		const n = queue.shift()!;
		if (n.type === 'type_identifier') return n.text;
		for (const c of n.namedChildren) if (c) queue.push(c);
	}
	return undefined;
}

function collectGo(source: string, node: Node, stack: string[], out: Decl[]): void {
	switch (node.type) {
		case 'function_declaration': {
			const name = node.childForFieldName('name')?.text;
			if (name) decl(source, node, [...stack, name], out);
			return;
		}
		case 'method_declaration': {
			const name = node.childForFieldName('name')?.text;
			if (name) {
				const recv = goReceiverType(node);
				decl(source, node, [...stack, ...(recv ? [recv] : []), name], out);
			}
			return;
		}
		case 'type_declaration':
		case 'const_declaration':
		case 'var_declaration': {
			for (const spec of node.namedChildren) {
				if (!spec || !/_spec$/.test(spec.type)) continue;
				for (const nameNode of fieldChildren(spec, 'name')) {
					decl(source, node, [...stack, nameNode.text], out);
				}
			}
			return;
		}
		default:
			for (const child of node.namedChildren) {
				if (child) collectGo(source, child, stack, out);
			}
	}
}

function collectPython(source: string, node: Node, stack: string[], out: Decl[]): void {
	if (node.type === 'function_definition' || node.type === 'class_definition') {
		const name = node.childForFieldName('name')?.text;
		if (name) {
			decl(source, wrapped(node, ['decorated_definition']), [...stack, name], out);
			const body = node.childForFieldName('body');
			if (body) collectPython(source, body, [...stack, name], out);
			return;
		}
	}
	for (const child of node.namedChildren) {
		if (child) collectPython(source, child, stack, out);
	}
}

const COLLECTORS: Record<LanguageId, (s: string, n: Node, st: string[], o: Decl[]) => void> = {
	typescript: collectTsLike,
	tsx: collectTsLike,
	javascript: collectTsLike,
	go: collectGo,
	python: collectPython
};

export async function listDeclarations(source: string, file: string): Promise<Decl[]> {
	const lang = languageForFile(file);
	if (!lang) {
		throw new DocrefError(
			'unsupported-language',
			`symbol resolution is not available for "${file}"; use a region marker instead`
		);
	}
	const parser = await parserFor(lang.wasm);
	const tree = parser.parse(source);
	if (!tree) throw new DocrefError('parse-failed', `could not parse ${file}`);
	const out: Decl[] = [];
	try {
		collectorRoot(lang.id, source, tree.rootNode, out);
	} finally {
		tree.delete();
	}
	return out;
}

function collectorRoot(id: LanguageId, source: string, root: Node, out: Decl[]): void {
	COLLECTORS[id](source, root, [], out);
}

export async function findSymbol(source: string, file: string, fragment: string): Promise<Decl> {
	const decls = await listDeclarations(source, file);
	const segs = fragment.split('.');
	const matches = decls.filter(
		(d) =>
			d.path.length >= segs.length &&
			segs.every((s, k) => d.path[d.path.length - segs.length + k] === s)
	);
	if (matches.length === 0) {
		throw new DocrefError('symbol-not-found', `no declaration matches "${fragment}" in ${file}`);
	}
	if (matches.length > 1) {
		const names = matches.map((m) => m.path.join('.')).join(', ');
		throw new DocrefError(
			'symbol-ambiguous',
			`"${fragment}" matches more than one declaration in ${file} (${names}); use the full path or a region marker`
		);
	}
	return matches[0]!;
}
