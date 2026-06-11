# docref format specification

Version: draft 1 (pre-implementation)

This document is normative for the on-disk format: how code is
anchored, how markdown carries references, how content is hashed, and
what states a reference can be in. The tool that operates on the format
is specified in [tooling.md](tooling.md).

## Terms

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

## 1. References

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

### Symbols

<!-- docref: begin src=packages/core/src/symbols.ts#listDeclarations:b9118450 -->

A symbol fragment names a declaration: function, method, class, type,
interface, enum, or top-level constant. Nesting uses `.`
(`Server.VerifySignature`). Resolution is structural (tree-sitter
queries against the parsed file), not textual.

<!-- docref: end -->

<!-- docref: begin src=packages/core/src/symbols.ts#findSymbol:a0e397ed -->

If the name matches more than one declaration in the file (overloads,
re-declarations), resolution **fails closed**: the ref is *broken* and
the fix is to use a region marker instead. The tool never guesses.

<!-- docref: end -->

### Regions and the `@` sigil

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d -->

The `@` sigil makes the resolver explicit: `#name` is always a symbol
lookup, `#@name` is always a marker lookup. There is no fallback from
one to the other. Without the sigil, a deleted marker whose name
happens to collide with a symbol would silently re-anchor the ref to
the wrong code; with it, the result is a loud "region not found".

<!-- docref: end -->

## 2. Region markers (in source files)

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

## 3. Snippets (in markdown)

A snippet is an ordinary fenced code block whose info string carries
docref attributes:

````markdown
```go docref=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3
func (s *Server) VerifySignature(req *Request) error {
    ...
}
```
````

<!-- docref: begin src=packages/core/src/markdown.ts#scanMarkdown:cd8ca97a,packages/core/src/markdown.ts#splitShaSuffix:30ec78f1,packages/core/src/markdown.ts#rewriteSnippets:7dc4de8e,packages/core/src/dedent.ts#dedent:1ded282f -->

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

## 4. Claims (in markdown)

A claim ties a span of prose to an anchor: "this text was verified
against that code".

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

<!-- docref: begin src=packages/core/src/markdown.ts#scanMarkdown:cd8ca97a,packages/core/src/markdown.ts#approveClaims:546d693e -->

- Claim comments use the same `docref: begin` / `docref: end` grammar
  as region markers. The argument forms differ: a code region takes a
  bare *name*; a claim takes `key=value` *attributes*. A token containing
  `=` is an attribute; otherwise it is a name.
- `src=` is required. Each source carries its own hash as a `:sha`
  suffix: the hash of the **referenced code** (not of the prose)
  recorded at approval time. A source without a suffix is unapproved,
  and the claim reports *stale-claim* until every source is approved.
- A claim may pin **several anchors**: `src=` takes a comma-separated
  list (no spaces), each entry its own `ref:sha`. The claim is broken
  if any source fails to resolve, stale if any drifted, and approved
  only as a whole. Snippets stay single-source; a fence materializes
  exactly one anchor.
- Claims do not nest. `end` is bare.
- The body is arbitrary markdown and belongs to the author. The tool
  never rewrites it.
- A snippet inside a claim is independent: its body still refreshes
  mechanically. Only the claim's shas require an approval. This is
  how a doc shows the current code *and* keeps a reviewed claim about
  it.

<!-- docref: end -->

HTML comments carry claims deliberately: they are
invisible on GitHub and in markdown previews, they survive Prettier,
and renderers that strip comments lose nothing visible.

### Collection files

A collection (research scratchpad) is just a markdown file made of
claims whose bodies are working notes, optionally with materialized
snippets inside. Collections are scanned and drift-checked like any other
markdown file, and folding research into real docs is cut-and-paste of
blocks. No separate format exists.

## 5. Hashing

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

## 6. Repositories, config, and lockfile

### `docref.toml` (authored, committed)

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

### `docref.lock` (tool-managed, committed)

```toml
[repos.open-secret]
rev = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

### Resolution semantics

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
- Because snippet bodies are materialized, **serving or rendering the
  docs never requires access to the referenced repositories**. Only
  `check`, `refresh`, and `update` do.

## 7. States

Every snippet and claim is in exactly one state:

<!-- docref: begin src=packages/core/src/ops.ts#State:18fd84bc -->

| State | Meaning | Resolution |
|---|---|---|
| `up-to-date` | anchor resolves, all hashes agree | nothing to do |
| `stale-snippet` | a snippet whose anchor resolves but whose recorded sha or body disagrees with the anchor | mechanical: `docref refresh` |
| `stale-claim` | a claim whose anchors resolve but whose recorded shas disagree (or are absent) | judgment: read the prose, fix it if needed, `docref approve` |
| `broken` | the anchor does not resolve: missing file, unknown symbol, ambiguous symbol, missing region, undeclared alias | author intervention; never auto-fixed |

<!-- docref: end -->

The defining rule of the whole system: **the tool may move anything in
and out of `stale-snippet` on its own, and may never move anything out
of `stale-claim` or `broken` on its own.**

## 8. Errors (fail closed)

All of the following are hard errors, not warnings:

<!-- docref: begin src=packages/core/src/resolve.ts#resolveAnchor:9908f20d,packages/core/src/symbols.ts#findSymbol:a0e397ed,packages/core/src/regions.ts#scanRegions:5fcc3f83,packages/core/src/ref.ts#parseRef:5e6d511d,packages/core/src/markdown.ts#scanMarkdown:cd8ca97a -->

- a ref whose path does not exist at the resolved rev
- a symbol fragment matching zero or multiple declarations
- a region fragment with no matching marker pair
- duplicate region names in one file; unmatched `begin`/`end`
- an alias not declared in `docref.toml`; an alias declared but absent
  from `docref.lock`
- a nested claim
- a malformed reference (unparseable attributes, missing `docref=`/`src=`)

<!-- docref: end -->

## 9. Renderers (informative)

Renderers need no docref support: fences are ordinary code blocks and
claim comments are invisible. A renderer that opts in may, for example,
show a provenance caption on fences ("from `handler.go`", linking to
the source at the locked rev), render a verified badge on claims,
or resolve and display an anchor's current contents at build time by
invoking the resolver. Such integrations are out of scope for the
format and must not change document semantics for other renderers.
