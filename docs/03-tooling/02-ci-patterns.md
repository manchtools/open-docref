---
title: CI patterns
description: How to wire docref into CI: gate every push, sync snippets mechanically, and watch cross-repo drift on a schedule.
---

# CI patterns

- **Gate (every push/PR):** `docref check`. Blocks merging docs whose
  refs are broken, and code changes that strand same-repo refs.
- **Mechanical sync (pre-commit or bot):** `docref refresh` keeps
  snippet bodies current; as a scheduled bot it opens a PR whose diff is
  itself the review surface.
- **Cross-repo watch (scheduled):** `docref update --check` nightly in
  the docs repository. The morning after a referenced repository
  changes an anchored region, the job goes red and names the affected
  pages. Advancing the pin is then a normal PR via `docref update`.

The gate is what makes divergence *hard* rather than merely visible;
the editor integration only makes it cheap to fix early.
