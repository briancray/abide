# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). It drives
versioning, the `CHANGELOG.md`, npm publishing, and GitHub Releases for `@briancray/abide`.

## Adding a changeset

When you make a change worth releasing, run:

```sh
bun run changeset
```

Pick the semver bump (patch / minor / major) and write a short description. This writes a
markdown file here. Commit it alongside your change.

## How a release happens

1. Merging changeset files to `main` makes the release workflow open a **"Version Packages"** PR
   that bumps the version, consumes the changesets, and updates `CHANGELOG.md`.
2. Merging that PR publishes to npm and creates a GitHub Release.

See [the docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
for more.
