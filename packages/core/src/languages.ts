// File-extension to grammar mapping for symbol resolution. Unsupported
// extensions fail closed at the call site; regions work in any language.
export type LanguageId =
	| 'typescript'
	| 'tsx'
	| 'javascript'
	| 'go'
	| 'python'
	| 'rust'
	| 'java'
	| 'c'
	| 'cpp'
	| 'csharp'
	| 'ruby'
	| 'php'
	| 'swift'
	| 'kotlin'
	| 'scala'
	| 'bash';

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
	pyi: { id: 'python', wasm: 'python' },
	rs: { id: 'rust', wasm: 'rust' },
	java: { id: 'java', wasm: 'java' },
	c: { id: 'c', wasm: 'c' },
	h: { id: 'c', wasm: 'c' },
	cpp: { id: 'cpp', wasm: 'cpp' },
	cc: { id: 'cpp', wasm: 'cpp' },
	cxx: { id: 'cpp', wasm: 'cpp' },
	hpp: { id: 'cpp', wasm: 'cpp' },
	hh: { id: 'cpp', wasm: 'cpp' },
	hxx: { id: 'cpp', wasm: 'cpp' },
	cs: { id: 'csharp', wasm: 'c_sharp' },
	rb: { id: 'ruby', wasm: 'ruby' },
	php: { id: 'php', wasm: 'php' },
	swift: { id: 'swift', wasm: 'swift' },
	kt: { id: 'kotlin', wasm: 'kotlin' },
	kts: { id: 'kotlin', wasm: 'kotlin' },
	scala: { id: 'scala', wasm: 'scala' },
	sc: { id: 'scala', wasm: 'scala' },
	sh: { id: 'bash', wasm: 'bash' },
	bash: { id: 'bash', wasm: 'bash' }
};

export function languageForFile(path: string): LanguageInfo | null {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return null;
	return BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}
