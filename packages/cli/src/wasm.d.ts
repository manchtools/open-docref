// `import x from './foo.wasm' with { type: 'file' }` (bun --compile) yields the
// runtime path of the embedded file as a string.
declare module '*.wasm' {
	const path: string;
	export default path;
}
