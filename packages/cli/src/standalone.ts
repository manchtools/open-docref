// Entry point for the standalone single-file binary (`bun build --compile`).
// It embeds the tree-sitter wasm — bun extracts each into the binary's virtual
// filesystem at runtime, under a hashed basename — and points the resolver at
// those exact paths via configureWasm's per-grammar form. Everything else is
// the shared CLI in ./main; `self-update` is the binary-only command.
import runtimeWasm from 'web-tree-sitter/tree-sitter.wasm' with { type: 'file' };
import typescriptWasm from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm' with { type: 'file' };
import tsxWasm from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm' with { type: 'file' };
import javascriptWasm from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm' with { type: 'file' };
import goWasm from 'tree-sitter-wasms/out/tree-sitter-go.wasm' with { type: 'file' };
import pythonWasm from 'tree-sitter-wasms/out/tree-sitter-python.wasm' with { type: 'file' };
import { configureWasm } from '@open-docref/core';
import { run, VERSION } from './main';
import { selfUpdate } from './selfupdate';

const GRAMMARS: Record<string, string> = {
	typescript: typescriptWasm,
	tsx: tsxWasm,
	javascript: javascriptWasm,
	go: goWasm,
	python: pythonWasm
};

configureWasm({ runtimeWasm, grammar: (id) => GRAMMARS[id] ?? id });

const argv = process.argv.slice(2);
const result =
	argv[0] === 'self-update' ? await selfUpdate(VERSION) : await run(argv, process.cwd());
if (result.out) console.log(result.out);
process.exit(result.code);
