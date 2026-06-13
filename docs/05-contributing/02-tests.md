---
title: Tests are part of the change
label: Tests
description: Every behaviour change ships with its tests in the same commit, asserting the rejection paths, not only the happy path.
---

# Tests are part of the change, not a follow-up

Every behaviour change ships with its tests in the same commit. The bar is the
one the milestones already set: each lands with tests that assert the
**rejection** paths (broken refs, ambiguous symbols, tampered fences, nested
claims, unsafe input), not only the happy path. A test that only checks "it
works" is not enough; cover the correct, the absent, and the present-but-wrong,
and derive the wrong case from what the format intends rather than from the code
under test.

When you find a bug, write the failing test first, watch it fail for the right
reason, then fix the code. A correct-behaviour test that fails is a finding in
the implementation; never quiet it with a skip to make the suite green.
