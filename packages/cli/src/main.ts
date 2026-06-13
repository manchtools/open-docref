#!/usr/bin/env node
// docref CLI (tooling.md section 1). Exit codes: 0 everything up to
// date, 1 stale references present, 2 broken references or usage errors.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	findRoot,
	loadProject,
	check,
	refresh,
	approve,
	update,
	affected,
	ls,
	anchors,
	diff,
	remove,
	resolveReference,
	claimBlockText,
	snippetFenceText,
	exitCode,
	suggest,
	type Report,
	type ReportEntry
} from '@open-docref/core';
import { installExtension } from './installext';

// Single source of truth for the version, pinned to package.json by a test
// (main.test.ts) so a release bump cannot desync them. Read as a constant so
// it survives bundling and `bun build --compile` without a JSON import.
export const VERSION = '0.1.0';

const USAGE = `usage: docref <command> [options]

commands:
  check [paths...]            report reference states; writes nothing
  refresh [paths...]          rewrite stale snippets (mechanical)
  approve <paths...>          record claim approvals after reviewing the prose
  update [aliases...]         pin cross-repo aliases to their branch tips
         --check              dry run: report drift, write nothing
  diff [paths...]             what changed since each stale claim was approved
  affected --since <rev>      references endangered by changes since <rev>
  suggest                     prose that names anchorable code but isn't anchored
  ls                          the reverse index: refs and their locations
  claim <ref...>              print a paste-ready claim block, shas computed
  snippet <ref>               print a paste-ready materialized snippet
  remove <ref>                delete a reference everywhere, marker included
  anchors                     region markers in the code, unused ones flagged
  install-extension           install the VS Code extension into your editors
         --all                every detected editor, no prompt
         --editor <list>      a comma-separated set of editor CLIs (e.g. code,cursor)
  self-update                 update the binary AND refresh the extension in editors that have it
         --skip-extension     update only the binary (compiled binary only)

options:
  --json                      machine-readable output`;

function popFlag(args: string[], flag: string): boolean {
	const at = args.indexOf(flag);
	if (at === -1) return false;
	args.splice(at, 1);
	return true;
}

function popValue(args: string[], flag: string): string | undefined {
	const at = args.indexOf(flag);
	if (at === -1) return undefined;
	const value = args[at + 1];
	args.splice(at, 2);
	return value;
}

function entryLine(e: ReportEntry): string {
	const hashes =
		e.pinned || e.current ? ` (${e.pinned ?? 'unapproved'} -> ${e.current ?? '?'})` : '';
	const reason = e.reason ? ` ${e.reason}` : '';
	return `${e.state}  ${e.doc}:${e.line}  ${e.ref}${hashes}${reason}`;
}

