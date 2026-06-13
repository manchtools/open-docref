---
label: Format
icon: "📐"
---

# Format specification

Version: draft 1 (pre-implementation)

This document is normative for the on-disk format: how code is
anchored, how markdown carries references, how content is hashed, and
what states a reference can be in. The tool that operates on the format
is specified in [Tooling & CLI](/tooling).

- **Anchor**: an addressable piece of code. Either a *symbol* (a named
  declaration found by parsing) or a *region* (a span delimited by
  marker comments) or a *whole file*.
- **Reference (ref)**: a locator string naming an anchor, optionally in
  another repository.
- **Snippet**: a fenced code block whose contents the tool keeps in
  sync with the anchored code.
- **Claim**: a comment-delimited span of prose asserting something
  about anchored code; it needs a human re-approval when that code
  changes.
- **Approval**: recording the hash of the anchored content at the
  moment a human or agent confirmed the prose is still true.

{% cards %}
{% card title="References" href="/format/references" icon="🔗" %}
The ref grammar: alias, path, and fragment, and what each part anchors.
{% /card %}
{% card title="Symbols" href="/format/symbols" icon="🔣" %}
Symbol fragments, structural resolution, and the `@` region sigil.
{% /card %}
{% card title="Region markers" href="/format/region-markers" icon="📍" %}
Marker lines in source files for sub-symbol slices and any file type.
{% /card %}
{% card title="Snippets" href="/format/snippets" icon="📋" %}
Fenced code blocks the tool materializes and keeps in sync.
{% /card %}
{% card title="Claims" href="/format/claims" icon="✍️" %}
Prose pinned to anchors, re-approved by a human when the code changes.
{% /card %}
{% card title="Hashing" href="/format/hashing" icon="🔐" %}
How content is whitespace-stripped and hashed to detect drift.
{% /card %}
{% card title="Repositories, config, and lockfile" href="/format/repositories-and-config" icon="🗂️" %}
`docref.toml`, `docref.lock`, and same-repo vs cross-repo resolution.
{% /card %}
{% card title="Reference states" href="/format/states" icon="🚦" %}
The four states every snippet and claim can be in.
{% /card %}
{% card title="Errors & renderers" href="/format/errors" icon="⛔" %}
The fail-closed error set and informative notes for renderers.
{% /card %}
{% /cards %}
