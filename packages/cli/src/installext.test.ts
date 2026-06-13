import { describe, it, expect } from 'vitest';
import { installExtension } from './installext';

// install-extension's IO is injected so the selection -> install flow is tested
// without a network or a real editor: which editors get the .vsix, and that the
// abort/refusal paths never download or install.

const editors = [
	{ id: 'vscode', name: 'VS Code', cli: 'code' },
	{ id: 'cursor', name: 'Cursor', cli: 'cursor' }
];
const fakeVsix = async () => ({ tag: 'v0.2.0', name: 'open-docref-vscode-0.2.0.vsix', bytes: Buffer.from('PK') });

describe('installExtension', () => {
	it('--all installs into every detected editor without prompting', async () => {
		const calls: string[] = [];
		const r = await installExtension(
			{ all: true },
			{
				detect: () => editors,
				install: (cli) => calls.push(cli),
				fetchVsix: fakeVsix,
				isTTY: false,
				prompt: async () => {
					throw new Error('must not prompt when --all is given');
				}
			}
		);
		expect(calls).toEqual(['code', 'cursor']);
		expect(r.code).toBe(0);
		expect(r.out).toContain('installed');
	});

	it('prompts on a TTY and installs only the chosen editors', async () => {
		const calls: string[] = [];
		const r = await installExtension(
			{},
			{
				detect: () => editors,
				isTTY: true,
				prompt: async (offered) => [offered[1]!], // user picks Cursor only
				install: (cli) => calls.push(cli),
				fetchVsix: fakeVsix
			}
		);
		expect(calls).toEqual(['cursor']);
		expect(r.code).toBe(0);
	});

	it('--editor installs an explicit set, including a fork that is not detected', async () => {
		const calls: string[] = [];
		await installExtension(
			{ editorList: 'code-oss' },
			{ detect: () => [], install: (cli) => calls.push(cli), fetchVsix: fakeVsix }
		);
		expect(calls).toEqual(['code-oss']);
	});

	it('refuses non-interactively when neither --all nor --editor is given (no download/install)', async () => {
		let touched = false;
		const r = await installExtension(
			{},
			{
				detect: () => editors,
				isTTY: false,
				fetchVsix: async () => {
					touched = true;
					return fakeVsix();
				},
				install: () => {
					touched = true;
				}
			}
		);
		expect(r.code).toBe(2);
		expect(r.out).toContain('--all');
		expect(touched).toBe(false);
	});

	it('guides the user when no editor CLI is on PATH', async () => {
		const r = await installExtension({}, { detect: () => [], isTTY: true, fetchVsix: fakeVsix });
		expect(r.code).toBe(2);
		expect(r.out).toContain('PATH');
	});

	it('selecting none installs nothing, exits 0, and never downloads', async () => {
		let fetched = false;
		const r = await installExtension(
			{},
			{
				detect: () => editors,
				isTTY: true,
				prompt: async () => [],
				fetchVsix: async () => {
					fetched = true;
					return fakeVsix();
				}
			}
		);
		expect(r.code).toBe(0);
		expect(fetched).toBe(false);
	});

	it('onlyInstalled refreshes just the editors that already have the extension (no prompt)', async () => {
		const calls: string[] = [];
		const r = await installExtension(
			{ onlyInstalled: true },
			{
				detect: () => editors, // both on PATH
				hasExtension: (cli) => cli === 'cursor', // only Cursor has it installed
				install: (cli) => calls.push(cli),
				fetchVsix: fakeVsix,
				prompt: async () => {
					throw new Error('must not prompt when refreshing in place');
				}
			}
		);
		expect(calls).toEqual(['cursor']); // VS Code is left untouched
		expect(r.code).toBe(0);
	});

	it('onlyInstalled is a no-op (exit 0, no download) when no editor has the extension', async () => {
		let fetched = false;
		const r = await installExtension(
			{ onlyInstalled: true },
			{
				detect: () => editors,
				hasExtension: () => false,
				fetchVsix: async () => {
					fetched = true;
					return fakeVsix();
				}
			}
		);
		expect(r.code).toBe(0);
		expect(fetched).toBe(false);
	});

	it('reports a per-editor failure (exit 2) while still installing the others', async () => {
		const calls: string[] = [];
		const r = await installExtension(
			{ all: true },
			{
				detect: () => editors,
				install: (cli) => {
					if (cli === 'code') throw new Error('code: command not found\nstack');
					calls.push(cli);
				},
				fetchVsix: fakeVsix
			}
		);
		expect(calls).toEqual(['cursor']);
		expect(r.code).toBe(2);
		expect(r.out).toContain('failed code');
		expect(r.out).toContain('installed'); // cursor still succeeded
		expect(r.out).not.toContain('stack'); // only the first line of the error
	});
});
