---
title: Repositories, config, and lockfile
description: The authored `docref.toml`, the tool-managed `docref.lock`, and same-repo vs cross-repo resolution semantics.
label: Repositories & config
---

# Repositories, config, and lockfile

## `docref.toml` (authored, committed)

<!-- docref: begin src=packages/core/src/config.ts#loadProject:56a6649b -->

Lives at the root of the repository containing the markdown. Declares
cross-repo aliases and scan scope:

<!-- docref: end -->

```toml
[scan]
include = ["docs/**/*.md", "README.md"]   # default: **/*.md
exclude = ["node_modules/**"]             # always excluded anyway

[anchors]
include = ["src/**"]                      # default: everything; where
exclude = ["vendor/**"]                   # region markers are inventoried
allow-unused = false                      # default: an unreferenced
                                          # marker fails `docref check`

[repos.open-secret]
url = "https://github.com/manchtools/open-secret"
ref = "main"        # branch tracked by `docref update`; default: the
                    # remote default branch
```

## `docref.lock` (tool-managed, committed)

```toml
[repos.open-secret]
rev = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

## Resolution semantics

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d,packages/core/src/gitcache.ts#gitRevSource:c1e10c7e -->

- **Same-repo refs float.** They resolve against the working tree, so
  drift is visible the moment the code is edited. In CI the working
  tree is the checkout, so the committed tree is what is checked.
- **Cross-repo refs are pinned.** They resolve against a cached
  checkout at the locked `rev`, so they can never drift silently.
  Drift surfaces when `docref update` advances the pin, which is a
  deliberate, batched, reviewable event (typically a scheduled CI job).

<!-- docref: end -->
<!-- docref: begin src=packages/core/src/gitcache.ts#cacheDirFor:e0236b27,packages/core/src/gitcache.ts#ensureCommit:0ee546f2 -->

- The cache is a shallow clone per repository under
  `$XDG_CACHE_HOME/docref/<host>/<owner>/<repo>`, fetched at the locked
  rev. Git is invoked as the system `git`, so existing credentials
  (SSH keys, credential helpers) cover private repositories with no
  extra configuration.

<!-- docref: end -->
- Because snippet bodies are materialized, **serving or rendering the docs never requires access to the referenced repositories**. Only
  `check`, `refresh`, and `update` do.
