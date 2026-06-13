---
title: Errors & renderers
description: The fail-closed error set that all hard errors belong to, plus informative notes for renderers.
label: Errors & renderers
---

# Errors & renderers

## Errors (fail closed)

All of the following are hard errors, not warnings:

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d,packages/core/src/symbols.ts#findSymbol:02623a31,packages/core/src/regions.ts#scanRegions:6b2f236c,packages/core/src/ref.ts#parseRef:b54f5326,packages/core/src/markdown.ts#scanMarkdown:d108e8c0 -->

- a ref whose path does not exist at the resolved rev
- a symbol fragment matching zero or multiple declarations
- a region fragment with no matching marker pair
- duplicate region names in one file; unmatched `begin`/`end`
- an alias not declared in `docref.toml`; an alias declared but absent
  from `docref.lock`
- a nested claim
- a malformed reference (unparseable attributes, missing `docref=`/`src=`)

<!-- docref: end -->

## Renderers (informative)

Renderers need no docref support: fences are ordinary code blocks and
claim comments are invisible. A renderer that opts in may, for example,
show a provenance caption on fences ("from `handler.go`", linking to
the source at the locked rev), render a verified badge on claims,
or resolve and display an anchor's current contents at build time by
invoking the resolver. Such integrations are out of scope for the
format and must not change document semantics for other renderers.
