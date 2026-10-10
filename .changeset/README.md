# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). It drives
versioning, each package's `CHANGELOG.md`, npm publishing and GitHub Releases for `@abide/abide`
and `@abide/bridge`.

A changeset is usually written for you: `scripts/autofillChangesets.ts` turns every conventional
commit since the last release that touches a published package's shipped files into one —
`feat:` is a minor, anything else a patch. Write one by hand (`bun run changeset`) when the
commit subject is not the release note you want; a hand-written one always wins.

## How a release happens

1. A push to `main` with changesets present makes the release workflow open a
   **"chore: version packages"** PR that bumps versions and writes the changelogs.
2. Merging that PR publishes to npm and creates a GitHub Release.

`/ship` (`.claude/skills/ship/SKILL.md`) drives both steps.
