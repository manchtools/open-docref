import { describe, it, expect } from 'vitest';
import { findSymbol, listDeclarations, configureWasm } from './symbols';
import { DocrefError } from './errors';

// Contract (format.md section 1, "Symbols"): a symbol fragment names a
// declaration; nesting uses "."; a fragment matches a declaration whose
// trailing path segments equal it. Zero matches and multiple matches both
// fail closed. Resolution is structural (tree-sitter), per file extension;
// unsupported languages fail closed with a pointer to region markers.

const code = async (e: () => Promise<unknown>): Promise<string> => {
	try {
		await e();
		return 'no-error';
	} catch (err) {
		return (err as DocrefError).code;
	}
};

const TS = `import { x } from './x';

export function applyFootnotes(content: string): string {
	return content;
}

export const limit = 10;

interface Options {
	deep: boolean;
}

type Mode = 'a' | 'b';

enum Level {
	Low,
	High
}

export class Renderer {
	run(input: string): string {
		return input;
	}
}

class Walker {
	run(input: string): string {
		return input;
	}
}

function helper() {}
`;

describe('typescript symbols', () => {
	it('finds a top-level function, span including the export keyword', async () => {
		const d = await findSymbol(TS, 'src/a.ts', 'applyFootnotes');
		expect(d.content).toContain('export function applyFootnotes');
		expect(d.content).toContain('return content;');
	});

	it('finds an exported const with the whole statement as span', async () => {
		const d = await findSymbol(TS, 'src/a.ts', 'limit');
		expect(d.content).toBe('export const limit = 10;');
	});

	it('finds interface, type alias, and enum declarations', async () => {
		expect((await findSymbol(TS, 'src/a.ts', 'Options')).content).toContain('interface Options');
		expect((await findSymbol(TS, 'src/a.ts', 'Mode')).content).toContain("type Mode = 'a' | 'b';");
		expect((await findSymbol(TS, 'src/a.ts', 'Level')).content).toContain('enum Level');
	});

	it('addresses a method through its class', async () => {
		const d = await findSymbol(TS, 'src/a.ts', 'Renderer.run');
		expect(d.content).toContain('run(input: string)');
		expect(d.content).not.toContain('class');
	});

	it('materializes indented declarations dedented, first line included', async () => {
		// a method sits one tab deep in its class; the snippet must come out
		// flush left with the internal nesting preserved (one tab on return)
		const d = await findSymbol(TS, 'src/a.ts', 'Renderer.run');
		expect(d.content).toBe('run(input: string): string {\n\treturn input;\n}');
	});

	it('rejects an ambiguous bare method name (two classes define run)', async () => {
		expect(await code(() => findSymbol(TS, 'src/a.ts', 'run'))).toBe('symbol-ambiguous');
	});

	it('suffix-matches a unique bare name', async () => {
		// helper is unique, so the bare name resolves
		expect((await findSymbol(TS, 'src/a.ts', 'helper')).content).toBe('function helper() {}');
	});

	it('rejects an unknown symbol', async () => {
		expect(await code(() => findSymbol(TS, 'src/a.ts', 'nope'))).toBe('symbol-not-found');
	});

	it('reports declarations with 1-based line spans', async () => {
		const decls = await listDeclarations(TS, 'src/a.ts');
		const fn = decls.find((d) => d.path.join('.') === 'applyFootnotes');
		expect(fn?.startLine).toBe(3);
		expect(fn?.endLine).toBe(5);
	});

	it('caches per file content-addressed, so an edit is never stale', async () => {
		// the parse cache is keyed by exact source content; the same path with
		// changed content must resolve to the NEW declarations, not a hit on the
		// old list (a path-keyed cache would be a correctness bug here)
		const names = async (src: string) =>
			(await listDeclarations(src, 'src/cache-probe.ts')).map((d) => d.path.join('.'));
		expect(await names('export function alpha() {}')).toEqual(['alpha']);
		expect(await names('export function beta() {}\nexport const gamma = 1;')).toEqual([
			'beta',
			'gamma'
		]);
		// re-using the first content is a cache hit and still correct
		expect(await names('export function alpha() {}')).toEqual(['alpha']);
	});
});

