---
title: Changing the format
label: Changing the format
description: The format is a pre-1.0 contract — what to update when you change it, commit conventions, and how to report a security issue.
---

# Changing the format

The format is pre-1.0 but it is still a contract: documents and source files in
the wild carry these references and hashes. If a change alters what is written
to disk or how a reference resolves, update the [Format specification](/format)
or [Tooling & CLI](/tooling) in the same change and add an entry to the
[Changelog](/changelog) under `Unreleased`, calling out the compatibility impact
explicitly.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
`feat:`, `fix:`, `docs:`, `refactor:`, `ci:`, with a `!` (for example
`refactor!:`) when the change breaks the format or a public interface. Keep the
subject in the imperative mood and let the body explain the why. Group a change
and its tests together.

## Reporting a security issue

The tool shells out to `git` and resolves references from other repositories, so
input handling is security-relevant. If you find a vulnerability, please report
it privately to the maintainers rather than opening a public issue, and give
them a chance to ship a fix before any disclosure.
