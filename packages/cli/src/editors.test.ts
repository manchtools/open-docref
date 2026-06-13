import { describe, it, expect } from 'vitest';
import {
	KNOWN_EDITORS,
	detectEditors,
	initialSelectorState,
	selectorStep,
	editorsFromFlag,
	pickVsix,
	type SelectorState,
	type KeyEvent
} from './editors';

// `docref install-extension` downloads the released .vsix and installs it into
// the VS Code-family editors the user picks. The IO (PATH probe, the prompt,
// the download, the per-editor install) is thin; the decisions are here and
// tested: which editors are detected, how a typed selection maps to them, how
// the --editor escape hatch is parsed, and which release asset is the .vsix.

describe('detectEditors', () => {
	it('returns only the known editors whose CLI is on PATH, in catalog order', () => {
		const present = new Set(['cursor', 'code']);
		const found = detectEditors((cli) => present.has(cli));
		expect(found.map((e) => e.cli)).toEqual(['code', 'cursor']); // catalog order, not probe order
	});

	it('returns nothing when no editor CLI resolves', () => {
		expect(detectEditors(() => false)).toEqual([]);
	});

	it('catalogs the VS Code family, not just VS Code itself', () => {
		const clis = KNOWN_EDITORS.map((e) => e.cli);
		// the whole point of the feature: cover the forks, addressed by their CLI
		for (const cli of ['code', 'code-insiders', 'codium', 'cursor', 'windsurf', 'positron']) {
			expect(clis).toContain(cli);
		}
	});
});

describe('selectorStep (arrow-key + space multi-select)', () => {
	const start = initialSelectorState(3);
	// narrow a 'continue' step to its state, or fail loudly
	const next = (s: SelectorState, key: KeyEvent): SelectorState => {
		const step = selectorStep(s, key);
		if (step.kind !== 'continue') throw new Error(`expected continue, got ${step.kind}`);
		return step.state;
	};

	it('starts with every editor checked, so a bare Enter installs into all', () => {
		expect(start).toEqual({ cursor: 0, checked: [true, true, true] });
	});

	it('moves the highlight with arrows / j / k and wraps both ends', () => {
		expect(next(start, { name: 'down' }).cursor).toBe(1);
		expect(next(start, { name: 'up' }).cursor).toBe(2); // wrap up to last
		expect(next({ cursor: 2, checked: [true, true, true] }, { name: 'down' }).cursor).toBe(0); // wrap down
		expect(next(start, { name: 'j' }).cursor).toBe(1);
		expect(next(start, { name: 'k' }).cursor).toBe(2);
	});

	it('space toggles only the row under the highlight', () => {
		expect(next({ cursor: 1, checked: [true, true, true] }, { name: 'space' }).checked).toEqual([
			true,
			false,
			true
		]);
	});

	it('"a" toggles all on or all off', () => {
		expect(next(start, { name: 'a' }).checked).toEqual([false, false, false]);
		expect(next({ cursor: 0, checked: [true, false, false] }, { name: 'a' }).checked).toEqual([
			true,
			true,
			true
		]);
	});

	it('Enter submits the checked indices in order', () => {
		expect(selectorStep({ cursor: 0, checked: [true, false, true] }, { name: 'return' })).toEqual({
			kind: 'submit',
			indices: [0, 2]
		});
	});

	it('Esc and Ctrl-C cancel (install nothing)', () => {
		expect(selectorStep(start, { name: 'escape' })).toEqual({ kind: 'cancel' });
		expect(selectorStep(start, { name: 'c', ctrl: true })).toEqual({ kind: 'cancel' });
	});

	it('ignores an unrelated key without changing state', () => {
		expect(selectorStep(start, { name: 'x' })).toEqual({ kind: 'continue', state: start });
	});
});

describe('editorsFromFlag (--editor escape hatch)', () => {
	it('maps known CLI names to their catalog entry', () => {
		expect(editorsFromFlag('code,cursor').map((e) => e.id)).toEqual(['vscode', 'cursor']);
	});

	it('accepts an unknown but well-formed CLI name (e.g. a fork like code-oss)', () => {
		const [e] = editorsFromFlag('code-oss');
		expect(e).toEqual({ id: 'code-oss', name: 'code-oss', cli: 'code-oss' });
	});

	it('de-dupes and rejects an unsafe CLI token (no shell metacharacters)', () => {
		expect(editorsFromFlag('code,code').map((e) => e.cli)).toEqual(['code']);
		expect(() => editorsFromFlag('code;rm -rf /')).toThrow();
		expect(() => editorsFromFlag('')).toThrow();
	});
});

describe('pickVsix', () => {
	it('finds the .vsix asset among the release assets', () => {
		const assets = [
			{ name: 'docref-linux-x64', url: 'u1' },
			{ name: 'open-docref-vscode-0.1.0.vsix', url: 'u2' }
		];
		expect(pickVsix(assets)).toEqual(assets[1]);
	});

	it('fails closed when the release carries no .vsix', () => {
		expect(() => pickVsix([{ name: 'docref-linux-x64', url: 'u1' }])).toThrow();
	});
});
