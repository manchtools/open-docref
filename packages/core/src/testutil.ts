// Shared helpers for integration tests: throwaway directories, files, and
// git fixture repositories.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function tmp(prefix = 'docref-test-'): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function write(root: string, rel: string, content: string): void {
	const abs = join(root, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content);
}

export function read(root: string, rel: string): string {
	return readFileSync(join(root, rel), 'utf8');
}

export function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function initRepo(dir: string): void {
	git(dir, 'init', '-b', 'main');
	git(dir, 'config', 'user.name', 'fixture');
	git(dir, 'config', 'user.email', 'fixture@example.invalid');
}

export function commitAll(dir: string, msg: string): string {
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', msg);
	return git(dir, 'rev-parse', 'HEAD').trim();
}
