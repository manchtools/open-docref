---
title: References
description: The reference grammar (alias, path, and fragment) and what each part anchors.
---

# References

```
ref      = [alias ":"] path ["#" fragment]
alias    = [a-z0-9][a-z0-9-]*          ; declared in docref.toml
path     = repo-relative POSIX path, no leading "./", no spaces
fragment = symbol | "@" region-name
```

Examples:

```
src/lib/server/markdown.ts#applyFootnotes      same repo, symbol
src/api/handler.go#Server.VerifySignature      same repo, method
src/lib/server/markdown.ts#@footnote-ordering  same repo, region
open-secret:src/api/handler.go#VerifySignature cross repo, symbol
config/default.toml                            same repo, whole file
```

<!-- docref: begin src=packages/core/src/ref.ts#parseRef:5e6d511d,packages/core/src/resolve.ts#resolveAnchor:9908f20d -->

- **No fragment** means the whole file is the anchor.
- **No alias** means the containing repository; the ref resolves
  against the working tree.
- **An alias** must be declared in `docref.toml` (section 6); an
  undeclared alias is a configuration error.
- Line numbers and line ranges are deliberately not part of the
  grammar. They rot on the next edit and would undermine the whole
  design.

<!-- docref: end -->
