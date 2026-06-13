import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { authHeaders, latestRelease, downloadAsset } from './github';

// The network boundary for self-update and install-extension. Branchy intent
// that was unverified: token precedence, the private-repo hint by status, the
// abort-to-timeout mapping, and the octet-stream download contract. fetch is
// stubbed so no real request is made.

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
function stubFetch(fn: (url: string, init: { headers: Record<string, string> }) => Promise<Response>): void {
	globalThis.fetch = fn as unknown as typeof fetch;
}

describe('authHeaders: token precedence and the unauthenticated case', () => {
	const saved = { d: process.env.DOCREF_GITHUB_TOKEN, g: process.env.GITHUB_TOKEN };
	beforeEach(() => {
		delete process.env.DOCREF_GITHUB_TOKEN;
		delete process.env.GITHUB_TOKEN;
	});
	afterEach(() => {
		if (saved.d === undefined) delete process.env.DOCREF_GITHUB_TOKEN;
		else process.env.DOCREF_GITHUB_TOKEN = saved.d;
		if (saved.g === undefined) delete process.env.GITHUB_TOKEN;
		else process.env.GITHUB_TOKEN = saved.g;
	});

	it('omits authorization when neither token is set, and carries the UA + accept', () => {
		const h = authHeaders('docref-x');
		expect(h.authorization).toBeUndefined();
		expect(h['user-agent']).toBe('docref-x');
		expect(h.accept).toBe('application/vnd.github+json');
	});

	it('uses GITHUB_TOKEN when only it is set', () => {
		process.env.GITHUB_TOKEN = 'gtok';
		expect(authHeaders('ua').authorization).toBe('Bearer gtok');
	});

	it('prefers DOCREF_GITHUB_TOKEN over GITHUB_TOKEN when both are set', () => {
		process.env.DOCREF_GITHUB_TOKEN = 'dtok';
		process.env.GITHUB_TOKEN = 'gtok';
		expect(authHeaders('ua').authorization).toBe('Bearer dtok');
	});

	it('honors an explicit accept override (the octet-stream download path)', () => {
		expect(authHeaders('ua', 'application/octet-stream').accept).toBe('application/octet-stream');
	});
});

describe('latestRelease', () => {
	it('attaches the private-repo hint on 401/404 but not on 500', async () => {
		stubFetch(async () => new Response('', { status: 404 }));
		await expect(latestRelease('ua')).rejects.toThrow(/private repo\? set GITHUB_TOKEN/);
		stubFetch(async () => new Response('', { status: 401 }));
		await expect(latestRelease('ua')).rejects.toThrow(/set GITHUB_TOKEN/);

		stubFetch(async () => new Response('', { status: 500 }));
		const msg = await latestRelease('ua').then(
			() => 'no-error',
			(e) => (e as Error).message
		);
		expect(msg).toContain('HTTP 500');
		expect(msg).not.toContain('GITHUB_TOKEN');
	});

	it('maps an aborted fetch to a timeout message', async () => {
		stubFetch(async () => {
			const e = new Error('aborted');
			e.name = 'AbortError';
			throw e;
		});
		await expect(latestRelease('ua')).rejects.toThrow(/timed out after 30s/);
	});

	it('returns the parsed release on success', async () => {
		stubFetch(async () => new Response(JSON.stringify({ tag_name: 'v9.9.9', assets: [] }), { status: 200 }));
		const r = await latestRelease('ua');
		expect(r.tag_name).toBe('v9.9.9');
	});
});

describe('downloadAsset', () => {
	it('requests octet-stream and returns the body as a Buffer', async () => {
		let sentAccept = '';
		stubFetch(async (_url, init) => {
			sentAccept = init.headers.accept ?? '';
			return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
		});
		const buf = await downloadAsset({ name: 'docref-linux-x64', url: 'https://api/x' }, 'ua');
		expect(sentAccept).toBe('application/octet-stream');
		expect([...buf]).toEqual([1, 2, 3]);
	});

	it('throws with the status on a non-ok response', async () => {
		stubFetch(async () => new Response('', { status: 403 }));
		await expect(downloadAsset({ name: 'x', url: 'u' }, 'ua')).rejects.toThrow(/download failed \(HTTP 403\)/);
	});
});
