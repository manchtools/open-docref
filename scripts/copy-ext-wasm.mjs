// Copy the tree-sitter runtime and grammar wasm files into the extension's
// dist, so the installed extension is self-contained and never resolves
// through node_modules at runtime. The grammar list is DISCOVERED from the
// language registry (packages/core/src/languages.ts) rather than hardcoded, so
// a language added there ships here automatically — a stale hardcoded list
// would silently omit new languages and fail at the user's runtime. Grammars
// not shipped by tree-sitter-wasms are taken from the vendored grammars dir.
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages', 'vscode', 'dist', 'wasm');
mkdirSync(out, { recursive: true });

copyFileSync(require.resolve('web-tree-sitter/tree-sitter.wasm'), join(out, 'tree-sitter.wasm'));

// distinct grammar wasm ids, discovered from the `wasm:` entries in the registry
const registry = readFileSync(join(root, 'packages', 'core', 'src', 'languages.ts'), 'utf8');
const grammars = [...new Set([...registry.matchAll(/wasm:\s*'([^']+)'/g)].map((m) => m[1]))];
if (grammars.length === 0) throw new Error('no grammars discovered in languages.ts');

const tsWasmsOut = join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
const vendoredDir = join(root, 'packages', 'core', 'grammars');

for (const g of grammars) {
	const file = `tree-sitter-${g}.wasm`;
	const vendored = join(vendoredDir, file);
	const src = existsSync(vendored) ? vendored : join(tsWasmsOut, file);
	copyFileSync(src, join(out, file));
}
console.log(`copied ${grammars.length + 1} wasm files to packages/vscode/dist/wasm`);
