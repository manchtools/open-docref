---
title: Symbols
description: Symbol fragments, structural tree-sitter resolution, and the `@` sigil for regions.
---

# Symbols

<!-- docref: begin src=packages/core/src/symbols.ts#listDeclarations:e4a10ace -->

A symbol fragment names a declaration: a function, method, class, type,
interface, enum, or top-level constant. It also names a member whose identity
is part of an API contract: a class field, a struct field, or an
interface/protocol property anchors as `Type.field`, and a protobuf message
field or enum value (whose number is wire-breaking) anchors the same way.
Nesting uses `.` (`Server.VerifySignature`, `User.email`). Resolution is
structural (tree-sitter queries against the parsed file), not textual.

<!-- docref: end -->

<!-- docref: begin src=packages/core/src/symbols.ts#findSymbol:02623a31 -->

If the name matches more than one declaration in the file (two types that
share a field name, overloads, re-declarations), resolution **fails closed**:
the ref is *broken* and the fix is to qualify it with the full path
(`Type.member`) or use a region marker. An exact top-level name wins over a
member that merely shares its leaf, so a top-level declaration is never shadowed
by a nested field. The tool never guesses.

<!-- docref: end -->

## Regions and the `@` sigil

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d -->

The `@` sigil makes the resolver explicit: `#name` is always a symbol
lookup, `#@name` is always a marker lookup. There is no fallback from
one to the other. Without the sigil, a deleted marker whose name
happens to collide with a symbol would silently re-anchor the ref to
the wrong code; with it, the result is a loud "region not found".

<!-- docref: end -->
