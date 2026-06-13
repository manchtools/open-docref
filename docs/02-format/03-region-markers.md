---
title: Region markers
description: Marker lines in source files for sub-symbol slices and file types where structural resolution is unavailable.
---

# Region markers

A region is delimited by two marker lines:

```
docref: begin <name>
docref: end <name>
```

The tokens may appear anywhere in a line, behind any comment leader.
The grammar is therefore language-agnostic without per-language comment
parsing:

```ts
// docref: begin footnote-ordering
```
```python
# docref: begin retry-loop
```
```sql
-- docref: begin tenant-scope
```
```html
<!-- docref: begin nav-skeleton -->
```

Rules:

<!-- docref: begin src=packages/core/src/regions.ts#scanRegions:5fcc3f83 -->

- Recognition pattern: `docref:\s*(begin|end)\s+([a-z0-9][a-z0-9-]*)`.
- Names are kebab-case and **unique per file**. A duplicate `begin`
  with the same name in one file is an error.
- `end` always carries the name. This keeps nested and overlapping
  regions unambiguous; both are permitted.
- An unmatched `begin` or `end` is an error.
- The marker lines themselves are **excluded** from extraction and from
  hashing.

<!-- docref: end -->

Symbols need no marker and are the default. Markers are for sub-symbol
slices (five specific lines inside a function) or for languages and
file types where structural resolution is unavailable.
