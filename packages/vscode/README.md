# open-docref for VS Code

Keep documentation anchored to the code it describes, without leaving the
editor. This extension is ergonomics over the same core the
[`open-docref`](https://github.com/manchtools/open-docref) CLI uses, so the
editor and CI never disagree about what counts as stale.

## Install

Download the `.vsix` from the
[GitHub releases](https://github.com/manchtools/open-docref/releases) and
install it — run *Extensions: Install from VSIX…* from the command palette, or
`code --install-extension open-docref-vscode-<version>.vsix`. It is not on the
VS Code Marketplace by design.

## Features

- **Referenced-by CodeLens** above any anchored symbol or region — "Referenced
  by N docs". Editing anchored code is exactly when you still have the context
  to fix the docs, and the lens puts that debt in view.
- **Markdown diagnostics** — stale and broken references get squiggles with the
  state and both hashes.
- **Claim drift diffs** — *Show Claim Drift* opens a diff per stale claim
  (the approved content recovered from git history versus the current code), and
  the *Approve Claims* flow opens the same diffs before it asks you to confirm,
  so approval happens next to the evidence.
- **Create anchor** from a selection — inserts a region marker pair (comment
  leader auto-detected) or copies a symbol reference when the selection is
  exactly one declaration.
- **References, Anchors, and Staged sidebars** — triage drift, browse the
  reverse index, and stage references to insert with their hashes precomputed.
- **Status bar** — a repo-wide count of stale and broken references.

## Requirements

A repository using docref (a `docref.toml` at its root). Symbol resolution
ships built in (WebAssembly tree-sitter grammars for TypeScript, JavaScript,
Go, and Python); regions work in any language. Nothing else to install — the
extension is self-contained.

## Learn more

The format specification, CLI, CI patterns, and the AI-agent contract live in
the [project repository](https://github.com/manchtools/open-docref).

MIT licensed.
