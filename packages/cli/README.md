# open-docref

Keep documentation anchored to the code it describes.

docref is a plain-text convention plus a small CLI. Markdown documents
reference code by symbol or by marked region, and every reference carries a
content hash of what the author last saw. When the code changes, the reference
goes stale loudly — in CI, in the editor, and in a machine-readable report an
AI agent can act on.

```sh
npm install -g open-docref      # or: npx open-docref check
docref check                    # report drift; exit 1 stale, exit 2 broken
docref refresh                  # rewrite stale code snippets (mechanical)
docref approve <doc>            # record a claim review (judgment)
docref affected --since <rev>   # which docs a change endangers (agents)
```

The convention is renderer-neutral: documents render normally on GitHub and in
any static-site generator, because the metadata hides in fence info strings and
HTML comments. Nothing needs to be installed to read or write the format.

- **Snippets** materialize code into a fenced block and refresh mechanically.
- **Claims** pin a paragraph to code; they go stale when the code changes and
  only a human (or agent) who re-read the prose may approve them.
- **Cross-repo** references resolve from a pinned, shallow git cache, so drift
  is a deliberate, reviewable `docref update`.

Symbol resolution ships as WebAssembly tree-sitter grammars (TypeScript,
JavaScript, Go, Python); regions work in any language. Requires Node 18+.

See the [project README](https://github.com/manchtools/open-docref) for the
format specification, CI patterns, the VS Code extension, and the agent
contract.

MIT licensed.
