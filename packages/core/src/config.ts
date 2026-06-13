// Project configuration (format.md section 6): docref.toml declares scan
// scope and cross-repo aliases; docref.lock (tool-managed) pins each alias
// to a rev. Both live at the project root and are committed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { DocrefError } from './errors';
import { assertRev, assertRef, assertUrl } from './gitcache';

export type RepoConfig = { url: string; ref?: string };

export type Project = {
	root: string;
	scan: { include: string[]; exclude: string[] };
	/** where to look for region markers (the code-side inventory) */
	anchors: { include: string[]; exclude: string[]; allowUnused: boolean };
	repos: Record<string, RepoConfig>;
	lock: Record<string, { rev: string }>;
};

const DEFAULT_INCLUDE = ['**/*.md'];
const ALWAYS_EXCLUDE = ['**/node_modules/**', '**/.git/**'];

function toml(path: string): Record<string, unknown> {
	const text = readFileSync(path, 'utf8'); // a missing file is existsSync-guarded
	try {
		return parseToml(text) as Record<string, unknown>;
	} catch (e) {
		// a raw smol-toml TomlError is unclassifiable and in a foreign voice;
		// give it the same code as every other config error and name the file
		throw new DocrefError('invalid-config', `${path}: ${(e as Error).message}`);
	}
}

export function loadProject(root: string): Project {
	const project: Project = {
		root,
		scan: { include: DEFAULT_INCLUDE, exclude: [...ALWAYS_EXCLUDE] },
		anchors: { include: ['**/*'], exclude: [...ALWAYS_EXCLUDE], allowUnused: false },
		repos: {},
		lock: {}
	};

	const configPath = join(root, 'docref.toml');
	if (existsSync(configPath)) {
		const t = toml(configPath);
		const scan = t.scan as { include?: string[]; exclude?: string[] } | undefined;
		if (scan?.include?.length) project.scan.include = scan.include;
		if (scan?.exclude?.length) project.scan.exclude.push(...scan.exclude);
		const anchors = t.anchors as
			| { include?: string[]; exclude?: string[]; 'allow-unused'?: boolean }
			| undefined;
		if (anchors?.include?.length) project.anchors.include = anchors.include;
		if (anchors?.exclude?.length) project.anchors.exclude.push(...anchors.exclude);
		if (anchors?.['allow-unused'] === true) project.anchors.allowUnused = true;
		const repos = (t.repos ?? {}) as Record<string, { url?: string; ref?: string }>;
		for (const [alias, repo] of Object.entries(repos)) {
			if (!repo.url) {
				throw new DocrefError('invalid-config', `repos.${alias} in docref.toml has no url`);
			}
			// reject at the boundary: url/ref are handed to the system git, and
			// an option-shaped or transport::address value would let committed
			// config execute code (see gitcache validators)
			assertUrl(repo.url);
			if (repo.ref !== undefined) assertRef(repo.ref);
			project.repos[alias] = { url: repo.url, ...(repo.ref ? { ref: repo.ref } : {}) };
		}
	}

	const lockPath = join(root, 'docref.lock');
	if (existsSync(lockPath)) {
		const t = toml(lockPath);
		const repos = (t.repos ?? {}) as Record<string, { rev?: string }>;
		for (const [alias, entry] of Object.entries(repos)) {
			if (!entry.rev) {
				throw new DocrefError('invalid-config', `repos.${alias} in docref.lock has no rev`);
			}
			assertRev(entry.rev); // a hex commit id, never a git option
			project.lock[alias] = { rev: entry.rev };
		}
	}

	return project;
}

export function writeLock(project: Project): void {
	writeFileSync(join(project.root, 'docref.lock'), stringifyToml({ repos: project.lock }) + '\n');
}

/** Walk up from cwd to the nearest docref.toml; fall back to cwd itself. */
export function findRoot(cwd: string): string {
	let dir = cwd;
	for (;;) {
		if (existsSync(join(dir, 'docref.toml'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
}
