// Shared GitHub-release access for `self-update` and `install-extension`.
// Releases are the single distribution channel (no registry, no marketplace);
// the repo is public, and a token (GITHUB_TOKEN / DOCREF_GITHUB_TOKEN) is only
// needed for a private fork.
export const REPO = 'manchtools/open-docref';

export type ReleaseAsset = { name: string; url: string };
export type Release = { tag_name?: string; assets?: ReleaseAsset[] };

export function authHeaders(
	userAgent: string,
	accept = 'application/vnd.github+json'
): Record<string, string> {
	const token = process.env.DOCREF_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
	const h: Record<string, string> = { 'user-agent': userAgent, accept };
	if (token) h.authorization = `Bearer ${token}`;
	return h;
}

// Network calls get a hard timeout so a hung connection can't wedge the CLI.
const TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, { headers, signal: ac.signal });
	} finally {
		clearTimeout(timer);
	}
}

function netMessage(e: unknown): string {
	return (e as Error).name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (e as Error).message;
}

/** The latest (non-prerelease) release; throws with a user-facing message. */
export async function latestRelease(userAgent: string): Promise<Release> {
	let res: Response;
	try {
		res = await fetchWithTimeout(`https://api.github.com/repos/${REPO}/releases/latest`, authHeaders(userAgent));
	} catch (e) {
		throw new Error(`could not reach ${REPO} releases: ${netMessage(e)}`);
	}
	if (!res.ok) {
		const hint = res.status === 404 || res.status === 401 ? ' — private repo? set GITHUB_TOKEN' : '';
		throw new Error(`could not reach ${REPO} releases (HTTP ${res.status})${hint}`);
	}
	return (await res.json()) as Release;
}

/** An asset's bytes via its API url + octet-stream (works behind a token). */
export async function downloadAsset(asset: ReleaseAsset, userAgent: string): Promise<Buffer> {
	let res: Response;
	try {
		res = await fetchWithTimeout(asset.url, authHeaders(userAgent, 'application/octet-stream'));
	} catch (e) {
		throw new Error(`could not download ${asset.name}: ${netMessage(e)}`);
	}
	if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
	return Buffer.from(await res.arrayBuffer());
}
