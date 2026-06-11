# Agent instructions

This repository anchors its own documentation to its code with docref — it
dogfoods the tool it ships. After you change code, keep the docs honest in the
same change:

1. Find what your change endangers (compare against the merge-base with the
   branch you will merge into):

   ```sh
   node packages/cli/dist/docref.js affected --since <merge-base> --json
   ```

2. For each affected document:
   - **snippets** — run `docref refresh <doc>`. Mechanical and always safe; it
     rewrites the materialized body and its hash.
   - **claims** — read the prose. If your change made it untrue, fix the prose,
     then `docref approve <doc>`. Never approve a claim without reading it.

3. `docref check` must exit `0` before you are done.

Build the CLI first with `bun run build` (the bundle is at
`packages/cli/dist/docref.js`). The development loop and the test bar are in
[CONTRIBUTING.md](CONTRIBUTING.md); the format and tool are specified in
[docs/format.md](docs/format.md) and [docs/tooling.md](docs/tooling.md).
