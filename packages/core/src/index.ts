export { DocrefError } from './errors';
export { dedent } from './dedent';
export { contentHash, shortHash, stripWhitespace, hashesMatch, SHORT_HASH_LEN } from './hash';
export { parseRef, isKebabName, KEBAB_NAME, type Ref, type Fragment } from './ref';
export { scanRegions, type Region, type RegionError } from './regions';
export {
	scanMarkdown,
	rewriteSnippets,
	approveClaims,
	splitShaSuffix,
	snippetFenceText,
	claimBlockText,
	type Reference,
	type Snippet,
	type Claim,
	type ScanError
} from './markdown';
export { listDeclarations, findSymbol, configureWasm, type Decl, type WasmConfig } from './symbols';
export { languageForFile, fenceLanguageForRef, type LanguageId, type LanguageInfo } from './languages';
export { workingTreeSource, resolveAnchor, type FileSource, type Anchor } from './resolve';
export { loadProject, writeLock, findRoot, GATE_LEVELS, type Project, type RepoConfig, type GateLevel } from './config';
export { ensureCommit, branchTip, gitRevSource } from './gitcache';
export {
	check,
	refresh,
	approve,
	update,
	addRepo,
	affected,
	ls,
	anchors,
	diff,
	remove,
	resolveReference,
	exitCode,
	exitCodeFor,
	EXIT,
	anchorFiles,
	suggest,
	type SuggestEntry,
	type ClaimDriftEntry,
	type UnusedAnchor,
	type AnchorEntry,
	type AnchorsResult,
	type State,
	type Report,
	type ReportEntry,
	type ReportError,
	type UpdateResult,
	type AddRepoResult,
	type AffectedEntry,
	type RefIndex
} from './ops';
