import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assetName, selfUpdate, expectedSha, ASSETS, type SelfUpdateIO } from './selfupdate';

// `docref self-update` fetches the release asset built for the running
// platform. The name must match exactly what the release workflow uploads,
// so the mapping is pinned here. An unsupported platform fails closed rather
// than downloading the wrong binary.

describe('assetName', () => {
	it('maps every supported platform/arch to its release asset', () => {
		expect(assetName('linux', 'x64')).toBe('docref-linux-x64');
		expect(assetName('linux', 'arm64')).toBe('docref-linux-arm64');
		expect(assetName('darwin', 'x64')).toBe('docref-darwin-x64');
		expect(assetName('darwin', 'arm64')).toBe('docref-darwin-arm64');
		expect(assetName('win32', 'x64')).toBe('docref-windows-x64.exe');
	});

	it('fails closed on an unsupported platform or arch', () => {
		expect(() => assetName('linux', 'ia32')).toThrow();
		expect(() => assetName('freebsd', 'x64')).toThrow();
		expect(() => assetName('win32', 'arm64')).toThrow();
	});
});

// The request boundary: selfUpdate's decision and failure paths, exercised
// through injected IO so no network call is made and no real binary is touched.
// Covers correct / absent / present-but-wrong for each step, including the
// checksum gate that guards the binary swap.
describe('selfUpdate: decision and failure paths', () => {
	const presentAsset = assetName(process.platform, process.arch);
	const BINARY = Buffer.from('new-binary');
	const BIN_SHA = createHash('sha256').update(BINARY).digest('hex');
	// a valid SHA256SUMS manifest matching BINARY for this platform's asset
	const SUMS = Buffer.from(`${BIN_SHA}  ${presentAsset}\n${'0'.repeat(64)}  other\n`);
	const io = (over: Partial<SelfUpdateIO> = {}): SelfUpdateIO => ({
		fetchRelease: async () => ({
			tag_name: 'v2.0.0',
			assets: [
				{ name: presentAsset, url: 'bin' },
				{ name: 'SHA256SUMS', url: 'sums' }
			]
		}),
		downloadAsset: async (asset) => (asset.name === 'SHA256SUMS' ? SUMS : BINARY),
		replaceBinary: () => {},
		refreshExtension: async () => ({ code: 0, out: 'extension refreshed' }),
		platform: process.platform,
		arch: process.arch,
		execPath: '/fake/docref',
		...over
	});

	it('on the happy path downloads, replaces, refreshes, and reports the new tag', async () => {
		let wrote: Buffer | null = null;
		const res = await selfUpdate('1.0.0', {}, io({ replaceBinary: (_t, b) => void (wrote = b) }));
		expect(res.code).toBe(0);
		expect(res.out).toContain('updated 1.0.0 -> v2.0.0');
		expect(res.out).toContain('extension refreshed');
		expect(wrote && (wrote as Buffer).toString()).toBe('new-binary');
	});

	it('does nothing (and never downloads) when already on the latest tag', async () => {
		let downloaded = false;
		const res = await selfUpdate(
			'2.0.0',
			{},
			io({
				fetchRelease: async () => ({ tag_name: 'v2.0.0', assets: [] }),
				downloadAsset: async () => {
					downloaded = true;
					return Buffer.from('');
				}
			})
		);
		expect(res.code).toBe(0);
		expect(res.out).toContain('already on the latest');
		expect(downloaded).toBe(false);
	});

	it('exits 2 when the release cannot be fetched', async () => {
		const res = await selfUpdate('1.0.0', {}, io({ fetchRelease: async () => { throw new Error('offline'); } }));
		expect(res.code).toBe(2);
		expect(res.out).toContain('self-update failed');
	});

	it('exits 2 when the release lacks this platform asset', async () => {
		const res = await selfUpdate('1.0.0', {}, io({ fetchRelease: async () => ({ tag_name: 'v2.0.0', assets: [] }) }));
		expect(res.code).toBe(2);
		expect(res.out).toContain('no asset');
	});

	it('exits 2 when the download fails', async () => {
		const res = await selfUpdate('1.0.0', {}, io({ downloadAsset: async () => { throw new Error('reset'); } }));
		expect(res.code).toBe(2);
		expect(res.out).toContain('download failed');
	});

	it('exits 2 when the binary cannot be replaced', async () => {
		const res = await selfUpdate('1.0.0', {}, io({ replaceBinary: () => { throw new Error('EACCES'); } }));
		expect(res.code).toBe(2);
		expect(res.out).toContain('could not replace');
	});

	it('with skipExtension updates only the binary and never refreshes the extension', async () => {
		let refreshed = false;
		const res = await selfUpdate(
			'1.0.0',
			{ skipExtension: true },
			io({ refreshExtension: async () => { refreshed = true; return { code: 0, out: 'x' }; } })
		);
		expect(res.code).toBe(0);
		expect(res.out).toContain('updated');
		expect(refreshed).toBe(false);
	});

	it('folds a non-zero extension refresh code into the result', async () => {
		const res = await selfUpdate('1.0.0', {}, io({ refreshExtension: async () => ({ code: 3, out: 'ext failed' }) }));
		expect(res.code).toBe(3);
		expect(res.out).toContain('updated');
		expect(res.out).toContain('ext failed');
	});

	it('refuses to replace the binary when the checksum does not match', async () => {
		let replaced = false;
		const tampered = Buffer.from(`${'a'.repeat(64)}  ${presentAsset}\n`);
		const res = await selfUpdate(
			'1.0.0',
			{},
			io({
				downloadAsset: async (asset) => (asset.name === 'SHA256SUMS' ? tampered : BINARY),
				replaceBinary: () => void (replaced = true)
			})
		);
		expect(res.code).toBe(2);
		expect(res.out).toContain('checksum mismatch');
		expect(replaced).toBe(false); // the swap never happened
	});

	it('refuses to replace the binary when the release ships no SHA256SUMS', async () => {
		const res = await selfUpdate(
			'1.0.0',
			{},
			io({ fetchRelease: async () => ({ tag_name: 'v2.0.0', assets: [{ name: presentAsset, url: 'bin' }] }) })
		);
		expect(res.code).toBe(2);
		expect(res.out).toContain('SHA256SUMS');
	});
});