const GO = `package api

type Server struct {
	key []byte
}

const MaxBody = 1 << 20

func Handle() {}

func (s *Server) VerifySignature(req []byte) error {
	return nil
}

func (s Server) Close() {}
`;

describe('go symbols', () => {
	it('finds a function and a type', async () => {
		expect((await findSymbol(GO, 'src/a.go', 'Handle')).content).toBe('func Handle() {}');
		expect((await findSymbol(GO, 'src/a.go', 'Server')).content).toContain('type Server struct');
	});

	it('finds a const', async () => {
		expect((await findSymbol(GO, 'src/a.go', 'MaxBody')).content).toContain('MaxBody = 1 << 20');
	});

	it('nests methods under the receiver type, pointer and value alike', async () => {
		const m = await findSymbol(GO, 'src/a.go', 'Server.VerifySignature');
		expect(m.content).toContain('func (s *Server) VerifySignature');
		expect((await findSymbol(GO, 'src/a.go', 'Server.Close')).content).toContain('Close()');
	});

	it('suffix-matches a unique method name without the receiver', async () => {
		const m = await findSymbol(GO, 'src/a.go', 'VerifySignature');
		expect(m.content).toContain('VerifySignature');
	});

	it('collects every name of a grouped declaration (plural name-field API)', async () => {
		// `var a, b, c int` is one spec with three `name` fields; all must be
		// collected. This pins the multi-name path (childrenForFieldName), so a
		// regression to a single-child lookup would drop b and c.
		const src = 'package api\n\nvar a, b, c int\n';
		const paths = (await listDeclarations(src, 'src/m.go')).map((d) => d.path.join('.'));
		expect(paths).toContain('a');
		expect(paths).toContain('b');
		expect(paths).toContain('c');
	});
});

const PY = `import os

def top(a):
    return a

@decorator
def wrapped():
    pass

class Config:
    def load(self):
        pass

    def save(self):
        pass

class Cache:
    def load(self):
        pass

def outer():
    def inner():
        pass
    return inner
`;

describe('python symbols', () => {
	it('finds functions and classes', async () => {
		expect((await findSymbol(PY, 'src/a.py', 'top')).content).toContain('def top(a):');
		expect((await findSymbol(PY, 'src/a.py', 'Cache')).content).toContain('class Cache:');
	});

	it('includes decorators in the span', async () => {
		expect((await findSymbol(PY, 'src/a.py', 'wrapped')).content).toContain('@decorator');
	});

	it('addresses methods through the class and rejects the ambiguous bare name', async () => {
		expect((await findSymbol(PY, 'src/a.py', 'Config.load')).content).toBe(
			'def load(self):\n    pass'
		);
		expect(await code(() => findSymbol(PY, 'src/a.py', 'load'))).toBe('symbol-ambiguous');
	});

	it('suffix-matches a unique method (save exists only on Config)', async () => {
		expect((await findSymbol(PY, 'src/a.py', 'save')).content).toContain('def save(self):');
	});

	it('addresses nested functions', async () => {
		expect((await findSymbol(PY, 'src/a.py', 'outer.inner')).content).toContain('def inner():');
	});
});