/** Unified diff of two strings via `git diff --no-index` (exit 1 = differ). */
function unifiedDiff(approved: string, current: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'docref-diff-'));
	try {
		writeFileSync(join(dir, 'approved'), approved.endsWith('\n') ? approved : approved + '\n');
		writeFileSync(join(dir, 'current'), current.endsWith('\n') ? current : current + '\n');
		try {
			execFileSync('git', ['diff', '--no-index', '--no-color', 'approved', 'current'], {
				cwd: dir,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			return '';
		} catch (e) {
			const out = (e as { stdout?: string }).stdout ?? '';
			const at = out.indexOf('--- ');
			return at >= 0 ? out.slice(at) : out;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function renderReport(report: Report, json: boolean): string {
	if (json) return JSON.stringify(report, null, 2);
	const lines = [
		...report.errors.map((e) => `error  ${e.doc}:${e.line}  ${e.message}`),
		...report.entries.filter((e) => e.state !== 'up-to-date').map(entryLine),
		...report.unusedAnchors.map((u) => `unused-anchor  ${u.file}#@${u.name}  (line ${u.line})`)
	];
	const s = report.summary;
	lines.push(
		`${s.upToDate} up-to-date, ${s.staleSnippet} stale-snippet, ${s.staleClaim} stale-claim, ${s.broken} broken, ${report.unusedAnchors.length} unused-anchor, ${report.errors.length} errors`
	);
	return lines.join('\n');
}

export async function run(argv: string[], cwd: string): Promise<{ code: number; out: string }> {
	const args = [...argv];
	if (popFlag(args, '--version') || popFlag(args, '-v') || args[0] === 'version') {
		return { code: 0, out: VERSION };
	}
	const json = popFlag(args, '--json');
	const checkOnly = popFlag(args, '--check');
	const since = popValue(args, '--since');
	const [cmd, ...rest] = args;
	const usage = (why: string) => ({ code: 2 as const, out: `${why}\n\n${USAGE}` });

	try {
		const project = () => loadProject(findRoot(cwd));
		switch (cmd) {
			case 'check': {
				const report = await check(project(), rest.length ? rest : undefined);
				return { code: exitCode(report), out: renderReport(report, json) };
			}
			case 'refresh': {
				const { report, changedDocs } = await refresh(project(), rest.length ? rest : undefined);
				if (json) return { code: exitCode(report), out: JSON.stringify({ changedDocs, ...report }, null, 2) };
				const head = changedDocs.length ? changedDocs.map((d) => `refreshed  ${d}`).join('\n') + '\n' : '';
				return { code: exitCode(report), out: head + renderReport(report, false) };
			}
			case 'approve': {
				if (rest.length === 0) return usage('approve requires explicit paths');
				const result = await approve(project(), rest);
				const code = result.refused.length > 0 ? 2 : 0;
				if (json) return { code, out: JSON.stringify(result, null, 2) };
				const lines = [
					`approved ${result.approved} claim(s) in ${result.changedDocs.length} file(s)`,
					...result.refused.map((e) => `refused  ${e.doc}:${e.line}  ${e.ref}  ${e.reason ?? ''}`)
				];
				return { code, out: lines.join('\n') };
			}
			case 'update': {
				const result = await update(project(), {
					...(rest.length ? { aliases: rest } : {}),
					checkOnly
				});
				const code = exitCode(result.report);
				if (json) return { code, out: JSON.stringify(result, null, 2) };
				const lines = result.changed.map(
					(c) => `${checkOnly ? 'would pin' : 'pinned'}  ${c.alias}  ${c.from?.slice(0, 12) ?? '(new)'} -> ${c.to.slice(0, 12)}`
				);
				return { code, out: [...lines, renderReport(result.report, false)].join('\n') };
			}
			case 'affected': {
				if (!since) return usage('affected requires --since <rev>');
				const result = await affected(project(), since);
				if (json) return { code: 0, out: JSON.stringify(result, null, 2) };
				return {
					code: 0,
					out:
						result.entries.map((e) => `${e.reason}  ${e.doc}:${e.line}  ${e.ref}`).join('\n') ||
						'no references affected'
				};
			}
			case 'suggest': {
				const result = await suggest(project());
				if (json) return { code: 0, out: JSON.stringify(result, null, 2) };
				return {
					code: 0,
					out:
						result.suggestions
							.map((s) => `${s.doc}:${s.line}  ${s.identifier}  -> ${s.refs.join(', ')}`)
							.join('\n') || 'no unanchored references found'
				};
			}
			case 'diff': {
				const result = await diff(project(), rest.length ? rest : undefined);
				if (json) return { code: 0, out: JSON.stringify(result, null, 2) };
				const blocks = result.entries.map((e) => {
					const head = `${e.doc}:${e.line}  ${e.ref}  (${e.pinned ?? 'unapproved'} -> ${e.current ?? '?'})`;
					if (e.approvedContent !== undefined && e.currentContent !== undefined) {
						return `${head}\n  approved at ${e.approvedRev!.slice(0, 12)}\n${unifiedDiff(e.approvedContent, e.currentContent)}`;
					}
					const sides = [
						e.approvedContent !== undefined ? `  approved at ${e.approvedRev!.slice(0, 12)}:\n${e.approvedContent}` : '',
						e.note ? `  ${e.note}` : ''
					].filter(Boolean);
					return [head, ...sides].join('\n');
				});
				return { code: 0, out: blocks.join('\n\n') || 'every claim is up to date' };
			}
			case 'claim': {
				if (rest.length === 0) return usage('claim takes one or more refs');
				const sources = [];
				for (const r of rest) sources.push(await resolveReference(project(), r));
				const text = claimBlockText(sources);
				if (json) return { code: 0, out: JSON.stringify({ text, sources: sources.map(({ ref, sha }) => ({ ref, sha })) }, null, 2) };
				return { code: 0, out: text.trimEnd() };
			}
			case 'snippet': {
				if (rest.length !== 1) return usage('snippet takes exactly one ref (a fence materializes one anchor)');
				const resolved = await resolveReference(project(), rest[0]!);
				const lang = resolved.ref.split('#')[0]!.split('/').pop()!.split('.').pop() ?? '';
				const text = snippetFenceText(resolved.ref, resolved.sha, lang, resolved.content);
				if (json) return { code: 0, out: JSON.stringify({ text, ref: resolved.ref, sha: resolved.sha }, null, 2) };
				return { code: 0, out: text.trimEnd() };
			}
			case 'remove': {
				if (rest.length !== 1) return usage('remove takes exactly one ref');
				const result = await remove(project(), rest[0]!);
				if (json) return { code: 0, out: JSON.stringify(result, null, 2) };
				const marker = result.markersRemoved ? ', marker pair deleted from the code' : '';
				return {
					code: 0,
					out: `removed ${result.referencesRemoved} reference(s) in ${result.docsChanged.length} file(s)${marker}`
				};
			}
			case 'anchors': {
				const result = await anchors(project());
				const code = result.errors.length > 0 ? 2 : 0;
				if (json) return { code, out: JSON.stringify(result, null, 2) };
				const lines = [
					...result.errors.map((e) => `error  ${e.file}:${e.line}  ${e.message}`),
					...result.anchors.map((a) => {
						const flag =
							a.references.length === 0
								? 'not used'
								: `${a.references.length} reference(s): ${a.references.map((r) => `${r.doc}:${r.line}`).join(', ')}`;
						return `${a.file}#@${a.name}  (line ${a.line})  ${flag}`;
					})
				];
				return { code, out: lines.join('\n') || 'no region markers found' };
			}
			case 'ls': {
				const index = await ls(project());
				if (json) return { code: 0, out: JSON.stringify(index, null, 2) };
				return {
					code: 0,
					out: index.refs
						.flatMap((r) => [r.ref, ...r.locations.map((l) => `  ${l.doc}:${l.line} (${l.kind})`)])
						.join('\n')
				};
			}
			case 'install-extension': {
				// editor bootstrap, not a docref-project command: needs no root
				const all = popFlag(rest, '--all');
				const editorList = popValue(rest, '--editor');
				return await installExtension({ all, ...(editorList ? { editorList } : {}) });
			}
			case 'self-update':
				// the compiled binary intercepts this before run(); reaching here
				// means a node/source build, which updates through its package manager
				return {
					code: 2,
					out: 'self-update replaces the compiled binary; a node/source install updates through its package manager instead.'
				};
			default:
				return usage(`unknown command "${cmd ?? ''}"`);
		}
	} catch (e) {
		return { code: 2, out: (e as Error).message };
	}
}

/**
 * True when this module is the executed entry point. Bin shims are
 * symlinks (~/.bun/bin/docref, node_modules/.bin/docref), so both sides
 * compare by real path; a raw comparison would silently no-op the CLI.
 */
export function isMainEntry(argv1: string | undefined, moduleUrl: string): boolean {
	if (!argv1) return false;
	try {
		return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
	} catch {
		return false;
	}
}

if (isMainEntry(process.argv[1], import.meta.url)) {
	const { code, out } = await run(process.argv.slice(2), process.cwd());
	if (out) console.log(out);
	process.exit(code);
}
