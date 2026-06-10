// Copy the tree-sitter runtime and grammar wasm files into the
// extension's dist, so the installed extension is self-contained and
// never resolves through node_modules at runtime.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../packages/vscode/dist/wasm/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

copyFileSync(require.resolve('web-tree-sitter/tree-sitter.wasm'), join(out, 'tree-sitter.wasm'));

const grammars = ['typescript', 'tsx', 'javascript', 'go', 'python'];
const grammarOut = dirname(require.resolve('tree-sitter-wasms/package.json'));
for (const g of grammars) {
	copyFileSync(join(grammarOut, 'out', `tree-sitter-${g}.wasm`), join(out, `tree-sitter-${g}.wasm`));
}
console.log(`copied ${grammars.length + 1} wasm files to packages/vscode/dist/wasm`);
