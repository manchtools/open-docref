---
title: Hashing
description: How anchored content is whitespace-stripped and hashed so formatters never invalidate a reference.
---

# Hashing

```
hash = lowercase hex sha256( utf8( strip-whitespace( content ) ) )
```

<!-- docref: begin src=packages/core/src/hash.ts#stripWhitespace:b0552a8d,packages/core/src/hash.ts#shortHash:67b3653c -->

- `strip-whitespace` removes **every** code point with the Unicode
  `White_Space` property, including newlines. Formatters (Prettier,
  gofmt, indentation churn) therefore never invalidate a hash; only
  token changes do.
- `content` is the anchored code: the symbol's full declaration span,
  the region between (excluding) its marker lines, or the whole file.
- References store the first **8 hex characters**. Longer prefixes are
  accepted when comparing. A collision does not corrupt anything; at
  worst it delays one review prompt.

<!-- docref: end -->

Known accepted blind spot: a change that alters only whitespace, such
as moving a Python statement into or out of a block by indentation
alone, hashes identically and will not trigger review. The cost is a
missed prompt, not a wrong build, and the formatter resilience is worth
more.
