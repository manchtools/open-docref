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
- **Carrier**: the markdown construct holding a ref. Either a *snippet
  fence* (code block with materialized contents) or a *pin block*
  (a comment-delimited span of prose).
- **Blessing**: recording the hash of the anchored content at the
  moment a human or agent confirmed the carrier's contents are true.

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

- **No fragment** means the whole file is the anchor.
- **No alias** means the containing repository; the ref resolves
  against the working tree.
- **An alias** must be declared in `docref.toml` (section 6); an
  undeclared alias is a configuration error.
- Line numbers and line ranges are deliberately not part of the
  grammar. They rot on the next edit and would undermine the whole
  design.

### Symbols

A symbol fragment names a declaration: function, method, class, type,
interface, enum, or top-level constant. Nesting uses `.`
(`Server.VerifySignature`). Resolution is structural (tree-sitter
queries against the parsed file), not textual.

If the name matches more than one declaration in the file (overloads,
re-declarations), resolution **fails closed**: the ref is *broken* and
the fix is to use a region marker instead. The tool never guesses.

### Regions and the `@` sigil

The `@` sigil makes the resolver explicit: `#name` is always a symbol
lookup, `#@name` is always a marker lookup. There is no fallback from
one to the other. Without the sigil, a deleted marker whose name
happens to collide with a symbol would silently re-anchor the ref to
the wrong code; with it, the result is a loud "region not found".

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

- Recognition pattern: `docref:\s*(begin|end)\s+([a-z0-9][a-z0-9-]*)`.
- Names are kebab-case and **unique per file**. A duplicate `begin`
  with the same name in one file is an error.
- `end` always carries the name. This keeps nested and overlapping
  regions unambiguous; both are permitted.
- An unmatched `begin` or `end` is an error.
- The marker lines themselves are **excluded** from extraction and from
  hashing.

Symbols need no marker and are the default. Markers are for sub-symbol
slices (five specific lines inside a function) or for languages and
file types where structural resolution is unavailable.

## 3. Snippet fences (in markdown)

A snippet fence is an ordinary fenced code block whose info string
carries docref attributes:

````markdown
```go docref=open-secret:src/api/handler.go#VerifySignature sha=9c2f1ab3
func (s *Server) VerifySignature(req *Request) error {
    ...
}
```
````

- The info string is: language word first (CommonMark convention, so
  syntax highlighting works everywhere), then space-separated
  `key=value` attributes in any order. Unknown keys are preserved.
- `docref=` is required. `sha=` is written by the tool; a fence without
  it is treated as never-refreshed and is stale by definition.
- The body is **materialized**: the tool writes the extracted anchor
  contents into the fence and commits them. Readers and renderers see
  a complete, ordinary code block; nothing resolves at render time.
- The body is owned by the tool. Hand edits are detected (the body no
  longer hashes to `sha=`) and overwritten by the next refresh.

A fence is *fresh* when the anchor's current hash, the `sha=`
attribute, and the hash of the fence body all agree. Any disagreement
makes it *stale-snippet*; see section 5.

## 4. Pin blocks (in markdown)

A pin block ties a span of prose to an anchor. It claims "this text was
verified against that code":

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature sha=9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

- Carrier comments use the same `docref: begin` / `docref: end` grammar
  as region markers. The argument forms differ: a code region takes a
  bare *name*; a pin takes `key=value` *attributes*. A token containing
  `=` is an attribute; otherwise it is a name.
- `src=` is required. `sha=` is the hash of the **referenced code
  region** (not of the prose) recorded at blessing time. A pin without
  `sha=` is unblessed and reported as *stale-claim* until first
  blessed.
- Pin blocks do not nest. `end` is bare.
- The body is arbitrary markdown and belongs to the author. The tool
  never rewrites it.
- A snippet fence inside a pin block is an independent carrier: its
  body still refreshes mechanically. Only the pin's `sha=` requires a
  blessing. This is how a doc shows the current code *and* keeps a
  reviewed claim about it.

