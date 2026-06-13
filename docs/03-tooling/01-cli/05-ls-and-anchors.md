---
title: ls & anchors
description: Dump the reverse index of anchors and their references, and inventory region markers code-side to flag unused ones.
---

# ls & anchors

## `docref ls [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#ls:98076b18 -->

Dump the reverse index: every referenced anchor and everything referencing it. The extension's CodeLens and the agent's orientation pass both read this.

<!-- docref: end -->

## `docref anchors [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#anchors:8d9d6ba5 -->

The code-side inventory, the reverse of `ls`: scan the source tree for every declared region marker and list each with the references to it; an anchor with none is flagged **not used**. Marker errors (duplicate names, unmatched begin/end) surface here even in files nothing references, which `check` alone would never visit. Exit `2` on marker errors, `0` otherwise (an unused anchor is information, not a failure).

<!-- docref: end -->

Files are enumerated from the `[anchors]` include/exclude globs in
`docref.toml` (default: everything), intersected with
`git ls-files --cached --others --exclude-standard` when the project is
a git repository, so gitignored build outputs with marker copies never
appear. Binary files and files over 2 MB are skipped, and fenced code
in markdown is ignored so marker examples in docs are not anchors.
Symbols are deliberately not inventoried: every declaration is
implicitly an anchor, so "unused" carries no signal for them.
