---
title: Symbols
description: Symbol fragments, structural tree-sitter resolution, and the `@` sigil for regions.
---

# Symbols

<!-- docref: begin src=packages/core/src/symbols.ts#listDeclarations:f87e8a33 -->

A symbol fragment names a declaration: function, method, class, type,
interface, enum, or top-level constant — and, where a language makes a
member's identity part of a contract, that member too: a protobuf message
field or enum value, whose number is wire-breaking, anchors as
`Message.field`. Nesting uses `.` (`Server.VerifySignature`). Resolution is
structural (tree-sitter queries against the parsed file), not textual.

<!-- docref: end -->

<!-- docref: begin src=packages/core/src/symbols.ts#findSymbol:a0e397ed -->

If the name matches more than one declaration in the file (overloads,
re-declarations), resolution **fails closed**: the ref is *broken* and
the fix is to use a region marker instead. The tool never guesses.

<!-- docref: end -->

## Regions and the `@` sigil

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d -->

The `@` sigil makes the resolver explicit: `#name` is always a symbol
lookup, `#@name` is always a marker lookup. There is no fallback from
one to the other. Without the sigil, a deleted marker whose name
happens to collide with a symbol would silently re-anchor the ref to
the wrong code; with it, the result is a loud "region not found".

<!-- docref: end -->