// Contract: a proto "symbol" is a named declaration — message (type-like),
// enum, service (interface-like), rpc (method-like), AND the fields of a
// message and the values of an enum. Unlike struct fields in other languages,
// a proto field number and an enum value number are the wire contract: a
// renumbered field or a retyped value is a subtle, security-relevant break —
// exactly the drift docref exists to anchor — so they are addressable. Nesting
// uses ".", so a field is `Message.field` and an rpc is `Service.rpc`. A bare
// name several messages share is ambiguous and fails closed; the qualified
// form resolves.
const PROTO = `syntax = "proto3";

package example;

message Account {
  string id = 1;
  Profile profile = 2;

  message Profile {
    string display_name = 1;
  }
}

enum Status {
  STATUS_UNKNOWN = 0;
  STATUS_ACTIVE = 1;
}

service AccountService {
  rpc GetAccount(GetAccountRequest) returns (Account);
  rpc DeleteAccount(DeleteAccountRequest) returns (Empty);
}

message GetAccountRequest {
  string id = 1;
  bool include_deleted = 2 [deprecated = true];
}
`;

describe('proto symbols', () => {
	it('finds a top-level message, enum, and service', async () => {
		expect((await findSymbol(PROTO, 'a.proto', 'Account')).content).toContain('message Account');
		expect((await findSymbol(PROTO, 'a.proto', 'Status')).content).toContain('enum Status');
		expect((await findSymbol(PROTO, 'a.proto', 'AccountService')).content).toContain(
			'service AccountService'
		);
	});

	it('nests a message inside its enclosing message', async () => {
		const d = await findSymbol(PROTO, 'a.proto', 'Account.Profile');
		expect(d.content).toContain('message Profile');
		expect(d.content).toContain('string display_name = 1;');
	});

	it('nests an rpc under its service', async () => {
		const d = await findSymbol(PROTO, 'a.proto', 'AccountService.GetAccount');
		expect(d.content).toContain('rpc GetAccount');
		expect(d.content).not.toContain('service');
	});

	it('suffix-matches a unique rpc by its bare name', async () => {
		expect((await findSymbol(PROTO, 'a.proto', 'DeleteAccount')).content).toContain(
			'rpc DeleteAccount'
		);
	});

	it('resolves a message field through its message (the field number is wire contract)', async () => {
		expect((await findSymbol(PROTO, 'a.proto', 'Account.id')).content).toContain('string id = 1');
		expect((await findSymbol(PROTO, 'a.proto', 'Account.profile')).content).toContain(
			'Profile profile = 2'
		);
		// a field of a nested message addresses through both
		expect((await findSymbol(PROTO, 'a.proto', 'Account.Profile.display_name')).content).toContain(
			'string display_name = 1'
		);
	});

	it('makes a field name shared by two messages ambiguous, but resolves the qualified form', async () => {
		// Account.id and GetAccountRequest.id both exist: a bare `id` must fail
		// closed rather than silently pick one (the drift would be invisible)
		expect(await code(() => findSymbol(PROTO, 'a.proto', 'id'))).toBe('symbol-ambiguous');
		expect((await findSymbol(PROTO, 'a.proto', 'GetAccountRequest.id')).content).toContain(
			'string id = 1'
		);
	});

	it('resolves an enum value through its enum (the value number is wire contract too)', async () => {
		expect((await findSymbol(PROTO, 'a.proto', 'Status.STATUS_ACTIVE')).content).toContain(
			'STATUS_ACTIVE = 1'
		);
	});

	it('does not collect field options or defaults as symbols', async () => {
		// the field itself is a symbol...
		const paths = (await listDeclarations(PROTO, 'a.proto')).map((d) => d.path.join('.'));
		expect(paths).toContain('GetAccountRequest.include_deleted');
		// ...but a field OPTION (`[deprecated = true]`) is metadata, not a declaration:
		// the generic `value`/`field` node types must not sweep it in
		expect(paths.some((p) => p.endsWith('deprecated'))).toBe(false);
	});

	it('rejects an unknown symbol', async () => {
		expect(await code(() => findSymbol(PROTO, 'a.proto', 'Nope'))).toBe('symbol-not-found');
	});

	it('reports the message span with 1-based line numbers', async () => {
		const decls = await listDeclarations(PROTO, 'a.proto');
		const acct = decls.find((d) => d.path.join('.') === 'Account');
		expect(acct?.startLine).toBe(5);
		const profile = decls.find((d) => d.path.join('.') === 'Account.Profile');
		expect(profile?.path).toEqual(['Account', 'Profile']);
	});
});

