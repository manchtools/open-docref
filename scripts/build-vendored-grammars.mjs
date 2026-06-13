// Rebuild the tree-sitter grammars that tree-sitter-wasms does not ship, into
// packages/core/grammars/. These wasm files are committed (so tests, CI and a
// bare checkout need no toolchain), but they are GENERATED — never hand-edit
// them; re-run this script to regenerate from the pinned source.
//
// Requirements: docker (the tree-sitter CLI compiles the wasm inside the
// official emscripten image, so no local emscripten is needed). The CLI
// version is pinned to match web-tree-sitter so the language ABI matches the
// runtime; bumping web-tree-sitter means bumping CLI_VERSION and rebuilding.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Keep in lockstep with web-tree-sitter in packages/core/package.json.
const CLI_VERSION = '0.25.10';

const GRAMMARS = [
	{
		// proto3/proto2; every declaration node (message/enum/service/rpc) exposes
		// a `name` field, so core's generic collector handles it unchanged.
		name: 'proto',
		repo: 'https://github.com/Clement-Jean/tree-sitter-proto.git',
		commit: '5c09ab434ea6a1dd03635ce58844b69a8d6bd90f',
		fileTypes: ['proto'],
		license: 'MIT'
	}
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'core', 'grammars');
mkdirSync(outDir, { recursive: true });

for (const g of GRAMMARS) {
	const work = join(tmpdir(), `docref-grammar-${g.name}`);
	rmSync(work, { recursive: true, force: true });
	const sh = (cmd, args, opts = {}) =>
		execFileSync(cmd, args, { stdio: 'inherit', cwd: work, ...opts });

	console.log(`\n# ${g.name}: cloning ${g.repo} @ ${g.commit.slice(0, 8)}`);
	execFileSync('git', ['clone', g.repo, work], { stdio: 'inherit' });
	sh('git', ['checkout', g.commit]);

	// CLI >= 0.24 requires a tree-sitter.json; older grammars predate it.
	writeFileSync(
		join(work, 'tree-sitter.json'),
		JSON.stringify(
			{
				grammars: [{ name: g.name, scope: `source.${g.name}`, path: '.', 'file-types': g.fileTypes }],
				metadata: { version: '0.0.0', license: g.license, authors: [{ name: g.repo }] }
			},
			null,
			2
		)
	);

	const wasm = `tree-sitter-${g.name}.wasm`;
	console.log(`# ${g.name}: building ${wasm} with tree-sitter-cli@${CLI_VERSION} (docker)`);
	sh('npx', ['-y', `tree-sitter-cli@${CLI_VERSION}`, 'build', '--wasm', '-o', wasm, '.']);
	copyFileSync(join(work, wasm), join(outDir, wasm));
	rmSync(work, { recursive: true, force: true });
	console.log(`# ${g.name}: wrote packages/core/grammars/${wasm}`);
}
