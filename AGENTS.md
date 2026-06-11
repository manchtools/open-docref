# Agent instructions

This repository anchors its own documentation to its code with docref — it
dogfoods the tool it ships. After you change code, keep the docs honest in the
same change:

1. Find what your change endangers (compare against the merge-base with the
   branch you will merge into):

   ```sh
   node packages/cli/dist/docref.js affected --since <merge-base> --json
   ```

2. For each affected document:
   - **snippets** — run `docref refresh <doc>`. Mechanical and always safe; it
     rewrites the materialized body and its hash.
   - **claims** — read the prose. If your change made it untrue, fix the prose,
     then `docref approve <doc>`. Never approve a claim without reading it.

3. `docref check` must exit `0` before you are done.

## Anchors

Most references name a symbol directly (`file.ts#funcName`); every declaration
is implicitly anchorable, so no marker is needed. A slice that is *not* a whole
symbol — a few lines, a CSS block, a template — is named by a marker pair in the
code, and a doc points at it with `file#@name`:

```ts
// docref: begin <name>
//   ...the anchored lines...
// docref: end <name>
```

<!-- docref: begin src=packages/core/src/regions.ts#scanRegions:5fcc3f83 -->
Marker names are kebab-case and unique per file; an unmatched or duplicate
marker is an error.
<!-- docref: end -->

Two things this means when you work here:

<!-- docref: begin src=packages/core/src/ops.ts#findUnusedAnchors:9e39e6cb,packages/core/src/ops.ts#exitCode:926bfd35 -->
- `docref check` reports an **unused anchor** when a marker pair has no doc
  referencing it, and that fails the gate (exit 1) unless `[anchors]
  allow-unused = true` in `docref.toml`. Either reference the marker from a
  doc, or delete the pair — a stranded marker is dead intent.
<!-- docref: end -->
- When you add a reference to a sub-symbol slice, add the marker pair around
  those exact lines first, then point the doc at `file#@name`. `docref anchors`
  lists every marker and what references it.

## Building and the specs

Build the CLI first with `bun run build` (the bundle is at
`packages/cli/dist/docref.js`). The development loop and the test bar are in
[CONTRIBUTING.md](CONTRIBUTING.md); the format and tool are specified in
[docs/format.md](docs/format.md) and [docs/tooling.md](docs/tooling.md).
