import { describe, it, expect } from 'vitest';
import { assetName } from './selfupdate';

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