// Contract (format.md section 1): a symbol is a "function, method, class,
// type, interface, enum, or top-level constant". A local variable inside a
// function body is none of those, so it must NOT be anchorable — otherwise
// `#x` collides with same-named locals and resolution is needlessly noisy.
// Nested *functions* remain addressable (a nested function is still a
// function; the python `outer.inner` case above pins that intent).
const SCOPED = `export function outer(n: number): number {
	const factor = 2;
	let scratch = 0;
	function inner(x: number): number {
		const bias = 1;
		return x * factor + bias;
	}
	return inner(n);
}

export const factor = 99;
`;

describe('symbol scope: locals inside function bodies are not symbols', () => {
	it('does not list local const/let declared inside a function body', async () => {
		const paths = (await listDeclarations(SCOPED, 'src/a.ts')).map((d) => d.path.join('.'));
		// the function and its nested function are symbols...
		expect(paths).toContain('outer');
		expect(paths).toContain('outer.inner');
		// ...but the locals are not, at any nesting depth
		expect(paths).not.toContain('outer.factor');
		expect(paths).not.toContain('outer.scratch');
		expect(paths).not.toContain('outer.inner.bias');
	});

	it('refuses to resolve a local variable as a symbol', async () => {
		expect(await code(() => findSymbol(SCOPED, 'src/a.ts', 'outer.factor'))).toBe(
			'symbol-not-found'
		);
		expect(await code(() => findSymbol(SCOPED, 'src/a.ts', 'outer.inner.bias'))).toBe(
			'symbol-not-found'
		);
	});

	it('still resolves the top-level const of the same bare name unambiguously', async () => {
		// `factor` exists as a top-level const and (before the fix) as a local;
		// with locals excluded the bare name is unique and resolves to the const
		const d = await findSymbol(SCOPED, 'src/a.ts', 'factor');
		expect(d.content).toBe('export const factor = 99;');
	});

	it('keeps a nested function addressable through its parent', async () => {
		const d = await findSymbol(SCOPED, 'src/a.ts', 'outer.inner');
		expect(d.content).toContain('function inner(x: number)');
	});
});

