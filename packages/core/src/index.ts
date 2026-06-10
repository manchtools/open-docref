export { DocrefError } from './errors';
export { contentHash, shortHash, stripWhitespace, hashesMatch } from './hash';
export { parseRef, type Ref, type Fragment } from './ref';
export { scanRegions, extractRegion, type Region, type RegionError } from './regions';
export {
	scanMarkdown,
	rewriteFences,
	blessPins,
	type Carrier,
	type FenceCarrier,
	type PinCarrier,
	type ScanError
} from './markdown';
export { listDeclarations, findSymbol, configureWasm, type Decl, type WasmConfig } from './symbols';
export { languageForFile, type LanguageId, type LanguageInfo } from './languages';
export { workingTreeSource, resolveAnchor, type FileSource, type Anchor } from './resolve';
export { loadProject, writeLock, findRoot, type Project, type RepoConfig } from './config';
export { ensureCommit, branchTip, gitRevSource } from './gitcache';
export {
	check,
	refresh,
	bless,
	update,
	affected,
	ls,
	exitCode,
	type State,
	type Report,
	type ReportEntry,
	type ReportError,
	type UpdateResult,
	type AffectedEntry,
	type RefIndex
} from './ops';
