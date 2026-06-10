import { describe, it, expect } from 'vitest';
import { findSymbol, listDeclarations } from './symbols';
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

describe('configureWasm', () => {
	// Bundled hosts (the VSCode extension) cannot resolve wasm files
	// through node_modules at runtime; they must be able to point the
	// resolver at shipped copies, and the override must actually be used.
	it('honors explicit wasm locations, failing closed on wrong ones', async () => {
		const { configureWasm } = await import('./symbols');
		const { createRequire } = await import('node:module');
		const { dirname, join } = await import('node:path');
		const req = createRequire(import.meta.url);

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
});

describe('unsupported languages', () => {
	it('fails closed and names the escape hatch', async () => {
		try {
			await findSymbol('fn main() {}', 'src/a.rs', 'main');
			expect.unreachable('should have thrown');
		} catch (e) {
			expect((e as DocrefError).code).toBe('unsupported-language');
			expect((e as DocrefError).message).toContain('region');
		}
	});
});