// Contract (format.md section 1): the "top-level constant, never a local" rule
// is language-agnostic. A const/val/property declared INSIDE a function body is
// a local, not a symbol, in EVERY language with the generic collector — not just
// TypeScript. Otherwise `#name` resolution silently differs by language and a
// body-local can shadow a real top-level symbol.
describe('symbol scope across languages: function-body locals are not symbols', () => {
	it('rust: const/static inside a fn body are not symbols; top-level const is', async () => {
		const RS = `pub fn outer() -> i32 {
    const LOCAL: i32 = 2;
    static SCRATCH: i32 = 3;
    LOCAL + SCRATCH
}

pub const FACTOR: i32 = 99;
`;
		const paths = (await listDeclarations(RS, 'a.rs')).map((d) => d.path.join('.'));
		expect(paths).toContain('outer');
		expect(paths).toContain('FACTOR');
		expect(paths).not.toContain('outer.LOCAL');
		expect(paths).not.toContain('outer.SCRATCH');
		expect(await code(() => findSymbol(RS, 'a.rs', 'outer.LOCAL'))).toBe('symbol-not-found');
	});

	it('scala: a val inside a def body is not a symbol; an object-level val is', async () => {
		const SC = `object G {
  def outer(n: Int): Int = {
    val local = 2
    local + n
  }
  val factor = 99
}
`;
		const paths = (await listDeclarations(SC, 'A.scala')).map((d) => d.path.join('.'));
		expect(paths).toContain('G.outer');
		expect(paths).toContain('G.factor');
		expect(paths).not.toContain('G.outer.local');
	});

	it('swift: a let inside a func body is not a symbol; a type-level property is', async () => {
		const SW = `class C {
  let value = 1
  func outer() -> Int {
    let local = 2
    return local
  }
}
`;
		const paths = (await listDeclarations(SW, 'a.swift')).map((d) => d.path.join('.'));
		expect(paths).toContain('C');
		expect(paths).toContain('C.value');
		expect(paths).toContain('C.outer');
		expect(paths).not.toContain('C.outer.local');
	});

	it('kotlin: a val inside a fun body is not a symbol', async () => {
		// (kotlin class-level `val` is not currently addressable at all — its name
		// sits under variable_declaration, out of declName's reach — so this pins
		// only that the function-body local does not leak; the class/fun do resolve)
		const KT = `class C {
  fun outer(): Int {
    val local = 2
    return local
  }
}
`;
		const paths = (await listDeclarations(KT, 'a.kt')).map((d) => d.path.join('.'));
		expect(paths).toContain('C');
		expect(paths).toContain('C.outer');
		expect(paths).not.toContain('C.outer.local');
	});

	it('csharp: class members survive the scope guard (regression)', async () => {
		const CS = `class C {
  public int Count { get; set; }
  public int Outer() {
    int local = 2;
    return local;
  }
}
`;
		const paths = (await listDeclarations(CS, 'A.cs')).map((d) => d.path.join('.'));
		expect(paths).toContain('C.Count');
		expect(paths).toContain('C.Outer');
		expect(paths).not.toContain('C.Outer.local');
	});
});

describe('configureWasm', () => {
	// Bundled hosts (the VSCode extension) cannot resolve wasm files
	// through node_modules at runtime; they must be able to point the
	// resolver at shipped copies, and the override must actually be used.
	it('honors explicit wasm locations, failing closed on wrong ones', async () => {
		const { configureWasm, __resetWasmForTest } = await import('./symbols');
		const { createRequire } = await import('node:module');
		const { dirname, join } = await import('node:path');
		const req = createRequire(import.meta.url);

		// Drop any grammar another test file may have warmed. Without this the
		// wrong path below is never consulted (the grammar is already cached),
		// so the fail-closed assertion passes spuriously under runners that
		// share module state across files (`bun test`).
		__resetWasmForTest();

		configureWasm({
			runtimeWasm: req.resolve('web-tree-sitter/tree-sitter.wasm'),
			grammarsDir: '/nonexistent/wasm'
		});
		try {
			// javascript is not cached by earlier tests, so its grammar must
			// come from the configured directory and therefore fail
			await expect(findSymbol('function f() {}', 'src/a.js', 'f')).rejects.toThrow();
		} finally {
			configureWasm({
				runtimeWasm: req.resolve('web-tree-sitter/tree-sitter.wasm'),
				grammarsDir: join(dirname(req.resolve('tree-sitter-wasms/package.json')), 'out')
			});
		}

		// with correct paths the same grammar loads: failures are not cached
		const d = await findSymbol('function f() {}', 'src/a.js', 'f');
		expect(d.content).toBe('function f() {}');
		configureWasm(null);
	});

	it('accepts an explicit per-grammar resolver (the compiled-binary form)', async () => {
		// A compiled binary embeds the grammars and gets back hashed, scattered
		// paths, so it supplies `grammar(id)` instead of a `grammarsDir`. tsx is
		// not loaded by any other test, so this exercises the resolver for real.
		const { configureWasm, __resetWasmForTest } = await import('./symbols');
		const { createRequire } = await import('node:module');
		const { dirname, join } = await import('node:path');
		const req = createRequire(import.meta.url);
		const outDir = join(dirname(req.resolve('tree-sitter-wasms/package.json')), 'out');

		// Ensure tsx is not pre-warmed, so the explicit resolver below is what
		// actually loads it (order-independent under `bun test`).
		__resetWasmForTest();

		configureWasm({
			runtimeWasm: req.resolve('web-tree-sitter/tree-sitter.wasm'),
			grammar: (id: string) => join(outDir, `tree-sitter-${id}.wasm`)
		});
		try {
			// JSX forces the tsx grammar; a wrong/ignored resolver fails to load it
			const d = await findSymbol('export function f() { return <div/>; }', 'src/a.tsx', 'f');
			expect(d.content).toContain('function f');
		} finally {
			configureWasm(null);
		}
	});
});

