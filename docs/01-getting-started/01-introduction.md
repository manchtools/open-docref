---
title: Introduction
description: What docref is: a plain-text convention plus a small tool that keeps documentation anchored to the code it describes, so drift is never silent.
---

# Introduction

docref is a plain-text convention plus a small tool. Markdown documents
reference code by symbol or by marked region, and every reference carries a
content hash of what the author last saw. When the code changes, the reference
goes stale loudly: in the editor, in CI, and in a machine-readable report that
an AI agent can act on. Divergence stops being silent.

The convention is renderer-neutral. Documents using docref render normally on
GitHub, in the VS Code preview, and in any static site generator; the metadata
hides in fence info strings and HTML comments. No tool needs to be installed to
read or write the format.

## A taste

A doc embeds a snippet that the tool keeps current:

````markdown
```ts docref=src/lib/server/markdown.ts#applyFootnotes:4fa2b1c9
export function applyFootnotes(content: string): string {
  ...
}
```
````

A claim ties a paragraph to code in another repository:

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

When `VerifySignature` changes, the snippet refreshes mechanically and the claim
is flagged for review until a reader confirms the prose is still true and
approves it.

## Anchors

A reference names a piece of code: a **symbol** (a declaration, found by parsing,
no marker needed) or a **region** (a span named in the source with
`docref: begin <name>` / `docref: end <name>`, for sub-symbol slices). The code
side has its own loud signal, not just the docs:

<!-- docref: begin src=packages/core/src/ops.ts#anchors:8d9d6ba5,packages/core/src/ops.ts#exitCode:57a1b5ed -->
`docref anchors` inventories every region marker and what references it, and a
marker that nothing references is flagged **not used**, which fails
`docref check` unless `[anchors] allow-unused = true`. A stranded marker, like a
broken reference, never passes silently.
<!-- docref: end -->

## Design principles

1. **Plain text first.** Every artifact (references, markers, claims, config,
   lockfile) is readable and editable without the tool, and documents degrade to
   ordinary markdown everywhere.
2. **Fail closed.** A reference that does not resolve is an error, not a warning.
   Ambiguity is an error. Silence is never an option.
3. **Mechanical work is automated, judgment never is.** Snippet bodies refresh
   automatically. A claim is only re-approved by a reader who looked at the prose.
4. **Usable without AI, useful for AI.** One CLI contract serves humans, editors,
   CI, and agents alike. Agents get JSON; humans get the same answers in the editor.
5. **Renderer-neutral.** Site generators may opt into rendering badges and source
   links from the metadata, but nothing requires them to.

## Supported languages

Structural (tree-sitter) symbol resolution covers:

<!-- docref: begin src=packages/core/src/languages.ts#LanguageId:85e3e28e -->

TypeScript, JavaScript, Go, Python, Rust, Java, C, C++, C#, Ruby, PHP, Swift,
Kotlin, Scala, Bash, and Protocol Buffers. Any other file type still works with
a region marker.

<!-- docref: end -->
