// Cross-repo resolution (format.md section 6): a shallow bare clone per
// repository under the cache directory, read via `git show <rev>:<path>`
// so no checkout is needed. Git is the system git, so the user's existing
// credentials cover private repositories.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DocrefError } from './errors';
import type { FileSource } from './resolve';

function cacheRoot(): string {
	return (
		process.env.DOCREF_CACHE ??
		join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'docref')
	);
}

export function cacheDirFor(url: string): string {
	// Content-address by the EXACT url, so distinct repositories can never share
	// a clone. The old punctuation-collapsing slug mapped `owner/repo` and
	// `owner-repo` to one dir, letting one alias read another repo's content (and
	// it was unbounded in length). A short sanitized hint is prepended purely for
	// human debuggability; the sha256 digest is what makes the key injective.
	const digest = createHash('sha256').update(url).digest('hex').slice(0, 32);
	const hint = url
		.replace(/^[a-z+]+:\/\//i, '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return join(cacheRoot(), hint ? `${hint}-${digest}` : digest);
}

// Inputs read from committed config (docref.lock rev, docref.toml ref/url)
// reach git as positional arguments. git treats any leading-dash positional
// as an option no matter where it sits, so "--upload-pack=<cmd>" turns a
// fetch into command execution, and a "transport::address" url runs a remote
// helper (ext::, fd::). The three validators below are the fail-closed
// boundary: a value that git could re-interpret as an option or a
// code-executing transport never reaches it. They are exported so the
// contract is unit-tested directly (gitcache.test.ts).
const REV = /^[0-9a-f]{7,64}$/i;
const REF = /^[0-9A-Za-z._/-]+$/;
const URL_SCHEME = /^(https?|ssh|git|file):\/\//i;
const SCP_LIKE = /^[^\s/:-][^\s/:]*@[^\s/:]+:.+$/;

export function assertRev(rev: string): string {
	if (typeof rev !== 'string' || !REV.test(rev)) {
		throw new DocrefError('unsafe-rev', `refusing unsafe git revision ${JSON.stringify(rev)}; expected a hex commit id`);
	}
	return rev;
}

export function assertRef(ref: string): string {
	if (typeof ref !== 'string' || ref.startsWith('-') || ref.includes('..') || !REF.test(ref)) {
		throw new DocrefError('unsafe-ref', `refusing unsafe git ref ${JSON.stringify(ref)}; expected a branch or tag name`);
	}
	return ref;
}

export function assertUrl(url: string): string {
	const ok =
		typeof url === 'string' &&
		!url.startsWith('-') &&
		!url.includes('::') &&
		(URL_SCHEME.test(url) || SCP_LIKE.test(url));
	if (!ok) {
		throw new DocrefError(
			'unsafe-url',
			`refusing unsafe repo url ${JSON.stringify(url)}; use https://, ssh://, git://, file://, or user@host:path`
		);
	}
	return url;
}

// Block protocols whose handlers can execute code (ext, fd, …) belt-and-braces
// with assertUrl, in case a future caller bypasses it.
const GIT_ENV = { ...process.env, GIT_ALLOW_PROTOCOL: 'file:git:http:https:ssh' };

// The one spawn configuration, shared by every git invocation so a change (a new
// GIT_* env var, a stdio tweak) cannot apply to some call sites and not others.
const GIT_SPAWN: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv } = {
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
	env: GIT_ENV
};

function git(args: string[], cwd: string): string {
	try {
		return execFileSync('git', args, { cwd, ...GIT_SPAWN });
	} catch (e) {
		const err = e as { stderr?: string; message: string };
		throw new DocrefError('git-failed', `git ${args.join(' ')}: ${err.stderr?.trim() || err.message}`);
	}
}

function ensureRepo(url: string): string {
	assertUrl(url);
	const dir = cacheDirFor(url);
	if (!existsSync(join(dir, 'HEAD'))) {
		mkdirSync(dir, { recursive: true });
		git(['init', '--bare', '-q'], dir);
		git(['remote', 'add', 'origin', '--', url], dir);
	} else {
		// defense in depth against a cache-key collision: an existing clone's
		// origin must be exactly this url, or we could fetch/read another repo
		const origin = git(['remote', 'get-url', 'origin'], dir).trim();
		if (origin !== url) {
			throw new DocrefError(
				'cache-origin-mismatch',
				`cache dir ${dir} has origin ${origin}, expected ${url}`
			);
		}
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
	assertRev(rev);
	const dir = ensureRepo(url);
	if (hasCommit(dir, rev)) return dir;
	try {
		// --end-of-options stops git treating rev as an option (assertRev
		// already forbids that; this is the second lock)
		git(['fetch', '-q', '--depth', '1', 'origin', '--end-of-options', rev], dir);
	} catch (first) {
		// some servers refuse fetch-by-sha; fall back to fetching branch refs —
		// still SHALLOW (--depth 1), so a transient auth/network failure is not
		// silently escalated to a full-remote fetch. Surface the original
		// targeted-fetch failure if the fallback fails too.
		try {
			git(['fetch', '-q', '--depth', '1', 'origin'], dir);
		} catch (second) {
			throw new DocrefError(
				'rev-unavailable',
				`cannot fetch commit ${rev} from ${url} (by-sha: ${(first as Error).message}; by-branch: ${(second as Error).message})`
			);
		}
	}
	if (!hasCommit(dir, rev)) {
		throw new DocrefError('rev-unavailable', `commit ${rev} is not reachable from ${url}`);
	}
	return dir;
}

/** Fetch the tracked branch (or the remote default) and return its tip. */
export function branchTip(url: string, branch?: string): string {
	if (branch !== undefined) assertRef(branch);
	const dir = ensureRepo(url);
	git(['fetch', '-q', '--depth', '1', 'origin', '--end-of-options', branch ?? 'HEAD'], dir);
	return git(['rev-parse', 'FETCH_HEAD'], dir).trim();
}

export function gitRevSource(url: string, rev: string): FileSource {
	assertRev(rev);
	let dir: string | null = null;
	return {
		read(path: string): string | null {
			dir ??= ensureCommit(url, rev);
			try {
				// the arg starts with the validated hex rev, so git can never
				// read `<rev>:<path>` as an option. A missing file at the rev is an
				// expected miss (null), not an error — so this does not use git().
				return execFileSync('git', ['show', `${rev}:${path}`], { cwd: dir, ...GIT_SPAWN });
			} catch {
				return null;
			}
		},
		describe: () => `${url}@${rev.slice(0, 12)}`
	};
}
