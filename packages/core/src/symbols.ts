// Structural symbol resolution (format.md section 1): declarations are
// found by parsing with tree-sitter (WASM grammars, so a bare cached
// checkout needs no project setup). A fragment matches a declaration whose
// trailing path segments equal it; zero or multiple matches fail closed.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { DocrefError } from './errors';
import { dedent } from './dedent';
import { languageForFile, type LanguageId } from './languages';

export type Decl = { path: string[]; startLine: number; endLine: number; content: string };

let inited: Promise<void> | null = null;
const languages = new Map<string, Promise<Language>>();
const parsers = new Map<string, Parser>();

// A bundled host points the resolver at explicit wasm locations. Two forms,
// because the layout differs: an extension ships the grammars in one directory
// under canonical `tree-sitter-<id>.wasm` names (grammarsDir); a compiled
// single binary embeds them and gets back hashed, scattered paths, so it
// supplies an explicit per-id resolver (grammar). grammar wins when both are
// given.
export type WasmConfig = {
	runtimeWasm: string;
	grammarsDir?: string;
	grammar?: (id: string) => string;
};
let wasmConfig: WasmConfig | null = null;

/**
 * Point the resolver at explicit wasm locations. Bundled hosts (the
 * VSCode extension, a compiled binary) ship the wasm files and MUST call
 * this before any symbol resolution: inside a bundle neither import.meta.url
 * nor a resolving require exists, so node_modules lookup is impossible.
 * Pass null to restore the default package-based resolution.
 */
export function configureWasm(config: WasmConfig | null): void {
	wasmConfig = config;
}

/**
 * Test-only: drop every module-level cache (runtime init, loaded grammars,
 * parsers, and the decl memo) and the wasm override. Runners without per-file
 * module isolation — notably `bun test` — share this module state across files,
 * so a grammar warmed by one test leaks into the next. A test that asserts
 * fail-closed resolution against a wrong wasm path would then find the grammar
 * already cached and pass spuriously. Calling this first makes such a test
 * order-independent. Not re-exported from the package barrel.
 */
export function __resetWasmForTest(): void {
	inited = null;
	languages.clear();
	parsers.clear();
	declCache.clear();
	wasmConfig = null;
}

// Lazy on purpose: must never run at module load time, where a bundled
// host would crash before it had the chance to call configureWasm().
function packageResolve(spec: string): string {
	const url = typeof import.meta !== 'undefined' ? import.meta.url : undefined;
	if (url) return createRequire(url).resolve(spec);
	if (typeof require === 'function' && typeof require.resolve === 'function') {
		return require.resolve(spec);
	}
	throw new DocrefError(
		'wasm-unresolvable',
		`cannot locate "${spec}" from a bundle; call configureWasm() with explicit paths`
	);
}

function runtimeWasmPath(name: string): string {
	return wasmConfig ? wasmConfig.runtimeWasm : packageResolve(`web-tree-sitter/${name}`);
}

// Grammars that tree-sitter-wasms does not ship are built from source (see
// scripts/build-vendored-grammars.mjs) and vendored in this package's grammars/
// dir, exposed via the package's "./grammars/*" export. They resolve through
// node module resolution exactly like tree-sitter-wasms, so the same lookup
// works from source, from a dependent's node_modules, and via self-reference.
const VENDORED_GRAMMARS = new Set<string>(['proto']);

function grammarWasmPath(wasm: string): string {
	const file = `tree-sitter-${wasm}.wasm`;
	if (wasmConfig?.grammar) return wasmConfig.grammar(wasm);
	if (wasmConfig?.grammarsDir) return `${wasmConfig.grammarsDir}/${file}`;
	if (VENDORED_GRAMMARS.has(wasm)) return packageResolve(`@open-docref/core/grammars/${file}`);
	return packageResolve(`tree-sitter-wasms/out/${file}`);
}

