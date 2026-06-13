---
title: VS Code extension
description: Ergonomics over the same core library the CLI uses: CodeLens, diagnostics, quick fixes, drift diffs, autocomplete, and a collection sidebar.
---

# VS Code extension

The extension is ergonomics over the same core library the CLI uses,
so the editor and CI can never disagree about what counts as stale.

- **Reverse-index CodeLens:** above any anchored symbol or region,
  "Referenced by N docs". Editing anchored code is the moment the
  author still has context; the lens puts the doc debt in view exactly
  then. Click peeks the referencing locations.
<!-- docref: begin src=packages/vscode/src/logic.ts#diagnosticsFromReport:21282af4,packages/vscode/src/logic.ts#quickFixesForState:247f87a2 -->
- **Markdown diagnostics:** stale and broken references get squiggles with the state and both hashes. A quick fix on the squiggle jumps to the referenced code, opens the approved-vs-current drift diff for that one claim, or approves it, so you can compare and contrast without leaving the diagnostic.
<!-- docref: end -->
<!-- docref: begin src=packages/core/src/ops.ts#diff:985e8e6b -->
- **Drift diffs:** *Show Claim Drift* opens one diff tab per stale claim (approved content recovered from git history versus current), and the *Approve Claims* flow opens the same diffs before its confirmation, so approval happens next to the evidence.
<!-- docref: end -->
<!-- docref: begin src=packages/vscode/src/logic.ts#commentLeaderFor:ade6eb1c,packages/vscode/src/logic.ts#markerLines:971e8e09,packages/vscode/src/logic.ts#suggestRegionName:95f5c855,packages/vscode/src/logic.ts#symbolFragmentForSelection:84eb75b9 -->
- **Create anchor:** select code, run "docref: create anchor". Inserts a marker pair (name prompted, comment leader auto-detected) or, when the selection is exactly a declaration, copies the symbol ref with no marker inserted.
<!-- docref: end -->
<!-- docref: begin src=packages/vscode/src/logic.ts#refCompletionContext:d0073c17,packages/vscode/src/extension.ts#pathCompletions:ac651d53,packages/vscode/src/extension.ts#fragmentCompletions:af157fbd,packages/vscode/src/logic.ts#claimScaffoldSnippet:45f23caf -->
- **Reference autocomplete:** typing a `docref=` or `src=` value in a markdown file completes the file path (within the project's `[anchors]` scope), then the symbol or `@region` inside it, and inserts the `:sha` already computed; nobody types a hash by hand. Multi-source claims complete the segment after each comma. Outside a reference value, the **claim-block scaffold** drops in the begin/end markers and parks the cursor on `src=`, where the same autocomplete takes over; a hand-written claim needs no markers typed by hand. Reach it via the *Docref: Insert Claim Block* command (palette or markdown right-click), or in the suggest list by typing the `docref` shorthand or pressing Ctrl+Space; markdown does not open suggestions on plain typing. When a referenced file has no anchorable symbols or markers, the list says so instead of sitting empty.
<!-- docref: end -->
- **Collection sidebar:** add the current selection to a chosen
  collection file as a claim with an empty note; reorder and
  annotate; "fold into document" moves blocks into a target markdown
  file. All of it is plain-text editing of the collection file, so the
  sidebar is optional, and agents or humans can edit the same file
  directly.
<!-- docref: begin src=packages/vscode/src/logic.ts#statusText:11321715 -->
- **Status bar:** repo-wide count of stale/broken references, updated on save of any anchored file (re-resolving only refs into the saved file keeps this instant).
<!-- docref: end -->