describe('expectedSha: parsing a sha256sum manifest', () => {
	it('reads the hash for a name in text and binary (*) modes, else undefined', () => {
		const h = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
		expect(expectedSha(`${h}  docref-linux-x64`, 'docref-linux-x64')).toBe(h);
		expect(expectedSha(`${h} *docref-linux-x64`, 'docref-linux-x64')).toBe(h);
		expect(expectedSha(`${h}  other`, 'docref-linux-x64')).toBeUndefined();
		expect(expectedSha('not a sums line', 'x')).toBeUndefined();
	});
});

describe('the release asset matrix is the single source of truth', () => {
	const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
	const releaseYml = readFileSync(`${repoRoot}/.github/workflows/release.yml`, 'utf8');
	const installSh = readFileSync(`${repoRoot}/install.sh`, 'utf8');

	it('every asset selfupdate requests is the one release.yml builds (no drift)', () => {
		const names = Object.values(ASSETS);
		expect(names.length).toBeGreaterThan(0); // guard against matching zero

		// the cross-compile loop: `for t in linux-x64 ... ; do ... docref-$t`
		const loop = /for t in ([^;\n]+)/.exec(releaseYml);
		expect(loop).not.toBeNull();
		const built = new Set(loop![1]!.trim().split(/\s+/).map((t) => `docref-${t}`));
		// the windows target is built explicitly as a .exe
		const win = /--outfile\s+(?:out\/)?(docref-windows-\S+\.exe)/.exec(releaseYml);
		expect(win).not.toBeNull();
		built.add(win![1]!);

		// the set built by release.yml must be exactly the set selfupdate maps
		expect(built).toEqual(new Set(names));
	});

	it('install.sh covers the os/arch of every non-Windows asset', () => {
		for (const name of Object.values(ASSETS)) {
			if (name.includes('windows')) continue; // install.sh points Windows users at the page
			// name is docref-<os>-<arch>; install.sh builds the same from uname
			const m = /^docref-([a-z0-9]+)-([a-z0-9]+)$/.exec(name)!;
			expect(installSh).toContain(`os=${m[1]!}`);
			expect(installSh).toContain(`arch=${m[2]!}`);
		}
	});
});
