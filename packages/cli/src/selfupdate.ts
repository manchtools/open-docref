// `docref self-update` — replace the running single-file binary with the
// latest release asset for this platform. Only meaningful for the compiled
// binary (the entrypoint wires it up); a node/npm install updates through its
// package manager instead. The repo's releases must be reachable: public, or
// pass a token via GITHUB_TOKEN / DOCREF_GITHUB_TOKEN for a private repo.
import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { downloadAsset, latestRelease } from './github';
import { installExtension } from './installext';

// Must match exactly the asset names the release workflow uploads.
const ASSETS: Record<string, string> = {
	'linux:x64': 'docref-linux-x64',
	'linux:arm64': 'docref-linux-arm64',
	'darwin:x64': 'docref-darwin-x64',
	'darwin:arm64': 'docref-darwin-arm64',
	'win32:x64': 'docref-windows-x64.exe'
};

export function assetName(platform: string, arch: string): string {
	const name = ASSETS[`${platform}:${arch}`];
	if (!name) {
		throw new Error(`no docref binary for ${platform}/${arch}; build from source or use the .vsix`);
	}
	return name;
}

export async function selfUpdate(
	currentVersion: string,
	opts: { skipExtension?: boolean } = {}
): Promise<{ code: number; out: string }> {
	const target = process.execPath; // the running binary
	let name: string;
	try {
		name = assetName(process.platform, process.arch);
	} catch (e) {
		return { code: 2, out: (e as Error).message };
	}

	let release;
	try {
		release = await latestRelease('docref-self-update');
	} catch (e) {
		return { code: 2, out: `self-update failed: ${(e as Error).message}` };
	}

	const tag = release.tag_name ?? '';
	if (tag === `v${currentVersion}`) {
		return { code: 0, out: `already on the latest release (${tag})` };
	}
	const asset = release.assets?.find((a) => a.name === name);
	if (!asset) {
		return { code: 2, out: `release ${tag || '(latest)'} has no asset ${name}` };
	}

	let bytes: Buffer;
	try {
		bytes = await downloadAsset(asset, 'docref-self-update');
	} catch (e) {
		return { code: 2, out: `download failed: ${(e as Error).message}` };
	}

	// Write beside the target (same directory => same filesystem, so the rename
	// is atomic) and swap it in. Replacing a running binary works on unix; on
	// Windows the file is locked, so we report that instead of corrupting it.
	const tmp = join(dirname(target), `.docref-update-${process.pid}`);
	try {
		writeFileSync(tmp, bytes);
		chmodSync(tmp, 0o755);
		renameSync(tmp, target);
	} catch (e) {
		try {
			unlinkSync(tmp);
		} catch {
			/* best effort */
		}
		return {
			code: 2,
			out: `could not replace ${target}: ${(e as Error).message}. Re-run with sufficient permissions, or download the new binary manually.`
		};
	}
	const updated = `updated ${currentVersion ? `${currentVersion} -> ` : ''}${tag} (${name})`;

	// Keep the editor extension in lockstep with the binary: refresh it in every
	// editor that already has it. Best-effort and in-place — never installs it
	// somewhere new. Opt out with --skip-extension.
	if (opts.skipExtension) return { code: 0, out: updated };
	const ext = await installExtension({ onlyInstalled: true });
	return { code: ext.code, out: `${updated}\n${ext.out}` };
}
