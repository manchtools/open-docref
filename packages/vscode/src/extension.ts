// The vscode API layer: thin wiring over @open-docref/core and ./logic.
// Everything that decides or formats lives in logic.ts (unit-tested);
// this file only moves data between the core and the editor.
import * as vscode from 'vscode';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	configureWasm,
	findRoot,
	loadProject,
	parseRef,
	workingTreeSource,
	resolveAnchor,
	check,
	refresh,
	approve,
	ls,
	anchors,
	diff,
	remove,
	resolveReference,
	snippetFenceText,
	claimBlockText,
	listDeclarations,
	languageForFile,
	scanRegions,
	extractRegion,
	contentHash,
	type Project,
	type Report,
	type RefIndex,
	type AnchorsResult
} from '@open-docref/core';
import {
	commentLeaderFor,
	markerLines,
	suggestRegionName,
	isValidRegionName,
	normalizeSelectionLines,
	symbolFragmentForSelection,
	diagnosticsFromReport,
	buildReferencesTree,
	buildAnchorsTree,
	buildStageTree,
	isRelevantChange,
	statusText,
	refCompletionContext,
	type Leader,
	type SidebarNode
} from './logic';

const COMPLETION_NOISE = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'dist',
	'build',
	'out',
	'coverage',
	'target'
]);

/** File/directory items for the path phase of a docref reference. */
function pathCompletions(root: string, partial: string, range: vscode.Range): vscode.CompletionItem[] {
	const slash = partial.lastIndexOf('/');
	const dir = slash === -1 ? '' : partial.slice(0, slash + 1);
	const base = (slash === -1 ? partial : partial.slice(slash + 1)).toLowerCase();
	let entries;
	try {
		entries = readdirSync(join(root, dir), { withFileTypes: true });
	} catch {
		return [];
	}
	const items: vscode.CompletionItem[] = [];
	for (const e of entries) {
		if (e.name.startsWith('.') || COMPLETION_NOISE.has(e.name)) continue;
		if (!e.name.toLowerCase().startsWith(base)) continue;
		if (e.isDirectory()) {
			const item = new vscode.CompletionItem(e.name + '/', vscode.CompletionItemKind.Folder);
			item.insertText = e.name + '/';
			item.range = range;
			// drill into the next level immediately
			item.command = { command: 'editor.action.triggerSuggest', title: '' };
			items.push(item);
		} else if (e.isFile()) {
			const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.File);
			item.insertText = e.name; // then type `#` (a trigger) for a fragment
			item.range = range;
			items.push(item);
		}
	}
	return items;
}

/**
 * Symbol and region items for the fragment phase, each with its `:sha` already
 * computed and attached to the insert text — the hash is never typed by hand.
 * Regions come from the marker scan; symbols from the (cached) tree-sitter
 * parse, skipped for languages without symbol support.
 */
async function fragmentCompletions(
	root: string,
	path: string,
	kind: 'any' | 'region',
	range: vscode.Range
): Promise<vscode.CompletionItem[]> {
	let text: string;
	try {
		text = readFileSync(join(root, path), 'utf8');
	} catch {
		return [];
	}
	const items: vscode.CompletionItem[] = [];

	for (const name of scanRegions(text).regions.keys()) {
		let sha: string;
		try {
			sha = contentHash(extractRegion(text, name)).slice(0, 8);
		} catch {
			continue;
		}
		const item = new vscode.CompletionItem('@' + name, vscode.CompletionItemKind.Reference);
		// `@` is part of the fragment: add it only when the user has not yet typed it
		item.insertText = `${kind === 'region' ? '' : '@'}${name}:${sha}`;
		item.detail = `region · ${sha}`;
		item.range = range;
		items.push(item);
	}

	if (kind === 'any' && languageForFile(path)) {
		try {
			for (const d of await listDeclarations(text, path)) {
				const name = d.path.join('.');
				const sha = contentHash(d.content).slice(0, 8);
				const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
				item.insertText = `${name}:${sha}`;
				item.detail = `symbol · ${sha}`;
				item.range = range;
				items.push(item);
			}
		} catch {
			// language not supported for symbols: regions still offered
		}
	}
	return items;
}

