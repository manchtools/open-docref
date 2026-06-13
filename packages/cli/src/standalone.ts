// Entry point for the standalone single-file binary (`bun build --compile`).
// It embeds the tree-sitter wasm — bun extracts each into the binary's virtual
// filesystem at runtime, under a hashed basename — and points the resolver at
// those exact paths via configureWasm's per-grammar form. Everything else is
// the shared CLI in ./main; `self-update` is the binary-only command.
//
// These imports MUST stay in sync with the language registry (languages.ts):
// bun embeds only statically-imported files, so a registered grammar missing
// here cannot resolve in the compiled binary. The grammar-coverage guard test
// fails if this map omits any registered grammar.
import runtimeWasm from 'web-tree-sitter/tree-sitter.wasm' with { type: 'file' };
import typescriptWasm from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm' with { type: 'file' };
import tsxWasm from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm' with { type: 'file' };
import javascriptWasm from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm' with { type: 'file' };
import goWasm from 'tree-sitter-wasms/out/tree-sitter-go.wasm' with { type: 'file' };
import pythonWasm from 'tree-sitter-wasms/out/tree-sitter-python.wasm' with { type: 'file' };
import rustWasm from 'tree-sitter-wasms/out/tree-sitter-rust.wasm' with { type: 'file' };
import javaWasm from 'tree-sitter-wasms/out/tree-sitter-java.wasm' with { type: 'file' };
import cWasm from 'tree-sitter-wasms/out/tree-sitter-c.wasm' with { type: 'file' };
import cppWasm from 'tree-sitter-wasms/out/tree-sitter-cpp.wasm' with { type: 'file' };
import csharpWasm from 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm' with { type: 'file' };
import rubyWasm from 'tree-sitter-wasms/out/tree-sitter-ruby.wasm' with { type: 'file' };
import phpWasm from 'tree-sitter-wasms/out/tree-sitter-php.wasm' with { type: 'file' };
import swiftWasm from 'tree-sitter-wasms/out/tree-sitter-swift.wasm' with { type: 'file' };
import kotlinWasm from 'tree-sitter-wasms/out/tree-sitter-kotlin.wasm' with { type: 'file' };
import scalaWasm from 'tree-sitter-wasms/out/tree-sitter-scala.wasm' with { type: 'file' };
import bashWasm from 'tree-sitter-wasms/out/tree-sitter-bash.wasm' with { type: 'file' };
import protoWasm from '@open-docref/core/grammars/tree-sitter-proto.wasm' with { type: 'file' };
import { configureWasm } from '@open-docref/core';
import { run, VERSION } from './main';
import { selfUpdate } from './selfupdate';

// Keyed by the grammar `wasm` id from the registry (the value configureWasm
// passes to the resolver), not the file extension.
const GRAMMARS: Record<string, string> = {
	typescript: typescriptWasm,
	tsx: tsxWasm,
	javascript: javascriptWasm,
	go: goWasm,
	python: pythonWasm,
	rust: rustWasm,
	java: javaWasm,
	c: cWasm,
	cpp: cppWasm,
	c_sharp: csharpWasm,
	ruby: rubyWasm,
	php: phpWasm,
	swift: swiftWasm,
	kotlin: kotlinWasm,
	scala: scalaWasm,
	bash: bashWasm,
	proto: protoWasm
};

configureWasm({ runtimeWasm, grammar: (id) => GRAMMARS[id] ?? id });

const argv = process.argv.slice(2);
const result =
	argv[0] === 'self-update'
		? await selfUpdate(VERSION, { skipExtension: argv.includes('--skip-extension') })
		: await run(argv, process.cwd());
if (result.out) console.log(result.out);
process.exit(result.code);
