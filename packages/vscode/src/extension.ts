// The vscode API layer: thin wiring over @open-docref/core and ./logic.
// Everything that decides or formats lives in logic.ts (unit-tested);
// this file only moves data between the core and the editor.
import * as vscode from 'vscode';
import {
	findRoot,
	loadProject,
	check,
	refresh,
	bless,
	ls,
	listDeclarations,
	languageForFile,
	scanRegions,
	type Project,
	type Report,
	type RefIndex
} from '@open-docref/core';
import {
	commentLeaderFor,
	markerLines,
	suggestRegionName,
	isValidRegionName,
	normalizeSelectionLines,
	symbolFragmentForSelection,
	diagnosticsFromReport,
	buildRefTree,
	statusText,
	type Leader,
	type RefNode
} from './logic';

let report: Report | null = null;
let index: RefIndex | null = null;

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
	fresh: new vscode.ThemeIcon('check'),
	'stale-snippet': new vscode.ThemeIcon('warning'),
	'stale-claim': new vscode.ThemeIcon('warning'),
	broken: new vscode.ThemeIcon('error'),
	unknown: new vscode.ThemeIcon('question')
};

class RefTree implements vscode.TreeDataProvider<RefNode | RefNode['locations'][number]> {
	private emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(el: RefNode | RefNode['locations'][number]): vscode.TreeItem {
		if ('ref' in el) {
			const item = new vscode.TreeItem(el.ref, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = STATE_ICONS[el.state];
			item.description = el.state;
			return item;
		}
		const item = new vscode.TreeItem(`${el.doc}:${el.line}`, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(el.carrier === 'pin' ? 'note' : 'code');
		item.description = `${el.carrier}${el.state === 'unknown' ? '' : ` (${el.state})`}`;
		item.command = {
			command: 'docref.openLocation',
			title: 'Open',
			arguments: [el.doc, el.line]
		};
		return item;
	}

	getChildren(
		el?: RefNode | RefNode['locations'][number]
	): (RefNode | RefNode['locations'][number])[] {
		if (!el) return index ? buildRefTree(index, report) : [];
		return 'ref' in el ? el.locations : [];
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection('docref');
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	status.command = 'docrefRefs.focus';
	status.text = 'docref';
	status.show();
	const tree = new RefTree();

	let pending: NodeJS.Timeout | undefined;
	async function rescan(): Promise<void> {
		const p = project();
		if (!p) return;
		try {
			report = await check(p);
			index = await ls(p);
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
	}
	function rescanSoon(): void {
		clearTimeout(pending);
		pending = setTimeout(() => void rescan(), 400);
	}

	async function createAnchor(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const root = workspaceRoot();
		if (!editor || !root || editor.selection.isEmpty) {
			void vscode.window.showWarningMessage('docref: select the code to anchor first.');
			return;
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
				if (fragment) {
					await offerRef(`${rel}#${fragment}`, doc.languageId);
					return;
				}
			} catch {
				// fall through to region markers
			}
		}

		let leader: Leader | null = commentLeaderFor(doc.languageId);
		if (!leader) {
			const picked = await vscode.window.showQuickPick(['//', '#', '--', '<!-- -->', '/* */'], {
				title: `docref: comment style for ${doc.languageId}`
			});
			if (!picked) return;
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
		if (!name) return;

		const indent = /^[\t ]*/.exec(doc.lineAt(startLine - 1).text)![0];
		const m = markerLines(name, leader, indent);
		await editor.edit((edit) => {
			edit.insert(new vscode.Position(startLine - 1, 0), m.begin + '\n');
			edit.insert(new vscode.Position(endLine, 0), m.end + '\n');
		});
		await offerRef(`${rel}#@${name}`, doc.languageId);
		rescanSoon();
	}

	async function offerRef(ref: string, languageId: string): Promise<void> {
		await vscode.env.clipboard.writeText(ref);
		const lang = languageId === 'typescriptreact' ? 'tsx' : languageId;
		const action = await vscode.window.showInformationMessage(
			`docref: ${ref} copied`,
			'Copy fence',
			'Copy pin block'
		);
		if (action === 'Copy fence') {
			await vscode.env.clipboard.writeText('```' + lang + ` docref=${ref}\n` + '```');
		} else if (action === 'Copy pin block') {
			await vscode.env.clipboard.writeText(
				`<!-- docref: begin src=${ref} -->\n\n<!-- docref: end -->`
			);
		}
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

	context.subscriptions.push(
		diagnostics,
		status,
		vscode.window.registerTreeDataProvider('docrefRefs', tree),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lensProvider),
		vscode.commands.registerCommand('docref.createAnchor', createAnchor),
		vscode.commands.registerCommand('docref.rescan', () => rescan()),
		vscode.commands.registerCommand('docref.refreshFences', async () => {
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
		vscode.commands.registerCommand('docref.blessDocument', async () => {
			const p = project();
			const editor = vscode.window.activeTextEditor;
			const root = workspaceRoot();
			if (!p || !editor || !root) return;
			const rel = relPath(editor.document.uri, root).split('\\').join('/');
			const confirmed = await vscode.window.showWarningMessage(
				`Bless all pins in ${rel}? Only do this after reading the pinned prose against the current code.`,
				{ modal: true },
				'Bless'
			);
			if (confirmed !== 'Bless') return;
			const result = await bless(p, [rel]);
			void vscode.window.showInformationMessage(
				`docref: blessed ${result.blessed} pin(s)` +
					(result.refused.length ? `, refused ${result.refused.length} broken` : '')
			);
			await rescan();
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
			async (locations: { doc: string; line: number; carrier: string }[]) => {
				const picked = await vscode.window.showQuickPick(
					locations.map((l) => ({ label: `${l.doc}:${l.line}`, description: l.carrier, l })),
					{ title: 'docref: referencing locations' }
				);
				if (picked) await vscode.commands.executeCommand('docref.openLocation', picked.l.doc, picked.l.line);
			}
		),
		vscode.workspace.onDidSaveTextDocument(() => rescanSoon())
	);

	void rescan();
}

export function deactivate(): void {}
