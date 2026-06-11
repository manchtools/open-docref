// CI performance gate. "Fast" is a contract of this tool, so a large project
// must check and refresh well under one second. This measures the SHIPPED
// artifact — the compiled single-file binary (`bun run build:bin`) — because
// that is what users run; the node bundle's slower wasm init is not the
// product. The algorithmic guard (parse-once-per-file) lives in
// packages/core/src/perf.test.ts; this is the end-to-end wall-clock gate.
//
// Ceiling overridable with DOCREF_BENCH_CEILING_MS (default 1000).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const CEILING_MS = Number(process.env.DOCREF_BENCH_CEILING_MS ?? 1000);
const N_SRC = 120; // source files
const FNS = 40; // functions per file
const N_DOC = 200; // markdown docs
const RPD = 24; // references per doc  => ~4800 references

const exe =
	process.platform === 'win32'
		? '../packages/cli/dist/docref.exe'
		: '../packages/cli/dist/docref';
const bin = fileURLToPath(new URL(exe, import.meta.url));
if (!existsSync(bin)) {
	console.error(`bench: binary not found at ${bin} — run \`bun run build:bin\` first.`);
	process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), 'docref-bench-'));
try {
	mkdirSync(join(root, 'src'));
	mkdirSync(join(root, 'docs'));
	writeFileSync(
		join(root, 'docref.toml'),
		'[scan]\ninclude = ["docs/**/*.md"]\n[anchors]\nallow-unused = true\n'
	);
	for (let f = 0; f < N_SRC; f++) {
		let c = '';
		for (let i = 0; i < FNS; i++) c += `export function fn${i}(a) { return a + ${i}; }\n`;
		writeFileSync(join(root, `src/mod${f}.ts`), c);
	}
	// deterministic pseudo-random; 30% of refs hit "hot" files to stress reuse
	let s = 12345;
	const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	let refs = 0;
	for (let d = 0; d < N_DOC; d++) {
		let md = `# ${d}\n\n`;
		for (let k = 0; k < RPD; k++) {
			const f = rnd() < 0.3 ? Math.floor(rnd() * 8) : Math.floor(rnd() * N_SRC);
			md += `\`\`\`ts docref=src/mod${f}.ts#fn${Math.floor(rnd() * FNS)}\n\`\`\`\n\n`;
			refs++;
		}
		writeFileSync(join(root, `docs/d${d}.md`), md);
	}

	const time = (args) => {
		const t = performance.now();
		try {
			execFileSync(bin, args, { cwd: root, stdio: 'ignore' });
		} catch {
			// `check` exits 1 when references are stale; we only care about wall time
		}
		return performance.now() - t;
	};

	// refresh materializes the snippets (cold); then check is steady-state.
	const refresh = time(['refresh']);
	const checks = [time(['check']), time(['check']), time(['check'])];
	const check = Math.min(...checks); // best of three: tolerate a noisy sample

	const fmt = (n) => `${n.toFixed(0)} ms`;
	console.log(
		`bench: ${refs} references across ${N_SRC} files | ` +
			`refresh ${fmt(refresh)} | check ${fmt(check)} (runs: ${checks.map((c) => c.toFixed(0)).join('/')}) | ` +
			`ceiling ${CEILING_MS} ms`
	);

	const over = [
		['refresh', refresh],
		['check', check]
	].filter(([, ms]) => ms > CEILING_MS);
	if (over.length) {
		for (const [name, ms] of over) {
			console.error(`PERFORMANCE REGRESSION: ${name} took ${fmt(ms)}, over the ${CEILING_MS} ms ceiling`);
		}
		process.exit(1);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
