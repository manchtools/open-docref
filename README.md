# open-docref

Keep documentation anchored to the code it describes.

docref is a plain-text convention plus a small tool. Markdown documents
reference code by symbol or by marked region, and every reference
carries a content hash of what the author last saw. When the code
changes, the reference goes stale loudly: in the editor, in CI, and in
a machine-readable report that an AI agent can act on. Divergence stops
being silent.

The convention is renderer-neutral. Documents using docref render
normally on GitHub, in the VSCode preview, and in any static site
generator; the metadata hides in fence info strings and HTML comments.
No tool needs to be installed to read or write the format.

## A taste

A doc embeds a snippet that the tool keeps current:

````markdown
```ts docref=src/lib/server/markdown.ts#applyFootnotes sha=4fa2b1c9
export function applyFootnotes(content: string): string {
  ...
}
```
````

A paragraph pins a claim to code in another repository:

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature sha=9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

When `VerifySignature` changes, the snippet refreshes mechanically and
the pinned paragraph is flagged for review until a reader confirms the
prose is still true.

## Design principles

1. **Plain text first.** Every artifact (references, markers, pins,
   config, lockfile) is readable and editable without the tool, and
   documents degrade to ordinary markdown everywhere.
2. **Fail closed.** A reference that does not resolve is an error, not
   a warning. Ambiguity is an error. Silence is never an option.
3. **Mechanical work is automated, judgment never is.** Snippet bodies
   refresh automatically. A pinned claim is only re-blessed by a reader
   who looked at the prose.
4. **Usable without AI, useful for AI.** One CLI contract serves
   humans, editors, CI, and agents alike. Agents get JSON; humans get
   the same answers in the editor.
5. **Renderer-neutral.** Site generators may opt into rendering badges
   and source links from the metadata, but nothing requires them to.

## Status

The core library, the CLI, and a first cut of the VSCode extension are
implemented and tested (milestones 1 through 5 of the plan): same-repo
and cross-repo resolution, symbols (TypeScript, JavaScript, Go, Python)
and regions, `check`, `refresh`, `bless`, `update`, `affected`, `ls`,
and in the editor: create-anchor from a selection, the references
sidebar with live states, drift diagnostics, referenced-by CodeLens,
and a status-bar counter.

```sh
bun install
bun test          # the contract suite
bun run build     # CLI bundle + extension bundle
```

To run the extension, open this repo in VSCode and press F5 (launches
an Extension Development Host on ../open-docs), or symlink
`packages/vscode` into your `~/.vscode/extensions` (or
`~/.vscode-oss/extensions`) as `manchtools.open-docref-vscode-0.1.0`
and restart the editor.

- [docs/format.md](docs/format.md): the normative format specification
- [docs/tooling.md](docs/tooling.md): CLI surface, CI patterns, VSCode
  extension, agent contract, implementation plan