describe('unsupported languages', () => {
	it('fails closed and names the escape hatch', async () => {
		try {
			// a filetype with no grammar mapping (regions are the escape hatch)
			await findSymbol('some text', 'docs/notes.txt', 'main');
			expect.unreachable('should have thrown');
		} catch (e) {
			expect((e as DocrefError).code).toBe('unsupported-language');
			expect((e as DocrefError).message).toContain('region');
		}
	});
});

describe('symbol resolution across popular languages', () => {
	const LANGS: { name: string; file: string; src: string; symbol: string; has: string }[] = [
		{ name: 'rust', file: 'a.rs', src: 'pub fn greet(name: &str) -> String {\n    format!("hi {name}")\n}\n', symbol: 'greet', has: 'fn greet' },
		{ name: 'java (class)', file: 'A.java', src: 'class Greeter {\n  String greet(String n) { return "hi" + n; }\n}\n', symbol: 'Greeter', has: 'class Greeter' },
		{ name: 'java (method)', file: 'A.java', src: 'class Greeter {\n  String greet(String n) { return "hi" + n; }\n}\n', symbol: 'Greeter.greet', has: 'greet' },
		{ name: 'c', file: 'a.c', src: 'int greet(int n) {\n  return n + 1;\n}\n', symbol: 'greet', has: 'greet' },
		{ name: 'cpp', file: 'a.cpp', src: 'int compute(int n) {\n  return n * 2;\n}\n', symbol: 'compute', has: 'compute' },
		{ name: 'csharp', file: 'A.cs', src: 'class Greeter {\n  public string Greet(string n) { return n; }\n}\n', symbol: 'Greeter', has: 'class Greeter' },
		{ name: 'ruby', file: 'a.rb', src: 'def greet(n)\n  n\nend\n', symbol: 'greet', has: 'def greet' },
		{ name: 'php', file: 'a.php', src: '<?php\nfunction greet($n) {\n  return $n;\n}\n', symbol: 'greet', has: 'function greet' },
		{ name: 'swift', file: 'a.swift', src: 'func greet(_ n: String) -> String {\n  return n\n}\n', symbol: 'greet', has: 'func greet' },
		{ name: 'kotlin', file: 'a.kt', src: 'fun greet(n: String): String {\n  return n\n}\n', symbol: 'greet', has: 'fun greet' },
		{ name: 'scala', file: 'A.scala', src: 'object G {\n  def greet(n: Int): Int = n\n}\n', symbol: 'greet', has: 'greet' },
		{ name: 'kotlin (class)', file: 'a.kt', src: 'class Greeter {\n  fun greet(n: String): String { return n }\n}\n', symbol: 'Greeter', has: 'class Greeter' },
		{ name: 'bash', file: 'a.sh', src: 'greet() {\n  echo "$1"\n}\n', symbol: 'greet', has: 'greet' },
		{ name: 'proto', file: 'a.proto', src: 'syntax = "proto3";\nmessage Greeting {\n  string text = 1;\n}\n', symbol: 'Greeting', has: 'message Greeting' }
	];
	for (const l of LANGS) {
		it(`resolves a declaration in ${l.name}`, async () => {
			const d = await findSymbol(l.src, l.file, l.symbol);
			expect(d.content).toContain(l.has);
		});
	}
});