HTML comments were chosen as the carrier deliberately: they are
invisible on GitHub and in markdown previews, they survive Prettier,
and renderers that strip comments lose nothing visible.

### Collection files

A collection (research scratchpad) is just a markdown file made of pin
blocks whose bodies are working notes, optionally with materialized
fences inside. Collections are scanned and drift-checked like any other
markdown file, and folding research into real docs is cut-and-paste of
blocks. No separate format exists.

## 5. Hashing

```
hash = lowercase hex sha256( utf8( strip-whitespace( content ) ) )
```

- `strip-whitespace` removes **every** code point with the Unicode
  `White_Space` property, including newlines. Formatters (Prettier,
  gofmt, indentation churn) therefore never invalidate a hash; only
  token changes do.
- `content` is the anchored code: the symbol's full declaration span,
  the region between (excluding) its marker lines, or the whole file.
- Carriers store the first **8 hex characters**. Longer prefixes are
  accepted when comparing. A collision does not corrupt anything; at
  worst it delays one review prompt.

Known accepted blind spot: a change that alters only whitespace, such
as moving a Python statement into or out of a block by indentation
alone, hashes identically and will not trigger review. The cost is a
missed prompt, not a wrong build, and the formatter resilience is worth
more.

## 6. Repositories, config, and lockfile

### `docref.toml` (authored, committed)

Lives at the root of the repository containing the markdown. Declares
cross-repo aliases and scan scope:

```toml
[scan]
include = ["docs/**/*.md", "README.md"]   # default: **/*.md
exclude = ["node_modules/**"]             # always excluded anyway

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

- **Same-repo refs float.** They resolve against the working tree, so
  drift is visible the moment the code is edited. In CI the working
  tree is the checkout, so the committed tree is what is checked.
- **Cross-repo refs are pinned.** They resolve against a cached
  checkout at the locked `rev`, so they can never drift silently.
  Drift surfaces when `docref update` advances the pin, which is a
  deliberate, batched, reviewable event (typically a scheduled CI job).
- The cache is a shallow clone per repository under
  `$XDG_CACHE_HOME/docref/<host>/<owner>/<repo>`, fetched at the locked
  rev. Git is invoked as the system `git`, so existing credentials
  (SSH keys, credential helpers) cover private repositories with no
  extra configuration.
- Because fence bodies are materialized, **serving or rendering the
  docs never requires access to the referenced repositories**. Only
  `check`, `refresh`, and `update` do.

## 7. States

Every carrier is in exactly one state:

| State | Meaning | Resolution |
|---|---|---|
| `fresh` | anchor resolves, all hashes agree | nothing to do |
| `stale-snippet` | a fence whose anchor resolves but whose `sha=` or body disagrees with the anchor | mechanical: `docref refresh` |
| `stale-claim` | a pin whose anchor resolves but whose `sha=` disagrees (or is absent) | judgment: read the prose, fix it if needed, `docref bless` |
| `broken` | the anchor does not resolve: missing file, unknown symbol, ambiguous symbol, missing region, undeclared alias | author intervention; never auto-fixed |

The defining rule of the whole system: **the tool may move anything in
and out of `stale-snippet` on its own, and may never move anything out
of `stale-claim` or `broken` on its own.**

## 8. Errors (fail closed)

All of the following are hard errors, not warnings:

- a ref whose path does not exist at the resolved rev
- a symbol fragment matching zero or multiple declarations
- a region fragment with no matching marker pair
- duplicate region names in one file; unmatched `begin`/`end`
- an alias not declared in `docref.toml`; an alias declared but absent
  from `docref.lock`
- a nested pin block
- a malformed carrier (unparseable attributes, missing `docref=`/`src=`)

## 9. Renderers (informative)

Renderers need no docref support: fences are ordinary code blocks and
pin comments are invisible. A renderer that opts in may, for example,
show a provenance caption on fences ("from `handler.go`", linking to
the source at the locked rev), render a verified badge on pin blocks,
or resolve and display an anchor's current contents at build time by
invoking the resolver. Such integrations are out of scope for the
format and must not change document semantics for other renderers.
