// `docref self-update` — replace the running single-file binary with the
// latest release asset for this platform. Only meaningful for the compiled
// binary (the entrypoint wires it up); a node/npm install updates through its
// package manager instead. The repo's releases must be reachable: public, or
// pass a token via GITHUB_TOKEN / DOCREF_GITHUB_TOKEN for a private repo.
import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadAsset, latestRelease, type Release, type ReleaseAsset } from './github';
import { installExtension } from './installext';

// The asset name the release ships its checksums under.
const SUMS_NAME = 'SHA256SUMS';

/** The expected sha256 for `name` from a `sha256sum`-format manifest (lines of
 * `<64-hex>  <name>`, the second space possibly `*` for binary mode), or
 * undefined when absent. */
export function expectedSha(sums: string, name: string): string | undefined {
	for (const raw of sums.split('\n')) {
		const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(raw.trim());
		if (m && m[2] === name) return m[1];
	}
	return undefined;
}

/**
 * The IO seams selfUpdate touches, injectable so its decision and failure paths
 * are unit-testable without the network or replacing a real binary (the same
 * pattern as installext's InstallIO). Defaults are the real implementations.
 */
export type SelfUpdateIO = {
	fetchRelease: (userAgent: string) => Promise<Release>;
	downloadAsset: (asset: ReleaseAsset, userAgent: string) => Promise<Buffer>;
	replaceBinary: (target: string, bytes: Buffer) => void;
	refreshExtension: () => Promise<{ code: number; out: string }>;
	platform: string;
	arch: string;
	execPath: string;
};

/** Write beside the target (same dir => same filesystem, so rename is atomic)
 * and swap it in. On unix this replaces a running binary; on Windows the file is
 * locked, so the rename throws and the caller reports it rather than corrupting. */
function realReplaceBinary(target: string, bytes: Buffer): void {
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
		throw e;
	}
}

const defaultIO: SelfUpdateIO = {
	fetchRelease: latestRelease,
	downloadAsset,
	replaceBinary: realReplaceBinary,
	refreshExtension: () => installExtension({ onlyInstalled: true }),
	platform: process.platform,
	arch: process.arch,
	execPath: process.execPath
};

// Must match exactly the asset names the release workflow uploads. Exported so a
// drift test pins it against release.yml's build matrix (selfupdate.test.ts).
export const ASSETS: Record<string, string> = {
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
	opts: { skipExtension?: boolean } = {},
	io: SelfUpdateIO = defaultIO
): Promise<{ code: number; out: string }> {
	const target = io.execPath; // the running binary
	let name: string;
	try {
		name = assetName(io.platform, io.arch);
	} catch (e) {
		return { code: 2, out: (e as Error).message };
	}

	let release: Release;
	try {
		release = await io.fetchRelease('docref-self-update');
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
		bytes = await io.downloadAsset(asset, 'docref-self-update');
	} catch (e) {
		return { code: 2, out: `download failed: ${(e as Error).message}` };
	}

	// Verify the bytes against the release's SHA256SUMS BEFORE writing — these
	// bytes replace the running process, so an unverified asset is code
	// execution. Fail closed on a missing manifest, a missing entry, or a
	// mismatch. (Checksums from the same release are integrity, not provenance:
	// they catch corruption and single-asset tampering, NOT a full release
	// compromise — that needs an out-of-band signature; tracked as a follow-up.)
	const sumsAsset = release.assets?.find((a) => a.name === SUMS_NAME);
	if (!sumsAsset) {
		return { code: 2, out: `release ${tag || '(latest)'} ships no ${SUMS_NAME}; refusing to replace the binary unverified` };
	}
	let expected: string | undefined;
	try {
		const sums = await io.downloadAsset(sumsAsset, 'docref-self-update');
		expected = expectedSha(sums.toString('utf8'), name);
	} catch (e) {
		return { code: 2, out: `could not fetch ${SUMS_NAME}: ${(e as Error).message}` };
	}
	if (!expected) {
		return { code: 2, out: `${SUMS_NAME} has no entry for ${name}; refusing to replace unverified` };
	}
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== expected) {
		return { code: 2, out: `checksum mismatch for ${name}; refusing to replace the binary` };
	}

	try {
		io.replaceBinary(target, bytes);
	} catch (e) {
		return {
			code: 2,
			out: `could not replace ${target}: ${(e as Error).message} — re-run with sufficient permissions, or download the new binary manually`
		};
	}
	const updated = `updated ${currentVersion ? `${currentVersion} -> ` : ''}${tag} (${name})`;

	// Keep the editor extension in lockstep with the binary: refresh it in every
	// editor that already has it. Best-effort and in-place — never installs it
	// somewhere new. Opt out with --skip-extension. A non-zero refresh folds into
	// the exit code so a failed extension update is not silently swallowed.
	if (opts.skipExtension) return { code: 0, out: updated };
	const ext = await io.refreshExtension();
	return { code: ext.code, out: `${updated}\n${ext.out}` };
}
