// Project configuration (format.md section 6): docref.toml declares scan
// scope and cross-repo aliases; docref.lock (tool-managed) pins each alias
// to a rev. Both live at the project root and are committed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { DocrefError } from './errors';

export type RepoConfig = { url: string; ref?: string };

export type Project = {
	root: string;
	scan: { include: string[]; exclude: string[] };
	repos: Record<string, RepoConfig>;
	lock: Record<string, { rev: string }>;
};

const DEFAULT_INCLUDE = ['**/*.md'];
const ALWAYS_EXCLUDE = ['**/node_modules/**', '**/.git/**'];

function toml(path: string): Record<string, unknown> {
	return parseToml(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function loadProject(root: string): Project {
	const project: Project = {
		root,
		scan: { include: DEFAULT_INCLUDE, exclude: [...ALWAYS_EXCLUDE] },
		repos: {},
		lock: {}
	};

	const configPath = join(root, 'docref.toml');
	if (existsSync(configPath)) {
		const t = toml(configPath);
		const scan = t.scan as { include?: string[]; exclude?: string[] } | undefined;
		if (scan?.include?.length) project.scan.include = scan.include;
		if (scan?.exclude?.length) project.scan.exclude.push(...scan.exclude);
		const repos = (t.repos ?? {}) as Record<string, { url?: string; ref?: string }>;
		for (const [alias, repo] of Object.entries(repos)) {
			if (!repo.url) {
				throw new DocrefError('invalid-config', `repos.${alias} in docref.toml has no url`);
			}
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
