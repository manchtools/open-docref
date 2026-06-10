// File-extension to grammar mapping for symbol resolution. Unsupported
// extensions fail closed at the call site; regions work in any language.
export type LanguageId = 'typescript' | 'tsx' | 'javascript' | 'go' | 'python';

export type LanguageInfo = { id: LanguageId; wasm: string };

const BY_EXT: Record<string, LanguageInfo> = {
	ts: { id: 'typescript', wasm: 'typescript' },
	mts: { id: 'typescript', wasm: 'typescript' },
	cts: { id: 'typescript', wasm: 'typescript' },
	tsx: { id: 'tsx', wasm: 'tsx' },
	js: { id: 'javascript', wasm: 'javascript' },
	mjs: { id: 'javascript', wasm: 'javascript' },
	cjs: { id: 'javascript', wasm: 'javascript' },
	jsx: { id: 'javascript', wasm: 'javascript' },
	go: { id: 'go', wasm: 'go' },
	py: { id: 'python', wasm: 'python' },
	pyi: { id: 'python', wasm: 'python' }
};

export function languageForFile(path: string): LanguageInfo | null {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return null;
	return BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}
