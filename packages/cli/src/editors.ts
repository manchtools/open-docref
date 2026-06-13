// VS Code-family editors and the pure decisions behind `docref
// install-extension`. The extension is a plain .vsix, so any editor that
// accepts `<cli> --install-extension <file.vsix>` can install it from the
// GitHub release — Marketplace/Open VSX never enters into it. Detection is by
// CLI name on PATH; everything here is pure so the install flow's IO (PATH
// probe, prompt, download, spawn) stays a thin shell over tested logic.

export type Editor = { id: string; name: string; cli: string };

// The catalog. Order is the order editors are offered in the prompt. Every one
// of these supports `--install-extension`; the forks differ only by CLI name.
export const KNOWN_EDITORS: readonly Editor[] = [
	{ id: 'vscode', name: 'Visual Studio Code', cli: 'code' },
	{ id: 'vscode-insiders', name: 'Visual Studio Code – Insiders', cli: 'code-insiders' },
	{ id: 'vscodium', name: 'VSCodium', cli: 'codium' },
	{ id: 'cursor', name: 'Cursor', cli: 'cursor' },
	{ id: 'windsurf', name: 'Windsurf', cli: 'windsurf' },
	{ id: 'positron', name: 'Positron', cli: 'positron' }
];

// The published extension id (publisher.name from the vscode manifest). Used to
// detect whether an editor already has the extension, so `self-update` can
// refresh it in place rather than installing it somewhere it was never wanted.
export const EXTENSION_ID = 'manchtools.open-docref-vscode';

// A CLI name we are willing to spawn: lowercase, starts alphanumeric, then
// alphanumerics/hyphens. Excludes spaces, slashes, and shell metacharacters,
// so an --editor value can never smuggle a second command.
const SAFE_CLI = /^[a-z0-9][a-z0-9-]*$/;

/** Known editors whose CLI resolves on PATH, in catalog order. */
export function detectEditors(onPath: (cli: string) => boolean): Editor[] {
	return KNOWN_EDITORS.filter((e) => onPath(e.cli));
}

// Interactive multi-select model (arrow keys + space), kept pure so the TUI in
// installext.ts is a thin render/IO loop over tested state transitions.
export type SelectorState = { cursor: number; checked: boolean[] };
export type KeyEvent = { name?: string; ctrl?: boolean };
export type SelectorStep =
	| { kind: 'continue'; state: SelectorState }
	| { kind: 'submit'; indices: number[] }
	| { kind: 'cancel' };

/** Start with every editor checked, so a bare Enter installs into all of them. */
export function initialSelectorState(count: number): SelectorState {
	return { cursor: 0, checked: Array.from({ length: count }, () => true) };
}

/**
 * Advance the selector for one keypress. up/down (or k/j) move the highlight
 * and wrap; space toggles the row under it; "a" toggles all; Enter submits the
 * checked indices; Esc or Ctrl-C cancels. Any other key is a no-op. Pure — the
 * TUI just renders the returned state and acts on submit/cancel.
 */
export function selectorStep(state: SelectorState, key: KeyEvent): SelectorStep {
	const n = state.checked.length;
	if (key.ctrl && key.name === 'c') return { kind: 'cancel' };
	switch (key.name) {
		case 'escape':
			return { kind: 'cancel' };
		case 'return':
		case 'enter':
			return { kind: 'submit', indices: state.checked.flatMap((c, i) => (c ? [i] : [])) };
		case 'up':
		case 'k':
			return { kind: 'continue', state: { ...state, cursor: n ? (state.cursor - 1 + n) % n : 0 } };
		case 'down':
		case 'j':
			return { kind: 'continue', state: { ...state, cursor: n ? (state.cursor + 1) % n : 0 } };
		case 'space': {
			const checked = [...state.checked];
			checked[state.cursor] = !checked[state.cursor];
			return { kind: 'continue', state: { ...state, checked } };
		}
		case 'a': {
			const allOn = state.checked.every(Boolean);
			return { kind: 'continue', state: { ...state, checked: state.checked.map(() => !allOn) } };
		}
		default:
			return { kind: 'continue', state };
	}
}

/**
 * Parse a `--editor a,b` value into editors: a known CLI maps to its catalog
 * entry; an unknown but well-formed name is taken as a custom fork CLI. Throws
 * on an empty list or an unsafe token.
 */
export function editorsFromFlag(list: string): Editor[] {
	const byCli = new Map(KNOWN_EDITORS.map((e) => [e.cli, e]));
	const out: Editor[] = [];
	const seen = new Set<string>();
	for (const raw of list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
		if (!SAFE_CLI.test(raw)) throw new Error(`unsafe editor name: "${raw}"`);
		if (seen.has(raw)) continue;
		seen.add(raw);
		out.push(byCli.get(raw) ?? { id: raw, name: raw, cli: raw });
	}
	if (out.length === 0) throw new Error('no editors given to --editor');
	return out;
}

/** The .vsix asset among a release's assets; throws if the release has none. */
export function pickVsix<T extends { name: string }>(assets: readonly T[]): T {
	const vsix = assets.find((a) => a.name.toLowerCase().endsWith('.vsix'));
	if (!vsix) throw new Error('this release has no .vsix asset to install');
	return vsix;
}
