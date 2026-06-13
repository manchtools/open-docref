// The standalone binary's command dispatch and the shared print/exit tail,
// factored out of standalone.ts so they are unit-testable: standalone.ts itself
// cannot be imported under vitest/node because of its bun `with { type: 'file' }`
// wasm imports. Keeping the self-update routing and --skip-extension parsing
// here means run()-based tests can prove that wiring without the compiled binary.
export type CliResult = { code: number; out: string };

export async function dispatchStandalone(
	argv: string[],
	deps: {
		run: (argv: string[], cwd: string) => Promise<CliResult>;
		selfUpdate: (version: string, opts: { skipExtension: boolean }) => Promise<CliResult>;
		version: string;
		cwd: string;
	}
): Promise<CliResult> {
	if (argv[0] === 'self-update') {
		return deps.selfUpdate(deps.version, { skipExtension: argv.includes('--skip-extension') });
	}
	return deps.run(argv, deps.cwd);
}

/** The shared CLI tail: print non-empty output, then exit with the code. */
export function emit(result: CliResult): never {
	if (result.out) console.log(result.out);
	process.exit(result.code);
}
