// `docref install-extension` — bootstrap the editor from the CLI: download the
// VS Code extension (.vsix) from the latest GitHub release and install it into
// the VS Code-family editors the user picks. The decisions (which editors,
// which selection, which asset) live in ./editors and are tested; this is the
// thin IO around them — PATH probe, the interactive prompt, the download, and
// the per-editor spawn.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { downloadAsset, latestRelease } from './github';
import {
	detectEditors,
	editorsFromFlag,
	EXTENSION_ID,
	initialSelectorState,
	pickVsix,
	selectorStep,
	type Editor
} from './editors';

const UA = 'docref-install-extension';

// Is `cli` an executable on PATH? Honors the common Windows shim extensions.
function onPath(cli: string): boolean {
	const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
	for (const dir of (process.env.PATH ?? '').split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) if (existsSync(join(dir, cli + ext))) return true;
	}
	return false;
}

// Install the .vsix into one editor. The cli name is validated upstream and the
// vsix path is one we created, so neither carries user input. Windows editor
// CLIs are .cmd shims that need a shell to launch (both paths quoted); else we
// spawn directly, no shell.
function installInto(cli: string, vsix: string): void {
	if (process.platform === 'win32') {
		execSync(`"${cli}" --install-extension "${vsix}" --force`, { stdio: 'pipe' });
	} else {
		execFileSync(cli, ['--install-extension', vsix, '--force'], { stdio: 'pipe' });
	}
}

