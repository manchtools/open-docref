---
title: Implementation plan & roadmap
description: The end-to-end TypeScript implementation, its package layout, and the milestone roadmap.
---

# Implementation plan & roadmap

## Implementation plan

**Language: TypeScript end-to-end.** The VSCode extension host is
Node, so the extension is TypeScript regardless; making the core a
library that both the CLI and the extension import removes the process
boundary and the risk of two resolvers disagreeing.

- **Symbol resolution: web-tree-sitter** (WASM grammars shipped in the
  package). No native compilation at install time, works identically
  on a bare cached checkout with zero project setup, which is exactly
  what cross-repo resolution needs. Per-language support is a grammar
  file plus a query file mapping declaration kinds to names.
- **Git: shell out to the system `git`.** Shallow clone and fetch by
  rev into the cache. The user's existing credentials cover private
  repositories.
- **Distribution: standalone binaries.** `bun build --compile` produces one
  self-contained executable per platform with the tree-sitter wasm embedded —
  no Node, no registry. They are attached to GitHub releases and installed via
  `install.sh` or `docref self-update`. In CI the install is one step before
  `docref check`.
- **Layout:** one repository, workspaces:

```
packages/
  core/      scanner, ref parser, resolvers, hasher, states, git cache
  cli/       bin: thin command layer over core, JSON output
  vscode/    extension: CodeLens, diagnostics, quick fixes, sidebar
```

## Milestones

1. **Core, same-repo:** ref parsing, region markers, tree-sitter symbol
   resolution (TS/JS, Go, Python first), hashing, fence carrier,
   `check` and `refresh`. The format is proven here.
2. **Pins:** pin-block carrier, `bless`, the full four-state model.
3. **Cross-repo:** `docref.toml`/`docref.lock`, shallow-clone cache,
   `update` and `update --check`.
4. **Change mapping:** `affected --since`, `ls`, JSON everywhere; the
   agent contract becomes usable.
5. **VSCode extension:** CodeLens, diagnostics, quick fixes, create
   anchor, collection sidebar.
6. **Renderer integrations** (separate packages, after the above is
   stable): provenance captions and verified badges for site
   generators.

Each milestone lands with tests that assert the rejection paths
(broken refs, ambiguous symbols, tampered fences, nested pins), not
only the happy path.
