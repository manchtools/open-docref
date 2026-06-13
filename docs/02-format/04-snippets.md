---
title: Snippets
description: Fenced code blocks whose bodies the tool materializes and keeps in sync with the anchored code.
---

# Snippets

A snippet is an ordinary fenced code block whose info string carries
docref attributes:

````markdown
```go docref=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3
func (s *Server) VerifySignature(req *Request) error {
    ...
}
```
````

<!-- docref: begin src=packages/core/src/markdown.ts#scanMarkdown:d108e8c0,packages/core/src/markdown.ts#splitShaSuffix:6a2cefbf,packages/core/src/markdown.ts#rewriteSnippets:7dc4de8e,packages/core/src/dedent.ts#dedent:1ded282f -->

- The info string is: language word first (CommonMark convention, so
  syntax highlighting works everywhere), then space-separated
  `key=value` attributes in any order. Unknown keys are preserved.
- `docref=` is required. The hash rides on the ref as a `:sha`
  suffix, written by the tool; a snippet without one is treated as
  never-refreshed and is stale by definition. The alias separator is
  the first colon of a ref, the sha suffix the last, and fragments
  cannot contain colons, so the two never collide.
- The body is **materialized**: the tool writes the extracted anchor
  contents into the fence and commits them. Readers and renderers see
  a complete, ordinary code block; nothing resolves at render time.
- Extraction starts at the beginning of the anchor's first line and
  removes the common leading indentation, so a method nested in a class
  materializes flush left with its internal nesting preserved. This is
  purely presentational; hashing strips all whitespace anyway.
- The body is owned by the tool. Hand edits are detected (the body no
  longer hashes to the recorded sha) and overwritten by the next
  refresh.

<!-- docref: end -->

A snippet is *up-to-date* when the anchor's current hash, the
recorded `:sha`, and the hash of the body all agree. Any disagreement makes
it *stale-snippet*; see section 5.