async function parserFor(wasm: string): Promise<Parser> {
	inited ??= Parser.init({ locateFile: (name: string) => runtimeWasmPath(name) });
	await inited;
	let langPromise = languages.get(wasm);
	if (!langPromise) {
		// do not cache failures: a host may configureWasm() and retry
		langPromise = Language.load(grammarWasmPath(wasm)).catch((e) => {
			languages.delete(wasm);
			throw e;
		});
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

// All names bound by one field — e.g. `var a, b int` has two `name` children.
// childrenForFieldName is a real web-tree-sitter API; childForFieldName would
// silently keep only the first, dropping secondary names.
function fieldChildren(node: Node, field: string): Node[] {
	return node.childrenForFieldName(field).filter((c): c is Node => c !== null);
}

// Breadth-first: the text of the first descendant (including the start node)
// whose type is in `types`, or undefined. Shared by the Go receiver-type and
// C/C++ declarator drills, which differ only in the matched type set.
function firstDescendantText(start: Node, types: Set<string>): string | undefined {
	const queue: Node[] = [start];
	while (queue.length) {
		const n = queue.shift()!;
		if (types.has(n.type)) return n.text;
		for (const c of n.namedChildren) if (c) queue.push(c);
	}
	return undefined;
}

const GO_RECEIVER_TYPES = new Set(['type_identifier']);
const CPP_DECL_TYPES = new Set(['identifier', 'field_identifier', 'type_identifier']);

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

// Bodies that hold locals. A const/let/var inside one of these is a local
// variable, not a symbol (format.md section 1 lists only top-level constants),
// so it is not collected. Nested *functions* still are: a nested function is a
// function, and the python `outer.inner` case pins that intent.
const FUNCTION_LIKE = new Set([
	'function_declaration',
	'generator_function_declaration',
	'method_definition'
]);

function collectTsLike(source: string, node: Node, stack: string[], out: Decl[]): void {
	walkTs(source, node, stack, false, out);
}

function walkTs(source: string, node: Node, stack: string[], inFn: boolean, out: Decl[]): void {
	if (TS_NAMED.has(node.type)) {
		const name = node.childForFieldName('name')?.text;
		if (name) {
			decl(source, wrapped(node, ['export_statement']), [...stack, name], out);
			// recurse to find nested functions and class members; once inside a
			// function body, descendants are locals and stay excluded
			const childInFn = inFn || FUNCTION_LIKE.has(node.type);
			for (const child of node.namedChildren) {
				if (child) walkTs(source, child, [...stack, name], childInFn, out);
			}
			return;
		}
	}
	if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
		if (inFn) return; // a local inside a function body is not a symbol
		for (const d of node.namedChildren) {
			if (d?.type !== 'variable_declarator') continue;
			const name = d.childForFieldName('name')?.text;
			if (name) decl(source, wrapped(node, ['export_statement']), [...stack, name], out);
		}
		return;
	}
	for (const child of node.namedChildren) {
		if (child) walkTs(source, child, stack, inFn, out);
	}
}

function goReceiverType(method: Node): string | undefined {
	const receiver = method.childForFieldName('receiver');
	if (!receiver) return undefined;
	// the receiver type may be plain, a pointer, or generic; the first
	// type_identifier inside is the type's name
	return firstDescendantText(receiver, GO_RECEIVER_TYPES);
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

// Data-driven collectors for the remaining languages: a set of "named
// declaration" node types per grammar. The name is the `name` field, or — for
// C/C++ — the identifier drilled out of the `declarator`. Nesting falls out of
// recursing with the declaration's name on the stack, so a method inside a
// class is `Class.method`.
function declName(node: Node): string | undefined {
	const direct = node.childForFieldName('name')?.text;
	if (direct) return direct;
	// declarator-based (C/C++): drill to the identifier nearest the top
	const dtor = node.childForFieldName('declarator');
	if (dtor) return firstDescendantText(dtor, CPP_DECL_TYPES);
	// field-less grammars (e.g. kotlin): the name is the first identifier-like
	// child of the declaration node
	for (const c of node.namedChildren) {
		if (c && /(^|_)identifier$/.test(c.type)) return c.text;
	}
	return undefined;
}

type Collector = (source: string, node: Node, stack: string[], out: Decl[]) => void;

const EMPTY_TYPES = new Set<string>();

// `named` — node types that are declarations. `functionLike` — those whose
// bodies hold locals (entering one sets inFn). `valueBindings` — the subset of
// `named` that are value bindings (const/val/property): once inFn, they are
// locals, not symbols, and are dropped — exactly walkTs's rule, generalized. A
// nested function or class inside a function body is still collected; only value
// bindings fall out. class/object/namespace do NOT set inFn, so their members
// stay symbols.
function namedCollector(
	named: string[],
	opts: { wrappers?: string[]; functionLike?: string[]; valueBindings?: string[] } = {}
): Collector {
	const names = new Set(named);
	const wrappers = opts.wrappers ?? [];
	const functionLike = opts.functionLike ? new Set(opts.functionLike) : EMPTY_TYPES;
	const valueBindings = opts.valueBindings ? new Set(opts.valueBindings) : EMPTY_TYPES;
	const walk = (source: string, node: Node, stack: string[], inFn: boolean, out: Decl[]): void => {
		if (names.has(node.type)) {
			if (inFn && valueBindings.has(node.type)) return; // a function-body local
			const name = declName(node);
			if (name) {
				decl(source, wrapped(node, wrappers), [...stack, name], out);
				const childInFn = inFn || functionLike.has(node.type);
				for (const c of node.namedChildren) {
					if (c) walk(source, c, [...stack, name], childInFn, out);
				}
				return;
			}
		}
		for (const c of node.namedChildren) if (c) walk(source, c, stack, inFn, out);
	};
	return (source, node, stack, out) => walk(source, node, stack, false, out);
}

// One config per language. The compile-time Record<LanguageId, …> totality check
// (which listDeclarations relies on) catches a missing language; functionLike /
// valueBindings stay empty for languages that bind no value types or have no
// function bodies (proto).
const COLLECTORS: Record<LanguageId, Collector> = {
	typescript: collectTsLike,
	tsx: collectTsLike,
	javascript: collectTsLike,
	go: collectGo,
	python: collectPython,
	rust: namedCollector(
		['function_item', 'struct_item', 'enum_item', 'union_item', 'trait_item', 'mod_item', 'type_item', 'const_item', 'static_item', 'macro_definition'],
		{ functionLike: ['function_item'], valueBindings: ['const_item', 'static_item'] }
	),
	java: namedCollector(
		['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration', 'method_declaration', 'constructor_declaration'],
		{ functionLike: ['method_declaration', 'constructor_declaration'] }
	),
	c: namedCollector(
		['function_definition', 'struct_specifier', 'enum_specifier', 'union_specifier', 'type_definition'],
		{ functionLike: ['function_definition'] }
	),
	cpp: namedCollector(
		['function_definition', 'struct_specifier', 'class_specifier', 'enum_specifier', 'union_specifier', 'namespace_definition', 'type_definition'],
		{ functionLike: ['function_definition'] }
	),
	csharp: namedCollector(
		['class_declaration', 'struct_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'namespace_declaration', 'delegate_declaration', 'method_declaration', 'constructor_declaration', 'property_declaration'],
		{ functionLike: ['method_declaration', 'constructor_declaration'] }
	),
	ruby: namedCollector(['method', 'singleton_method', 'class', 'module'], {
		functionLike: ['method', 'singleton_method']
	}),
	php: namedCollector(
		['function_definition', 'method_declaration', 'class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration'],
		{ functionLike: ['function_definition', 'method_declaration'] }
	),
	swift: namedCollector(['function_declaration', 'class_declaration', 'protocol_declaration', 'property_declaration'], {
		functionLike: ['function_declaration'],
		valueBindings: ['property_declaration']
	}),
	kotlin: namedCollector(['function_declaration', 'class_declaration', 'object_declaration', 'property_declaration'], {
		functionLike: ['function_declaration'],
		valueBindings: ['property_declaration']
	}),
	scala: namedCollector(
		['function_definition', 'class_definition', 'object_definition', 'trait_definition', 'type_definition', 'val_definition'],
		{ functionLike: ['function_definition'], valueBindings: ['val_definition'] }
	),
	bash: namedCollector(['function_definition'], { functionLike: ['function_definition'] }),
	// proto: message (type-like), enum, service (interface-like), rpc
	// (method-like), plus message fields and enum values. Unlike struct fields
	// elsewhere, a proto field/value number is the wire contract and the most
	// drift-prone thing in a schema, so `Message.field` is addressable. `field`
	// covers oneof members too (the grammar reuses it); `value` is the enum
	// constant. Field options/defaults are other node types and are not swept in.
	// No function bodies, so no scope flags.
	proto: namedCollector(['message', 'enum', 'service', 'rpc', 'field', 'map_field', 'value'])
};

// Parsing a file is by far the dominant cost, and a document with many
// references into the same source would otherwise re-parse it once per
// reference. Memoize the declaration list, keyed by the language and an EXACT
// (whitespace-preserving) hash of the source — content-addressed, so an edit
// is a miss and the cache can never go stale. Bounded LRU so a long-lived host
// (the extension) cannot grow without limit. Decls are plain data (no live
// tree-sitter handles), so sharing the array is safe; callers never mutate it.
const declCache = new Map<string, Decl[]>();
const DECL_CACHE_MAX = 256;

// Counters behind the performance-regression guard (perf.test.ts): a parse is
// the expensive operation, and the invariant is "once per unique file, never
// once per reference". Also a foundation for a future `--stats`.
let parseCount = 0;
let cacheHitCount = 0;

export function symbolCacheStats(): { parses: number; hits: number; size: number } {
	return { parses: parseCount, hits: cacheHitCount, size: declCache.size };
}

export async function listDeclarations(source: string, file: string): Promise<Decl[]> {
	const lang = languageForFile(file);
	if (!lang) {
		throw new DocrefError(
			'unsupported-language',
			`symbol resolution is not available for "${file}"; use a region marker instead`
		);
	}
	const key = `${lang.id}\0${createHash('sha256').update(source, 'utf8').digest('hex')}`;
	const hit = declCache.get(key);
	if (hit) {
		cacheHitCount++;
		declCache.delete(key); // refresh recency
		declCache.set(key, hit);
		return hit;
	}
	const parser = await parserFor(lang.wasm);
	const tree = parser.parse(source);
	if (!tree) throw new DocrefError('parse-failed', `could not parse ${file}`);
	const out: Decl[] = [];
	try {
		COLLECTORS[lang.id](source, tree.rootNode, [], out);
	} finally {
		tree.delete();
	}
	parseCount++;
	declCache.set(key, out);
	if (declCache.size > DECL_CACHE_MAX) {
		const oldest = declCache.keys().next().value;
		if (oldest !== undefined) declCache.delete(oldest);
	}
	return out;
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