let report: Report | null = null;
let index: RefIndex | null = null;
let anchorIndex: AnchorsResult | null = null;

function workspaceRoot(): string | null {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function project(): Project | null {
	const ws = workspaceRoot();
	return ws ? loadProject(findRoot(ws)) : null;
}

function relPath(uri: vscode.Uri, root: string): string {
	return uri.fsPath.startsWith(root + '/') ? uri.fsPath.slice(root.length + 1) : uri.fsPath;
}

const STATE_ICONS: Record<string, vscode.ThemeIcon> = {
	'up-to-date': new vscode.ThemeIcon('check'),
	'stale-snippet': new vscode.ThemeIcon('warning'),
	'stale-claim': new vscode.ThemeIcon('warning'),
	broken: new vscode.ThemeIcon('error'),
	unknown: new vscode.ThemeIcon('question')
};

class SidebarTree implements vscode.TreeDataProvider<SidebarNode> {
	private emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;

	constructor(private roots: () => SidebarNode[]) {}

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(n: SidebarNode): vscode.TreeItem {
		const collapsible = !n.children?.length
			? vscode.TreeItemCollapsibleState.None
			: n.type === 'group' && n.mood === 'attention'
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed;
		const item = new vscode.TreeItem(n.label, collapsible);
		item.id = n.id;
		item.description = n.description;
		if (n.ref) item.contextValue = n.id.startsWith('stage:') ? 'staged' : 'hasRef';
		switch (n.type) {
			case 'group':
				item.iconPath = new vscode.ThemeIcon(n.mood === 'attention' ? 'alert' : 'list-tree');
				break;
			case 'issue':
				item.iconPath = new vscode.ThemeIcon(n.severity === 'error' ? 'error' : 'warning');
				item.command = { command: 'docref.openLocation', title: 'Open', arguments: [n.doc, n.line] };
				break;
			case 'file':
				item.iconPath = new vscode.ThemeIcon('file-code');
				item.command = { command: 'docref.openLocation', title: 'Open', arguments: [n.path, 1] };
				break;
			case 'ref':
				item.iconPath = STATE_ICONS[n.state ?? 'unknown'];
				item.command = { command: 'docref.openAnchor', title: 'Open code', arguments: [n.ref] };
				break;
			case 'location':
				item.iconPath = new vscode.ThemeIcon(n.kind === 'claim' ? 'note' : 'code');
				item.command = { command: 'docref.openLocation', title: 'Open', arguments: [n.doc, n.line] };
				break;
		}
		return item;
	}

	getChildren(n?: SidebarNode): SidebarNode[] {
		return n ? (n.children ?? []) : this.roots();
	}
}

export function activate(context: vscode.ExtensionContext): void {
	// inside the bundle nothing can resolve through node_modules; the
	// build copies the wasm files into dist/wasm and we point core there
	configureWasm({
		runtimeWasm: join(context.extensionPath, 'dist', 'wasm', 'tree-sitter.wasm'),
		grammarsDir: join(context.extensionPath, 'dist', 'wasm')
	});

	// virtual documents backing the approved-vs-current drift diffs
	const driftDocs = new Map<string, string>();
	let driftSeq = 0;
	const driftProvider: vscode.TextDocumentContentProvider = {
		provideTextDocumentContent: (uri) => driftDocs.get(uri.path) ?? ''
	};

	/**
	 * Open one diff tab per stale claim whose approved content is
	 * recoverable from git history. Returns how many opened.
	 */
	async function openDrift(rel?: string): Promise<{ opened: number; total: number }> {
		const p = project();
		if (!p) return { opened: 0, total: 0 };
		const { entries } = await diff(p, rel ? [rel] : undefined);
		let opened = 0;
		for (const e of entries) {
			if (e.approvedContent === undefined || e.currentContent === undefined) continue;
			const ext = e.ref.split('#')[0]!.split('.').pop() ?? 'txt';
			const token = driftSeq++;
			const left = vscode.Uri.parse(`docref-drift:/${token}/approved.${ext}`);
			const right = vscode.Uri.parse(`docref-drift:/${token}/current.${ext}`);
			driftDocs.set(left.path, e.approvedContent);
			driftDocs.set(right.path, e.currentContent);
			await vscode.commands.executeCommand(
				'vscode.diff',
				left,
				right,
				`${e.ref}  (approved ${e.pinned ?? '?'} -> ${e.current ?? '?'})`,
				{ preview: false }
			);
			opened++;
		}
		return { opened, total: entries.length };
	}

	const diagnostics = vscode.languages.createDiagnosticCollection('docref');
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	status.command = 'docrefRefs.focus';
	status.text = 'docref';
	status.show();
	const tree = new SidebarTree(() => (index ? buildReferencesTree(index, report) : []));
	const anchorTree = new SidebarTree(() => (anchorIndex ? buildAnchorsTree(anchorIndex) : []));

	// the staging area: refs collected (sha computed at stage time for
	// display, recomputed at insert time so pastes are always current)
	let staged: { ref: string; sha?: string }[] = context.workspaceState.get('docref.staged') ?? [];
	const stageTree = new SidebarTree(() => buildStageTree(staged));
	async function saveStage(): Promise<void> {
		await context.workspaceState.update('docref.staged', staged);
		stageTree.refresh();
	}

	async function resolveRefNow(refRaw: string): Promise<{ content: string; sha: string } | null> {
		const p = project();
		if (!p) return null;
		try {
			return await resolveReference(p, refRaw);
		} catch {
			return null;
		}
	}

	async function stageAdd(ref: string): Promise<void> {
		const resolved = await resolveRefNow(ref);
		staged = [
			...staged.filter((s) => s.ref !== ref),
			{ ref, ...(resolved ? { sha: resolved.sha } : {}) }
		];
		await saveStage();
		void vscode.window.showInformationMessage(`docref: staged ${ref}`);
	}

	async function insertReference(n: SidebarNode, kind: 'claim' | 'snippet'): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !n.ref) {
			void vscode.window.showWarningMessage('docref: open the target document and place the cursor first.');
			return;
		}
		const resolved = await resolveRefNow(n.ref);
		if (!resolved) {
			void vscode.window.showWarningMessage(`docref: ${n.ref} does not resolve right now.`);
			return;
		}
		const lang = n.ref.split('#')[0]!.split('/').pop()!.split('.').pop() ?? '';
		const text =
			kind === 'claim'
				? claimBlockText([{ ref: n.ref, sha: resolved.sha }])
				: snippetFenceText(n.ref, resolved.sha, lang, resolved.content);
		const at = editor.selection.active;
		await editor.edit((e) => e.insert(at, (at.character > 0 ? '\n' : '') + text));
		rescanSoon();
	}

	let pending: NodeJS.Timeout | undefined;
	async function rescan(): Promise<void> {
		const p = project();
		if (!p) return;
		try {
			report = await check(p);
			index = await ls(p);
			anchorIndex = await anchors(p);
		} catch (e) {
			void vscode.window.showErrorMessage(`docref: ${(e as Error).message}`);
			return;
		}
		diagnostics.clear();
		for (const [doc, list] of diagnosticsFromReport(report)) {
			diagnostics.set(
				vscode.Uri.file(`${p.root}/${doc}`),
				list.map((d) => {
					const diag = new vscode.Diagnostic(
						new vscode.Range(d.line - 1, 0, d.line - 1, 1000),
						d.message,
						d.severity === 'error'
							? vscode.DiagnosticSeverity.Error
							: vscode.DiagnosticSeverity.Warning
					);
					diag.source = 'docref';
					diag.code = d.code;
					return diag;
				})
			);
		}
		status.text = statusText(report);
		tree.refresh();
		anchorTree.refresh();
	}
	function rescanSoon(): void {
		clearTimeout(pending);
		pending = setTimeout(() => void rescan(), 400);
	}

	// background watching, like the git extension: changes from the CLI,
	// branch switches, or any external edit update the views unprompted
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	function onFsEvent(uri: vscode.Uri): void {
		const root = workspaceRoot();
		if (!root || !uri.fsPath.startsWith(root + '/')) return;
		const rel = relPath(uri, root).split('\\').join('/');
		const refPaths = new Set(
			(index?.refs ?? [])
				.map((r) => r.ref)
				.filter((ref) => !ref.includes(':'))
				.map((ref) => ref.split('#')[0]!)
		);
		const anchorFiles = new Set((anchorIndex?.anchors ?? []).map((a) => a.file));
		if (isRelevantChange(rel, refPaths, anchorFiles)) rescanSoon();
	}

	async function refFromSelection(): Promise<string | null> {
		const editor = vscode.window.activeTextEditor;
		const root = workspaceRoot();
		if (!editor || !root || editor.selection.isEmpty) {
			void vscode.window.showWarningMessage('docref: select the code to anchor first.');
			return null;
		}
		const doc = editor.document;
		const rel = relPath(doc.uri, root).split('\\').join('/');
		const [startLine, endLine] = normalizeSelectionLines(
			editor.selection.start.line + 1,
			editor.selection.end.line + 1,
			editor.selection.end.character
		);

		// exactly-one-declaration selections become symbol refs, no markers
		if (languageForFile(rel)) {
			try {
				const decls = await listDeclarations(doc.getText(), rel);
				const fragment = symbolFragmentForSelection(decls, startLine, endLine);
				if (fragment) return `${rel}#${fragment}`;
			} catch {
				// fall through to region markers
			}
		}

		let leader: Leader | null = commentLeaderFor(doc.languageId);
		if (!leader) {
			const picked = await vscode.window.showQuickPick(['//', '#', '--', '<!-- -->', '/* */'], {
				title: `docref: comment style for ${doc.languageId}`
			});
			if (!picked) return null;
			leader =
				picked === '<!-- -->'
					? { kind: 'block', open: '<!--', close: '-->' }
					: picked === '/* */'
						? { kind: 'block', open: '/*', close: '*/' }
						: { kind: 'line', open: picked };
		}

		const taken = new Set(scanRegions(doc.getText()).regions.keys());
		const name = await vscode.window.showInputBox({
			title: 'docref: region name',
			value: suggestRegionName(doc.getText(editor.selection), taken),
			validateInput: (v) =>
				!isValidRegionName(v)
					? 'kebab-case: lowercase letters, digits, hyphens'
					: taken.has(v)
						? `"${v}" already exists in this file`
						: null
		});
		if (!name) return null;

		const indent = /^[\t ]*/.exec(doc.lineAt(startLine - 1).text)![0];
		const m = markerLines(name, leader, indent);
		await editor.edit((edit) => {
			edit.insert(new vscode.Position(startLine - 1, 0), m.begin + '\n');
			edit.insert(new vscode.Position(endLine, 0), m.end + '\n');
		});
		rescanSoon();
		return `${rel}#@${name}`;
	}

	/** Offer the freshly anchored ref: stage it, or copy paste-ready text. */
	async function offerRef(ref: string): Promise<void> {
		const resolved = await resolveRefNow(ref);
		const pinned = resolved ? `${ref}:${resolved.sha}` : ref;
		await vscode.env.clipboard.writeText(pinned);
		const action = await vscode.window.showInformationMessage(
			`docref: ${pinned} copied`,
			'Stage',
			'Copy claim',
			'Copy snippet'
		);
		if (action === 'Stage') {
			await stageAdd(ref);
		} else if (action === 'Copy claim') {
			await vscode.env.clipboard.writeText(
				claimBlockText([{ ref, ...(resolved ? { sha: resolved.sha } : {}) }])
			);
		} else if (action === 'Copy snippet') {
			if (!resolved) {
				void vscode.window.showWarningMessage('docref: cannot materialize, the ref does not resolve.');
				return;
			}
			const lang = ref.split('#')[0]!.split('/').pop()!.split('.').pop() ?? '';
			await vscode.env.clipboard.writeText(
				snippetFenceText(ref, resolved.sha, lang, resolved.content)
			);
		}
	}

	async function createAnchor(): Promise<void> {
		const ref = await refFromSelection();
		if (ref) await offerRef(ref);
	}

	const lensProvider: vscode.CodeLensProvider = {
		async provideCodeLenses(doc) {
			const root = workspaceRoot();
			if (!root || !index) return [];
			const rel = relPath(doc.uri, root).split('\\').join('/');
			const mine = index.refs.filter((r) => r.ref.split('#')[0] === rel && !r.ref.includes(':'));
			if (mine.length === 0) return [];

			const lineFor = new Map<string, number>();
			const { regions } = scanRegions(doc.getText());
			for (const [name, region] of regions) lineFor.set(`@${name}`, region.beginLine);
			if (languageForFile(rel)) {
				try {
					for (const d of await listDeclarations(doc.getText(), rel)) {
						lineFor.set(d.path.join('.'), d.startLine);
					}
				} catch {
					// regions still get lenses
				}
			}

			const lenses: vscode.CodeLens[] = [];
			for (const r of mine) {
				const fragment = r.ref.split('#')[1];
				const line = fragment ? lineFor.get(fragment) : 1;
				if (line === undefined) continue;
				lenses.push(
					new vscode.CodeLens(new vscode.Range(line - 1, 0, line - 1, 0), {
						title: `docref: referenced by ${r.locations.length} location(s)`,
						command: 'docref.showLocations',
						arguments: [r.locations]
					})
				);
			}
			return lenses;
		}
	};

	// Autocomplete a docref reference as it is typed: file path, then the
	// symbol or @region inside it, with the :sha computed and attached inline.
	const completionProvider: vscode.CompletionItemProvider = {
		async provideCompletionItems(doc, position) {
			const root = workspaceRoot();
			if (!root) return;
			const ctx = refCompletionContext(doc.lineAt(position.line).text, position.character);
			if (!ctx || ctx.alias) return; // cross-repo file/symbol listing is not offered
			const word =
				ctx.phase === 'path' ? ctx.partial.slice(ctx.partial.lastIndexOf('/') + 1) : ctx.partial;
			const range = new vscode.Range(
				position.line,
				position.character - word.length,
				position.line,
				position.character
			);
			return ctx.phase === 'path'
				? pathCompletions(root, ctx.partial, range)
				: await fragmentCompletions(root, ctx.path, ctx.kind, range);
		}
	};

	context.subscriptions.push(
		diagnostics,
		status,
		vscode.window.registerTreeDataProvider('docrefRefs', tree),
		vscode.window.registerTreeDataProvider('docrefAnchors', anchorTree),
		vscode.window.registerTreeDataProvider('docrefStaged', stageTree),
		vscode.commands.registerCommand('docref.stageSelection', async () => {
			const ref = await refFromSelection();
			if (ref) await stageAdd(ref);
		}),
		vscode.commands.registerCommand('docref.stageRef', async (n: SidebarNode) => {
			if (n?.ref) await stageAdd(n.ref);
		}),
		vscode.commands.registerCommand('docref.unstage', async (n: SidebarNode) => {
			staged = staged.filter((s) => s.ref !== n.ref);
			await saveStage();
		}),
		vscode.commands.registerCommand('docref.clearStage', async () => {
			staged = [];
			await saveStage();
		}),
		vscode.commands.registerCommand('docref.insertClaim', (n: SidebarNode) =>
			insertReference(n, 'claim')
		),
		vscode.commands.registerCommand('docref.insertSnippet', (n: SidebarNode) =>
			insertReference(n, 'snippet')
		),
		vscode.commands.registerCommand('docref.removeEverywhere', async (n: SidebarNode) => {
			const p = project();
			if (!p || !n?.ref) return;
			const marker = n.ref.includes('#@') ? ' Its marker pair is deleted from the code.' : '';
			const confirmed = await vscode.window.showWarningMessage(
				`Delete ${n.ref} everywhere? Snippets are removed whole; claim comments are removed and the prose stays.${marker}`,
				{ modal: true },
				'Delete'
			);
			if (confirmed !== 'Delete') return;
			const result = await remove(p, n.ref);
			staged = staged.filter((s) => s.ref !== n.ref);
			await saveStage();
			void vscode.window.showInformationMessage(
				`docref: removed ${result.referencesRemoved} reference(s) in ${result.docsChanged.length} file(s)` +
					(result.markersRemoved ? ', marker deleted' : '')
			);
			await rescan();
		}),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lensProvider),
		vscode.languages.registerCompletionItemProvider(
			{ language: 'markdown' },
			completionProvider,
			'/',
			'#',
			'@',
			'=',
			',',
			':'
		),
		vscode.commands.registerCommand('docref.createAnchor', createAnchor),
		vscode.commands.registerCommand('docref.rescan', () => rescan()),
		vscode.commands.registerCommand('docref.refreshSnippets', async () => {
			const p = project();
			if (!p) return;
			const { changedDocs } = await refresh(p);
			void vscode.window.showInformationMessage(
				changedDocs.length
					? `docref: refreshed ${changedDocs.join(', ')}`
					: 'docref: nothing to refresh'
			);
			await rescan();
		}),
		vscode.workspace.registerTextDocumentContentProvider('docref-drift', driftProvider),
		vscode.commands.registerCommand('docref.showDrift', async () => {
			const editor = vscode.window.activeTextEditor;
			const root = workspaceRoot();
			const rel = editor && root ? relPath(editor.document.uri, root).split('\\').join('/') : undefined;
			const { opened, total } = await openDrift(rel?.endsWith('.md') ? rel : undefined);
			if (opened === 0) {
				void vscode.window.showInformationMessage(
					total === 0
						? 'docref: every claim is up to date.'
						: `docref: ${total} stale claim(s), but no approved state was found in git history.`
				);
			}
		}),
		vscode.commands.registerCommand('docref.approveClaims', async () => {
			const p = project();
			const editor = vscode.window.activeTextEditor;
			const root = workspaceRoot();
			if (!p || !editor || !root) return;
			const rel = relPath(editor.document.uri, root).split('\\').join('/');
			// show the evidence first: one diff tab per recoverable claim
			const { opened } = await openDrift(rel);
			const confirmed = await vscode.window.showWarningMessage(
				`Approve all claims in ${rel}? Only do this after reading the claimed prose against the current code.` +
					(opened > 0 ? ` ${opened} drift diff(s) are open in the editor.` : ''),
				{ modal: true },
				'Approve'
			);
			if (confirmed !== 'Approve') return;
			const result = await approve(p, [rel]);
			void vscode.window.showInformationMessage(
				`docref: approved ${result.approved} claim(s)` +
					(result.refused.length ? `, refused ${result.refused.length} broken` : '')
			);
			await rescan();
		}),
		vscode.commands.registerCommand('docref.openAnchor', async (refRaw: string) => {
			const root = workspaceRoot();
			if (!root) return;
			try {
				const ref = parseRef(refRaw);
				if (ref.alias) {
					void vscode.window.showInformationMessage(
						`docref: ${refRaw} lives in another repository (pinned via docref.lock); there is no local file to open.`
					);
					return;
				}
				const anchor = await resolveAnchor(workingTreeSource(root), ref);
				await vscode.commands.executeCommand(
					'docref.openLocation',
					ref.path,
					anchor.span?.startLine ?? 1
				);
			} catch (e) {
				void vscode.window.showWarningMessage(`docref: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('docref.openLocation', async (doc: string, line: number) => {
			const root = workspaceRoot();
			if (!root) return;
			const editor = await vscode.window.showTextDocument(vscode.Uri.file(`${root}/${doc}`));
			const pos = new vscode.Position(line - 1, 0);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
		}),
		vscode.commands.registerCommand(
			'docref.showLocations',
			async (locations: { doc: string; line: number; kind: string }[]) => {
				const picked = await vscode.window.showQuickPick(
					locations.map((l) => ({ label: `${l.doc}:${l.line}`, description: l.kind, l })),
					{ title: 'docref: referencing locations' }
				);
				if (picked) await vscode.commands.executeCommand('docref.openLocation', picked.l.doc, picked.l.line);
			}
		),
		vscode.workspace.onDidSaveTextDocument(() => rescanSoon()),
		watcher,
		watcher.onDidChange(onFsEvent),
		watcher.onDidCreate(onFsEvent),
		watcher.onDidDelete(onFsEvent)
	);

	void rescan();
}

export function deactivate(): void {}
