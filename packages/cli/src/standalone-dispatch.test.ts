import { describe, it, expect } from 'vitest';
import { dispatchStandalone, type CliResult } from './standalone-dispatch';

// The compiled binary intercepts `self-update` before run() and parses
// --skip-extension; every other command goes to run(). standalone.ts cannot be
// imported under vitest (its bun `with { type: 'file' }` wasm imports), so the
// routing is proven here against injected fakes.

function fakes() {
	const calls: Record<string, unknown>[] = [];
	const run = async (argv: string[], cwd: string): Promise<CliResult> => {
		calls.push({ fn: 'run', argv, cwd });
		return { code: 0, out: 'ran' };
	};
	const selfUpdate = async (
		version: string,
		opts: { skipExtension: boolean }
	): Promise<CliResult> => {
		calls.push({ fn: 'selfUpdate', version, opts });
		return { code: 7, out: 'updated' };
	};
	return { calls, run, selfUpdate };
}

describe('dispatchStandalone', () => {
	it('routes self-update to selfUpdate (not run), skipExtension false by default', async () => {
		const f = fakes();
		const res = await dispatchStandalone(['self-update'], {
			run: f.run,
			selfUpdate: f.selfUpdate,
			version: '1.2.3',
			cwd: '/x'
		});
		expect(res).toEqual({ code: 7, out: 'updated' });
		expect(f.calls).toEqual([{ fn: 'selfUpdate', version: '1.2.3', opts: { skipExtension: false } }]);
	});

	it('parses --skip-extension into skipExtension: true (binary-only update)', async () => {
		const f = fakes();
		await dispatchStandalone(['self-update', '--skip-extension'], {
			run: f.run,
			selfUpdate: f.selfUpdate,
			version: '1.2.3',
			cwd: '/x'
		});
		expect(f.calls[0]).toMatchObject({ fn: 'selfUpdate', opts: { skipExtension: true } });
	});

	it('routes every other command to run() with argv and cwd unchanged', async () => {
		const f = fakes();
		const res = await dispatchStandalone(['check', '--json'], {
			run: f.run,
			selfUpdate: f.selfUpdate,
			version: '1.2.3',
			cwd: '/proj'
		});
		expect(res).toEqual({ code: 0, out: 'ran' });
		expect(f.calls).toEqual([{ fn: 'run', argv: ['check', '--json'], cwd: '/proj' }]);
		// self-update was NOT called
		expect(f.calls.some((c) => c.fn === 'selfUpdate')).toBe(false);
	});
});