// Does this editor already have the docref extension? `self-update` uses this
// to refresh only the editors that have it. Any failure (CLI missing, errors)
// reads as "no", so detection never throws into the update path.
function hasExtension(cli: string): boolean {
	try {
		const out =
			process.platform === 'win32'
				? execSync(`"${cli}" --list-extensions`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
				: execFileSync(cli, ['--list-extensions'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		return out
			.split(/\r?\n/)
			.map((s) => s.trim().toLowerCase())
			.includes(EXTENSION_ID.toLowerCase());
	} catch {
		return false;
	}
}

// Interactive checkbox selector: arrow keys move, space toggles, Enter
// confirms, Esc/Ctrl-C aborts. The key handling is the pure selectorStep; this
// is the raw-mode render loop around it. Drawn on stderr so stdout stays clean
// for the result summary.
function promptSelection(offered: Editor[]): Promise<Editor[]> {
	return new Promise((resolve) => {
		const input = process.stdin;
		const out = process.stderr;
		let state = initialSelectorState(offered.length);
		emitKeypressEvents(input);
		const wasRaw = Boolean(input.isRaw);
		input.setRawMode?.(true);
		input.resume();

		out.write('Select editors to install into  (↑/↓ move · space toggle · a all · enter confirm · esc cancel)\n');
		let drawn = 0;
		const render = (): void => {
			if (drawn) out.write(`\x1b[${drawn}A`); // back to the top of the list
			const lines = offered.map((e, i) => {
				const pointer = i === state.cursor ? '❯' : ' ';
				const box = state.checked[i] ? '◉' : '◯';
				return `\x1b[2K ${pointer} ${box} ${e.name}  (${e.cli})`;
			});
			out.write(lines.join('\n') + '\n');
			drawn = lines.length;
		};
		render();

		let done = false;
		const finish = (chosen: Editor[]): void => {
			if (done) return;
			done = true;
			input.off('keypress', onKey);
			input.setRawMode?.(wasRaw);
			input.pause();
			out.write('\n');
			resolve(chosen);
		};
		const onKey = (_s: string, key: { name?: string; ctrl?: boolean } = {}): void => {
			const step = selectorStep(state, key);
			if (step.kind === 'continue') {
				state = step.state;
				render();
			} else if (step.kind === 'cancel') {
				finish([]);
			} else {
				finish(step.indices.map((i) => offered[i]!));
			}
		};
		input.on('keypress', onKey);
	});
}

export type InstallOpts = {
	all?: boolean;
	editorList?: string;
	/** Refresh only editors that already have the extension (used by self-update). */
	onlyInstalled?: boolean;
};
export type InstallIO = {
	detect?: () => Editor[];
	prompt?: (offered: Editor[]) => Promise<Editor[]>;
	install?: (cli: string, vsix: string) => void;
	hasExtension?: (cli: string) => boolean;
	isTTY?: boolean;
	fetchVsix?: () => Promise<{ tag: string; name: string; bytes: Buffer }>;
};

export async function installExtension(
	opts: InstallOpts,
	io: InstallIO = {}
): Promise<{ code: number; out: string }> {
	const detect = io.detect ?? (() => detectEditors(onPath));
	const prompt = io.prompt ?? promptSelection;
	const install = io.install ?? installInto;
	const installed = io.hasExtension ?? hasExtension;
	const isTTY = io.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

	// 1) which editors?
	let chosen: Editor[];
	if (opts.editorList) {
		try {
			chosen = editorsFromFlag(opts.editorList);
		} catch (e) {
			return { code: 2, out: (e as Error).message };
		}
	} else if (opts.onlyInstalled) {
		// refresh in place: only the editors that already carry the extension, no
		// prompt. Nothing to do is success, not an error (self-update calls this).
		const have = detect().filter((e) => installed(e.cli));
		if (have.length === 0) return { code: 0, out: 'no editor has the docref extension; nothing to update' };
		chosen = have;
	} else {
		const detected = detect();
		if (detected.length === 0) {
			return {
				code: 2,
				out: 'no VS Code-family editor CLI found on PATH (code, code-insiders, codium, cursor, windsurf, positron).\nOpen your editor and run its "Shell Command: Install \'code\' command in PATH" action, or pass --editor <cli>.'
			};
		}
		if (opts.all) chosen = detected;
		else if (isTTY) chosen = await prompt(detected);
		else {
			const names = detected.map((e) => e.cli).join(', ');
			return {
				code: 2,
				out: `found ${detected.length} editor(s): ${names}. Not a TTY — pass --all or --editor <list> to choose non-interactively.`
			};
		}
	}
	if (chosen.length === 0) return { code: 0, out: 'nothing selected; no extension installed' };

	// 2) get the .vsix from the latest release
	let vsix: { tag: string; name: string; bytes: Buffer };
	try {
		vsix = io.fetchVsix ? await io.fetchVsix() : await fetchLatestVsix();
	} catch (e) {
		return { code: 2, out: (e as Error).message };
	}

	// 3) write it once, install into each chosen editor, report per-editor.
	// A FIXED filename (not the release-supplied vsix.name) so the Windows shell
	// invocation in installInto never interpolates an untrusted name; the editor
	// reads the file regardless of what it's called.
	const dir = mkdtempSync(join(tmpdir(), 'docref-vsix-'));
	const path = join(dir, 'extension.vsix');
	const ok: string[] = [];
	const failed: { cli: string; why: string }[] = [];
	try {
		writeFileSync(path, vsix.bytes);
		for (const e of chosen) {
			try {
				install(e.cli, path);
				ok.push(e.cli);
			} catch (err) {
				failed.push({ cli: e.cli, why: ((err as Error).message || 'install failed').split('\n')[0]! });
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	const lines = [
		...ok.map((c) => `installed ${vsix.name} into ${c} (${vsix.tag})`),
		...failed.map((f) => `failed ${f.cli}: ${f.why}`)
	];
	return { code: failed.length ? 2 : 0, out: lines.join('\n') };
}

async function fetchLatestVsix(): Promise<{ tag: string; name: string; bytes: Buffer }> {
	const release = await latestRelease(UA);
	const asset = pickVsix(release.assets ?? []);
	const bytes = await downloadAsset(asset, UA);
	return { tag: release.tag_name ?? '(latest)', name: asset.name, bytes };
}
