// Cross-repo resolution (format.md section 6): a shallow bare clone per
// repository under the cache directory, read via `git show <rev>:<path>`
// so no checkout is needed. Git is the system git, so the user's existing
// credentials cover private repositories.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DocrefError } from './errors';
import type { FileSource } from './resolve';

function cacheRoot(): string {
	return (
		process.env.DOCREF_CACHE ??
		join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'docref')
	);
}

function cacheDirFor(url: string): string {
	const slug = url.replace(/^[a-z+]+:\/\//i, '').replace(/[^A-Za-z0-9._-]+/g, '-');
	return join(cacheRoot(), slug);
}

function git(args: string[], cwd: string): string {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (e) {
		const err = e as { stderr?: string; message: string };
		throw new DocrefError('git-failed', `git ${args.join(' ')}: ${err.stderr?.trim() || err.message}`);
	}
}

function ensureRepo(url: string): string {
	const dir = cacheDirFor(url);
	if (!existsSync(join(dir, 'HEAD'))) {
		mkdirSync(dir, { recursive: true });
		git(['init', '--bare', '-q'], dir);
		git(['remote', 'add', 'origin', url], dir);
	}
	return dir;
}

function hasCommit(dir: string, rev: string): boolean {
	try {
		git(['cat-file', '-e', `${rev}^{commit}`], dir);
		return true;
	} catch {
		return false;
	}
}

/** Make sure the commit is in the cache; shallow-fetch it on demand. */
export function ensureCommit(url: string, rev: string): string {
	const dir = ensureRepo(url);
	if (hasCommit(dir, rev)) return dir;
	try {
		git(['fetch', '-q', '--depth', '1', 'origin', rev], dir);
	} catch {
		// some servers refuse fetch-by-sha; fall back to fetching branches
		git(['fetch', '-q', 'origin'], dir);
	}
	if (!hasCommit(dir, rev)) {
		throw new DocrefError('rev-unavailable', `commit ${rev} is not reachable from ${url}`);
	}
	return dir;
}

/** Fetch the tracked branch (or the remote default) and return its tip. */
export function branchTip(url: string, branch?: string): string {
	const dir = ensureRepo(url);
	git(['fetch', '-q', '--depth', '1', 'origin', branch ?? 'HEAD'], dir);
	return git(['rev-parse', 'FETCH_HEAD'], dir).trim();
}

export function gitRevSource(url: string, rev: string): FileSource {
	let dir: string | null = null;
	return {
		read(path: string): string | null {
			dir ??= ensureCommit(url, rev);
			try {
				return execFileSync('git', ['show', `${rev}:${path}`], {
					cwd: dir,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe']
				});
			} catch {
				return null;
			}
		},
		describe: () => `${url}@${rev.slice(0, 12)}`
	};
}
